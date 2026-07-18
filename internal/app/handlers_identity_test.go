package app

import "testing"

func TestValidThemePreference(t *testing.T) {
	for _, value := range []string{"system", "dark", "light"} {
		if !validThemePreference(value) {
			t.Fatalf("validThemePreference(%q) = false", value)
		}
	}
	for _, value := range []string{"", "auto", "Dark"} {
		if validThemePreference(value) {
			t.Fatalf("validThemePreference(%q) = true", value)
		}
	}
}
