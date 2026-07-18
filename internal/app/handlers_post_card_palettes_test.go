package app

import (
	"encoding/json"
	"errors"
	"net/http"
	"testing"
)

func TestNormalizeCreateGroupPostCardPaletteRequest(t *testing.T) {
	accentHue := 173
	accentColorfulness := 74
	input, err := normalizeCreateGroupPostCardPaletteRequest(createGroupPostCardPaletteRequest{
		Name: "  Chalk dust  ",
		MaterialIntent: postCardMaterialIntentRequest{
			Model:               postCardMaterialModel,
			SurfaceHue:          167,
			SurfaceColorfulness: 95,
			AccentHue:           &accentHue,
			AccentColorfulness:  &accentColorfulness,
		},
	})
	if err != nil {
		t.Fatalf("normalizeCreateGroupPostCardPaletteRequest returned error: %v", err)
	}
	if input.Name != "Chalk dust" {
		t.Fatalf("name = %q", input.Name)
	}
	if input.MaterialIntent.Model != postCardMaterialModel || input.MaterialIntent.SurfaceHue != 167 {
		t.Fatalf("material intent = %#v", input.MaterialIntent)
	}
	if input.MaterialIntent.AccentHue == nil || *input.MaterialIntent.AccentHue != accentHue {
		t.Fatalf("accent hue = %#v", input.MaterialIntent.AccentHue)
	}
}

func TestNormalizePostCardMaterialIntentRequiresAccentPair(t *testing.T) {
	accentHue := 10
	_, err := normalizePostCardMaterialIntent(postCardMaterialIntentRequest{
		Model:               postCardMaterialModel,
		SurfaceHue:          20,
		SurfaceColorfulness: 30,
		AccentHue:           &accentHue,
	})
	if err == nil {
		t.Fatal("expected a partial accent pair to be rejected")
	}
}

func TestNormalizePostCardMaterialIntentRejectsOutOfRangeValues(t *testing.T) {
	intPtr := func(value int) *int { return &value }
	for _, request := range []postCardMaterialIntentRequest{
		{Model: "unknown-model", SurfaceHue: 10, SurfaceColorfulness: 50},
		{Model: postCardMaterialModel, SurfaceHue: -1, SurfaceColorfulness: 50},
		{Model: postCardMaterialModel, SurfaceHue: 360, SurfaceColorfulness: 50},
		{Model: postCardMaterialModel, SurfaceHue: 10, SurfaceColorfulness: -1},
		{Model: postCardMaterialModel, SurfaceHue: 10, SurfaceColorfulness: 101},
		{Model: postCardMaterialModel, SurfaceHue: 10, SurfaceColorfulness: 50, AccentHue: intPtr(-1), AccentColorfulness: intPtr(50)},
		{Model: postCardMaterialModel, SurfaceHue: 10, SurfaceColorfulness: 50, AccentHue: intPtr(360), AccentColorfulness: intPtr(50)},
		{Model: postCardMaterialModel, SurfaceHue: 10, SurfaceColorfulness: 50, AccentHue: intPtr(10), AccentColorfulness: intPtr(-1)},
		{Model: postCardMaterialModel, SurfaceHue: 10, SurfaceColorfulness: 50, AccentHue: intPtr(10), AccentColorfulness: intPtr(101)},
	} {
		if _, err := normalizePostCardMaterialIntent(request); err == nil {
			t.Fatalf("expected request to be rejected: %#v", request)
		}
	}
}

func TestNormalizePostCardMaterialIntentAcceptsInclusiveBounds(t *testing.T) {
	for _, request := range []postCardMaterialIntentRequest{
		{Model: postCardMaterialModel, SurfaceHue: 0, SurfaceColorfulness: 0},
		{
			Model:               postCardMaterialModel,
			SurfaceHue:          359,
			SurfaceColorfulness: 100,
			AccentHue:           intPointer(0),
			AccentColorfulness:  intPointer(0),
		},
		{
			Model:               postCardMaterialModel,
			SurfaceHue:          0,
			SurfaceColorfulness: 0,
			AccentHue:           intPointer(359),
			AccentColorfulness:  intPointer(100),
		},
	} {
		if _, err := normalizePostCardMaterialIntent(request); err != nil {
			t.Fatalf("expected boundary request to be accepted: %#v: %v", request, err)
		}
	}
}

func TestValidatePostCardPaletteArchive(t *testing.T) {
	if err := validatePostCardPaletteArchive(false, true, 0); err != nil {
		t.Fatalf("unreferenced active palette archive returned error: %v", err)
	}
	if err := validatePostCardPaletteArchive(true, true, 4); err != nil {
		t.Fatalf("already archived palette returned error: %v", err)
	}
	if err := validatePostCardPaletteArchive(false, false, 4); err != nil {
		t.Fatalf("active palette retained as active returned error: %v", err)
	}

	err := validatePostCardPaletteArchive(false, true, 1)
	var status statusError
	if !errors.As(err, &status) || status.status != http.StatusConflict {
		t.Fatalf("referenced palette archive error = %#v, want conflict", err)
	}
}

func intPointer(value int) *int {
	return &value
}

func TestNormalizePatchGroupPostCardPaletteRequestRequiresRevisionAndChange(t *testing.T) {
	if _, err := normalizePatchGroupPostCardPaletteRequest(patchGroupPostCardPaletteRequest{}); err == nil {
		t.Fatal("expected missing revision to be rejected")
	}
	if _, err := normalizePatchGroupPostCardPaletteRequest(patchGroupPostCardPaletteRequest{ExpectedRevision: 1}); err == nil {
		t.Fatal("expected empty palette patch to be rejected")
	}
}

func TestParsePostCardPaletteIfMatch(t *testing.T) {
	for _, input := range []string{`"12"`, "12", `W/"12"`} {
		revision, err := parsePostCardPaletteIfMatch(input)
		if err != nil {
			t.Fatalf("parsePostCardPaletteIfMatch(%q) returned error: %v", input, err)
		}
		if revision != 12 {
			t.Fatalf("parsePostCardPaletteIfMatch(%q) = %d", input, revision)
		}
	}
	if _, err := parsePostCardPaletteIfMatch(""); err == nil {
		t.Fatal("expected empty If-Match to be rejected")
	}
}

func TestEvidenceFormatPaletteSummaryJSONShape(t *testing.T) {
	evidenceFormat := EvidenceFormat{
		ID:                   "format-id",
		ContentTypeface:      "serif",
		ContentCardPaletteID: "palette-id",
		ContentCardPalette: PostCardPaletteSummary{
			ID:   "palette-id",
			Name: "Plum",
			MaterialIntent: PostCardMaterialIntent{
				Model:               postCardMaterialModel,
				SurfaceHue:          300,
				SurfaceColorfulness: 50,
			},
			Revision: 2,
		},
	}
	body, err := json.Marshal(evidenceFormat)
	if err != nil {
		t.Fatalf("json.Marshal returned error: %v", err)
	}
	var decoded map[string]any
	if err := json.Unmarshal(body, &decoded); err != nil {
		t.Fatalf("json.Unmarshal returned error: %v", err)
	}
	if decoded["content_typeface"] != "serif" || decoded["content_card_palette_id"] != "palette-id" {
		t.Fatalf("appearance fields missing from %s", body)
	}
	palette, ok := decoded["content_card_palette"].(map[string]any)
	if !ok || palette["revision"] != float64(2) {
		t.Fatalf("palette summary missing from %s", body)
	}
}
