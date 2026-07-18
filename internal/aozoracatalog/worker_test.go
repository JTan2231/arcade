package aozoracatalog

import (
	"context"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

func TestBrowserExtractorProtocolIntegration(t *testing.T) {
	if os.Getenv("AOZORA_BROWSER_WORKER_TEST") == "" {
		t.Skip("set AOZORA_BROWSER_WORKER_TEST=1 to run the pinned Chromium worker integration")
	}
	_, currentFile, _, ok := runtime.Caller(0)
	if !ok {
		t.Fatal("runtime.Caller did not return the test source path")
	}
	repositoryRoot := filepath.Clean(filepath.Join(filepath.Dir(currentFile), "..", ".."))
	sourceRoot := filepath.Join(repositoryRoot, "tools", "aozora-dom-extract", "test", "fixtures", "corpus")

	extractor, err := NewBrowserExtractor(context.Background(), BrowserExtractorOptions{})
	if err != nil {
		t.Fatalf("NewBrowserExtractor: %v", err)
	}
	closed := false
	defer func() {
		if !closed {
			_ = extractor.Close()
		}
	}()

	result, err := extractor.Extract(context.Background(), ExtractRequest{
		SourceRoot: sourceRoot,
		HTMLPath:   "cards/000001/files/utf8-rich.html",
		Encoding:   "UTF-8",
	})
	if err != nil {
		t.Fatalf("Extract: %v", err)
	}
	if !result.HasText || result.OccurrencesSeen == 0 || result.SelectorsVerified == 0 || len(result.Occurrences) != result.SelectorsVerified {
		t.Fatalf("extract result = %#v", result)
	}
	if result.Metadata.WorkName != "試験作品" {
		t.Fatalf("fallback work name = %q", result.Metadata.WorkName)
	}

	native, err := extractor.Extract(context.Background(), ExtractRequest{
		SourceRoot:   sourceRoot,
		HTMLPath:     "cards/000001/files/native.html",
		NativeSample: true,
	})
	if err != nil {
		t.Fatalf("native Extract: %v", err)
	}
	if !native.HasText || native.SelectorsVerified == 0 {
		t.Fatalf("native extract result = %#v", native)
	}

	rejected, err := extractor.Extract(context.Background(), ExtractRequest{
		SourceRoot: sourceRoot,
		HTMLPath:   "cards/000001/files/duplicate-main.html",
	})
	if err != nil {
		t.Fatalf("invalid main_text should be a document rejection, got %v", err)
	}
	if rejected.HasText || !strings.Contains(rejected.RejectedReason, "expected exactly one") {
		t.Fatalf("document rejection = %#v", rejected)
	}

	stats, err := extractor.Stats(context.Background())
	if err != nil {
		t.Fatalf("Stats: %v", err)
	}
	if stats.SelectorEngineRevision == "" || stats.ChromiumVersion == "" {
		t.Fatalf("version stats = %#v", stats)
	}
	wantDOMVerified := result.SelectorsVerified + native.SelectorsVerified
	if stats.DOMRoundTripsVerified != wantDOMVerified || stats.NativeNavigationsChecked != 1 || stats.NativeNavigationsVerified != 1 {
		t.Fatalf("validation stats = %#v, extracts = %#v / %#v", stats, result, native)
	}
	if err := extractor.Close(); err != nil {
		t.Fatalf("Close: %v", err)
	}
	closed = true
}

func TestTailWriterKeepsOnlyConfiguredTail(t *testing.T) {
	writer := &tailWriter{limit: 5}
	_, _ = writer.Write([]byte("abc"))
	_, _ = writer.Write([]byte("defg"))
	if got := writer.String(); got != "cdefg" {
		t.Fatalf("tail = %q, want cdefg", got)
	}
	_, _ = writer.Write([]byte("123456"))
	if got := writer.String(); got != "23456" {
		t.Fatalf("tail after oversized write = %q, want 23456", got)
	}
}
