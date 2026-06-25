package app

import "testing"

func TestNormalizeCreateGroupFeedPostRequest(t *testing.T) {
	caption := "  Optional note.  "
	payload, err := normalizeCreateGroupFeedPostRequest(createGroupFeedPostRequest{
		EvidenceKind: " text ",
		EvidenceText: "  I finished the prompt.  ",
		Caption:      &caption,
	})
	if err != nil {
		t.Fatalf("normalizeCreateGroupFeedPostRequest returned error: %v", err)
	}
	if payload.EvidenceKind != "text" {
		t.Fatalf("evidence kind = %q", payload.EvidenceKind)
	}
	if payload.EvidenceText != "I finished the prompt." {
		t.Fatalf("evidence text = %q", payload.EvidenceText)
	}
	if payload.Caption == nil || *payload.Caption != "Optional note." {
		t.Fatalf("caption = %#v", payload.Caption)
	}
}

func TestNormalizeCreateGroupFeedPostRequestRequiresEvidence(t *testing.T) {
	_, err := normalizeCreateGroupFeedPostRequest(createGroupFeedPostRequest{
		EvidenceKind: "text",
		EvidenceText: "   ",
	})
	if err == nil {
		t.Fatal("expected empty evidence_text to be rejected")
	}
}

func TestNormalizeCreateGroupFeedPostRequestRejectsUnsupportedEvidenceKind(t *testing.T) {
	_, err := normalizeCreateGroupFeedPostRequest(createGroupFeedPostRequest{
		EvidenceKind: "image",
		EvidenceText: "proof",
	})
	if err == nil {
		t.Fatal("expected unsupported evidence_kind to be rejected")
	}
}

func TestNormalizePatchGroupFeedPostRequest(t *testing.T) {
	caption := "  Updated note.  "
	patch, err := normalizePatchGroupFeedPostRequest(patchGroupFeedPostRequest{
		EvidenceText: optionalStringField{Set: true, Value: "  Updated proof.  "},
		Caption:      optionalNullableStringField{Set: true, Value: &caption},
	})
	if err != nil {
		t.Fatalf("normalizePatchGroupFeedPostRequest returned error: %v", err)
	}
	if patch.EvidenceText == nil || *patch.EvidenceText != "Updated proof." {
		t.Fatalf("evidence text = %#v", patch.EvidenceText)
	}
	if !patch.CaptionSet {
		t.Fatal("caption was not marked as set")
	}
	if patch.Caption == nil || *patch.Caption != "Updated note." {
		t.Fatalf("caption = %#v", patch.Caption)
	}
}

func TestNormalizePatchGroupFeedPostRequestAllowsCaptionClear(t *testing.T) {
	patch, err := normalizePatchGroupFeedPostRequest(patchGroupFeedPostRequest{
		Caption: optionalNullableStringField{Set: true, Value: nil},
	})
	if err != nil {
		t.Fatalf("normalizePatchGroupFeedPostRequest returned error: %v", err)
	}
	if !patch.CaptionSet {
		t.Fatal("caption clear was not marked as set")
	}
	if patch.Caption != nil {
		t.Fatalf("caption = %#v", patch.Caption)
	}
}

func TestNormalizePatchGroupFeedPostRequestRequiresAField(t *testing.T) {
	_, err := normalizePatchGroupFeedPostRequest(patchGroupFeedPostRequest{})
	if err == nil {
		t.Fatal("expected empty patch to be rejected")
	}
}
