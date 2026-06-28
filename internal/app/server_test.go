package app

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestUnknownAPIRoutesReturnJSONNotFoundWithoutAuth(t *testing.T) {
	server := &Server{}

	for _, request := range []*http.Request{
		httptest.NewRequest(http.MethodGet, "http://localhost:8080/api/not-real", nil),
		httptest.NewRequest(http.MethodPost, "http://localhost:8080/api", nil),
		httptest.NewRequest(http.MethodGet, "http://localhost:8080/api/auth/login", nil),
	} {
		recorder := httptest.NewRecorder()
		server.Routes().ServeHTTP(recorder, request)

		if recorder.Code != http.StatusNotFound {
			t.Fatalf("%s %s status = %d, want %d", request.Method, request.URL.Path, recorder.Code, http.StatusNotFound)
		}

		var response apiError
		if err := json.NewDecoder(recorder.Body).Decode(&response); err != nil {
			t.Fatalf("%s %s response was not JSON: %v", request.Method, request.URL.Path, err)
		}
		if response.Error != "endpoint not found" {
			t.Fatalf("%s %s error = %q, want %q", request.Method, request.URL.Path, response.Error, "endpoint not found")
		}
	}
}

func TestProtectedAPIRouteStillRequiresAuth(t *testing.T) {
	server := &Server{}
	request := httptest.NewRequest(http.MethodGet, "http://localhost:8080/api/groups", nil)
	recorder := httptest.NewRecorder()

	server.Routes().ServeHTTP(recorder, request)

	if recorder.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want %d", recorder.Code, http.StatusUnauthorized)
	}

	var response apiError
	if err := json.NewDecoder(recorder.Body).Decode(&response); err != nil {
		t.Fatalf("response was not JSON: %v", err)
	}
	if response.Error != "not authenticated" {
		t.Fatalf("error = %q, want %q", response.Error, "not authenticated")
	}
}
