package aozoracatalog

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"arcade/internal/catalogimport"
)

type catalogManifestLine struct {
	Schema        string            `json:"schema"`
	Kind          string            `json:"kind"`
	GeneratedAt   string            `json:"generated_at"`
	CatalogSource catalogSourceLine `json:"catalog_source"`
	Provider      providerLine      `json:"provider"`
}

type catalogSourceLine struct {
	Slug     string `json:"slug"`
	Name     string `json:"name"`
	Scope    string `json:"scope"`
	Template string `json:"template"`
}

type providerLine struct {
	Slug    string `json:"slug"`
	Name    string `json:"name"`
	BaseURL string `json:"base_url"`
}

type catalogFieldLine struct {
	Schema            string `json:"schema"`
	Kind              string `json:"kind"`
	CatalogSourceSlug string `json:"catalog_source_slug"`
	Key               string `json:"key"`
	Label             string `json:"label"`
	ValueType         string `json:"value_type"`
	IsArray           bool   `json:"is_array"`
	DisplayOrder      int    `json:"display_order"`
}

type catalogItemLine struct {
	Schema            string          `json:"schema"`
	Kind              string          `json:"kind"`
	CatalogSourceSlug string          `json:"catalog_source_slug"`
	ExternalID        string          `json:"external_id"`
	Data              catalogItemData `json:"data"`
}

type catalogItemData struct {
	Name              string   `json:"name"`
	HTMLPath          string   `json:"html_path"`
	TextSelector      string   `json:"text_selector"`
	RangeKind         string   `json:"range_kind"`
	StartKey          string   `json:"start_key"`
	EndKey            string   `json:"end_key"`
	WorkID            string   `json:"work_id,omitempty"`
	WorkName          string   `json:"work_name,omitempty"`
	AuthorNames       []string `json:"author_names,omitempty"`
	SentenceGraphemes int      `json:"sentence_graphemes"`
	OccurrenceCount   int      `json:"occurrence_count"`
}

func CatalogFields() []catalogFieldLine {
	return []catalogFieldLine{
		{Schema: catalogimport.Schema, Kind: "catalog_field", CatalogSourceSlug: CatalogSourceSlug, Key: "range_kind", Label: "Range kind", ValueType: "string", DisplayOrder: 10},
		{Schema: catalogimport.Schema, Kind: "catalog_field", CatalogSourceSlug: CatalogSourceSlug, Key: "start_key", Label: "Beginning", ValueType: "string", DisplayOrder: 20},
		{Schema: catalogimport.Schema, Kind: "catalog_field", CatalogSourceSlug: CatalogSourceSlug, Key: "end_key", Label: "Ending", ValueType: "string", DisplayOrder: 30},
		{Schema: catalogimport.Schema, Kind: "catalog_field", CatalogSourceSlug: CatalogSourceSlug, Key: "work_id", Label: "Work ID", ValueType: "string", DisplayOrder: 40},
		{Schema: catalogimport.Schema, Kind: "catalog_field", CatalogSourceSlug: CatalogSourceSlug, Key: "work_name", Label: "Work", ValueType: "string", DisplayOrder: 50},
		{Schema: catalogimport.Schema, Kind: "catalog_field", CatalogSourceSlug: CatalogSourceSlug, Key: "author_names", Label: "Authors", ValueType: "string", IsArray: true, DisplayOrder: 60},
		{Schema: catalogimport.Schema, Kind: "catalog_field", CatalogSourceSlug: CatalogSourceSlug, Key: "sentence_graphemes", Label: "Sentence length", ValueType: "number", DisplayOrder: 70},
		{Schema: catalogimport.Schema, Kind: "catalog_field", CatalogSourceSlug: CatalogSourceSlug, Key: "occurrence_count", Label: "Occurrences", ValueType: "number", DisplayOrder: 80},
	}
}

func FormatCatalog(items []ProjectedItem, generatedAt time.Time) ([]byte, error) {
	items = append([]ProjectedItem(nil), items...)
	sort.Slice(items, func(i, j int) bool { return items[i].ExternalID < items[j].ExternalID })

	var output bytes.Buffer
	manifest := catalogManifestLine{
		Schema:      catalogimport.Schema,
		Kind:        "manifest",
		GeneratedAt: generatedAt.UTC().Format(time.RFC3339),
		CatalogSource: catalogSourceLine{
			Slug:     CatalogSourceSlug,
			Name:     CatalogSourceName,
			Scope:    "global",
			Template: CatalogTemplate,
		},
		Provider: providerLine{Slug: "aozora-bunko", Name: "Aozora Bunko", BaseURL: "https://www.aozora.gr.jp"},
	}
	if err := appendJSONLine(&output, manifest); err != nil {
		return nil, err
	}
	for _, field := range CatalogFields() {
		if err := appendJSONLine(&output, field); err != nil {
			return nil, err
		}
	}

	seen := make(map[string]struct{}, len(items))
	for _, item := range items {
		if err := validateProjectedItem(item); err != nil {
			return nil, fmt.Errorf("item %q: %w", item.ExternalID, err)
		}
		if _, exists := seen[item.ExternalID]; exists {
			return nil, fmt.Errorf("duplicate external ID %q", item.ExternalID)
		}
		seen[item.ExternalID] = struct{}{}

		authors := sortedUniqueStrings(item.AuthorNames)
		line := catalogItemLine{
			Schema:            catalogimport.Schema,
			Kind:              "catalog_item",
			CatalogSourceSlug: CatalogSourceSlug,
			ExternalID:        item.ExternalID,
			Data: catalogItemData{
				Name:              item.Name,
				HTMLPath:          item.HTMLPath,
				TextSelector:      item.TextSelector,
				RangeKind:         string(item.RangeKind),
				StartKey:          item.StartKey,
				EndKey:            item.EndKey,
				WorkID:            item.WorkID,
				WorkName:          item.WorkName,
				AuthorNames:       authors,
				SentenceGraphemes: item.SentenceGraphemes,
				OccurrenceCount:   item.OccurrenceCount,
			},
		}
		if err := appendJSONLine(&output, line); err != nil {
			return nil, err
		}
	}
	if err := enforceCatalogSize(output.Len()); err != nil {
		return nil, err
	}

	catalog := output.Bytes()
	file, result, err := catalogimport.ParseJSONL(bytes.NewReader(catalog), catalogimport.Options{AllowGlobal: true})
	if err != nil {
		return nil, fmt.Errorf("parse generated catalog: %w", err)
	}
	if len(result.Errors) != 0 {
		return nil, fmt.Errorf("generated catalog failed Arcade validation: %s", summarizeImportErrors(result.Errors))
	}
	if err := ValidateCatalogFile(file); err != nil {
		return nil, fmt.Errorf("generated catalog failed Aozora validation: %w", err)
	}
	return append([]byte(nil), catalog...), nil
}

func validateProjectedItem(item ProjectedItem) error {
	if !item.SelectorVerified {
		return errors.New("representative selector was not verified")
	}
	if err := validateRelativeHTMLPath(item.HTMLPath); err != nil {
		return err
	}
	if err := ValidateSelector(item.TextSelector); err != nil {
		return fmt.Errorf("invalid text selector: %w", err)
	}
	if item.RangeKind != RangeKindWord && item.RangeKind != RangeKindGrapheme3 {
		return fmt.Errorf("unknown range kind %q", item.RangeKind)
	}
	if item.StartKey == "" || item.EndKey == "" {
		return errors.New("endpoint keys are required")
	}
	documentID := DocumentID(item.HTMLPath)
	if item.DocumentID != "" && item.DocumentID != documentID {
		return errors.New("document ID does not match html_path")
	}
	wantID := PairDocumentExternalID(documentID, item.RangeKind, item.StartKey, item.EndKey)
	if item.ExternalID != wantID {
		return fmt.Errorf("external ID does not match pair identity; want %q", wantID)
	}
	if strings.TrimSpace(item.Name) == "" {
		return errors.New("name is required")
	}
	if item.SentenceGraphemes <= 0 {
		return errors.New("sentence graphemes must be positive")
	}
	if item.OccurrenceCount <= 0 {
		return errors.New("occurrence count must be positive")
	}
	return nil
}

func ValidateCatalogFile(file catalogimport.File) error {
	manifest := file.Manifest.CatalogSource
	if manifest.Slug != CatalogSourceSlug || manifest.Name != CatalogSourceName || manifest.Scope != "global" || manifest.Template != CatalogTemplate {
		return errors.New("manifest does not match the Aozora catalogue source contract")
	}
	if got, _ := file.Manifest.Provider["slug"].(string); got != "aozora-bunko" {
		return errors.New("manifest provider slug is invalid")
	}
	if got, _ := file.Manifest.Provider["name"].(string); got != "Aozora Bunko" {
		return errors.New("manifest provider name is invalid")
	}
	if got, _ := file.Manifest.Provider["base_url"].(string); got != "https://www.aozora.gr.jp" {
		return errors.New("manifest provider base_url is invalid")
	}

	wantFields := CatalogFields()
	if len(file.Fields) != len(wantFields) {
		return fmt.Errorf("catalog declares %d fields, want %d", len(file.Fields), len(wantFields))
	}
	for index, got := range file.Fields {
		want := wantFields[index]
		if got.CatalogSourceSlug != want.CatalogSourceSlug || got.Key != want.Key || got.Label != want.Label || got.ValueType != want.ValueType || got.IsArray != want.IsArray || got.DisplayOrder != want.DisplayOrder {
			return fmt.Errorf("catalog field %d (%q) does not match the field contract", index+1, got.Key)
		}
	}

	previousID := ""
	seen := make(map[string]struct{}, len(file.Items))
	for _, item := range file.Items {
		if item.CatalogSourceSlug != CatalogSourceSlug {
			return fmt.Errorf("item %q references another source", item.ExternalID)
		}
		if previousID != "" && item.ExternalID <= previousID {
			return fmt.Errorf("item external IDs are not strictly sorted at %q", item.ExternalID)
		}
		previousID = item.ExternalID
		if _, exists := seen[item.ExternalID]; exists {
			return fmt.Errorf("duplicate external ID %q", item.ExternalID)
		}
		seen[item.ExternalID] = struct{}{}
		if err := validateParsedItem(item); err != nil {
			return fmt.Errorf("item %q: %w", item.ExternalID, err)
		}
	}
	return nil
}

func validateParsedItem(item catalogimport.CatalogItem) error {
	allowedKeys := map[string]bool{
		"external_id": true, // ParseJSONL supplies this transiently.
		"name":        true, "html_path": true, "text_selector": true,
		"range_kind": true, "start_key": true, "end_key": true,
		"work_id": true, "work_name": true, "author_names": true,
		"sentence_graphemes": true, "occurrence_count": true,
	}
	for key := range item.Data {
		if strings.EqualFold(strings.TrimSpace(key), "url") {
			return errors.New("item data contains a url key")
		}
		if !allowedKeys[key] {
			return fmt.Errorf("item data contains forbidden or unknown key %q", key)
		}
	}

	htmlPath, err := requiredString(item.Data, "html_path")
	if err != nil {
		return err
	}
	if err := validateRelativeHTMLPath(htmlPath); err != nil {
		return err
	}
	selector, err := requiredString(item.Data, "text_selector")
	if err != nil {
		return err
	}
	if err := ValidateSelector(selector); err != nil {
		return fmt.Errorf("invalid text_selector: %w", err)
	}
	rangeKindValue, err := requiredString(item.Data, "range_kind")
	if err != nil {
		return err
	}
	rangeKind := RangeKind(rangeKindValue)
	if rangeKind != RangeKindWord && rangeKind != RangeKindGrapheme3 {
		return fmt.Errorf("invalid range_kind %q", rangeKind)
	}
	startKey, err := requiredString(item.Data, "start_key")
	if err != nil {
		return err
	}
	endKey, err := requiredString(item.Data, "end_key")
	if err != nil {
		return err
	}
	wantID := PairDocumentExternalID(DocumentID(htmlPath), rangeKind, startKey, endKey)
	if item.ExternalID != wantID {
		return fmt.Errorf("external ID does not match item identity; want %q", wantID)
	}
	if _, err := requiredString(item.Data, "name"); err != nil {
		return err
	}
	if err := optionalString(item.Data, "work_id"); err != nil {
		return err
	}
	if err := optionalString(item.Data, "work_name"); err != nil {
		return err
	}
	if err := optionalSortedStringArray(item.Data, "author_names"); err != nil {
		return err
	}
	if err := positiveJSONInteger(item.Data, "sentence_graphemes"); err != nil {
		return err
	}
	if err := positiveJSONInteger(item.Data, "occurrence_count"); err != nil {
		return err
	}
	return nil
}

func requiredString(data map[string]any, key string) (string, error) {
	value, ok := data[key]
	if !ok {
		return "", fmt.Errorf("%s is required", key)
	}
	text, ok := value.(string)
	if !ok || strings.TrimSpace(text) == "" {
		return "", fmt.Errorf("%s must be a nonempty string", key)
	}
	return text, nil
}

func optionalString(data map[string]any, key string) error {
	value, ok := data[key]
	if !ok {
		return nil
	}
	text, ok := value.(string)
	if !ok || strings.TrimSpace(text) == "" {
		return fmt.Errorf("%s must be a nonempty string when present", key)
	}
	return nil
}

func optionalSortedStringArray(data map[string]any, key string) error {
	value, ok := data[key]
	if !ok {
		return nil
	}
	values, ok := value.([]any)
	if !ok || len(values) == 0 {
		return fmt.Errorf("%s must be a nonempty string array when present", key)
	}
	previous := ""
	for _, value := range values {
		text, ok := value.(string)
		if !ok || strings.TrimSpace(text) == "" {
			return fmt.Errorf("%s must contain only nonempty strings", key)
		}
		if previous != "" && text <= previous {
			return fmt.Errorf("%s must be sorted and deduplicated", key)
		}
		previous = text
	}
	return nil
}

func positiveJSONInteger(data map[string]any, key string) error {
	value, ok := data[key]
	if !ok {
		return fmt.Errorf("%s is required", key)
	}
	number, ok := value.(json.Number)
	if !ok {
		return fmt.Errorf("%s must be a number", key)
	}
	integer, err := number.Int64()
	if err != nil || integer <= 0 {
		return fmt.Errorf("%s must be a positive integer", key)
	}
	return nil
}

func sortedUniqueStrings(values []string) []string {
	seen := make(map[string]struct{}, len(values))
	cleaned := make([]string, 0, len(values))
	for _, value := range values {
		value = strings.TrimSpace(value)
		if value == "" {
			continue
		}
		if _, exists := seen[value]; exists {
			continue
		}
		seen[value] = struct{}{}
		cleaned = append(cleaned, value)
	}
	sort.Strings(cleaned)
	return cleaned
}

func appendJSONLine(output *bytes.Buffer, value any) error {
	encoded, err := json.Marshal(value)
	if err != nil {
		return err
	}
	output.Write(encoded)
	output.WriteByte('\n')
	return nil
}

func CommitCatalog(outputDirectory string, catalog []byte, report BuildReport) (BuildReport, error) {
	if err := enforceCatalogSize(len(catalog)); err != nil {
		return BuildReport{}, err
	}
	file, result, err := catalogimport.ParseJSONL(bytes.NewReader(catalog), catalogimport.Options{AllowGlobal: true})
	if err != nil {
		return BuildReport{}, fmt.Errorf("parse catalog before commit: %w", err)
	}
	if len(result.Errors) != 0 {
		return BuildReport{}, fmt.Errorf("catalog failed Arcade validation: %s", summarizeImportErrors(result.Errors))
	}
	if err := ValidateCatalogFile(file); err != nil {
		return BuildReport{}, fmt.Errorf("catalog failed Aozora validation: %w", err)
	}
	if report.CatalogItems != result.Counts.ItemsSeen {
		return BuildReport{}, fmt.Errorf("report catalog_items is %d, catalog contains %d", report.CatalogItems, result.Counts.ItemsSeen)
	}

	digest := sha256.Sum256(catalog)
	report.Schema = BuildReportSchema
	report.DocumentLimit = documentLimit
	report.CatalogBytes = int64(len(catalog))
	report.CatalogSHA256 = hex.EncodeToString(digest[:])
	report.ExtractorVersion = ExtractorVersion
	if _, err := time.Parse(time.RFC3339, report.GeneratedAt); err != nil {
		return BuildReport{}, errors.New("report generated_at must be an RFC3339 timestamp")
	}
	reportBytes, err := json.MarshalIndent(report, "", "  ")
	if err != nil {
		return BuildReport{}, err
	}
	reportBytes = append(reportBytes, '\n')

	if err := os.MkdirAll(outputDirectory, 0o755); err != nil {
		return BuildReport{}, fmt.Errorf("create output directory: %w", err)
	}
	catalogTemp := filepath.Join(outputDirectory, "catalog.jsonl.tmp")
	reportTemp := filepath.Join(outputDirectory, "build.json.tmp")
	catalogFinal := filepath.Join(outputDirectory, "catalog.jsonl")
	reportFinal := filepath.Join(outputDirectory, "build.json")
	defer os.Remove(catalogTemp)
	defer os.Remove(reportTemp)

	if err := writeSyncedFile(catalogTemp, catalog); err != nil {
		return BuildReport{}, fmt.Errorf("write temporary catalog: %w", err)
	}
	writtenCatalog, err := os.ReadFile(catalogTemp)
	if err != nil {
		return BuildReport{}, fmt.Errorf("read temporary catalog for validation: %w", err)
	}
	if !bytes.Equal(writtenCatalog, catalog) {
		return BuildReport{}, errors.New("temporary catalog differs from generated bytes")
	}
	writtenFile, writtenResult, err := catalogimport.ParseJSONL(bytes.NewReader(writtenCatalog), catalogimport.Options{AllowGlobal: true})
	if err != nil {
		return BuildReport{}, fmt.Errorf("parse temporary catalog: %w", err)
	}
	if len(writtenResult.Errors) != 0 {
		return BuildReport{}, fmt.Errorf("temporary catalog failed Arcade validation: %s", summarizeImportErrors(writtenResult.Errors))
	}
	if err := ValidateCatalogFile(writtenFile); err != nil {
		return BuildReport{}, fmt.Errorf("temporary catalog failed Aozora validation: %w", err)
	}
	if err := writeSyncedFile(reportTemp, reportBytes); err != nil {
		return BuildReport{}, fmt.Errorf("write temporary build report: %w", err)
	}
	if err := os.Rename(catalogTemp, catalogFinal); err != nil {
		return BuildReport{}, fmt.Errorf("publish catalog: %w", err)
	}
	if err := syncDirectory(outputDirectory); err != nil {
		return BuildReport{}, fmt.Errorf("sync published catalog: %w", err)
	}
	if err := os.Rename(reportTemp, reportFinal); err != nil {
		return BuildReport{}, fmt.Errorf("publish build report: %w", err)
	}
	if err := syncDirectory(outputDirectory); err != nil {
		return BuildReport{}, fmt.Errorf("sync published build report: %w", err)
	}
	return report, nil
}

func enforceCatalogSize(size int) error {
	if size > maxCatalogArtifactBytes {
		return fmt.Errorf("catalog is %d bytes, exceeds %d-byte safety limit", size, maxCatalogArtifactBytes)
	}
	return nil
}

func writeSyncedFile(filename string, data []byte) (returnErr error) {
	file, err := os.OpenFile(filename, os.O_WRONLY|os.O_CREATE|os.O_TRUNC, 0o644)
	if err != nil {
		return err
	}
	defer func() {
		if err := file.Close(); returnErr == nil && err != nil {
			returnErr = err
		}
	}()
	if _, err := file.Write(data); err != nil {
		return err
	}
	return file.Sync()
}

func syncDirectory(directory string) error {
	file, err := os.Open(directory)
	if err != nil {
		return err
	}
	defer file.Close()
	return file.Sync()
}
