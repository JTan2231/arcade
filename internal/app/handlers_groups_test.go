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

func TestValidGroupJoinPolicy(t *testing.T) {
	if !validGroupJoinPolicy("invite_only") {
		t.Fatal("invite_only join policy should be valid")
	}
	if !validGroupJoinPolicy("open") {
		t.Fatal("open join policy should be valid")
	}
	if validGroupJoinPolicy("public") {
		t.Fatal("public join policy should be rejected")
	}
}

func TestValidGroupAccessSettingsRequiresOpenGroupsToBePublic(t *testing.T) {
	tests := []struct {
		visibility string
		joinPolicy string
		valid      bool
	}{
		{visibility: "public", joinPolicy: "invite_only", valid: true},
		{visibility: "private", joinPolicy: "invite_only", valid: true},
		{visibility: "public", joinPolicy: "open", valid: true},
		{visibility: "private", joinPolicy: "open", valid: false},
	}

	for _, test := range tests {
		if got := validGroupAccessSettings(test.visibility, test.joinPolicy); got != test.valid {
			t.Fatalf("validGroupAccessSettings(%q, %q) = %t, want %t", test.visibility, test.joinPolicy, got, test.valid)
		}
	}
}
