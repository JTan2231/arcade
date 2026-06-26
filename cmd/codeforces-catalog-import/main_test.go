package main

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestNormalizeImportEndpointAcceptsBaseURL(t *testing.T) {
	endpoint, err := normalizeImportEndpoint("https://arcade.example.com/")
	if err != nil {
		t.Fatalf("normalizeImportEndpoint returned error: %v", err)
	}
	if endpoint != "https://arcade.example.com/api/catalog-imports" {
		t.Fatalf("endpoint = %q", endpoint)
	}
}

func TestNormalizeImportEndpointPreservesExplicitPath(t *testing.T) {
	endpoint, err := normalizeImportEndpoint("http://localhost:8080/api/catalog-imports")
	if err != nil {
		t.Fatalf("normalizeImportEndpoint returned error: %v", err)
	}
	if endpoint != "http://localhost:8080/api/catalog-imports" {
		t.Fatalf("endpoint = %q", endpoint)
	}
}

func TestNormalizeImportEndpointRejectsMissingHost(t *testing.T) {
	if _, err := normalizeImportEndpoint("/api/catalog-imports"); err == nil {
		t.Fatal("expected endpoint without host to be rejected")
	}
}

func TestPreflightUploadAcceptsExpectedMultipartError(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/catalog-imports" {
			t.Fatalf("path = %q", r.URL.Path)
		}
		if r.Header.Get("Authorization") != "Bearer secret" {
			t.Fatalf("authorization = %q", r.Header.Get("Authorization"))
		}
		writeJSON := `{"error":"invalid multipart upload"}`
		http.Error(w, writeJSON, http.StatusBadRequest)
	}))
	defer server.Close()

	err := preflightUpload(context.Background(), server.URL+"/api/catalog-imports", "secret", time.Second)
	if err != nil {
		t.Fatalf("preflightUpload returned error: %v", err)
	}
}

func TestPreflightUploadReportsUnauthorized(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Error(w, `{"error":"invalid catalog import token"}`, http.StatusUnauthorized)
	}))
	defer server.Close()

	err := preflightUpload(context.Background(), server.URL+"/api/catalog-imports", "wrong", time.Second)
	if err == nil {
		t.Fatal("expected unauthorized preflight to fail")
	}
	if !strings.Contains(err.Error(), "HTTP 401") {
		t.Fatalf("error = %q", err.Error())
	}
}
