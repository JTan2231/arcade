package main

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"path/filepath"
	"strings"
	"testing"

	"arcade/internal/aozoracatalog"
	"arcade/internal/catalogimport"
)

func TestParseBuildAcceptsSourceBeforeOrAfterOutput(t *testing.T) {
	tests := []struct {
		name string
		args []string
	}{
		{name: "before output", args: []string{"build", "--source", "/corpus", "/dataset"}},
		{name: "after output", args: []string{"build", "/dataset", "--source", "/corpus"}},
		{name: "equals form", args: []string{"build", "/dataset", "--source=/corpus"}},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			parsed, err := parseCommand(test.args)
			if err != nil {
				t.Fatalf("parseCommand() error = %v", err)
			}
			if parsed.subcommand != "build" {
				t.Fatalf("subcommand = %q, want build", parsed.subcommand)
			}
			if parsed.outputDirectory != "/dataset" {
				t.Fatalf("outputDirectory = %q, want /dataset", parsed.outputDirectory)
			}
			if !parsed.sourceSet || parsed.source != "/corpus" {
				t.Fatalf("source = %q, set = %t", parsed.source, parsed.sourceSet)
			}
		})
	}
}

func TestParseUploadAcceptsDryRunAfterOutput(t *testing.T) {
	for _, args := range [][]string{
		{"upload", "/dataset", "--dry-run"},
		{"upload", "--dry-run", "/dataset"},
	} {
		parsed, err := parseCommand(args)
		if err != nil {
			t.Fatalf("parseCommand(%q) error = %v", args, err)
		}
		if parsed.subcommand != "upload" || parsed.outputDirectory != "/dataset" || !parsed.dryRun {
			t.Fatalf("parseCommand(%q) = %#v", args, parsed)
		}
	}
}

func TestParseCommandRejectsInvalidSurface(t *testing.T) {
	tests := []struct {
		name    string
		args    []string
		message string
	}{
		{name: "missing subcommand", message: "subcommand is required"},
		{name: "unknown subcommand", args: []string{"convert"}, message: "expected build or upload"},
		{name: "build output required", args: []string{"build"}, message: "OUTPUT_DIRECTORY is required"},
		{name: "upload output required", args: []string{"upload", "--dry-run"}, message: "OUTPUT_DIRECTORY is required"},
		{name: "blank build output", args: []string{"build", ""}, message: "OUTPUT_DIRECTORY is required"},
		{name: "blank upload output", args: []string{"upload", " "}, message: "OUTPUT_DIRECTORY is required"},
		{name: "build flag", args: []string{"build", "/dataset", "--dry-run"}, message: "unknown option"},
		{name: "upload flag", args: []string{"upload", "/dataset", "--source", "/corpus"}, message: "unknown option"},
		{name: "extra positional", args: []string{"build", "/dataset", "/other"}, message: "unexpected argument"},
		{name: "empty source", args: []string{"build", "/dataset", "--source="}, message: "requires a directory"},
		{name: "duplicate source", args: []string{"build", "/dataset", "--source", "/one", "--source", "/two"}, message: "only be provided once"},
		{name: "duplicate dry run", args: []string{"upload", "/dataset", "--dry-run", "--dry-run"}, message: "only be provided once"},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			_, err := parseCommand(test.args)
			if err == nil {
				t.Fatal("parseCommand() unexpectedly succeeded")
			}
			if !strings.Contains(err.Error(), test.message) {
				t.Fatalf("parseCommand() error = %q, want substring %q", err, test.message)
			}
		})
	}
}

func TestRunBuildResolvesSourcePrecedence(t *testing.T) {
	tests := []struct {
		name        string
		args        []string
		environment map[string]string
		wantSource  string
		wantHome    bool
	}{
		{
			name:        "flag wins over environment",
			args:        []string{"build", "/dataset", "--source", "/from-flag"},
			environment: map[string]string{"AOZORA_ROOT": "/from-environment"},
			wantSource:  "/from-flag",
		},
		{
			name:        "environment wins over default",
			args:        []string{"build", "/dataset"},
			environment: map[string]string{"AOZORA_ROOT": "/from-environment"},
			wantSource:  "/from-environment",
		},
		{
			name:       "home default",
			args:       []string{"build", "/dataset"},
			wantSource: filepath.Join("/home/operator", "jp", "aozorabunko"),
			wantHome:   true,
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			var stdout bytes.Buffer
			var stderr bytes.Buffer
			homeCalled := false
			dependencies := testDependencies()
			dependencies.lookupEnv = mapLookup(test.environment)
			dependencies.userHomeDir = func() (string, error) {
				homeCalled = true
				return "/home/operator", nil
			}
			dependencies.build = func(_ context.Context, options aozoracatalog.BuildOptions) (aozoracatalog.BuildReport, error) {
				if options.SourceRoot != test.wantSource {
					t.Fatalf("SourceRoot = %q, want %q", options.SourceRoot, test.wantSource)
				}
				if options.OutputDirectory != "/dataset" {
					t.Fatalf("OutputDirectory = %q", options.OutputDirectory)
				}
				return aozoracatalog.BuildReport{Schema: aozoracatalog.BuildReportSchema, SourceRoot: options.SourceRoot}, nil
			}

			if code := run(context.Background(), test.args, &stdout, &stderr, dependencies); code != 0 {
				t.Fatalf("run() code = %d, stderr = %q", code, stderr.String())
			}
			if homeCalled != test.wantHome {
				t.Fatalf("userHomeDir called = %t, want %t", homeCalled, test.wantHome)
			}

			var report aozoracatalog.BuildReport
			if err := json.Unmarshal(stdout.Bytes(), &report); err != nil {
				t.Fatalf("decode stdout: %v; output = %q", err, stdout.String())
			}
			if report.SourceRoot != test.wantSource {
				t.Fatalf("stdout source_root = %q, want %q", report.SourceRoot, test.wantSource)
			}
		})
	}
}

func TestRunBuildKeepsDiagnosticsAndProgressOnStderr(t *testing.T) {
	var stdout bytes.Buffer
	var stderr bytes.Buffer
	dependencies := testDependencies()
	dependencies.build = func(ctx context.Context, options aozoracatalog.BuildOptions) (aozoracatalog.BuildReport, error) {
		if ctx.Err() != context.Canceled {
			t.Fatalf("build context error = %v, want context.Canceled", ctx.Err())
		}
		fmt.Fprintln(options.WorkerStderr, "worker diagnostic")
		options.Progress(7, 100, "cards/000001/files/example.html")
		return aozoracatalog.BuildReport{Schema: aozoracatalog.BuildReportSchema, CatalogItems: 42}, nil
	}

	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if code := run(ctx, []string{"build", "/dataset", "--source", "/corpus"}, &stdout, &stderr, dependencies); code != 0 {
		t.Fatalf("run() code = %d, stderr = %q", code, stderr.String())
	}
	if !strings.Contains(stderr.String(), "worker diagnostic\nbuild: 7/100 cards/000001/files/example.html\n") {
		t.Fatalf("stderr = %q", stderr.String())
	}
	if strings.Contains(stdout.String(), "worker diagnostic") || strings.Contains(stdout.String(), "build: 7/100") {
		t.Fatalf("stdout contains diagnostics: %q", stdout.String())
	}

	var report aozoracatalog.BuildReport
	if err := json.Unmarshal(stdout.Bytes(), &report); err != nil {
		t.Fatalf("decode stdout: %v", err)
	}
	if report.CatalogItems != 42 {
		t.Fatalf("catalog_items = %d, want 42", report.CatalogItems)
	}
}

func TestRunUploadPassesEnvironmentAndPrintsDryRunResult(t *testing.T) {
	var stdout bytes.Buffer
	var stderr bytes.Buffer
	dependencies := testDependencies()
	dependencies.lookupEnv = mapLookup(map[string]string{
		"ARCADE_BASE_URL":             "https://arcade.example.test/root",
		"ARCADE_CATALOG_IMPORT_TOKEN": "secret-token",
	})
	dependencies.upload = func(ctx context.Context, outputDirectory string, options aozoracatalog.UploadOptions) (aozoracatalog.UploadResult, error) {
		if ctx.Err() != context.Canceled {
			t.Fatalf("upload context error = %v, want context.Canceled", ctx.Err())
		}
		if outputDirectory != "/dataset" {
			t.Fatalf("outputDirectory = %q", outputDirectory)
		}
		if options.BaseURL != "https://arcade.example.test/root" || options.Token != "secret-token" || !options.DryRun {
			t.Fatalf("UploadOptions = %#v", options)
		}
		return aozoracatalog.UploadResult{Validation: catalogimport.Result{
			DryRun: true,
			Status: "completed",
			Counts: catalogimport.Counts{ItemsSeen: 37},
		}}, nil
	}

	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if code := run(ctx, []string{"upload", "/dataset", "--dry-run"}, &stdout, &stderr, dependencies); code != 0 {
		t.Fatalf("run() code = %d, stderr = %q", code, stderr.String())
	}
	if stderr.Len() != 0 {
		t.Fatalf("stderr = %q", stderr.String())
	}

	var result catalogimport.Result
	if err := json.Unmarshal(stdout.Bytes(), &result); err != nil {
		t.Fatalf("decode stdout: %v; output = %q", err, stdout.String())
	}
	if !result.DryRun || result.Status != "completed" || result.Counts.ItemsSeen != 37 {
		t.Fatalf("stdout result = %#v", result)
	}
}

func TestRunUploadPrintsRealImportCounts(t *testing.T) {
	var stdout bytes.Buffer
	var stderr bytes.Buffer
	dependencies := testDependencies()
	dependencies.lookupEnv = mapLookup(map[string]string{"ARCADE_CATALOG_IMPORT_TOKEN": "secret-token"})
	dependencies.upload = func(_ context.Context, _ string, options aozoracatalog.UploadOptions) (aozoracatalog.UploadResult, error) {
		if options.BaseURL != "" {
			t.Fatalf("BaseURL = %q, want empty so the library applies its default", options.BaseURL)
		}
		if options.DryRun {
			t.Fatal("DryRun = true for a normal upload")
		}
		imported := catalogimport.Result{
			Status: "completed",
			Counts: catalogimport.Counts{ItemsSeen: 12, ItemsInserted: 7, ItemsUpdated: 5},
		}
		return aozoracatalog.UploadResult{
			Validation: catalogimport.Result{DryRun: true, Status: "completed"},
			Import:     &imported,
		}, nil
	}

	if code := run(context.Background(), []string{"upload", "/dataset"}, &stdout, &stderr, dependencies); code != 0 {
		t.Fatalf("run() code = %d, stderr = %q", code, stderr.String())
	}

	var result catalogimport.Result
	if err := json.Unmarshal(stdout.Bytes(), &result); err != nil {
		t.Fatalf("decode stdout: %v", err)
	}
	if result.DryRun || result.Counts.ItemsInserted != 7 || result.Counts.ItemsUpdated != 5 {
		t.Fatalf("stdout result = %#v", result)
	}
}

func TestRunUploadRequiresTokenWithoutCallingAPI(t *testing.T) {
	var stdout bytes.Buffer
	var stderr bytes.Buffer
	dependencies := testDependencies()
	dependencies.upload = func(context.Context, string, aozoracatalog.UploadOptions) (aozoracatalog.UploadResult, error) {
		t.Fatal("upload API was called without a token")
		return aozoracatalog.UploadResult{}, nil
	}

	if code := run(context.Background(), []string{"upload", "/dataset"}, &stdout, &stderr, dependencies); code != 1 {
		t.Fatalf("run() code = %d, want 1", code)
	}
	if stdout.Len() != 0 {
		t.Fatalf("stdout = %q", stdout.String())
	}
	if !strings.Contains(stderr.String(), "ARCADE_CATALOG_IMPORT_TOKEN is required") {
		t.Fatalf("stderr = %q", stderr.String())
	}
}

func TestRunUsageErrorIsClear(t *testing.T) {
	var stdout bytes.Buffer
	var stderr bytes.Buffer

	if code := run(context.Background(), []string{"extract"}, &stdout, &stderr, testDependencies()); code != 2 {
		t.Fatalf("run() code = %d, want 2", code)
	}
	if stdout.Len() != 0 {
		t.Fatalf("stdout = %q", stdout.String())
	}
	for _, want := range []string{"unknown subcommand", "aozora-catalog build OUTPUT_DIRECTORY", "aozora-catalog upload OUTPUT_DIRECTORY"} {
		if !strings.Contains(stderr.String(), want) {
			t.Fatalf("stderr = %q, missing %q", stderr.String(), want)
		}
	}
}

func testDependencies() commandDependencies {
	return commandDependencies{
		build: func(context.Context, aozoracatalog.BuildOptions) (aozoracatalog.BuildReport, error) {
			return aozoracatalog.BuildReport{}, errors.New("unexpected build call")
		},
		upload: func(context.Context, string, aozoracatalog.UploadOptions) (aozoracatalog.UploadResult, error) {
			return aozoracatalog.UploadResult{}, errors.New("unexpected upload call")
		},
		lookupEnv: mapLookup(nil),
		userHomeDir: func() (string, error) {
			return "/home/operator", nil
		},
	}
}

func mapLookup(values map[string]string) func(string) (string, bool) {
	return func(key string) (string, bool) {
		value, ok := values[key]
		return value, ok
	}
}
