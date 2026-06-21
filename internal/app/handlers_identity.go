package app

import (
	"context"
	"database/sql"
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
)

func (s *Server) handleGetMe(w http.ResponseWriter, r *http.Request) {
	user, err := s.getUser(r.Context(), s.currentUser.ID)
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

	username := s.currentUser.Username
	displayName := s.currentUser.DisplayName
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
	err := s.db.QueryRow(r.Context(), `
		update users
		set username = $2,
		    display_name = $3,
		    avatar_url = coalesce($4, avatar_url)
		where id = $1
		returning id::text, username, display_name, avatar_url, created_at, updated_at
	`, s.currentUser.ID, username, displayName, avatarURL).Scan(
		&user.ID,
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
	s.currentUser = user
	writeJSON(w, http.StatusOK, user)
}

func (s *Server) handleGetPreferences(w http.ResponseWriter, r *http.Request) {
	rows, err := s.db.Query(r.Context(), `
		select
			up.id::text,
			up.user_id::text,
			up.source_id::text,
			ps.slug,
			up.target_difficulty_delta,
			up.daily_problem_count,
			up.include_solved,
			coalesce(array(
				select upt.tag
				from user_preference_tags upt
				where upt.user_preference_id = up.id and upt.preference = 'preferred'
				order by upt.tag
			), '{}'),
			coalesce(array(
				select upt.tag
				from user_preference_tags upt
				where upt.user_preference_id = up.id and upt.preference = 'blocked'
				order by upt.tag
			), '{}'),
			up.created_at,
			up.updated_at
		from user_preferences up
		left join problem_sources ps on ps.id = up.source_id
		where up.user_id = $1
		order by ps.slug nulls first
	`, s.currentUser.ID)
	if err != nil {
		handleError(w, err)
		return
	}
	defer rows.Close()

	preferences := []Preference{}
	for rows.Next() {
		preference, err := scanPreference(rows)
		if err != nil {
			handleError(w, err)
			return
		}
		preferences = append(preferences, preference)
	}
	if err := rows.Err(); err != nil {
		handleError(w, err)
		return
	}

	writeJSON(w, http.StatusOK, preferences)
}

func (s *Server) handlePatchPreferences(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Source                *string   `json:"source"`
		TargetDifficultyDelta *int      `json:"target_difficulty_delta"`
		DailyProblemCount     *int      `json:"daily_problem_count"`
		IncludeSolved         *bool     `json:"include_solved"`
		PreferredTags         *[]string `json:"preferred_tags"`
		BlockedTags           *[]string `json:"blocked_tags"`
	}
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid JSON request")
		return
	}

	var sourceID any
	if req.Source != nil && *req.Source != "" {
		id, err := s.sourceIDBySlug(r.Context(), *req.Source)
		if err != nil {
			handleError(w, err)
			return
		}
		sourceID = id
	}

	tx, err := s.db.Begin(r.Context())
	if err != nil {
		handleError(w, err)
		return
	}
	defer tx.Rollback(r.Context())

	var preferenceID string
	err = tx.QueryRow(r.Context(), `
		select id::text
		from user_preferences
		where user_id = $1 and source_id is not distinct from $2::uuid
	`, s.currentUser.ID, sourceID).Scan(&preferenceID)
	if errors.Is(err, pgx.ErrNoRows) {
		err = tx.QueryRow(r.Context(), `
			insert into user_preferences (user_id, source_id)
			values ($1, $2)
			returning id::text
		`, s.currentUser.ID, sourceID).Scan(&preferenceID)
	}
	if err != nil {
		handleError(w, err)
		return
	}

	if req.TargetDifficultyDelta != nil {
		if _, err := tx.Exec(r.Context(), `update user_preferences set target_difficulty_delta = $2 where id = $1`, preferenceID, *req.TargetDifficultyDelta); err != nil {
			handleError(w, err)
			return
		}
	}
	if req.DailyProblemCount != nil {
		if *req.DailyProblemCount < 1 || *req.DailyProblemCount > 12 {
			writeError(w, http.StatusBadRequest, "daily_problem_count must be between 1 and 12")
			return
		}
		if _, err := tx.Exec(r.Context(), `update user_preferences set daily_problem_count = $2 where id = $1`, preferenceID, *req.DailyProblemCount); err != nil {
			handleError(w, err)
			return
		}
	}
	if req.IncludeSolved != nil {
		if _, err := tx.Exec(r.Context(), `update user_preferences set include_solved = $2 where id = $1`, preferenceID, *req.IncludeSolved); err != nil {
			handleError(w, err)
			return
		}
	}

	if req.PreferredTags != nil {
		if err := replacePreferenceTags(r.Context(), tx, preferenceID, "preferred", *req.PreferredTags); err != nil {
			handleError(w, err)
			return
		}
	}
	if req.BlockedTags != nil {
		if err := replacePreferenceTags(r.Context(), tx, preferenceID, "blocked", *req.BlockedTags); err != nil {
			handleError(w, err)
			return
		}
	}

	if err := tx.Commit(r.Context()); err != nil {
		handleError(w, err)
		return
	}

	preference, err := s.getPreference(r.Context(), preferenceID)
	if err != nil {
		handleError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, preference)
}

func replacePreferenceTags(ctx context.Context, tx pgx.Tx, preferenceID string, preference string, tags []string) error {
	if _, err := tx.Exec(ctx, `delete from user_preference_tags where user_preference_id = $1 and preference = $2`, preferenceID, preference); err != nil {
		return err
	}
	for _, tag := range tags {
		tag = strings.TrimSpace(tag)
		if tag == "" {
			continue
		}
		if _, err := tx.Exec(ctx, `
			insert into user_preference_tags (user_preference_id, tag, preference, weight)
			values ($1, $2, $3, 1)
			on conflict (user_preference_id, tag, preference) do update set weight = excluded.weight
		`, preferenceID, tag, preference); err != nil {
			return err
		}
	}
	return nil
}

func (s *Server) handleListExternalAccounts(w http.ResponseWriter, r *http.Request) {
	accounts, err := s.listExternalAccounts(r.Context(), s.currentUser.ID)
	if err != nil {
		handleError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, accounts)
}

func (s *Server) handleCreateExternalAccount(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Source         string  `json:"source"`
		ExternalHandle string  `json:"external_handle"`
		ExternalUserID *string `json:"external_user_id"`
	}
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid JSON request")
		return
	}
	if req.Source == "" || req.ExternalHandle == "" {
		writeError(w, http.StatusBadRequest, "source and external_handle are required")
		return
	}

	sourceID, err := s.sourceIDBySlug(r.Context(), req.Source)
	if err != nil {
		handleError(w, err)
		return
	}

	var account ExternalAccount
	err = s.db.QueryRow(r.Context(), `
		insert into external_accounts (user_id, source_id, external_handle, external_user_id)
		values ($1, $2, $3, $4)
		returning id::text
	`, s.currentUser.ID, sourceID, req.ExternalHandle, req.ExternalUserID).Scan(&account.ID)
	if err != nil {
		handleError(w, err)
		return
	}

	account, err = s.getExternalAccount(r.Context(), account.ID)
	if err != nil {
		handleError(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, account)
}

func (s *Server) handleGetExternalAccount(w http.ResponseWriter, r *http.Request) {
	account, err := s.getExternalAccount(r.Context(), r.PathValue("account_id"))
	if err != nil {
		handleError(w, err)
		return
	}
	if account.UserID != s.currentUser.ID {
		writeError(w, http.StatusNotFound, "external account not found")
		return
	}
	writeJSON(w, http.StatusOK, account)
}

func (s *Server) handleDeleteExternalAccount(w http.ResponseWriter, r *http.Request) {
	tag, err := s.db.Exec(r.Context(), `
		delete from external_accounts
		where id = $1 and user_id = $2
	`, r.PathValue("account_id"), s.currentUser.ID)
	if err != nil {
		handleError(w, err)
		return
	}
	if tag.RowsAffected() == 0 {
		writeError(w, http.StatusNotFound, "external account not found")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) handleVerifyExternalAccount(w http.ResponseWriter, r *http.Request) {
	account, err := s.updateExternalAccountStatus(r.Context(), r.PathValue("account_id"), "synced", true, false)
	if err != nil {
		handleError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, account)
}

func (s *Server) handleSyncExternalAccount(w http.ResponseWriter, r *http.Request) {
	account, err := s.updateExternalAccountStatus(r.Context(), r.PathValue("account_id"), "synced", false, true)
	if err != nil {
		handleError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, account)
}

func (s *Server) updateExternalAccountStatus(ctx context.Context, accountID string, status string, verified bool, synced bool) (ExternalAccount, error) {
	var verifiedExpr any
	var syncedExpr any
	if verified {
		verifiedExpr = time.Now().UTC()
	}
	if synced {
		syncedExpr = time.Now().UTC()
	}

	tag, err := s.db.Exec(ctx, `
		update external_accounts
		set sync_status = $3,
		    verified_at = coalesce($4, verified_at),
		    last_synced_at = coalesce($5, last_synced_at)
		where id = $1 and user_id = $2
	`, accountID, s.currentUser.ID, status, verifiedExpr, syncedExpr)
	if err != nil {
		return ExternalAccount{}, err
	}
	if tag.RowsAffected() == 0 {
		return ExternalAccount{}, errNotFound("external account")
	}
	return s.getExternalAccount(ctx, accountID)
}

func (s *Server) getUser(ctx context.Context, userID string) (User, error) {
	var user User
	var avatarURL sql.NullString
	err := s.db.QueryRow(ctx, `
		select id::text, username, display_name, avatar_url, created_at, updated_at
		from users
		where id = $1
	`, userID).Scan(&user.ID, &user.Username, &user.DisplayName, &avatarURL, &user.CreatedAt, &user.UpdatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return User{}, errNotFound("user")
	}
	if err != nil {
		return User{}, err
	}
	user.AvatarURL = nullStringPtr(avatarURL)
	return user, nil
}

func (s *Server) getPreference(ctx context.Context, preferenceID string) (Preference, error) {
	row := s.db.QueryRow(ctx, `
		select
			up.id::text,
			up.user_id::text,
			up.source_id::text,
			ps.slug,
			up.target_difficulty_delta,
			up.daily_problem_count,
			up.include_solved,
			coalesce(array(
				select upt.tag
				from user_preference_tags upt
				where upt.user_preference_id = up.id and upt.preference = 'preferred'
				order by upt.tag
			), '{}'),
			coalesce(array(
				select upt.tag
				from user_preference_tags upt
				where upt.user_preference_id = up.id and upt.preference = 'blocked'
				order by upt.tag
			), '{}'),
			up.created_at,
			up.updated_at
		from user_preferences up
		left join problem_sources ps on ps.id = up.source_id
		where up.id = $1
	`, preferenceID)
	preference, err := scanPreference(row)
	if errors.Is(err, pgx.ErrNoRows) {
		return Preference{}, errNotFound("preference")
	}
	return preference, err
}

func scanPreference(row pgx.Row) (Preference, error) {
	var preference Preference
	var sourceID sql.NullString
	var sourceSlug sql.NullString
	if err := row.Scan(
		&preference.ID,
		&preference.UserID,
		&sourceID,
		&sourceSlug,
		&preference.TargetDifficultyDelta,
		&preference.DailyProblemCount,
		&preference.IncludeSolved,
		&preference.PreferredTags,
		&preference.BlockedTags,
		&preference.CreatedAt,
		&preference.UpdatedAt,
	); err != nil {
		return Preference{}, err
	}
	preference.SourceID = nullStringPtr(sourceID)
	preference.SourceSlug = nullStringPtr(sourceSlug)
	return preference, nil
}

func (s *Server) listExternalAccounts(ctx context.Context, userID string) ([]ExternalAccount, error) {
	rows, err := s.db.Query(ctx, externalAccountSelect()+` where ea.user_id = $1 order by ps.slug, ea.external_handle`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	accounts := []ExternalAccount{}
	for rows.Next() {
		account, err := scanExternalAccount(rows)
		if err != nil {
			return nil, err
		}
		accounts = append(accounts, account)
	}
	return accounts, rows.Err()
}

func (s *Server) getExternalAccount(ctx context.Context, accountID string) (ExternalAccount, error) {
	account, err := scanExternalAccount(s.db.QueryRow(ctx, externalAccountSelect()+` where ea.id = $1`, accountID))
	if errors.Is(err, pgx.ErrNoRows) {
		return ExternalAccount{}, errNotFound("external account")
	}
	return account, err
}

func externalAccountSelect() string {
	return `
		select
			ea.id::text,
			ea.user_id::text,
			ea.source_id::text,
			ps.slug,
			ps.name,
			ea.external_handle,
			ea.external_user_id,
			ea.verified_at,
			ea.last_synced_at,
			ea.sync_status,
			ea.created_at,
			ea.updated_at
		from external_accounts ea
		join problem_sources ps on ps.id = ea.source_id
	`
}

func scanExternalAccount(row pgx.Row) (ExternalAccount, error) {
	var account ExternalAccount
	var externalUserID sql.NullString
	var verifiedAt sql.NullTime
	var lastSyncedAt sql.NullTime
	if err := row.Scan(
		&account.ID,
		&account.UserID,
		&account.SourceID,
		&account.SourceSlug,
		&account.SourceName,
		&account.ExternalHandle,
		&externalUserID,
		&verifiedAt,
		&lastSyncedAt,
		&account.SyncStatus,
		&account.CreatedAt,
		&account.UpdatedAt,
	); err != nil {
		return ExternalAccount{}, err
	}
	account.ExternalUserID = nullStringPtr(externalUserID)
	account.VerifiedAt = nullTimePtr(verifiedAt)
	account.LastSyncedAt = nullTimePtr(lastSyncedAt)
	return account, nil
}
