package catalogimport

import (
	"strings"
	"testing"
)

func TestParseJSONLValidCodeforcesImport(t *testing.T) {
	input := strings.Join([]string{
		`{"schema":"arcade.catalog_import.v1","kind":"manifest","generated_at":"2026-06-26T00:00:00Z","catalog_source":{"slug":"codeforces-problemset","name":"Codeforces Problemset","scope":"global","template":"https://codeforces.com/problemset/problem/{contest_id}/{index}"},"provider":{"slug":"codeforces","name":"Codeforces","base_url":"https://codeforces.com"}}`,
		`{"schema":"arcade.catalog_import.v1","kind":"catalog_field","catalog_source_slug":"codeforces-problemset","key":"rating","label":"Rating","value_type":"number","is_array":false,"display_order":10}`,
		`{"schema":"arcade.catalog_import.v1","kind":"catalog_field","catalog_source_slug":"codeforces-problemset","key":"tags","label":"Tags","value_type":"string","is_array":true,"display_order":20}`,
		`{"schema":"arcade.catalog_import.v1","kind":"catalog_item","catalog_source_slug":"codeforces-problemset","external_id":"4A","data":{"name":"Watermelon","contest_id":"4","index":"A","rating":800,"tags":["brute force","math"]}}`,
	}, "\n")

	file, result, err := ParseJSONL(strings.NewReader(input), Options{AllowGlobal: true})
	if err != nil {
		t.Fatalf("ParseJSONL returned error: %v", err)
	}
	if len(result.Errors) != 0 {
		t.Fatalf("validation errors = %#v", result.Errors)
	}
	if result.Counts.SourcesSeen != 1 || result.Counts.FieldsSeen != 2 || result.Counts.ItemsSeen != 1 {
		t.Fatalf("counts = %#v", result.Counts)
	}
	if got := file.Items[0].Data["external_id"]; got != "4A" {
		t.Fatalf("external_id copied into data = %#v", got)
	}
}

func TestParseJSONLRejectsDuplicateExternalID(t *testing.T) {
	input := strings.Join([]string{
		`{"schema":"arcade.catalog_import.v1","kind":"manifest","generated_at":"2026-06-26T00:00:00Z","catalog_source":{"slug":"codeforces-problemset","name":"Codeforces Problemset","scope":"global","template":"{contest_id}{index}"}}`,
		`{"schema":"arcade.catalog_import.v1","kind":"catalog_item","catalog_source_slug":"codeforces-problemset","external_id":"4A","data":{"contest_id":"4","index":"A"}}`,
		`{"schema":"arcade.catalog_import.v1","kind":"catalog_item","catalog_source_slug":"codeforces-problemset","external_id":"4A","data":{"contest_id":"4","index":"A"}}`,
	}, "\n")

	_, result, err := ParseJSONL(strings.NewReader(input), Options{AllowGlobal: true})
	if err != nil {
		t.Fatalf("ParseJSONL returned error: %v", err)
	}
	if !hasError(result, "duplicate_external_id") {
		t.Fatalf("expected duplicate_external_id, got %#v", result.Errors)
	}
}

func TestParseJSONLRejectsFieldTypeMismatch(t *testing.T) {
	input := strings.Join([]string{
		`{"schema":"arcade.catalog_import.v1","kind":"manifest","generated_at":"2026-06-26T00:00:00Z","catalog_source":{"slug":"codeforces-problemset","name":"Codeforces Problemset","scope":"global","template":"{contest_id}{index}"}}`,
		`{"schema":"arcade.catalog_import.v1","kind":"catalog_field","catalog_source_slug":"codeforces-problemset","key":"rating","label":"Rating","value_type":"number","is_array":false,"display_order":10}`,
		`{"schema":"arcade.catalog_import.v1","kind":"catalog_item","catalog_source_slug":"codeforces-problemset","external_id":"4A","data":{"contest_id":"4","index":"A","rating":"800"}}`,
	}, "\n")

	_, result, err := ParseJSONL(strings.NewReader(input), Options{AllowGlobal: true})
	if err != nil {
		t.Fatalf("ParseJSONL returned error: %v", err)
	}
	if !hasError(result, "field_type_mismatch") {
		t.Fatalf("expected field_type_mismatch, got %#v", result.Errors)
	}
}

func TestParseJSONLRequiresGroupIDForGroupScope(t *testing.T) {
	input := `{"schema":"arcade.catalog_import.v1","kind":"manifest","generated_at":"2026-06-26T00:00:00Z","catalog_source":{"slug":"team-source","name":"Team Source","scope":"group","template":"{name}"}}`

	_, result, err := ParseJSONL(strings.NewReader(input), Options{AllowGlobal: true})
	if err != nil {
		t.Fatalf("ParseJSONL returned error: %v", err)
	}
	if !hasError(result, "missing_group_id") {
		t.Fatalf("expected missing_group_id, got %#v", result.Errors)
	}
}

func TestParseJSONLRejectsUnauthorizedGlobalImport(t *testing.T) {
	input := `{"schema":"arcade.catalog_import.v1","kind":"manifest","generated_at":"2026-06-26T00:00:00Z","catalog_source":{"slug":"global-source","name":"Global Source","scope":"global","template":"{name}"}}`

	_, result, err := ParseJSONL(strings.NewReader(input), Options{})
	if err != nil {
		t.Fatalf("ParseJSONL returned error: %v", err)
	}
	if !hasError(result, "unauthorized_global_import") {
		t.Fatalf("expected unauthorized_global_import, got %#v", result.Errors)
	}
}

func hasError(result Result, code string) bool {
	for _, err := range result.Errors {
		if err.Code == code {
			return true
		}
	}
	return false
}
