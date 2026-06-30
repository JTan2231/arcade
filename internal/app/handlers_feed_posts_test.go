package app

import "testing"

const (
	testTagIDOne = "11111111-1111-4111-8111-111111111111"
	testTagIDTwo = "22222222-2222-4222-8222-222222222222"
)

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

func TestNormalizeCreateGroupFeedPostRequestAcceptsOmittedTagIDs(t *testing.T) {
	payload, err := normalizeCreateGroupFeedPostRequest(createGroupFeedPostRequest{
		EvidenceKind: "text",
		EvidenceText: "proof",
	})
	if err != nil {
		t.Fatalf("normalizeCreateGroupFeedPostRequest returned error: %v", err)
	}
	if len(payload.TagIDs) != 0 {
		t.Fatalf("tag IDs = %#v", payload.TagIDs)
	}
}

func TestNormalizeCreateGroupFeedPostRequestDeduplicatesTagIDs(t *testing.T) {
	payload, err := normalizeCreateGroupFeedPostRequest(createGroupFeedPostRequest{
		EvidenceKind: "text",
		EvidenceText: "proof",
		TagIDs: stringSliceField{
			testTagIDOne,
			"  " + testTagIDOne + "  ",
			testTagIDTwo,
		},
	})
	if err != nil {
		t.Fatalf("normalizeCreateGroupFeedPostRequest returned error: %v", err)
	}
	if len(payload.TagIDs) != 2 {
		t.Fatalf("tag IDs = %#v", payload.TagIDs)
	}
	if payload.TagIDs[0] != testTagIDOne || payload.TagIDs[1] != testTagIDTwo {
		t.Fatalf("tag IDs = %#v", payload.TagIDs)
	}
}

func TestNormalizeCreateGroupFeedPostRequestAcceptsVisibility(t *testing.T) {
	payload, err := normalizeCreateGroupFeedPostRequest(createGroupFeedPostRequest{
		EvidenceKind: "text",
		EvidenceText: "proof",
		Visibility:   " public ",
	})
	if err != nil {
		t.Fatalf("normalizeCreateGroupFeedPostRequest returned error: %v", err)
	}
	if payload.Visibility == nil || *payload.Visibility != "public" {
		t.Fatalf("visibility = %#v, want public", payload.Visibility)
	}
}

func TestNormalizeCreateGroupFeedPostRequestRejectsInvalidVisibility(t *testing.T) {
	_, err := normalizeCreateGroupFeedPostRequest(createGroupFeedPostRequest{
		EvidenceKind: "text",
		EvidenceText: "proof",
		Visibility:   "invite_only",
	})
	if err == nil {
		t.Fatal("expected invalid visibility to be rejected")
	}
}

func TestNormalizeCreateGroupFeedPostRequestRejectsEmptyTagIDs(t *testing.T) {
	_, err := normalizeCreateGroupFeedPostRequest(createGroupFeedPostRequest{
		EvidenceKind: "text",
		EvidenceText: "proof",
		TagIDs:       stringSliceField{testTagIDOne, " "},
	})
	if err == nil {
		t.Fatal("expected empty tag ID to be rejected")
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

func TestNormalizePatchGroupFeedPostRequestAcceptsOnlyTagIDs(t *testing.T) {
	patch, err := normalizePatchGroupFeedPostRequest(patchGroupFeedPostRequest{
		TagIDs: optionalStringSliceField{
			Set:   true,
			Value: []string{testTagIDOne},
		},
	})
	if err != nil {
		t.Fatalf("normalizePatchGroupFeedPostRequest returned error: %v", err)
	}
	if !patch.TagIDsSet {
		t.Fatal("tag IDs were not marked as set")
	}
	if len(patch.TagIDs) != 1 || patch.TagIDs[0] != testTagIDOne {
		t.Fatalf("tag IDs = %#v", patch.TagIDs)
	}
}

func TestNormalizePatchGroupFeedPostRequestAcceptsVisibility(t *testing.T) {
	patch, err := normalizePatchGroupFeedPostRequest(patchGroupFeedPostRequest{
		Visibility: optionalStringField{Set: true, Value: " private "},
	})
	if err != nil {
		t.Fatalf("normalizePatchGroupFeedPostRequest returned error: %v", err)
	}
	if patch.Visibility == nil || *patch.Visibility != "private" {
		t.Fatalf("visibility = %#v, want private", patch.Visibility)
	}
}

func TestNormalizePatchGroupFeedPostRequestRejectsInvalidVisibility(t *testing.T) {
	_, err := normalizePatchGroupFeedPostRequest(patchGroupFeedPostRequest{
		Visibility: optionalStringField{Set: true, Value: "invite_only"},
	})
	if err == nil {
		t.Fatal("expected invalid visibility to be rejected")
	}
}

func TestNormalizePatchGroupFeedPostRequestAcceptsEmptyTagIDs(t *testing.T) {
	patch, err := normalizePatchGroupFeedPostRequest(patchGroupFeedPostRequest{
		TagIDs: optionalStringSliceField{Set: true, Value: []string{}},
	})
	if err != nil {
		t.Fatalf("normalizePatchGroupFeedPostRequest returned error: %v", err)
	}
	if !patch.TagIDsSet {
		t.Fatal("tag IDs were not marked as set")
	}
	if len(patch.TagIDs) != 0 {
		t.Fatalf("tag IDs = %#v", patch.TagIDs)
	}
}

func TestNormalizePatchGroupFeedPostRequestRequiresAField(t *testing.T) {
	_, err := normalizePatchGroupFeedPostRequest(patchGroupFeedPostRequest{})
	if err == nil {
		t.Fatal("expected empty patch to be rejected")
	}
}
