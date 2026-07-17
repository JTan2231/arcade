package app

import "testing"

const (
	testTagIDOne = "11111111-1111-4111-8111-111111111111"
	testTagIDTwo = "22222222-2222-4222-8222-222222222222"
)

func TestNormalizeCreateGroupFeedPostRequest(t *testing.T) {
	caption := "  Optional note.  "
	payload, err := normalizeCreateGroupFeedPostRequest(createGroupFeedPostRequest{
		EvidenceText: "  I finished the prompt.  ",
		Caption:      &caption,
	})
	if err != nil {
		t.Fatalf("normalizeCreateGroupFeedPostRequest returned error: %v", err)
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

func TestNormalizeCreateGroupFeedPostRequestRejectsEmptyTagIDs(t *testing.T) {
	_, err := normalizeCreateGroupFeedPostRequest(createGroupFeedPostRequest{
		EvidenceText: "proof",
		TagIDs:       stringSliceField{testTagIDOne, " "},
	})
	if err == nil {
		t.Fatal("expected empty tag ID to be rejected")
	}
}

func TestNormalizeCreateGroupFeedPostRequestRequiresEvidence(t *testing.T) {
	_, err := normalizeCreateGroupFeedPostRequest(createGroupFeedPostRequest{
		EvidenceText: "   ",
	})
	if err == nil {
		t.Fatal("expected empty evidence_text to be rejected")
	}
}

func TestNormalizePatchGroupFeedPostRequest(t *testing.T) {
	caption := "  Updated note.  "
	patch, err := normalizePatchGroupFeedPostRequest(patchGroupFeedPostRequest{
		EvidenceText: optionalStringField{Set: true, Value: "  Updated proof.\r\nSecond line.  "},
		Caption:      optionalNullableStringField{Set: true, Value: &caption},
	})
	if err != nil {
		t.Fatalf("normalizePatchGroupFeedPostRequest returned error: %v", err)
	}
	if patch.EvidenceText == nil || *patch.EvidenceText != "Updated proof.\nSecond line." {
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

func TestValidateGroupFeedPostCaptionWrite(t *testing.T) {
	caption := "A caption"
	tests := []struct {
		name            string
		captionsEnabled bool
		captionSet      bool
		caption         *string
		wantError       bool
	}{
		{
			name:            "enabled caption",
			captionsEnabled: true,
			captionSet:      true,
			caption:         &caption,
		},
		{
			name:            "disabled non-null caption",
			captionsEnabled: false,
			captionSet:      true,
			caption:         &caption,
			wantError:       true,
		},
		{
			name:            "disabled omitted caption",
			captionsEnabled: false,
			captionSet:      false,
			caption:         nil,
		},
		{
			name:            "disabled caption clear",
			captionsEnabled: false,
			captionSet:      true,
			caption:         nil,
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			err := validateGroupFeedPostCaptionWrite(test.captionsEnabled, test.captionSet, test.caption)
			if test.wantError && err == nil {
				t.Fatal("expected caption write to be rejected")
			}
			if !test.wantError && err != nil {
				t.Fatalf("caption write returned error: %v", err)
			}
		})
	}
}
