package app

import "testing"

func TestNormalizeCreateGroupPostTagRequestTrimsName(t *testing.T) {
	input, err := normalizeCreateGroupPostTagRequest(createGroupPostTagRequest{
		Name: "  AC  ",
		DisplayOrder: optionalIntField{
			Set:   true,
			Value: 10,
		},
	})
	if err != nil {
		t.Fatalf("normalizeCreateGroupPostTagRequest returned error: %v", err)
	}
	if input.Name != "AC" {
		t.Fatalf("name = %q", input.Name)
	}
	if input.DisplayOrder != 10 {
		t.Fatalf("display order = %d", input.DisplayOrder)
	}
}

func TestNormalizeCreateGroupPostTagRequestRejectsEmptyName(t *testing.T) {
	_, err := normalizeCreateGroupPostTagRequest(createGroupPostTagRequest{Name: "   "})
	if err == nil {
		t.Fatal("expected empty tag name to be rejected")
	}
}

func TestNormalizeCreateGroupPostTagRequestRejectsOverlongName(t *testing.T) {
	_, err := normalizeCreateGroupPostTagRequest(createGroupPostTagRequest{
		Name: "abcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvw",
	})
	if err == nil {
		t.Fatal("expected overlong tag name to be rejected")
	}
}

func TestNormalizePatchGroupPostTagRequestRequiresAField(t *testing.T) {
	_, err := normalizePatchGroupPostTagRequest(patchGroupPostTagRequest{})
	if err == nil {
		t.Fatal("expected empty tag patch to be rejected")
	}
}
