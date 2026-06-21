package app

import (
	"net/http/httptest"
	"testing"
	"time"
)

func TestNormalizeEmail(t *testing.T) {
	email, err := normalizeEmail("  User@Example.COM  ")
	if err != nil {
		t.Fatalf("normalizeEmail returned error: %v", err)
	}
	if email != "user@example.com" {
		t.Fatalf("normalizeEmail = %q, want user@example.com", email)
	}

	if _, err := normalizeEmail("not-an-email"); err == nil {
		t.Fatal("normalizeEmail accepted invalid email")
	}
}

func TestSessionTokenHashFromCookie(t *testing.T) {
	raw, cookieToken, err := generateSessionToken()
	if err != nil {
		t.Fatalf("generateSessionToken returned error: %v", err)
	}
	if len(raw) != sessionTokenBytes {
		t.Fatalf("raw token length = %d, want %d", len(raw), sessionTokenBytes)
	}

	hash, ok := hashCookieToken(cookieToken)
	if !ok {
		t.Fatal("hashCookieToken rejected generated cookie token")
	}
	if len(hash) != 32 {
		t.Fatalf("token hash length = %d, want 32", len(hash))
	}

	if _, ok := hashCookieToken("invalid"); ok {
		t.Fatal("hashCookieToken accepted invalid token")
	}
}

func TestSetSessionCookieLifetime(t *testing.T) {
	request := httptest.NewRequest("POST", "http://localhost:8080/api/auth/login", nil)

	sessionRecorder := httptest.NewRecorder()
	setSessionCookie(sessionRecorder, request, "token", time.Now().Add(normalSessionLifetime), false)
	sessionCookie := sessionRecorder.Result().Cookies()[0]
	if sessionCookie.MaxAge != 0 {
		t.Fatalf("session cookie MaxAge = %d, want 0", sessionCookie.MaxAge)
	}
	if sessionCookie.Secure {
		t.Fatal("localhost session cookie should not be secure")
	}

	rememberRecorder := httptest.NewRecorder()
	setSessionCookie(rememberRecorder, request, "token", time.Now().Add(rememberSessionLifetime), true)
	rememberCookie := rememberRecorder.Result().Cookies()[0]
	if rememberCookie.MaxAge <= 0 {
		t.Fatalf("remember cookie MaxAge = %d, want positive", rememberCookie.MaxAge)
	}
}
