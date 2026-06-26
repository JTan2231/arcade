package app

import (
	"net/http/httptest"
	"testing"
)

func TestCatalogImportTokenValidatesBearerToken(t *testing.T) {
	server := &Server{catalogImportToken: "secret-token"}
	request := httptest.NewRequest("POST", "http://localhost:8080/api/catalog-imports", nil)
	request.Header.Set("Authorization", "Bearer secret-token")

	if !server.catalogImportTokenValid(request) {
		t.Fatal("expected bearer token to be accepted")
	}

	request.Header.Set("Authorization", "Bearer wrong-token")
	if server.catalogImportTokenValid(request) {
		t.Fatal("expected wrong bearer token to be rejected")
	}
}

func TestCatalogImportTokenValidatesFallbackHeader(t *testing.T) {
	server := &Server{catalogImportToken: "secret-token"}
	request := httptest.NewRequest("POST", "http://localhost:8080/api/catalog-imports", nil)
	request.Header.Set("X-Arcade-Catalog-Import-Token", "secret-token")

	if !server.catalogImportTokenValid(request) {
		t.Fatal("expected fallback token header to be accepted")
	}
}

func TestParseOptionalBool(t *testing.T) {
	truthy, err := parseOptionalBool("yes")
	if err != nil {
		t.Fatalf("parseOptionalBool returned error: %v", err)
	}
	if !truthy {
		t.Fatal("yes should parse as true")
	}

	falsy, err := parseOptionalBool("")
	if err != nil {
		t.Fatalf("parseOptionalBool returned error: %v", err)
	}
	if falsy {
		t.Fatal("empty value should default to false")
	}

	if _, err := parseOptionalBool("sometimes"); err == nil {
		t.Fatal("expected invalid boolean to be rejected")
	}
}
