package aozoracatalog

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestBuildProducesStableHundredDocumentArtifact(t *testing.T) {
	sourceRoot := writeBuildTestCorpus(t, documentLimit)
	generatedAt := time.Date(2026, 7, 18, 3, 4, 5, 0, time.UTC)
	firstOutput := filepath.Join(t.TempDir(), "first")
	secondOutput := filepath.Join(t.TempDir(), "second")
	progressCalls := 0

	firstExtractor := &fakeExtractor{}
	first, err := Build(context.Background(), BuildOptions{
		SourceRoot:      sourceRoot,
		OutputDirectory: firstOutput,
		GeneratedAt:     generatedAt,
		Extractor:       firstExtractor,
		Progress: func(processed, total int, _ string) {
			progressCalls++
			if processed != progressCalls || total != documentLimit {
				t.Errorf("progress = %d/%d on call %d", processed, total, progressCalls)
			}
		},
	})
	if err != nil {
		t.Fatalf("first Build: %v", err)
	}
	second, err := Build(context.Background(), BuildOptions{
		SourceRoot:      sourceRoot,
		OutputDirectory: secondOutput,
		GeneratedAt:     generatedAt,
		Extractor:       &fakeExtractor{},
	})
	if err != nil {
		t.Fatalf("second Build: %v", err)
	}
	if progressCalls != documentLimit {
		t.Fatalf("progress calls = %d, want %d", progressCalls, documentLimit)
	}
	if first.DocumentsSelected != documentLimit || first.DocumentsProcessed != documentLimit || first.DocumentsWithText != documentLimit || first.DocumentsRejected != 0 {
		t.Fatalf("document report = %#v", first)
	}
	if first.OccurrencesSeen != documentLimit || first.SelectorsVerified != documentLimit || first.SelectorsRejected != 0 {
		t.Fatalf("selector report = %#v", first)
	}
	if first.WordItems != documentLimit || first.Grapheme3Items != documentLimit || first.CatalogItems != 2*documentLimit {
		t.Fatalf("item report = %#v", first)
	}
	if first.DocumentsMetadataFallback != 0 || first.NativeNavigationsChecked != 10 || first.NativeNavigationsVerified != 10 {
		t.Fatalf("metadata/native report = %#v", first)
	}
	if first.CatalogSHA256 != second.CatalogSHA256 || first.CatalogBytes != second.CatalogBytes {
		t.Fatalf("stable reports differ: first=%#v second=%#v", first, second)
	}
	firstCatalog, err := os.ReadFile(filepath.Join(firstOutput, "catalog.jsonl"))
	if err != nil {
		t.Fatal(err)
	}
	secondCatalog, err := os.ReadFile(filepath.Join(secondOutput, "catalog.jsonl"))
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(firstCatalog, secondCatalog) {
		t.Fatal("catalog item output changed for the same inputs and generated_at")
	}
}

func TestBuildRequiresExactlyHundredSelectedDocuments(t *testing.T) {
	sourceRoot := writeBuildTestCorpus(t, documentLimit-1)
	_, err := Build(context.Background(), BuildOptions{
		SourceRoot:      sourceRoot,
		OutputDirectory: t.TempDir(),
		Extractor:       &fakeExtractor{},
	})
	if err == nil {
		t.Fatal("Build returned nil error")
	}
}

func TestBuildDoesNotPublishAfterExtractorFailure(t *testing.T) {
	sourceRoot := writeBuildTestCorpus(t, documentLimit)
	output := filepath.Join(t.TempDir(), "output")
	_, err := Build(context.Background(), BuildOptions{
		SourceRoot:      sourceRoot,
		OutputDirectory: output,
		Extractor:       &fakeExtractor{failAt: 2},
	})
	if err == nil {
		t.Fatal("Build returned nil error")
	}
	for _, name := range []string{"catalog.jsonl", "build.json"} {
		if _, statErr := os.Stat(filepath.Join(output, name)); !errors.Is(statErr, os.ErrNotExist) {
			t.Errorf("%s exists after failed extraction: %v", name, statErr)
		}
	}
}

type fakeExtractor struct {
	requests int
	checked  int
	failAt   int
}

func (extractor *fakeExtractor) Extract(_ context.Context, request ExtractRequest) (ExtractResult, error) {
	extractor.requests++
	if extractor.failAt != 0 && extractor.requests == extractor.failAt {
		return ExtractResult{}, errors.New("worker stopped")
	}
	if request.NativeSample {
		extractor.checked++
	}
	selector := Selector{Kind: SelectorKindExact, Start: "文。", Verified: true}
	encoded, err := SerializeSelector(selector)
	if err != nil {
		return ExtractResult{}, err
	}
	selector.Encoded = encoded
	return ExtractResult{
		HasText:           true,
		Metadata:          HTMLMetadata{WorkName: "page fallback", AuthorNames: []string{"page author"}},
		OccurrencesSeen:   1,
		SelectorsVerified: 1,
		Occurrences: []Occurrence{{
			Index:             0,
			ExactText:         "文。",
			IdentityText:      "文。",
			DuplicateOrdinal:  0,
			SentenceGraphemes: 2,
			Selector:          selector,
			Endpoints: []Endpoint{
				{RangeKind: RangeKindWord, StartSurface: "文", EndSurface: "文"},
				{RangeKind: RangeKindGrapheme3, StartSurface: "文", EndSurface: "文"},
			},
		}},
	}, nil
}

func (extractor *fakeExtractor) Stats(context.Context) (ExtractorStats, error) {
	return ExtractorStats{
		SelectorEngineRevision:    "test-selector",
		ChromiumVersion:           "test-chromium",
		DOMRoundTripsVerified:     extractor.requests,
		NativeNavigationsChecked:  extractor.checked,
		NativeNavigationsVerified: extractor.checked,
	}, nil
}

func (*fakeExtractor) Close() error { return nil }

func writeBuildTestCorpus(t *testing.T, count int) string {
	t.Helper()
	root := t.TempDir()
	rows := make([][]string, 0, count)
	for index := range count {
		rel := fmt.Sprintf("cards/000001/files/%03d.html", index)
		writeTestHTML(t, root, rel)
		rows = append(rows, catalogTestRow(
			fmt.Sprintf("%06d", index),
			fmt.Sprintf("Work %03d", index),
			"000001",
			"Author",
			fmt.Sprintf("%03d", index),
			"著者",
			"https://www.aozora.gr.jp/"+rel,
			"UTF-8",
			"Unicode",
		))
	}
	writeTestCatalog(t, root, rows)
	return root
}
