package aozoracatalog

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"reflect"
	"strconv"
	"testing"
	"time"

	"arcade/internal/catalogimport"
)

func TestUploadAlwaysDryRunsBeforeCommit(t *testing.T) {
	directory, catalog := writeTestArtifact(t, 1)
	var dryRuns []bool
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, request *http.Request) {
		if request.URL.Path != "/api/catalog-imports" {
			t.Errorf("request path = %q", request.URL.Path)
		}
		if got := request.Header.Get("Authorization"); got != "Bearer secret" {
			t.Errorf("Authorization = %q", got)
		}
		if err := request.ParseMultipartForm(64 << 20); err != nil {
			t.Errorf("ParseMultipartForm: %v", err)
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		dryRun, err := strconv.ParseBool(request.FormValue("dry_run"))
		if err != nil {
			t.Errorf("dry_run: %v", err)
		}
		dryRuns = append(dryRuns, dryRun)
		file, _, err := request.FormFile("file")
		if err != nil {
			t.Errorf("FormFile: %v", err)
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		defer file.Close()
		got, err := io.ReadAll(file)
		if err != nil {
			t.Errorf("ReadAll: %v", err)
		}
		if !bytes.Equal(got, catalog) {
			t.Error("uploaded bytes differ from committed catalog")
		}
		result := catalogimport.Result{
			DryRun: dryRun,
			Status: "completed",
			Counts: catalogimport.Counts{ItemsSeen: 1},
			Errors: []catalogimport.ImportMessage{},
		}
		if !dryRun {
			result.Counts.ItemsInserted = 1
		}
		_ = json.NewEncoder(w).Encode(result)
	}))
	defer server.Close()

	result, err := Upload(context.Background(), directory, UploadOptions{
		BaseURL: server.URL,
		Token:   "secret",
		Client:  server.Client(),
	})
	if err != nil {
		t.Fatalf("Upload: %v", err)
	}
	if !reflect.DeepEqual(dryRuns, []bool{true, false}) {
		t.Fatalf("dry-run sequence = %#v", dryRuns)
	}
	if result.Import == nil || result.Import.Counts.ItemsInserted != 1 {
		t.Fatalf("import result = %#v", result.Import)
	}
}

func TestUploadDryRunStopsAfterMandatoryValidation(t *testing.T) {
	directory, _ := writeTestArtifact(t, 1)
	requests := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, request *http.Request) {
		requests++
		if err := request.ParseMultipartForm(64 << 20); err != nil {
			t.Error(err)
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		if request.FormValue("dry_run") != "true" {
			t.Errorf("dry_run = %q", request.FormValue("dry_run"))
		}
		_ = json.NewEncoder(w).Encode(catalogimport.Result{
			DryRun: true,
			Status: "completed",
			Counts: catalogimport.Counts{ItemsSeen: 1},
			Errors: []catalogimport.ImportMessage{},
		})
	}))
	defer server.Close()

	result, err := Upload(context.Background(), directory, UploadOptions{
		BaseURL: server.URL,
		Token:   "secret",
		DryRun:  true,
		Client:  server.Client(),
	})
	if err != nil {
		t.Fatalf("Upload: %v", err)
	}
	if requests != 1 {
		t.Fatalf("requests = %d, want 1", requests)
	}
	if result.Import != nil {
		t.Fatalf("Import = %#v, want nil", result.Import)
	}
}

func TestUploadRefusesDigestMismatchBeforeHTTP(t *testing.T) {
	directory, _ := writeTestArtifact(t, 1)
	if err := os.WriteFile(filepath.Join(directory, "catalog.jsonl"), []byte("changed"), 0o644); err != nil {
		t.Fatal(err)
	}
	requests := 0
	server := httptest.NewServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) { requests++ }))
	defer server.Close()

	_, err := Upload(context.Background(), directory, UploadOptions{BaseURL: server.URL, Token: "secret", Client: server.Client()})
	if err == nil {
		t.Fatal("Upload returned nil error")
	}
	if requests != 0 {
		t.Fatalf("requests = %d, want 0", requests)
	}
}

func TestUploadRefusesArcadeCountMismatchWithoutCommit(t *testing.T) {
	directory, _ := writeTestArtifact(t, 1)
	requests := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, request *http.Request) {
		requests++
		_ = json.NewEncoder(w).Encode(catalogimport.Result{
			DryRun: true,
			Status: "completed",
			Counts: catalogimport.Counts{ItemsSeen: 2},
			Errors: []catalogimport.ImportMessage{},
		})
	}))
	defer server.Close()

	_, err := Upload(context.Background(), directory, UploadOptions{BaseURL: server.URL, Token: "secret", Client: server.Client()})
	if err == nil {
		t.Fatal("Upload returned nil error")
	}
	if requests != 1 {
		t.Fatalf("requests = %d, want mandatory dry run only", requests)
	}
}

func writeTestArtifact(t *testing.T, itemCount int) (string, []byte) {
	t.Helper()
	generatedAt := time.Date(2026, 7, 18, 12, 0, 0, 0, time.UTC)
	htmlPath := "cards/000008/files/47386_69118.html"
	documentID := DocumentID(htmlPath)
	selector, err := SerializeSelector(Selector{Kind: SelectorKindExact, Start: "その朝"})
	if err != nil {
		t.Fatal(err)
	}
	items := make([]ProjectedItem, 0, itemCount)
	for index := range itemCount {
		startKey := "その朝" + strconv.Itoa(index)
		items = append(items, ProjectedItem{
			ExternalID:        PairDocumentExternalID(documentID, RangeKindWord, startKey, "帰った"),
			Name:              "續生活の探求 — その朝 … 帰った",
			HTMLPath:          htmlPath,
			TextSelector:      selector,
			RangeKind:         RangeKindWord,
			StartKey:          startKey,
			EndKey:            "帰った",
			WorkID:            "47386",
			WorkName:          "續生活の探求",
			AuthorNames:       []string{"小栗 虫太郎"},
			SentenceGraphemes: 11,
			OccurrenceCount:   1,
			DocumentID:        documentID,
			SelectorVerified:  true,
		})
	}
	catalog, err := FormatCatalog(items, generatedAt)
	if err != nil {
		t.Fatalf("FormatCatalog: %v", err)
	}
	directory := t.TempDir()
	_, err = CommitCatalog(directory, catalog, BuildReport{
		SourceRoot:             "/tmp/aozora",
		CatalogItems:           itemCount,
		GeneratedAt:            generatedAt.Format(time.RFC3339),
		ChromiumVersion:        "test",
		SelectorEngineRevision: "test",
	})
	if err != nil {
		t.Fatalf("CommitCatalog: %v", err)
	}
	return directory, catalog
}
