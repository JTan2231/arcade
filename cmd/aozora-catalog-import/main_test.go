package main

import (
	"strings"
	"testing"
	"time"

	"arcade/internal/catalogimport"
)

func TestFormatAozoraJSONLBuildsCatalogItemsWithoutFields(t *testing.T) {
	input := strings.Join([]string{
		"start\tend\tperson_id\twork_id\tfile_id",
		"ああい\tからね\t000008\t47386\t69118",
	}, "\n")

	jsonl, err := formatAozoraJSONL(strings.NewReader(input), time.Date(2026, 7, 2, 0, 0, 0, 0, time.UTC))
	if err != nil {
		t.Fatalf("formatAozoraJSONL returned error: %v", err)
	}

	file, result, err := catalogimport.ParseJSONL(strings.NewReader(string(jsonl)), catalogimport.Options{AllowGlobal: true})
	if err != nil {
		t.Fatalf("ParseJSONL returned error: %v", err)
	}
	if len(result.Errors) != 0 {
		t.Fatalf("validation errors = %#v", result.Errors)
	}
	if result.Counts.FieldsSeen != 0 {
		t.Fatalf("FieldsSeen = %d, want 0", result.Counts.FieldsSeen)
	}
	if result.Counts.ItemsSeen != 1 {
		t.Fatalf("ItemsSeen = %d, want 1", result.Counts.ItemsSeen)
	}
	if file.Manifest.CatalogSource.Template != defaultTemplate {
		t.Fatalf("template = %q, want %q", file.Manifest.CatalogSource.Template, defaultTemplate)
	}

	item := file.Items[0]
	if item.ExternalID != "000008/47386/69118#text=%E3%81%82%E3%81%82%E3%81%84,%E3%81%8B%E3%82%89%E3%81%AD" {
		t.Fatalf("external ID = %q", item.ExternalID)
	}
	if got := item.Data["fragment_start"]; got != "%E3%81%82%E3%81%82%E3%81%84" {
		t.Fatalf("fragment_start = %#v", got)
	}
	if got := item.Data["fragment_end"]; got != "%E3%81%8B%E3%82%89%E3%81%AD" {
		t.Fatalf("fragment_end = %#v", got)
	}
	if _, exists := item.Data["start"]; exists {
		t.Fatal("item data unexpectedly includes raw start")
	}
	if _, exists := item.Data["end"]; exists {
		t.Fatal("item data unexpectedly includes raw end")
	}
}

func TestEncodeTextFragmentPartEscapesTextFragmentDelimiters(t *testing.T) {
	got := encodeTextFragmentPart("a b-c,d&")
	want := "a%20b%2Dc%2Cd%26"
	if got != want {
		t.Fatalf("encodeTextFragmentPart = %q, want %q", got, want)
	}
}

func TestFormatAozoraJSONLRejectsUnexpectedHeader(t *testing.T) {
	input := "start\tend\tperson_id\twork_id\tbad\nあ\tい\t000008\t47386\t69118\n"

	_, err := formatAozoraJSONL(strings.NewReader(input), time.Date(2026, 7, 2, 0, 0, 0, 0, time.UTC))
	if err == nil {
		t.Fatal("formatAozoraJSONL returned nil error")
	}
	if !strings.Contains(err.Error(), "unexpected TSV header column 5") {
		t.Fatalf("error = %q", err)
	}
}
