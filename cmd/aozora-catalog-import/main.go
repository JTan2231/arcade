package main

import (
	"bytes"
	"encoding/csv"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"log"
	"net/url"
	"os"
	"strings"
	"time"

	"arcade/internal/catalogimport"
)

const (
	defaultTSVPath    = "ab-dataset/period_ranges_3.tsv"
	defaultSourceSlug = "aozora-bunko-ranges"
	defaultSourceName = "Aozora Bunko Ranges"
	defaultTemplate   = "https://www.aozora.gr.jp/cards/{person_id}/files/{work_id}_{file_id}.html#:~:text={fragment_start},{fragment_end}"
)

func main() {
	var tsvPath string
	var jsonlOut string
	var dryRun bool

	flag.StringVar(&tsvPath, "tsv", defaultTSVPath, "Aozora Bunko period ranges TSV")
	flag.StringVar(&jsonlOut, "jsonl-out", "", "write generated normalized JSONL to this path")
	flag.BoolVar(&dryRun, "dry-run", false, "validate generated JSONL and print the import result")
	flag.Parse()

	input, err := os.Open(tsvPath)
	if err != nil {
		log.Fatalf("open TSV: %v", err)
	}
	defer input.Close()

	jsonl, err := formatAozoraJSONL(input, time.Now().UTC())
	if err != nil {
		log.Fatalf("format Aozora data: %v", err)
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
	log.Printf("generated %d Aozora items", result.Counts.ItemsSeen)

	if dryRun {
		if err := json.NewEncoder(os.Stdout).Encode(result); err != nil {
			log.Fatalf("write dry-run result: %v", err)
		}
		return
	}

	if jsonlOut != "" {
		if err := os.WriteFile(jsonlOut, jsonl, 0o644); err != nil {
			log.Fatalf("write JSONL: %v", err)
		}
		return
	}
	_, _ = os.Stdout.Write(jsonl)
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

type importItemLine struct {
	Schema            string         `json:"schema"`
	Kind              string         `json:"kind"`
	CatalogSourceSlug string         `json:"catalog_source_slug"`
	ExternalID        string         `json:"external_id"`
	Data              map[string]any `json:"data"`
}

func formatAozoraJSONL(r io.Reader, generatedAt time.Time) ([]byte, error) {
	reader := csv.NewReader(r)
	reader.Comma = '\t'
	reader.FieldsPerRecord = 5
	reader.ReuseRecord = true

	header, err := reader.Read()
	if err != nil {
		if errors.Is(err, io.EOF) {
			return nil, errors.New("TSV is empty")
		}
		return nil, fmt.Errorf("read TSV header: %w", err)
	}
	if err := validateHeader(header); err != nil {
		return nil, err
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
			Slug:    "aozora-bunko",
			Name:    "Aozora Bunko",
			BaseURL: "https://www.aozora.gr.jp",
		},
	}); err != nil {
		return nil, err
	}

	seenExternalIDs := map[string]int{}
	lineNumber := 1
	for {
		record, err := reader.Read()
		if errors.Is(err, io.EOF) {
			break
		}
		lineNumber++
		if err != nil {
			return nil, fmt.Errorf("read TSV line %d: %w", lineNumber, err)
		}

		row, err := aozoraRowFromRecord(record, lineNumber)
		if err != nil {
			return nil, err
		}
		if firstLine, exists := seenExternalIDs[row.externalID]; exists {
			return nil, fmt.Errorf("TSV line %d duplicates external ID from line %d", lineNumber, firstLine)
		}
		seenExternalIDs[row.externalID] = lineNumber

		if err := writeJSONL(&out, importItemLine{
			Schema:            catalogimport.Schema,
			Kind:              "catalog_item",
			CatalogSourceSlug: defaultSourceSlug,
			ExternalID:        row.externalID,
			Data: map[string]any{
				"external_id":    row.externalID,
				"name":           row.name,
				"person_id":      row.personID,
				"work_id":        row.workID,
				"file_id":        row.fileID,
				"fragment_start": row.fragmentStart,
				"fragment_end":   row.fragmentEnd,
			},
		}); err != nil {
			return nil, err
		}
	}
	return out.Bytes(), nil
}

type aozoraRow struct {
	personID      string
	workID        string
	fileID        string
	fragmentStart string
	fragmentEnd   string
	externalID    string
	name          string
}

func aozoraRowFromRecord(record []string, lineNumber int) (aozoraRow, error) {
	start := record[0]
	end := record[1]
	personID := strings.TrimSpace(record[2])
	workID := strings.TrimSpace(record[3])
	fileID := strings.TrimSpace(record[4])
	if start == "" {
		return aozoraRow{}, fmt.Errorf("TSV line %d has empty start", lineNumber)
	}
	if end == "" {
		return aozoraRow{}, fmt.Errorf("TSV line %d has empty end", lineNumber)
	}
	if personID == "" || workID == "" || fileID == "" {
		return aozoraRow{}, fmt.Errorf("TSV line %d has empty source ID field", lineNumber)
	}

	fragmentStart := encodeTextFragmentPart(start)
	fragmentEnd := encodeTextFragmentPart(end)
	externalID := personID + "/" + workID + "/" + fileID + "#text=" + fragmentStart + "," + fragmentEnd
	return aozoraRow{
		personID:      personID,
		workID:        workID,
		fileID:        fileID,
		fragmentStart: fragmentStart,
		fragmentEnd:   fragmentEnd,
		externalID:    externalID,
		name:          "Aozora " + personID + "/" + workID + "_" + fileID + " " + fragmentStart + "," + fragmentEnd,
	}, nil
}

func encodeTextFragmentPart(value string) string {
	escaped := url.PathEscape(value)
	escaped = strings.ReplaceAll(escaped, "-", "%2D")
	escaped = strings.ReplaceAll(escaped, ",", "%2C")
	escaped = strings.ReplaceAll(escaped, "&", "%26")
	return escaped
}

func validateHeader(header []string) error {
	expected := []string{"start", "end", "person_id", "work_id", "file_id"}
	for index, value := range expected {
		if header[index] != value {
			return fmt.Errorf("unexpected TSV header column %d: got %q, want %q", index+1, header[index], value)
		}
	}
	return nil
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
