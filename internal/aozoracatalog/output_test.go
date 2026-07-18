package aozoracatalog

import (
	"bytes"
	"encoding/json"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
	"time"

	"arcade/internal/catalogimport"
)

func TestFormatCatalogDeclaresFieldsAndOmitsPerItemURL(t *testing.T) {
	generatedAt := time.Date(2026, 7, 18, 0, 0, 0, 0, time.UTC)
	item := testProjectedItem(t, "い")
	catalog, err := FormatCatalog([]ProjectedItem{item}, generatedAt)
	if err != nil {
		t.Fatalf("FormatCatalog: %v", err)
	}
	file, result, err := catalogimport.ParseJSONL(bytes.NewReader(catalog), catalogimport.Options{AllowGlobal: true})
	if err != nil {
		t.Fatal(err)
	}
	if len(result.Errors) != 0 {
		t.Fatalf("validation errors = %#v", result.Errors)
	}
	if file.Manifest.CatalogSource.Template != CatalogTemplate {
		t.Fatalf("template = %q", file.Manifest.CatalogSource.Template)
	}
	if len(file.Fields) != 8 {
		t.Fatalf("fields = %d, want 8", len(file.Fields))
	}
	for index, field := range file.Fields {
		if field.DisplayOrder != (index+1)*10 {
			t.Errorf("field %q display_order = %d", field.Key, field.DisplayOrder)
		}
	}
	data := file.Items[0].Data
	if _, exists := data["url"]; exists {
		t.Fatal("item has url data")
	}
	for _, key := range []string{"exact_text", "sentence", "range", "dom_path", "validation_trace"} {
		if _, exists := data[key]; exists {
			t.Errorf("item has transient data key %q", key)
		}
	}
	if got := data["html_path"]; got != item.HTMLPath {
		t.Errorf("html_path = %#v", got)
	}
	if got := data["text_selector"]; got != item.TextSelector {
		t.Errorf("text_selector = %#v", got)
	}
	if strings.Contains(string(catalog), item.HTMLPath+"#:~:") {
		t.Fatal("catalog contains a complete per-item URL")
	}
}

func TestFormatCatalogSortsItemsDeterministically(t *testing.T) {
	generatedAt := time.Date(2026, 7, 18, 0, 0, 0, 0, time.UTC)
	first := testProjectedItem(t, "あ")
	second := testProjectedItem(t, "い")
	catalogA, err := FormatCatalog([]ProjectedItem{second, first}, generatedAt)
	if err != nil {
		t.Fatal(err)
	}
	catalogB, err := FormatCatalog([]ProjectedItem{first, second}, generatedAt)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(catalogA, catalogB) {
		t.Fatal("catalog output depends on input ordering")
	}
}

func TestCommitCatalogWritesDigestLastAndPreservesUnrelatedFiles(t *testing.T) {
	generatedAt := time.Date(2026, 7, 18, 0, 0, 0, 0, time.UTC)
	catalog, err := FormatCatalog([]ProjectedItem{testProjectedItem(t, "あ")}, generatedAt)
	if err != nil {
		t.Fatal(err)
	}
	directory := t.TempDir()
	unrelated := filepath.Join(directory, "keep.txt")
	if err := os.WriteFile(unrelated, []byte("keep"), 0o644); err != nil {
		t.Fatal(err)
	}
	report, err := CommitCatalog(directory, catalog, BuildReport{
		CatalogItems:           1,
		GeneratedAt:            generatedAt.Format(time.RFC3339),
		SelectorEngineRevision: "test",
		ChromiumVersion:        "test",
	})
	if err != nil {
		t.Fatalf("CommitCatalog: %v", err)
	}
	if report.CatalogBytes != int64(len(catalog)) || len(report.CatalogSHA256) != 64 {
		t.Fatalf("report digest metadata = %#v", report)
	}
	loaded, loadedReport, err := LoadArtifact(directory)
	if err != nil {
		t.Fatalf("LoadArtifact: %v", err)
	}
	if !bytes.Equal(loaded, catalog) || !reflect.DeepEqual(loadedReport, report) {
		t.Fatal("loaded artifact differs from committed artifact")
	}
	if got, err := os.ReadFile(unrelated); err != nil || string(got) != "keep" {
		t.Fatalf("unrelated file = %q, %v", got, err)
	}
	for _, name := range []string{"catalog.jsonl.tmp", "build.json.tmp"} {
		if _, err := os.Stat(filepath.Join(directory, name)); !os.IsNotExist(err) {
			t.Errorf("temporary file %s remains after commit", name)
		}
	}
}

func TestCatalogArtifactSizeLimit(t *testing.T) {
	if err := enforceCatalogSize(maxCatalogArtifactBytes); err != nil {
		t.Fatalf("exact limit rejected: %v", err)
	}
	if err := enforceCatalogSize(maxCatalogArtifactBytes + 1); err == nil {
		t.Fatal("oversized catalog accepted")
	}
}

func TestValidateCatalogRejectsURLData(t *testing.T) {
	item := testProjectedItem(t, "あ")
	catalog, err := FormatCatalog([]ProjectedItem{item}, time.Date(2026, 7, 18, 0, 0, 0, 0, time.UTC))
	if err != nil {
		t.Fatal(err)
	}
	var lines []map[string]any
	for _, raw := range bytes.Split(bytes.TrimSpace(catalog), []byte{'\n'}) {
		var line map[string]any
		if err := json.Unmarshal(raw, &line); err != nil {
			t.Fatal(err)
		}
		if line["kind"] == "catalog_item" {
			line["data"].(map[string]any)["url"] = "https://www.aozora.gr.jp/forbidden"
		}
		lines = append(lines, line)
	}
	var altered bytes.Buffer
	for _, line := range lines {
		encoded, _ := json.Marshal(line)
		altered.Write(encoded)
		altered.WriteByte('\n')
	}
	file, result, err := catalogimport.ParseJSONL(&altered, catalogimport.Options{AllowGlobal: true})
	if err != nil || len(result.Errors) != 0 {
		t.Fatalf("generic parse = %v, %#v", err, result.Errors)
	}
	if err := ValidateCatalogFile(file); err == nil {
		t.Fatal("ValidateCatalogFile accepted item-level url")
	}
}

func TestValidateCatalogRequiresProviderName(t *testing.T) {
	catalog, err := FormatCatalog([]ProjectedItem{testProjectedItem(t, "あ")}, time.Date(2026, 7, 18, 0, 0, 0, 0, time.UTC))
	if err != nil {
		t.Fatal(err)
	}
	file, result, err := catalogimport.ParseJSONL(bytes.NewReader(catalog), catalogimport.Options{AllowGlobal: true})
	if err != nil || len(result.Errors) != 0 {
		t.Fatalf("generic parse = %v, %#v", err, result.Errors)
	}
	file.Manifest.Provider["name"] = "Wrong Provider"
	if err := ValidateCatalogFile(file); err == nil {
		t.Fatal("ValidateCatalogFile accepted the wrong provider name")
	}
}

func testProjectedItem(t *testing.T, startKey string) ProjectedItem {
	t.Helper()
	htmlPath := "cards/000008/files/47386_69118.html"
	documentID := DocumentID(htmlPath)
	selector, err := SerializeSelector(Selector{Kind: SelectorKindExact, Start: "その朝、帰った。"})
	if err != nil {
		t.Fatal(err)
	}
	return ProjectedItem{
		ExternalID:                 PairDocumentExternalID(documentID, RangeKindWord, startKey, "帰った"),
		Name:                       "續生活の探求 — その朝 … 帰った",
		HTMLPath:                   htmlPath,
		TextSelector:               selector,
		RangeKind:                  RangeKindWord,
		StartKey:                   startKey,
		EndKey:                     "帰った",
		WorkID:                     "47386",
		WorkName:                   "續生活の探求",
		AuthorNames:                []string{"小栗 虫太郎", "小栗 虫太郎"},
		SentenceGraphemes:          11,
		OccurrenceCount:            1,
		DocumentID:                 documentID,
		RepresentativeOccurrenceID: "occurrence",
		SelectorVerified:           true,
	}
}
