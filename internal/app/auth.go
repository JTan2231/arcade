package app

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"database/sql"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"fmt"
	"math/big"
	"net"
	"net/http"
	"net/mail"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/jackc/pgx/v5"
	"golang.org/x/crypto/bcrypt"
)

const (
	sessionCookieName       = "arcade_session"
	sessionTokenBytes       = 32
	normalSessionLifetime   = 12 * time.Hour
	rememberSessionLifetime = 30 * 24 * time.Hour
	disabledPasswordHash    = "disabled"
	friendCodePrefix        = "ARCD"
	friendCodeRandomChars   = 8
	friendCodeAlphabet      = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ"
)

type contextKey string

const currentUserKey contextKey = "currentUser"

func currentUser(ctx context.Context) (User, bool) {
	user, ok := ctx.Value(currentUserKey).(User)
	return user, ok
}

func requireUser(ctx context.Context) (User, error) {
	user, ok := currentUser(ctx)
	if !ok {
		return User{}, unauthorized("not authenticated")
	}
	return user, nil
}

func withCurrentUser(ctx context.Context, user User) context.Context {
	return context.WithValue(ctx, currentUserKey, user)
}

func (s *Server) handleSignup(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Email       string `json:"email"`
		Password    string `json:"password"`
		DisplayName string `json:"display_name"`
		RememberMe  bool   `json:"remember_me"`
	}
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid JSON request")
		return
	}

	email, err := normalizeEmail(req.Email)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	displayName, err := validateDisplayName(req.DisplayName)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	if err := validatePassword(req.Password); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}

	passwordHash, err := bcrypt.GenerateFromPassword([]byte(req.Password), bcrypt.DefaultCost)
	if err != nil {
		handleError(w, err)
		return
	}

	user, err := s.createSignupUser(r.Context(), email, displayName, string(passwordHash))
	if err != nil {
		if isUniqueConstraint(err, "users_email_unique") {
			writeError(w, http.StatusConflict, "email already exists")
			return
		}
		handleError(w, err)
		return
	}

	if err := s.createSession(r.Context(), w, r, user.ID, req.RememberMe); err != nil {
		handleError(w, err)
		return
	}

	writeJSON(w, http.StatusCreated, user)
}

func (s *Server) handleLogin(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Email      string `json:"email"`
		Password   string `json:"password"`
		RememberMe bool   `json:"remember_me"`
	}
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid JSON request")
		return
	}
	if strings.TrimSpace(req.Email) == "" {
		writeError(w, http.StatusBadRequest, "email is required")
		return
	}
	if req.Password == "" {
		writeError(w, http.StatusBadRequest, "password is required")
		return
	}
	email, err := normalizeEmail(req.Email)
	if err != nil {
		writeError(w, http.StatusUnauthorized, "invalid email or password")
		return
	}

	var user User
	var avatarURL sql.NullString
	var passwordHash string
	err = s.db.QueryRow(r.Context(), `
		select id::text, email, username, display_name, avatar_url, friend_code, password_hash, created_at, updated_at
		from users
		where lower(email) = lower($1)
	`, email).Scan(
		&user.ID,
		&user.Email,
		&user.Username,
		&user.DisplayName,
		&avatarURL,
		&user.FriendCode,
		&passwordHash,
		&user.CreatedAt,
		&user.UpdatedAt,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		writeError(w, http.StatusUnauthorized, "invalid email or password")
		return
	}
	if err != nil {
		handleError(w, err)
		return
	}
	if bcrypt.CompareHashAndPassword([]byte(passwordHash), []byte(req.Password)) != nil {
		writeError(w, http.StatusUnauthorized, "invalid email or password")
		return
	}
	user.AvatarURL = nullStringPtr(avatarURL)

	if err := s.createSession(r.Context(), w, r, user.ID, req.RememberMe); err != nil {
		handleError(w, err)
		return
	}

	writeJSON(w, http.StatusOK, user)
}

func (s *Server) handleLogout(w http.ResponseWriter, r *http.Request) {
	if cookie, err := r.Cookie(sessionCookieName); err == nil {
		if err := s.revokeSessionToken(r.Context(), cookie.Value); err != nil {
			handleError(w, err)
			return
		}
	}
	clearSessionCookie(w, r)
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) handleAuthSession(w http.ResponseWriter, r *http.Request) {
	user, ok, err := s.authenticateRequest(r.Context(), r)
	if err != nil {
		handleError(w, err)
		return
	}
	if !ok {
		writeError(w, http.StatusUnauthorized, "not authenticated")
		return
	}
	writeJSON(w, http.StatusOK, user)
}

func (s *Server) withAuth(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !strings.HasPrefix(r.URL.Path, "/api/") || isPublicAPIRoute(r) {
			next.ServeHTTP(w, r)
			return
		}

		user, ok, err := s.authenticateRequest(r.Context(), r)
		if err != nil {
			handleError(w, err)
			return
		}
		if !ok {
			writeError(w, http.StatusUnauthorized, "not authenticated")
			return
		}

		next.ServeHTTP(w, r.WithContext(withCurrentUser(r.Context(), user)))
	})
}

func isPublicAPIRoute(r *http.Request) bool {
	switch {
	case r.Method == http.MethodGet && r.URL.Path == "/api/health":
		return true
	case r.Method == http.MethodPost && r.URL.Path == "/api/auth/signup":
		return true
	case r.Method == http.MethodPost && r.URL.Path == "/api/auth/login":
		return true
	case r.Method == http.MethodPost && r.URL.Path == "/api/auth/logout":
		return true
	case r.Method == http.MethodGet && r.URL.Path == "/api/auth/session":
		return true
	case r.Method == http.MethodPost && r.URL.Path == "/api/catalog-imports":
		// Admin import scripts authenticate this route with a shared bearer token.
		return true
	default:
		return false
	}
}

func (s *Server) authenticateRequest(ctx context.Context, r *http.Request) (User, bool, error) {
	cookie, err := r.Cookie(sessionCookieName)
	if err != nil {
		if errors.Is(err, http.ErrNoCookie) {
			return User{}, false, nil
		}
		return User{}, false, err
	}
	tokenHash, ok := hashCookieToken(cookie.Value)
	if !ok {
		return User{}, false, nil
	}

	var user User
	var avatarURL sql.NullString
	var sessionID string
	err = s.db.QueryRow(ctx, `
		select
			us.id::text,
			u.id::text,
			u.email,
			u.username,
			u.display_name,
			u.avatar_url,
			u.friend_code,
			u.created_at,
			u.updated_at
		from user_sessions us
		join users u on u.id = us.user_id
		where us.token_hash = $1
		  and us.revoked_at is null
		  and us.expires_at > now()
	`, tokenHash).Scan(
		&sessionID,
		&user.ID,
		&user.Email,
		&user.Username,
		&user.DisplayName,
		&avatarURL,
		&user.FriendCode,
		&user.CreatedAt,
		&user.UpdatedAt,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return User{}, false, nil
	}
	if err != nil {
		return User{}, false, err
	}
	user.AvatarURL = nullStringPtr(avatarURL)

	if _, err := s.db.Exec(ctx, `update user_sessions set last_seen_at = now() where id = $1`, sessionID); err != nil {
		return User{}, false, err
	}
	return user, true, nil
}

func (s *Server) createSignupUser(ctx context.Context, email string, displayName string, passwordHash string) (User, error) {
	baseUsername := slugify(displayName)
	if baseUsername == "" {
		baseUsername = strings.Split(email, "@")[0]
	}
	if baseUsername == "" {
		baseUsername = "user"
	}

	var lastErr error
	for attempt := 0; attempt < 6; attempt++ {
		username := baseUsername
		if attempt > 0 {
			suffix, err := randomHex(3)
			if err != nil {
				return User{}, err
			}
			username = baseUsername + "-" + suffix
		}
		friendCode, err := generateFriendCode()
		if err != nil {
			return User{}, err
		}

		var user User
		var avatarURL sql.NullString
		err = s.db.QueryRow(ctx, `
			insert into users (email, username, display_name, password_hash, friend_code)
			values ($1, $2, $3, $4, $5)
			returning id::text, email, username, display_name, avatar_url, friend_code, created_at, updated_at
		`, email, username, displayName, passwordHash, friendCode).Scan(
			&user.ID,
			&user.Email,
			&user.Username,
			&user.DisplayName,
			&avatarURL,
			&user.FriendCode,
			&user.CreatedAt,
			&user.UpdatedAt,
		)
		if err == nil {
			user.AvatarURL = nullStringPtr(avatarURL)
			return user, nil
		}
		if isUniqueConstraint(err, "users_username_key") {
			lastErr = err
			continue
		}
		if isUniqueConstraint(err, "users_friend_code_unique") {
			lastErr = err
			continue
		}
		return User{}, err
	}
	return User{}, lastErr
}

func (s *Server) createSession(ctx context.Context, w http.ResponseWriter, r *http.Request, userID string, rememberMe bool) error {
	rawToken, cookieToken, err := generateSessionToken()
	if err != nil {
		return err
	}

	lifetime := normalSessionLifetime
	if rememberMe {
		lifetime = rememberSessionLifetime
	}
	expiresAt := time.Now().UTC().Add(lifetime)

	if _, err := s.db.Exec(ctx, `
		insert into user_sessions (user_id, token_hash, remember_me, user_agent, ip_address, expires_at)
		values ($1, $2, $3, $4, $5, $6)
	`, userID, hashSessionToken(rawToken), rememberMe, nullableText(trimForStorage(r.UserAgent(), 1024)), requestIP(r), expiresAt); err != nil {
		return err
	}

	setSessionCookie(w, r, cookieToken, expiresAt, rememberMe)
	return nil
}

func (s *Server) revokeSessionToken(ctx context.Context, cookieToken string) error {
	tokenHash, ok := hashCookieToken(cookieToken)
	if !ok {
		return nil
	}
	_, err := s.db.Exec(ctx, `
		update user_sessions
		set revoked_at = coalesce(revoked_at, now())
		where token_hash = $1
	`, tokenHash)
	return err
}

func generateSessionToken() ([]byte, string, error) {
	raw := make([]byte, sessionTokenBytes)
	if _, err := rand.Read(raw); err != nil {
		return nil, "", fmt.Errorf("generate session token: %w", err)
	}
	return raw, base64.RawURLEncoding.EncodeToString(raw), nil
}

func hashSessionToken(raw []byte) []byte {
	sum := sha256.Sum256(raw)
	return sum[:]
}

func hashCookieToken(cookieToken string) ([]byte, bool) {
	raw, err := base64.RawURLEncoding.DecodeString(cookieToken)
	if err != nil || len(raw) != sessionTokenBytes {
		return nil, false
	}
	return hashSessionToken(raw), true
}

func setSessionCookie(w http.ResponseWriter, r *http.Request, value string, expiresAt time.Time, rememberMe bool) {
	cookie := &http.Cookie{
		Name:     sessionCookieName,
		Value:    value,
		Path:     "/",
		HttpOnly: true,
		SameSite: http.SameSiteLaxMode,
		Secure:   secureSessionCookie(r),
	}
	if rememberMe {
		cookie.Expires = expiresAt
		cookie.MaxAge = int(time.Until(expiresAt).Seconds())
	}
	http.SetCookie(w, cookie)
}

func clearSessionCookie(w http.ResponseWriter, r *http.Request) {
	http.SetCookie(w, &http.Cookie{
		Name:     sessionCookieName,
		Value:    "",
		Path:     "/",
		MaxAge:   -1,
		Expires:  time.Unix(0, 0),
		HttpOnly: true,
		SameSite: http.SameSiteLaxMode,
		Secure:   secureSessionCookie(r),
	})
}

func secureSessionCookie(r *http.Request) bool {
	host := r.Host
	if host == "" {
		host = r.URL.Host
	}
	hostname, _, err := net.SplitHostPort(host)
	if err != nil {
		hostname = host
	}
	hostname = strings.Trim(hostname, "[]")
	return hostname != "localhost" && hostname != "127.0.0.1" && hostname != "::1"
}

func normalizeEmail(value string) (string, error) {
	email := strings.ToLower(strings.TrimSpace(value))
	if email == "" {
		return "", errors.New("email is required")
	}
	address, err := mail.ParseAddress(email)
	if err != nil || address.Address != email {
		return "", errors.New("email must be valid")
	}
	local, domain, ok := strings.Cut(email, "@")
	if !ok || local == "" || domain == "" || !strings.Contains(domain, ".") {
		return "", errors.New("email must be valid")
	}
	return email, nil
}

func validatePassword(value string) error {
	if value == "" {
		return errors.New("password is required")
	}
	if len(value) < 8 {
		return errors.New("password must be at least 8 characters")
	}
	return nil
}

func validateDisplayName(value string) (string, error) {
	displayName := strings.TrimSpace(value)
	if displayName == "" {
		return "", errors.New("display_name is required")
	}
	if utf8.RuneCountInString(displayName) > 100 {
		return "", errors.New("display_name must be 100 characters or fewer")
	}
	return displayName, nil
}

func randomHex(byteCount int) (string, error) {
	raw := make([]byte, byteCount)
	if _, err := rand.Read(raw); err != nil {
		return "", err
	}
	return hex.EncodeToString(raw), nil
}

func generateFriendCode() (string, error) {
	var builder strings.Builder
	builder.WriteString(friendCodePrefix)
	max := big.NewInt(int64(len(friendCodeAlphabet)))
	for range friendCodeRandomChars {
		index, err := rand.Int(rand.Reader, max)
		if err != nil {
			return "", err
		}
		builder.WriteByte(friendCodeAlphabet[index.Int64()])
	}
	return builder.String(), nil
}

func normalizeFriendCode(value string) (string, error) {
	normalized := strings.ToUpper(strings.NewReplacer("-", "", " ", "").Replace(strings.TrimSpace(value)))
	if normalized == "" {
		return "", errors.New("friend_code is required")
	}
	for _, char := range normalized {
		if (char < 'A' || char > 'Z') && (char < '0' || char > '9') {
			return "", errors.New("friend_code must contain only letters and numbers")
		}
	}
	return normalized, nil
}

func placeholderEmail(username string) string {
	return username + "@local.arcade.invalid"
}

func nullableText(value string) any {
	if value == "" {
		return nil
	}
	return value
}

func trimForStorage(value string, maxBytes int) string {
	if len(value) <= maxBytes {
		return value
	}
	return value[:maxBytes]
}

func requestIP(r *http.Request) any {
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		host = r.RemoteAddr
	}
	if net.ParseIP(host) == nil {
		return nil
	}
	return host
}
