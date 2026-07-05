package app

import (
	"context"
	"database/sql"
	"errors"
	"net/http"

	"github.com/jackc/pgx/v5"
)

func (s *Server) handleGetMe(w http.ResponseWriter, r *http.Request) {
	current, err := requireUser(r.Context())
	if err != nil {
		handleError(w, err)
		return
	}
	user, err := s.getUser(r.Context(), current.ID)
	if err != nil {
		handleError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, user)
}

func (s *Server) handlePatchMe(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Username    *string `json:"username"`
		DisplayName *string `json:"display_name"`
		AvatarURL   *string `json:"avatar_url"`
	}
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid JSON request")
		return
	}

	current, err := requireUser(r.Context())
	if err != nil {
		handleError(w, err)
		return
	}

	username := current.Username
	displayName := current.DisplayName
	var avatarURL any
	if req.Username != nil {
		username = slugify(*req.Username)
	}
	if req.DisplayName != nil && *req.DisplayName != "" {
		displayName = *req.DisplayName
	}
	if req.AvatarURL != nil && *req.AvatarURL != "" {
		avatarURL = *req.AvatarURL
	}

	var user User
	var avatar sql.NullString
	err = s.db.QueryRow(r.Context(), `
		update users
		set username = $2,
		    display_name = $3,
		    avatar_url = coalesce($4, avatar_url)
		where id = $1
		returning id::text, email, username, display_name, avatar_url, created_at, updated_at
	`, current.ID, username, displayName, avatarURL).Scan(
		&user.ID,
		&user.Email,
		&user.Username,
		&user.DisplayName,
		&avatar,
		&user.CreatedAt,
		&user.UpdatedAt,
	)
	if err != nil {
		handleError(w, err)
		return
	}
	user.AvatarURL = nullStringPtr(avatar)
	writeJSON(w, http.StatusOK, user)
}

func (s *Server) getUser(ctx context.Context, userID string) (User, error) {
	var user User
	var avatarURL sql.NullString
	err := s.db.QueryRow(ctx, `
		select id::text, email, username, display_name, avatar_url, created_at, updated_at
		from users
		where id = $1
	`, userID).Scan(
		&user.ID,
		&user.Email,
		&user.Username,
		&user.DisplayName,
		&avatarURL,
		&user.CreatedAt,
		&user.UpdatedAt,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return User{}, errNotFound("user")
	}
	if err != nil {
		return User{}, err
	}
	user.AvatarURL = nullStringPtr(avatarURL)
	return user, nil
}
