package aozoracatalog

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"arcade/internal/catalogimport"
)

const defaultArcadeBaseURL = "http://localhost:8080"

type UploadOptions struct {
	BaseURL string
	Token   string
	DryRun  bool
	Client  *http.Client
}

type UploadResult struct {
	Validation catalogimport.Result
	Import     *catalogimport.Result
}

// LoadArtifact verifies the build commit marker and performs local JSONL and
// Aozora-specific validation before upload is attempted.
func LoadArtifact(outputDirectory string) ([]byte, BuildReport, error) {
	reportPath := filepath.Join(outputDirectory, "build.json")
	reportBytes, err := os.ReadFile(reportPath)
	if err != nil {
		return nil, BuildReport{}, fmt.Errorf("read build report: %w", err)
	}

	var report BuildReport
	decoder := json.NewDecoder(bytes.NewReader(reportBytes))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&report); err != nil {
		return nil, BuildReport{}, fmt.Errorf("decode build report: %w", err)
	}
	if err := requireJSONEOF(decoder); err != nil {
		return nil, BuildReport{}, fmt.Errorf("decode build report: %w", err)
	}
	if report.Schema != BuildReportSchema {
		return nil, BuildReport{}, fmt.Errorf("build report schema is %q, want %q", report.Schema, BuildReportSchema)
	}
	if report.CatalogBytes < 0 || report.CatalogBytes > maxCatalogArtifactBytes {
		return nil, BuildReport{}, fmt.Errorf("build report catalog_bytes %d exceeds %d-byte safety limit", report.CatalogBytes, maxCatalogArtifactBytes)
	}
	if len(report.CatalogSHA256) != sha256.Size*2 {
		return nil, BuildReport{}, errors.New("build report catalog_sha256 is malformed")
	}
	if _, err := hex.DecodeString(report.CatalogSHA256); err != nil || report.CatalogSHA256 != strings.ToLower(report.CatalogSHA256) {
		return nil, BuildReport{}, errors.New("build report catalog_sha256 is malformed")
	}

	catalogPath := filepath.Join(outputDirectory, "catalog.jsonl")
	info, err := os.Stat(catalogPath)
	if err != nil {
		return nil, BuildReport{}, fmt.Errorf("stat catalog: %w", err)
	}
	if !info.Mode().IsRegular() {
		return nil, BuildReport{}, errors.New("catalog.jsonl is not a regular file")
	}
	if info.Size() > maxCatalogArtifactBytes {
		return nil, BuildReport{}, fmt.Errorf("catalog.jsonl is %d bytes, exceeds %d-byte safety limit", info.Size(), maxCatalogArtifactBytes)
	}
	if info.Size() != report.CatalogBytes {
		return nil, BuildReport{}, fmt.Errorf("catalog size %d does not match build report %d", info.Size(), report.CatalogBytes)
	}

	catalog, err := os.ReadFile(catalogPath)
	if err != nil {
		return nil, BuildReport{}, fmt.Errorf("read catalog: %w", err)
	}
	digest := sha256.Sum256(catalog)
	if got := hex.EncodeToString(digest[:]); got != report.CatalogSHA256 {
		return nil, BuildReport{}, fmt.Errorf("catalog SHA-256 %s does not match build report", got)
	}

	parsed, result, err := catalogimport.ParseJSONL(bytes.NewReader(catalog), catalogimport.Options{AllowGlobal: true})
	if err != nil {
		return nil, BuildReport{}, fmt.Errorf("parse catalog: %w", err)
	}
	if len(result.Errors) != 0 {
		return nil, BuildReport{}, fmt.Errorf("catalog failed local validation: %s", summarizeImportErrors(result.Errors))
	}
	if err := ValidateCatalogFile(parsed); err != nil {
		return nil, BuildReport{}, fmt.Errorf("catalog failed Aozora validation: %w", err)
	}
	if result.Counts.ItemsSeen != report.CatalogItems {
		return nil, BuildReport{}, fmt.Errorf("catalog contains %d items, build report records %d", result.Counts.ItemsSeen, report.CatalogItems)
	}
	return catalog, report, nil
}

func Upload(ctx context.Context, outputDirectory string, options UploadOptions) (UploadResult, error) {
	catalog, report, err := LoadArtifact(outputDirectory)
	if err != nil {
		return UploadResult{}, err
	}
	endpoint, err := catalogImportEndpoint(options.BaseURL)
	if err != nil {
		return UploadResult{}, err
	}
	token := strings.TrimSpace(options.Token)
	if token == "" {
		return UploadResult{}, errors.New("ARCADE_CATALOG_IMPORT_TOKEN is required")
	}
	client := options.Client
	if client == nil {
		client = &http.Client{Timeout: 10 * time.Minute}
	}

	validation, err := sendCatalogImport(ctx, client, endpoint, token, catalog, true)
	if err != nil {
		return UploadResult{}, fmt.Errorf("Arcade dry run: %w", err)
	}
	if validation.Counts.ItemsSeen != report.CatalogItems {
		return UploadResult{}, fmt.Errorf("Arcade dry run saw %d items, build report records %d", validation.Counts.ItemsSeen, report.CatalogItems)
	}
	result := UploadResult{Validation: validation}
	if options.DryRun {
		return result, nil
	}

	imported, err := sendCatalogImport(ctx, client, endpoint, token, catalog, false)
	if err != nil {
		return UploadResult{}, fmt.Errorf("Arcade import: %w", err)
	}
	result.Import = &imported
	return result, nil
}

func catalogImportEndpoint(baseURL string) (string, error) {
	baseURL = strings.TrimSpace(baseURL)
	if baseURL == "" {
		baseURL = defaultArcadeBaseURL
	}
	parsed, err := url.Parse(baseURL)
	if err != nil {
		return "", fmt.Errorf("ARCADE_BASE_URL: %w", err)
	}
	if (parsed.Scheme != "http" && parsed.Scheme != "https") || parsed.Host == "" {
		return "", errors.New("ARCADE_BASE_URL must be an absolute http or https URL")
	}
	if parsed.RawQuery != "" || parsed.Fragment != "" {
		return "", errors.New("ARCADE_BASE_URL must not contain a query or fragment")
	}
	parsed.Path = strings.TrimRight(parsed.Path, "/") + "/api/catalog-imports"
	parsed.RawPath = ""
	return parsed.String(), nil
}

func sendCatalogImport(ctx context.Context, client *http.Client, endpoint, token string, catalog []byte, dryRun bool) (catalogimport.Result, error) {
	var body bytes.Buffer
	writer := multipart.NewWriter(&body)
	if err := writer.WriteField("dry_run", strconv.FormatBool(dryRun)); err != nil {
		return catalogimport.Result{}, err
	}
	part, err := writer.CreateFormFile("file", "catalog.jsonl")
	if err != nil {
		return catalogimport.Result{}, err
	}
	if _, err := part.Write(catalog); err != nil {
		return catalogimport.Result{}, err
	}
	if err := writer.Close(); err != nil {
		return catalogimport.Result{}, err
	}

	request, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, &body)
	if err != nil {
		return catalogimport.Result{}, err
	}
	request.Header.Set("Authorization", "Bearer "+token)
	request.Header.Set("Content-Type", writer.FormDataContentType())

	response, err := client.Do(request)
	if err != nil {
		return catalogimport.Result{}, err
	}
	defer response.Body.Close()
	responseBody, err := io.ReadAll(io.LimitReader(response.Body, 8<<20))
	if err != nil {
		return catalogimport.Result{}, err
	}
	if response.StatusCode < http.StatusOK || response.StatusCode >= http.StatusMultipleChoices {
		message := strings.TrimSpace(string(responseBody))
		if message == "" {
			message = http.StatusText(response.StatusCode)
		}
		return catalogimport.Result{}, fmt.Errorf("HTTP %d: %s", response.StatusCode, message)
	}

	var result catalogimport.Result
	if err := json.Unmarshal(responseBody, &result); err != nil {
		return catalogimport.Result{}, fmt.Errorf("decode response: %w", err)
	}
	if result.Status != "completed" || len(result.Errors) != 0 {
		return catalogimport.Result{}, fmt.Errorf("import response status %q: %s", result.Status, summarizeImportErrors(result.Errors))
	}
	if result.DryRun != dryRun {
		return catalogimport.Result{}, fmt.Errorf("import response dry_run=%t, want %t", result.DryRun, dryRun)
	}
	return result, nil
}

func summarizeImportErrors(messages []catalogimport.ImportMessage) string {
	if len(messages) == 0 {
		return "no validation details"
	}
	parts := make([]string, 0, len(messages))
	for _, message := range messages {
		parts = append(parts, message.Code+": "+message.Message)
		if len(parts) == 3 {
			break
		}
	}
	return strings.Join(parts, "; ")
}

func requireJSONEOF(decoder *json.Decoder) error {
	var extra any
	if err := decoder.Decode(&extra); err == io.EOF {
		return nil
	} else if err != nil {
		return err
	}
	return errors.New("unexpected data after JSON object")
}
