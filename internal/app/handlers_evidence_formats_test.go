package app

import "testing"

func TestNormalizeCreateEvidenceFormatRequest(t *testing.T) {
	maxChars := 280
	exactLines := 4
	lineMaxChars := 80
	allowBlankLines := false

	input, err := normalizeCreateEvidenceFormatRequest(createEvidenceFormatRequest{
		Slug:            "quartet",
		Name:            "  Quartet  ",
		MaxChars:        &maxChars,
		ExactLines:      &exactLines,
		LineMaxChars:    &lineMaxChars,
		AllowBlankLines: &allowBlankLines,
	})
	if err != nil {
		t.Fatalf("normalizeCreateEvidenceFormatRequest returned error: %v", err)
	}
	if input.Slug != "quartet" {
		t.Fatalf("slug = %q", input.Slug)
	}
	if input.Name != "Quartet" {
		t.Fatalf("name = %q", input.Name)
	}
	if input.Constraints.MinChars != 1 {
		t.Fatalf("min chars = %d", input.Constraints.MinChars)
	}
	if input.Constraints.MaxChars == nil || *input.Constraints.MaxChars != maxChars {
		t.Fatalf("max chars = %#v", input.Constraints.MaxChars)
	}
	if input.Constraints.ExactLines == nil || *input.Constraints.ExactLines != exactLines {
		t.Fatalf("exact lines = %#v", input.Constraints.ExactLines)
	}
	if input.Constraints.AllowBlankLines {
		t.Fatal("allow blank lines was not normalized")
	}
	if input.ContentTypeface != "monospace" {
		t.Fatalf("content typeface = %q", input.ContentTypeface)
	}
}

func TestNormalizeEvidenceFormatAppearance(t *testing.T) {
	input, err := normalizeCreateEvidenceFormatRequest(createEvidenceFormatRequest{
		Slug:            "essay",
		Name:            "Essay",
		ContentTypeface: "serif",
	})
	if err != nil {
		t.Fatalf("normalizeCreateEvidenceFormatRequest returned error: %v", err)
	}
	if input.ContentTypeface != "serif" {
		t.Fatalf("content typeface = %q", input.ContentTypeface)
	}

	if _, err := normalizeContentTypeface("sans", false); err == nil {
		t.Fatal("expected unsupported typeface to be rejected")
	}
}

func TestNormalizeCreateEvidenceFormatRequestRejectsInvalidSlug(t *testing.T) {
	_, err := normalizeCreateEvidenceFormatRequest(createEvidenceFormatRequest{
		Slug: "Bad Slug",
		Name: "Format",
	})
	if err == nil {
		t.Fatal("expected invalid slug to be rejected")
	}
}

func TestNormalizeEvidenceFormatConstraintsRejectsInvalidLineCombination(t *testing.T) {
	minLines := 2
	exactLines := 2
	_, err := normalizeEvidenceFormatConstraints(evidenceFormatConstraintsRequest{
		MinLines:   &minLines,
		ExactLines: &exactLines,
	})
	if err == nil {
		t.Fatal("expected exact_lines with min_lines to be rejected")
	}
}

func TestValidateEvidenceTextRejectsBlankLines(t *testing.T) {
	err := validateEvidenceText("line one\n\nline three", EvidenceFormatVersion{
		MinChars:        1,
		AllowBlankLines: false,
	})
	if err == nil {
		t.Fatal("expected blank line to be rejected")
	}
}

func TestValidateEvidenceTextUsesLineLimits(t *testing.T) {
	exactLines := 2
	lineMinChars := 3
	version := EvidenceFormatVersion{
		MinChars:        1,
		ExactLines:      &exactLines,
		LineMinChars:    &lineMinChars,
		AllowBlankLines: true,
	}

	if err := validateEvidenceText("abc\ndef", version); err != nil {
		t.Fatalf("validateEvidenceText returned error: %v", err)
	}
	if err := validateEvidenceText("ab\ndef", version); err == nil {
		t.Fatal("expected short line to be rejected")
	}
	if err := validateEvidenceText("abc", version); err == nil {
		t.Fatal("expected wrong line count to be rejected")
	}
}
