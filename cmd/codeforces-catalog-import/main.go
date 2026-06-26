package main

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"log"
	"mime/multipart"
	"net/http"
	"os"
	"os/signal"
	"sort"
	"strconv"
	"strings"
	"syscall"
	"time"

	"arcade/internal/catalogimport"
)

const (
	codeforcesProblemsetURL = "https://codeforces.com/api/problemset.problems"
	defaultSourceSlug       = "codeforces-problemset"
	defaultSourceName       = "Codeforces Problemset"
	defaultTemplate         = "https://codeforces.com/problemset/problem/{contest_id}/{index}"
)

func main() {
	var rawFile string
	var jsonlOut string
	var endpoint string
	var dryRun bool
	var timeout time.Duration

	flag.StringVar(&rawFile, "raw-file", "", "read a saved Codeforces problemset.problems JSON response instead of fetching live")
	flag.StringVar(&jsonlOut, "jsonl-out", "", "write generated normalized JSONL to this path")
	flag.StringVar(&endpoint, "endpoint", "", "optional Arcade /api/catalog-imports URL to upload to")
	flag.BoolVar(&dryRun, "dry-run", false, "validate locally and request a dry-run when uploading")
	flag.DurationVar(&timeout, "timeout", 30*time.Second, "HTTP timeout for fetch and upload requests")
	flag.Parse()

	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	raw, err := loadRawCodeforces(ctx, rawFile, timeout)
	if err != nil {
		log.Fatalf("load Codeforces data: %v", err)
	}

	jsonl, skipped, err := formatCodeforcesJSONL(raw, time.Now().UTC())
	if err != nil {
		log.Fatalf("format Codeforces data: %v", err)
	}
	if skipped > 0 {
		log.Printf("skipped %d Codeforces rows missing contestId or index", skipped)
	}

	_, result, err := catalogimport.ParseJSONL(bytes.NewReader(jsonl), catalogimport.Options{
		DryRun:      dryRun,
		AllowGlobal: true,
	})
	if err != nil {
		log.Fatalf("validate generated JSONL: %v", err)
	}
	if len(result.Errors) > 0 {
		_ = json.NewEncoder(os.Stdout).Encode(result)
		log.Fatal("generated JSONL failed catalog import validation")
	}
	log.Printf("generated %d items and %d fields", result.Counts.ItemsSeen, result.Counts.FieldsSeen)

	if jsonlOut != "" {
		if err := os.WriteFile(jsonlOut, jsonl, 0o644); err != nil {
			log.Fatalf("write JSONL: %v", err)
		}
	}

	if endpoint != "" {
		body, status, err := uploadJSONL(ctx, endpoint, jsonl, dryRun, timeout)
		if err != nil {
			log.Fatalf("upload JSONL: %v", err)
		}
		fmt.Print(string(body))
		if status < 200 || status >= 300 {
			os.Exit(1)
		}
		return
	}

	if dryRun {
		if err := json.NewEncoder(os.Stdout).Encode(result); err != nil {
			log.Fatalf("write dry-run result: %v", err)
		}
		return
	}

	if jsonlOut == "" {
		_, _ = os.Stdout.Write(jsonl)
	}
}

type codeforcesResponse struct {
	Status  string `json:"status"`
	Comment string `json:"comment"`
	Result  struct {
		Problems          []codeforcesProblem          `json:"problems"`
		ProblemStatistics []codeforcesProblemStatistic `json:"problemStatistics"`
	} `json:"result"`
}

type codeforcesProblem struct {
	ContestID *int     `json:"contestId"`
	Index     string   `json:"index"`
	Name      string   `json:"name"`
	Type      string   `json:"type"`
	Points    *float64 `json:"points"`
	Rating    *int     `json:"rating"`
	Tags      []string `json:"tags"`
}

type codeforcesProblemStatistic struct {
	ContestID   *int   `json:"contestId"`
	Index       string `json:"index"`
	SolvedCount int    `json:"solvedCount"`
}

type importManifestLine struct {
	Schema        string                  `json:"schema"`
	Kind          string                  `json:"kind"`
	GeneratedAt   string                  `json:"generated_at"`
	CatalogSource importCatalogSourceLine `json:"catalog_source"`
	Provider      importProviderLine      `json:"provider"`
}

type importCatalogSourceLine struct {
	Slug     string `json:"slug"`
	Name     string `json:"name"`
	Scope    string `json:"scope"`
	Template string `json:"template"`
}

type importProviderLine struct {
	Slug    string `json:"slug"`
	Name    string `json:"name"`
	BaseURL string `json:"base_url"`
}

type importFieldLine struct {
	Schema            string `json:"schema"`
	Kind              string `json:"kind"`
	CatalogSourceSlug string `json:"catalog_source_slug"`
	Key               string `json:"key"`
	Label             string `json:"label"`
	ValueType         string `json:"value_type"`
	IsArray           bool   `json:"is_array"`
	DisplayOrder      int    `json:"display_order"`
}

type importItemLine struct {
	Schema            string         `json:"schema"`
	Kind              string         `json:"kind"`
	CatalogSourceSlug string         `json:"catalog_source_slug"`
	ExternalID        string         `json:"external_id"`
	Data              map[string]any `json:"data"`
}

func loadRawCodeforces(ctx context.Context, rawFile string, timeout time.Duration) ([]byte, error) {
	if rawFile != "" {
		return os.ReadFile(rawFile)
	}

	request, err := http.NewRequestWithContext(ctx, http.MethodGet, codeforcesProblemsetURL, nil)
	if err != nil {
		return nil, err
	}
	client := &http.Client{Timeout: timeout}
	response, err := client.Do(request)
	if err != nil {
		return nil, err
	}
	defer response.Body.Close()
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return nil, fmt.Errorf("Codeforces returned HTTP %d", response.StatusCode)
	}
	return io.ReadAll(response.Body)
}

func formatCodeforcesJSONL(raw []byte, generatedAt time.Time) ([]byte, int, error) {
	var response codeforcesResponse
	if err := json.Unmarshal(raw, &response); err != nil {
		return nil, 0, err
	}
	if response.Status != "OK" {
		if response.Comment != "" {
			return nil, 0, fmt.Errorf("Codeforces status %q: %s", response.Status, response.Comment)
		}
		return nil, 0, fmt.Errorf("Codeforces status %q", response.Status)
	}

	statsByKey := map[string]int{}
	for _, stat := range response.Result.ProblemStatistics {
		if stat.ContestID == nil || strings.TrimSpace(stat.Index) == "" {
			continue
		}
		statsByKey[codeforcesKey(*stat.ContestID, stat.Index)] = stat.SolvedCount
	}

	var out bytes.Buffer
	if err := writeJSONL(&out, importManifestLine{
		Schema:      catalogimport.Schema,
		Kind:        "manifest",
		GeneratedAt: generatedAt.Format(time.RFC3339),
		CatalogSource: importCatalogSourceLine{
			Slug:     defaultSourceSlug,
			Name:     defaultSourceName,
			Scope:    "global",
			Template: defaultTemplate,
		},
		Provider: importProviderLine{
			Slug:    "codeforces",
			Name:    "Codeforces",
			BaseURL: "https://codeforces.com",
		},
	}); err != nil {
		return nil, 0, err
	}

	for _, field := range codeforcesFields() {
		if err := writeJSONL(&out, field); err != nil {
			return nil, 0, err
		}
	}

	skipped := 0
	for _, problem := range response.Result.Problems {
		if problem.ContestID == nil || strings.TrimSpace(problem.Index) == "" {
			skipped++
			continue
		}
		contestID := strconv.Itoa(*problem.ContestID)
		index := strings.TrimSpace(problem.Index)
		externalID := contestID + index
		data := map[string]any{
			"external_id": externalID,
			"name":        strings.TrimSpace(problem.Name),
			"contest_id":  contestID,
			"index":       index,
			"tags":        cleanedStrings(problem.Tags),
		}
		if problem.Rating != nil {
			data["rating"] = *problem.Rating
		}
		if problem.Type != "" {
			data["type"] = problem.Type
		}
		if problem.Points != nil {
			data["points"] = *problem.Points
		}
		if solvedCount, ok := statsByKey[codeforcesKey(*problem.ContestID, index)]; ok {
			data["solved_count"] = solvedCount
		}
		if err := writeJSONL(&out, importItemLine{
			Schema:            catalogimport.Schema,
			Kind:              "catalog_item",
			CatalogSourceSlug: defaultSourceSlug,
			ExternalID:        externalID,
			Data:              data,
		}); err != nil {
			return nil, 0, err
		}
	}
	return out.Bytes(), skipped, nil
}

func codeforcesFields() []importFieldLine {
	return []importFieldLine{
		{Schema: catalogimport.Schema, Kind: "catalog_field", CatalogSourceSlug: defaultSourceSlug, Key: "rating", Label: "Rating", ValueType: "number", IsArray: false, DisplayOrder: 10},
		{Schema: catalogimport.Schema, Kind: "catalog_field", CatalogSourceSlug: defaultSourceSlug, Key: "tags", Label: "Tags", ValueType: "string", IsArray: true, DisplayOrder: 20},
		{Schema: catalogimport.Schema, Kind: "catalog_field", CatalogSourceSlug: defaultSourceSlug, Key: "solved_count", Label: "Solved Count", ValueType: "number", IsArray: false, DisplayOrder: 30},
		{Schema: catalogimport.Schema, Kind: "catalog_field", CatalogSourceSlug: defaultSourceSlug, Key: "type", Label: "Type", ValueType: "string", IsArray: false, DisplayOrder: 40},
	}
}

func codeforcesKey(contestID int, index string) string {
	return strconv.Itoa(contestID) + "\x00" + strings.TrimSpace(index)
}

func cleanedStrings(values []string) []string {
	cleaned := make([]string, 0, len(values))
	seen := map[string]bool{}
	for _, value := range values {
		value = strings.TrimSpace(value)
		if value == "" {
			continue
		}
		key := strings.ToLower(value)
		if seen[key] {
			continue
		}
		seen[key] = true
		cleaned = append(cleaned, value)
	}
	sort.Strings(cleaned)
	return cleaned
}

func writeJSONL(w io.Writer, value any) error {
	encoded, err := json.Marshal(value)
	if err != nil {
		return err
	}
	if _, err := w.Write(encoded); err != nil {
		return err
	}
	_, err = w.Write([]byte("\n"))
	return err
}

func uploadJSONL(ctx context.Context, endpoint string, jsonl []byte, dryRun bool, timeout time.Duration) ([]byte, int, error) {
	token := strings.TrimSpace(os.Getenv("ARCADE_CATALOG_IMPORT_TOKEN"))
	if token == "" {
		return nil, 0, errors.New("ARCADE_CATALOG_IMPORT_TOKEN is required for upload")
	}

	var body bytes.Buffer
	writer := multipart.NewWriter(&body)
	if err := writer.WriteField("dry_run", strconv.FormatBool(dryRun)); err != nil {
		return nil, 0, err
	}
	part, err := writer.CreateFormFile("file", "codeforces.jsonl")
	if err != nil {
		return nil, 0, err
	}
	if _, err := part.Write(jsonl); err != nil {
		return nil, 0, err
	}
	if err := writer.Close(); err != nil {
		return nil, 0, err
	}

	request, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, &body)
	if err != nil {
		return nil, 0, err
	}
	request.Header.Set("Authorization", "Bearer "+token)
	request.Header.Set("Content-Type", writer.FormDataContentType())

	client := &http.Client{Timeout: timeout}
	response, err := client.Do(request)
	if err != nil {
		return nil, 0, err
	}
	defer response.Body.Close()

	responseBody, err := io.ReadAll(response.Body)
	if err != nil {
		return nil, response.StatusCode, err
	}
	return responseBody, response.StatusCode, nil
}
