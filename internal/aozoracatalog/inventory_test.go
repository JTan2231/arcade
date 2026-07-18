package aozoracatalog

import (
	"archive/zip"
	"encoding/csv"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
)

func TestSelectHTMLPathsMatchesLexicalPrototypeScope(t *testing.T) {
	root := t.TempDir()
	writeTestHTML(t, root, "cards/000002/files/b.html")
	writeTestHTML(t, root, "cards/000002/files/a.html")
	writeTestHTML(t, root, "cards/000001/files/z.html")
	writeTestHTML(t, root, "cards/000001/files/nested/ignored.html")
	writeTestHTML(t, root, "cards/000001/card1.html")
	writeTestHTML(t, root, "cards/000001/files/not-html.xhtml")

	external := filepath.Join(t.TempDir(), "linked.html")
	if err := os.WriteFile(external, []byte("linked"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(external, filepath.Join(root, "cards/000001/files/linked.html")); err != nil {
		t.Fatal(err)
	}

	got, err := SelectHTMLPaths(root, 2)
	if err != nil {
		t.Fatalf("SelectHTMLPaths: %v", err)
	}
	want := []string{
		"cards/000001/files/z.html",
		"cards/000002/files/a.html",
	}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("SelectHTMLPaths() = %#v, want %#v", got, want)
	}

	all, err := SelectHTMLPaths(root, 100)
	if err != nil {
		t.Fatalf("SelectHTMLPaths(all): %v", err)
	}
	if want := []string{
		"cards/000001/files/z.html",
		"cards/000002/files/a.html",
		"cards/000002/files/b.html",
	}; !reflect.DeepEqual(all, want) {
		t.Fatalf("SelectHTMLPaths(all) = %#v, want %#v", all, want)
	}
}

func TestOfficialHTMLPathValidation(t *testing.T) {
	root := t.TempDir()
	rel := "cards/000008/files/47386_69118.html"
	writeTestHTML(t, root, rel)
	selected := []string{rel}

	got, err := OfficialHTMLPath(root, "https://www.aozora.gr.jp/"+rel, selected)
	if err != nil {
		t.Fatalf("OfficialHTMLPath(valid): %v", err)
	}
	if got != rel {
		t.Fatalf("OfficialHTMLPath(valid) = %q, want %q", got, rel)
	}

	invalid := []string{
		"http://www.aozora.gr.jp/" + rel,
		"https://example.com/" + rel,
		"https://www.aozora.gr.jp:443/" + rel,
		"https://user@www.aozora.gr.jp/" + rel,
		"https://www.aozora.gr.jp/" + rel + "?download=1",
		"https://www.aozora.gr.jp/" + rel + "?",
		"https://www.aozora.gr.jp/" + rel + "#section",
		"https://www.aozora.gr.jp/" + rel + "#",
		"https://www.aozora.gr.jp/cards/000008/files/../47386_69118.html",
		"https://www.aozora.gr.jp/cards/000008/files/%2e%2e/47386_69118.html",
		"https://www.aozora.gr.jp/cards/000008/files%2f47386_69118.html",
		"https://www.aozora.gr.jp/not-cards/000008/files/47386_69118.html",
		"https://www.aozora.gr.jp/cards/000008/card47386.html",
		"https://www.aozora.gr.jp/cards/000008/files/not-selected.html",
		" https://www.aozora.gr.jp/" + rel,
	}
	for _, rawURL := range invalid {
		t.Run(rawURL, func(t *testing.T) {
			if got, err := OfficialHTMLPath(root, rawURL, selected); err == nil {
				t.Fatalf("OfficialHTMLPath(%q) unexpectedly accepted %q", rawURL, got)
			}
		})
	}
}

func TestOfficialHTMLPathRejectsSymlinkRoundTrip(t *testing.T) {
	root := t.TempDir()
	linkedRel := "cards/000008/files/linked.html"
	if err := os.MkdirAll(filepath.Join(root, "cards/000008/files"), 0o755); err != nil {
		t.Fatal(err)
	}
	external := filepath.Join(t.TempDir(), "external.html")
	if err := os.WriteFile(external, []byte("external"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(external, filepath.Join(root, filepath.FromSlash(linkedRel))); err != nil {
		t.Fatal(err)
	}

	if _, err := OfficialHTMLPath(root, "https://www.aozora.gr.jp/"+linkedRel, []string{linkedRel}); err == nil {
		t.Fatal("OfficialHTMLPath accepted a selected symlink that escapes the source root")
	}
}

func TestLoadCatalogMetadataGroupsRowsAndAuthors(t *testing.T) {
	root := t.TempDir()
	rel := "cards/000007/files/123_456.html"
	writeTestHTML(t, root, rel)
	url := "https://www.aozora.gr.jp/" + rel

	rows := [][]string{
		catalogTestRow("000123", " Test   Work ", "000007", "Zulu", "Author", "著者", url, "ShiftJIS", "JIS X 0208"),
		catalogTestRow("000123", "Test Work", "000008", "Ignored", "Translator", "翻訳者", url, "ShiftJIS", "JIS X 0208"),
		catalogTestRow("000123", "Test Work", "000009", "Alpha", "Author", "著者", url, "ShiftJIS", "JIS X 0208"),
		catalogTestRow("000123", "Test Work", "000009", " Alpha ", "Author", " 著者 ", url, "ShiftJIS", "JIS X 0208"),
		catalogTestRow("999999", "Foreign", "000010", "Foreign", "Author", "著者", "https://example.test/"+rel, "UTF-8", "Unicode"),
	}
	writeTestCatalog(t, root, rows)

	got, err := LoadCatalogMetadata(root, []string{rel})
	if err != nil {
		t.Fatalf("LoadCatalogMetadata: %v", err)
	}
	if len(got) != 1 {
		t.Fatalf("LoadCatalogMetadata returned %d documents, want 1", len(got))
	}
	metadata := got[rel]
	if metadata.HTMLPath != rel {
		t.Errorf("HTMLPath = %q, want %q", metadata.HTMLPath, rel)
	}
	if metadata.WorkID != "000123" {
		t.Errorf("WorkID = %q, want leading-zero ID %q", metadata.WorkID, "000123")
	}
	if metadata.WorkName != "Test Work" {
		t.Errorf("WorkName = %q, want %q", metadata.WorkName, "Test Work")
	}
	if want := []string{"Alpha Author", "Zulu Author"}; !reflect.DeepEqual(metadata.AuthorNames, want) {
		t.Errorf("AuthorNames = %#v, want %#v", metadata.AuthorNames, want)
	}
	if metadata.CatalogEncoding != "ShiftJIS" || metadata.CatalogCharset != "JIS X 0208" {
		t.Errorf("catalog encoding = %q/%q", metadata.CatalogEncoding, metadata.CatalogCharset)
	}
	if metadata.MetadataFallback {
		t.Error("catalog metadata unexpectedly marked as fallback")
	}

	columns, err := catalogColumnIndexes(catalogTestHeader())
	if err != nil {
		t.Fatal(err)
	}
	parsed := catalogRowFromRecord(rows[0], columns)
	if parsed.WorkID != "000123" || parsed.PersonID != "000007" {
		t.Fatalf("catalog IDs were not preserved as strings: work=%q person=%q", parsed.WorkID, parsed.PersonID)
	}
}

func TestLoadCatalogMetadataRejectsMalformedOfficialURL(t *testing.T) {
	root := t.TempDir()
	rel := "cards/000007/files/123_456.html"
	writeTestHTML(t, root, rel)
	rows := [][]string{
		catalogTestRow("000123", "Test Work", "000007", "Test", "Author", "著者", "https://www.aozora.gr.jp/"+rel+"?unsafe=1", "ShiftJIS", "JIS X 0208"),
	}
	writeTestCatalog(t, root, rows)

	if _, err := LoadCatalogMetadata(root, []string{rel}); err == nil {
		t.Fatal("LoadCatalogMetadata accepted a malformed official URL")
	}
}

func TestMergeMetadataFallback(t *testing.T) {
	selected := []string{
		"cards/000001/files/catalog.html",
		"cards/000001/files/partial.html",
		"cards/000001/files/missing.html",
	}
	catalog := map[string]DocumentMetadata{
		selected[0]: {
			HTMLPath:    selected[0],
			WorkID:      "000001",
			WorkName:    "Catalog Work",
			AuthorNames: []string{"Catalog Author"},
		},
		selected[1]: {
			HTMLPath: selected[1],
			WorkID:   "000002",
		},
	}
	fallbacks := map[string]HTMLMetadata{
		selected[0]: {WorkName: "Wrong Work", AuthorNames: []string{"Wrong Author"}},
		selected[1]: {WorkName: " Page   Work ", AuthorNames: []string{"Zulu", "Alpha", "Alpha"}},
		selected[2]: {WorkName: "Missing Work", AuthorNames: []string{"Missing Author"}},
	}

	got, fallbackCount := MergeMetadataFallback(selected, catalog, fallbacks)
	if fallbackCount != 2 {
		t.Fatalf("fallback count = %d, want 2", fallbackCount)
	}
	if metadata := got[selected[0]]; metadata.WorkName != "Catalog Work" ||
		!reflect.DeepEqual(metadata.AuthorNames, []string{"Catalog Author"}) || metadata.MetadataFallback {
		t.Errorf("authoritative catalog metadata was not preserved: %#v", metadata)
	}
	if metadata := got[selected[1]]; metadata.WorkName != "Page Work" ||
		!reflect.DeepEqual(metadata.AuthorNames, []string{"Alpha", "Zulu"}) || !metadata.MetadataFallback {
		t.Errorf("partial metadata fallback = %#v", metadata)
	}
	if metadata := got[selected[2]]; metadata.HTMLPath != selected[2] || metadata.WorkID != "" ||
		metadata.WorkName != "Missing Work" || !metadata.MetadataFallback {
		t.Errorf("missing metadata fallback = %#v", metadata)
	}
}

func TestMergeMetadataFallbackDoesNotRelabelKnownNonAuthors(t *testing.T) {
	selected := []string{"cards/000001/files/translated.html"}
	catalog := map[string]DocumentMetadata{
		selected[0]: {
			HTMLPath:          selected[0],
			WorkID:            "000001",
			WorkName:          "Translated Work",
			catalogRolesKnown: true,
		},
	}
	fallbacks := map[string]HTMLMetadata{
		selected[0]: {AuthorNames: []string{"Page Contributor"}},
	}

	got, fallbackCount := MergeMetadataFallback(selected, catalog, fallbacks)
	if fallbackCount != 0 {
		t.Fatalf("fallback count = %d, want 0", fallbackCount)
	}
	if metadata := got[selected[0]]; len(metadata.AuthorNames) != 0 || metadata.MetadataFallback {
		t.Fatalf("known non-author roles were relabeled: %#v", metadata)
	}
}

func TestLoadCatalogMetadataRequiresNamedColumns(t *testing.T) {
	root := t.TempDir()
	rel := "cards/000007/files/123_456.html"
	writeTestHTML(t, root, rel)
	writeTestCatalogWithHeader(t, root, []string{"作品ID", "作品名"}, [][]string{{"000123", "Work"}})

	_, err := LoadCatalogMetadata(root, []string{rel})
	if err == nil || !strings.Contains(err.Error(), "missing required column") {
		t.Fatalf("LoadCatalogMetadata error = %v, want missing-column error", err)
	}
}

func TestCorpusInventoryIntegration(t *testing.T) {
	root := os.Getenv("AOZORA_TEST_ROOT")
	if root == "" {
		t.Skip("set AOZORA_TEST_ROOT to exercise the mirrored Aozora catalogue")
	}
	selected, err := SelectHTMLPaths(root, documentLimit)
	if err != nil {
		t.Fatalf("SelectHTMLPaths: %v", err)
	}
	if len(selected) != documentLimit {
		t.Fatalf("selected %d documents, want %d", len(selected), documentLimit)
	}
	metadata, _, err := LoadDocumentMetadata(root, selected, nil)
	if err != nil {
		t.Fatalf("LoadDocumentMetadata: %v", err)
	}
	if len(metadata) != documentLimit {
		t.Fatalf("loaded metadata for %d documents, want %d", len(metadata), documentLimit)
	}
}

func writeTestHTML(t *testing.T, root, rel string) {
	t.Helper()
	fullPath := filepath.Join(root, filepath.FromSlash(rel))
	if err := os.MkdirAll(filepath.Dir(fullPath), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(fullPath, []byte("<!doctype html>"), 0o600); err != nil {
		t.Fatal(err)
	}
}

func writeTestCatalog(t *testing.T, root string, rows [][]string) {
	t.Helper()
	header := catalogTestHeader()
	header[0] = "\ufeff" + header[0]
	writeTestCatalogWithHeader(t, root, header, rows)
}

func writeTestCatalogWithHeader(t *testing.T, root string, header []string, rows [][]string) {
	t.Helper()
	zipPath := filepath.Join(root, filepath.FromSlash(extendedCatalogPath))
	if err := os.MkdirAll(filepath.Dir(zipPath), 0o755); err != nil {
		t.Fatal(err)
	}
	file, err := os.Create(zipPath)
	if err != nil {
		t.Fatal(err)
	}
	zipWriter := zip.NewWriter(file)
	member, err := zipWriter.Create("list_person_all_extended_utf8.csv")
	if err != nil {
		t.Fatal(err)
	}
	csvWriter := csv.NewWriter(member)
	if err := csvWriter.Write(header); err != nil {
		t.Fatal(err)
	}
	if err := csvWriter.WriteAll(rows); err != nil {
		t.Fatal(err)
	}
	csvWriter.Flush()
	if err := csvWriter.Error(); err != nil {
		t.Fatal(err)
	}
	if err := zipWriter.Close(); err != nil {
		t.Fatal(err)
	}
	if err := file.Close(); err != nil {
		t.Fatal(err)
	}
}

func catalogTestHeader() []string {
	return []string{
		"作品ID",
		"作品名",
		"人物ID",
		"姓",
		"名",
		"役割フラグ",
		"XHTML/HTMLファイルURL",
		"XHTML/HTMLファイル符号化方式",
		"XHTML/HTMLファイル文字集合",
	}
}

func catalogTestRow(workID, workName, personID, surname, givenName, role, htmlURL, encoding, charset string) []string {
	return []string{workID, workName, personID, surname, givenName, role, htmlURL, encoding, charset}
}
