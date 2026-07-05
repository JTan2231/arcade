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

const defaultInviteLinkLifetime = 7 * 24 * time.Hour

func (s *Server) handleListGroupInviteLinks(w http.ResponseWriter, r *http.Request) {
	current, err := requireUser(r.Context())
	if err != nil {
		handleError(w, err)
		return
	}
	groupID := r.PathValue("group_id")
	if err := s.requireGroupRole(r.Context(), current.ID, groupID, "owner", "admin"); err != nil {
		handleError(w, err)
		return
	}

	links, err := s.listGroupInviteLinks(r.Context(), groupID)
	if err != nil {
		handleError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, links)
}

func (s *Server) handleCreateGroupInviteLink(w http.ResponseWriter, r *http.Request) {
	current, err := requireUser(r.Context())
	if err != nil {
		handleError(w, err)
		return
	}
	groupID := r.PathValue("group_id")
	if err := s.requireGroupRole(r.Context(), current.ID, groupID, "owner", "admin"); err != nil {
		handleError(w, err)
		return
	}

	var req struct {
		Label     *string    `json:"label"`
		ExpiresAt *time.Time `json:"expires_at"`
		MaxUses   *int       `json:"max_uses"`
	}
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid JSON request")
		return
	}

	label, err := normalizeInviteLinkLabel(req.Label)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	expiresAt := time.Now().UTC().Add(defaultInviteLinkLifetime)
	if req.ExpiresAt != nil {
		expiresAt = req.ExpiresAt.UTC()
	}
	if !expiresAt.After(time.Now().UTC().Add(time.Minute)) {
		writeError(w, http.StatusBadRequest, "expires_at must be in the future")
		return
	}
	if req.MaxUses != nil && *req.MaxUses <= 0 {
		writeError(w, http.StatusBadRequest, "max_uses must be greater than zero")
		return
	}

	link, err := s.createGroupInviteLink(r.Context(), groupID, current.ID, label, expiresAt, req.MaxUses)
	if err != nil {
		handleError(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, link)
}

func (s *Server) handleRevokeGroupInviteLink(w http.ResponseWriter, r *http.Request) {
	current, err := requireUser(r.Context())
	if err != nil {
		handleError(w, err)
		return
	}
	groupID := r.PathValue("group_id")
	if err := s.requireGroupRole(r.Context(), current.ID, groupID, "owner", "admin"); err != nil {
		handleError(w, err)
		return
	}

	tag, err := s.db.Exec(r.Context(), `
		update group_invite_links
		set revoked_at = coalesce(revoked_at, now())
		where id = $1 and group_id = $2
	`, r.PathValue("link_id"), groupID)
	if err != nil {
		handleError(w, err)
		return
	}
	if tag.RowsAffected() == 0 {
		writeError(w, http.StatusNotFound, "invite link not found")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) handleGetInviteLinkPreview(w http.ResponseWriter, r *http.Request) {
	preview, err := s.getInviteLinkPreview(r.Context(), r.PathValue("token"))
	if err != nil {
		handleError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, preview)
}

func (s *Server) handleAcceptInviteLink(w http.ResponseWriter, r *http.Request) {
	current, err := requireUser(r.Context())
	if err != nil {
		handleError(w, err)
		return
	}

	groupID, err := s.acceptInviteLink(r.Context(), r.PathValue("token"), current.ID)
	if err != nil {
		handleError(w, err)
		return
	}
	group, err := s.getGroup(r.Context(), groupID)
	if err != nil {
		handleError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, group)
}

func (s *Server) listGroupInviteLinks(ctx context.Context, groupID string) ([]GroupInviteLink, error) {
	rows, err := s.db.Query(ctx, groupInviteLinkSelect()+`
		where link.group_id = $1
		order by link.created_at desc
	`, groupID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	links := []GroupInviteLink{}
	for rows.Next() {
		link, err := scanGroupInviteLink(rows)
		if err != nil {
			return nil, err
		}
		links = append(links, link)
	}
	return links, rows.Err()
}

func (s *Server) createGroupInviteLink(ctx context.Context, groupID string, creatorUserID string, label *string, expiresAt time.Time, maxUses *int) (GroupInviteLink, error) {
	var lastErr error
	for range 6 {
		rawToken, token, err := generateSessionToken()
		if err != nil {
			return GroupInviteLink{}, err
		}
		var labelValue any
		if label != nil {
			labelValue = *label
		}
		var maxUsesValue any
		if maxUses != nil {
			maxUsesValue = *maxUses
		}

		link, err := scanGroupInviteLink(s.db.QueryRow(ctx, `
			with created as (
				insert into group_invite_links (
					group_id,
					token_hash,
					label,
					created_by_user_id,
					expires_at,
					max_uses
				)
				values ($1, $2, $3, $4, $5, $6)
				returning *
			)
		`+groupInviteLinkSelectFrom("created"), groupID, hashSessionToken(rawToken), labelValue, creatorUserID, expiresAt, maxUsesValue))
		if err == nil {
			link.Token = stringPtr(token)
			link.URLPath = stringPtr("/join/" + token)
			return link, nil
		}
		if isUniqueConstraint(err, "") {
			lastErr = err
			continue
		}
		return GroupInviteLink{}, err
	}
	return GroupInviteLink{}, lastErr
}

func (s *Server) getInviteLinkPreview(ctx context.Context, token string) (GroupInviteLinkPreview, error) {
	tokenHash, ok := hashCookieToken(token)
	if !ok {
		return GroupInviteLinkPreview{}, errNotFound("invite link")
	}

	var preview GroupInviteLinkPreview
	var creatorID sql.NullString
	var creatorUsername sql.NullString
	var creatorDisplayName sql.NullString
	var creatorAvatarURL sql.NullString
	var revokedAt sql.NullTime
	var maxUses sql.NullInt64
	err := s.db.QueryRow(ctx, `
		select
			g.id::text,
			g.name,
			g.slug,
			g.visibility,
			creator.id::text,
			creator.username,
			creator.display_name,
			creator.avatar_url,
			link.expires_at,
			link.revoked_at,
			link.max_uses,
			coalesce(redemptions.use_count, 0)::integer
		from group_invite_links link
		join groups g on g.id = link.group_id
		left join users creator on creator.id = link.created_by_user_id
		left join lateral (
			select count(*)::integer as use_count
			from group_invite_link_redemptions redemption
			where redemption.invite_link_id = link.id
		) redemptions on true
		where link.token_hash = $1
	`, tokenHash).Scan(
		&preview.Group.ID,
		&preview.Group.Name,
		&preview.Group.Slug,
		&preview.Group.Visibility,
		&creatorID,
		&creatorUsername,
		&creatorDisplayName,
		&creatorAvatarURL,
		&preview.ExpiresAt,
		&revokedAt,
		&maxUses,
		&preview.UseCount,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return GroupInviteLinkPreview{}, errNotFound("invite link")
	}
	if err != nil {
		return GroupInviteLinkPreview{}, err
	}
	if creatorID.Valid {
		preview.CreatedBy = &PublicUser{
			ID:          creatorID.String,
			Username:    creatorUsername.String,
			DisplayName: creatorDisplayName.String,
			AvatarURL:   nullStringPtr(creatorAvatarURL),
		}
	}
	preview.RevokedAt = nullTimePtr(revokedAt)
	preview.MaxUses = nullIntPtr(maxUses)
	return preview, nil
}

func (s *Server) acceptInviteLink(ctx context.Context, token string, currentUserID string) (string, error) {
	tokenHash, ok := hashCookieToken(token)
	if !ok {
		return "", errNotFound("invite link")
	}

	tx, err := s.db.Begin(ctx)
	if err != nil {
		return "", err
	}
	defer tx.Rollback(ctx)

	state, err := loadInviteLinkRedemptionState(ctx, tx, tokenHash)
	if err != nil {
		return "", err
	}
	now := time.Now().UTC()
	if state.revokedAt.Valid {
		return "", statusError{status: http.StatusGone, message: "invite link has been revoked"}
	}
	if !state.expiresAt.After(now) {
		return "", statusError{status: http.StatusGone, message: "invite link has expired"}
	}
	if state.maxUses.Valid && state.useCount >= int(state.maxUses.Int64) {
		return "", statusError{status: http.StatusGone, message: "invite link has no remaining uses"}
	}
	if !state.creatorUserID.Valid || !state.creatorRole.Valid {
		return "", forbidden("invite link is no longer valid")
	}

	existing, err := groupMemberStateForUpdate(ctx, tx, state.groupID, currentUserID)
	if err == nil && existing.Status == "active" {
		if err := tx.Commit(ctx); err != nil {
			return "", err
		}
		return state.groupID, nil
	}
	if err != nil && !isStatusNotFound(err) {
		return "", err
	}
	if err == nil && existing.Status == "removed" && state.creatorRole.String != "owner" && state.creatorRole.String != "admin" {
		return "", forbidden("only owner or admin links can re-add removed members")
	}

	tag, err := tx.Exec(ctx, `
		insert into group_memberships (
			group_id,
			user_id,
			role,
			status,
			joined_at,
			invited_by_user_id,
			invited_at,
			invite_link_id
		)
		values ($1, $2, 'member', 'active', now(), $3, now(), $4)
		on conflict (group_id, user_id) do update set
			role = 'member',
			status = 'active',
			joined_at = coalesce(group_memberships.joined_at, excluded.joined_at),
			invited_by_user_id = excluded.invited_by_user_id,
			invited_at = excluded.invited_at,
			invite_link_id = excluded.invite_link_id
		where group_memberships.status in ('removed', 'left')
	`, state.groupID, currentUserID, state.creatorUserID.String, state.linkID)
	if err != nil {
		return "", err
	}
	if tag.RowsAffected() == 0 {
		return "", statusError{status: http.StatusConflict, message: "group membership cannot be changed by this invite link"}
	}

	if _, err := tx.Exec(ctx, `
		insert into group_invite_link_redemptions (
			invite_link_id,
			group_id,
			redeemed_by_user_id,
			invited_by_user_id
		)
		values ($1, $2, $3, $4)
	`, state.linkID, state.groupID, currentUserID, state.creatorUserID.String); err != nil {
		return "", err
	}

	if err := tx.Commit(ctx); err != nil {
		return "", err
	}
	return state.groupID, nil
}

type inviteLinkRedemptionState struct {
	linkID        string
	groupID       string
	creatorUserID sql.NullString
	expiresAt     time.Time
	revokedAt     sql.NullTime
	maxUses       sql.NullInt64
	useCount      int
	creatorRole   sql.NullString
}

func loadInviteLinkRedemptionState(ctx context.Context, tx pgx.Tx, tokenHash []byte) (inviteLinkRedemptionState, error) {
	var state inviteLinkRedemptionState
	err := tx.QueryRow(ctx, `
		select
			link.id::text,
			link.group_id::text,
			link.created_by_user_id::text,
			link.expires_at,
			link.revoked_at,
			link.max_uses,
			coalesce(redemptions.use_count, 0)::integer,
			creator_membership.role
		from group_invite_links link
		left join lateral (
			select count(*)::integer as use_count
			from group_invite_link_redemptions redemption
			where redemption.invite_link_id = link.id
		) redemptions on true
		left join group_memberships creator_membership
			on creator_membership.group_id = link.group_id
			and creator_membership.user_id = link.created_by_user_id
			and creator_membership.status = 'active'
		where link.token_hash = $1
		for update of link
	`, tokenHash).Scan(
		&state.linkID,
		&state.groupID,
		&state.creatorUserID,
		&state.expiresAt,
		&state.revokedAt,
		&state.maxUses,
		&state.useCount,
		&state.creatorRole,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return inviteLinkRedemptionState{}, errNotFound("invite link")
	}
	return state, err
}

func groupMemberStateForUpdate(ctx context.Context, tx pgx.Tx, groupID string, userID string) (groupMemberState, error) {
	var member groupMemberState
	err := tx.QueryRow(ctx, `
		select role, status
		from group_memberships
		where group_id = $1 and user_id = $2
		for update
	`, groupID, userID).Scan(&member.Role, &member.Status)
	if errors.Is(err, pgx.ErrNoRows) {
		return groupMemberState{}, errNotFound("group member")
	}
	return member, err
}

func groupInviteLinkSelect() string {
	return groupInviteLinkSelectFrom("group_invite_links")
}

func groupInviteLinkSelectFrom(source string) string {
	return `
		select
			link.id::text,
			link.group_id::text,
			link.label,
			creator.id::text,
			creator.username,
			creator.display_name,
			creator.avatar_url,
			link.expires_at,
			link.revoked_at,
			link.max_uses,
			coalesce(redemptions.use_count, 0)::integer,
			link.created_at,
			link.updated_at
		from ` + source + ` link
		left join users creator on creator.id = link.created_by_user_id
		left join lateral (
			select count(*)::integer as use_count
			from group_invite_link_redemptions redemption
			where redemption.invite_link_id = link.id
		) redemptions on true
	`
}

func scanGroupInviteLink(row pgx.Row) (GroupInviteLink, error) {
	var link GroupInviteLink
	var label sql.NullString
	var creatorID sql.NullString
	var creatorUsername sql.NullString
	var creatorDisplayName sql.NullString
	var creatorAvatarURL sql.NullString
	var revokedAt sql.NullTime
	var maxUses sql.NullInt64
	if err := row.Scan(
		&link.ID,
		&link.GroupID,
		&label,
		&creatorID,
		&creatorUsername,
		&creatorDisplayName,
		&creatorAvatarURL,
		&link.ExpiresAt,
		&revokedAt,
		&maxUses,
		&link.UseCount,
		&link.CreatedAt,
		&link.UpdatedAt,
	); err != nil {
		return GroupInviteLink{}, err
	}
	link.Label = nullStringPtr(label)
	if creatorID.Valid {
		link.CreatedBy = &PublicUser{
			ID:          creatorID.String,
			Username:    creatorUsername.String,
			DisplayName: creatorDisplayName.String,
			AvatarURL:   nullStringPtr(creatorAvatarURL),
		}
	}
	link.RevokedAt = nullTimePtr(revokedAt)
	link.MaxUses = nullIntPtr(maxUses)
	return link, nil
}

func normalizeInviteLinkLabel(value *string) (*string, error) {
	if value == nil {
		return nil, nil
	}
	label := strings.TrimSpace(*value)
	if label == "" {
		return nil, nil
	}
	if len(label) > 120 {
		return nil, errors.New("label must be 120 characters or fewer")
	}
	return &label, nil
}

func isStatusNotFound(err error) bool {
	var status statusError
	return errors.As(err, &status) && status.status == http.StatusNotFound
}
