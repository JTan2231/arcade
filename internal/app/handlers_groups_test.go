package app

import "testing"

func TestValidGroupVisibilityRejectsInviteOnly(t *testing.T) {
	if !validGroupVisibility("public") {
		t.Fatal("public visibility should be valid")
	}
	if !validGroupVisibility("private") {
		t.Fatal("private visibility should be valid")
	}
	if validGroupVisibility("invite_only") {
		t.Fatal("invite_only visibility should be rejected")
	}
}
