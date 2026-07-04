package app

import (
	"context"
	"database/sql"
	"errors"
	"net/http"
	"time"

	"github.com/jackc/pgx/v5"
)

func (s *Server) handleListGroups(w http.ResponseWriter, r *http.Request) {
	current, err := requireUser(r.Context())
	if err != nil {
		handleError(w, err)
		return
	}

	rows, err := s.db.Query(r.Context(), `
		select
			g.id::text,
			g.name,
			g.slug,
			g.description,
			g.visibility,
			g.created_by_user_id::text,
			gm.role,
			gm.status,
			g.created_at,
			g.updated_at
		from groups g
		left join group_memberships gm on gm.group_id = g.id and gm.user_id = $1
		where g.visibility = 'public'
		   or gm.status = 'active'
		order by g.created_at desc
	`, current.ID)
	if err != nil {
		handleError(w, err)
		return
	}
	defer rows.Close()

	groups := []Group{}
	for rows.Next() {
		group, err := scanGroup(rows)
		if err != nil {
			handleError(w, err)
			return
		}
		groups = append(groups, group)
	}
	if err := rows.Err(); err != nil {
		handleError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, groups)
}

func (s *Server) handleCreateGroup(w http.ResponseWriter, r *http.Request) {
	current, err := requireUser(r.Context())
	if err != nil {
		handleError(w, err)
		return
	}

	var req struct {
		Name        string  `json:"name"`
		Slug        string  `json:"slug"`
		Description *string `json:"description"`
		Visibility  string  `json:"visibility"`
	}
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid JSON request")
		return
	}
	if req.Name == "" {
		writeError(w, http.StatusBadRequest, "name is required")
		return
	}
	if req.Slug == "" {
		req.Slug = slugify(req.Name)
	} else {
		req.Slug = slugify(req.Slug)
	}
	if req.Visibility == "" {
		req.Visibility = "public"
	}
	if !validGroupVisibility(req.Visibility) {
		writeError(w, http.StatusBadRequest, "visibility must be public or private")
		return
	}

	tx, err := s.db.Begin(r.Context())
	if err != nil {
		handleError(w, err)
		return
	}
	defer tx.Rollback(r.Context())

	var groupID string
	err = tx.QueryRow(r.Context(), `
		insert into groups (name, slug, description, visibility, created_by_user_id)
		values ($1, $2, $3, $4, $5)
		returning id::text
	`, req.Name, req.Slug, req.Description, req.Visibility, current.ID).Scan(&groupID)
	if err != nil {
		handleError(w, err)
		return
	}

	if _, err := tx.Exec(r.Context(), `
		insert into group_memberships (group_id, user_id, role, status, joined_at)
		values ($1, $2, 'owner', 'active', now())
	`, groupID, current.ID); err != nil {
		handleError(w, err)
		return
	}

	evidenceFormatID, err := createPlainTextEvidenceFormat(r.Context(), tx, groupID, current.ID)
	if err != nil {
		handleError(w, err)
		return
	}

	defaultFeedSchedule := DailyFeedSchedule{
		StartsAt:        defaultScheduleStartsAt(time.UTC),
		Timezone:        "UTC",
		IntervalSeconds: 86400,
	}
	var defaultFeedID string
	if err := tx.QueryRow(r.Context(), `
		insert into group_daily_feeds (
			group_id,
			name,
			slug,
			kind,
			enabled,
			evidence_format_id,
			schedule_starts_at,
			schedule_timezone,
			schedule_interval_seconds,
			created_by_user_id
		)
		values (
			$1,
			$2,
			$3,
			$4,
			true,
			$5,
			$6,
			$7,
			$8,
			$9
		)
		returning id::text
	`, groupID, defaultDailyThreadFeedName, defaultDailyThreadFeedSlug, dailyFeedKindDailyThread, evidenceFormatID, defaultFeedSchedule.StartsAt, defaultFeedSchedule.Timezone, defaultFeedSchedule.IntervalSeconds, current.ID).Scan(&defaultFeedID); err != nil {
		handleError(w, err)
		return
	}

	if err := insertDailyFeedScheduleVersion(r.Context(), tx, groupID, defaultFeedID, defaultFeedSchedule, current.ID); err != nil {
		handleError(w, err)
		return
	}

	if err := tx.Commit(r.Context()); err != nil {
		handleError(w, err)
		return
	}

	group, err := s.getGroup(r.Context(), groupID)
	if err != nil {
		handleError(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, group)
}

func (s *Server) handleGetGroup(w http.ResponseWriter, r *http.Request) {
	current, err := requireUser(r.Context())
	if err != nil {
		handleError(w, err)
		return
	}
	groupID := r.PathValue("group_id")
	if err := s.canViewGroup(r.Context(), current.ID, groupID); err != nil {
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

func (s *Server) handlePatchGroup(w http.ResponseWriter, r *http.Request) {
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
		Name        *string `json:"name"`
		Slug        *string `json:"slug"`
		Description *string `json:"description"`
		Visibility  *string `json:"visibility"`
	}
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid JSON request")
		return
	}
	if req.Visibility != nil && !validGroupVisibility(*req.Visibility) {
		writeError(w, http.StatusBadRequest, "visibility must be public or private")
		return
	}

	var slug any
	if req.Slug != nil {
		slug = slugify(*req.Slug)
	}

	tag, err := s.db.Exec(r.Context(), `
		update groups
		set name = coalesce($2, name),
		    slug = coalesce($3, slug),
		    description = coalesce($4, description),
		    visibility = coalesce($5, visibility)
		where id = $1
	`, groupID, req.Name, slug, req.Description, req.Visibility)
	if err != nil {
		handleError(w, err)
		return
	}
	if tag.RowsAffected() == 0 {
		writeError(w, http.StatusNotFound, "group not found")
		return
	}

	group, err := s.getGroup(r.Context(), groupID)
	if err != nil {
		handleError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, group)
}

func (s *Server) handleDeleteGroup(w http.ResponseWriter, r *http.Request) {
	current, err := requireUser(r.Context())
	if err != nil {
		handleError(w, err)
		return
	}
	groupID := r.PathValue("group_id")
	if err := s.requireGroupOwner(r.Context(), current.ID, groupID); err != nil {
		handleError(w, err)
		return
	}

	tag, err := s.db.Exec(r.Context(), `
		delete from groups
		where id = $1
	`, groupID)
	if err != nil {
		handleError(w, err)
		return
	}
	if tag.RowsAffected() == 0 {
		writeError(w, http.StatusNotFound, "group not found")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) handleListGroupMembers(w http.ResponseWriter, r *http.Request) {
	current, err := requireUser(r.Context())
	if err != nil {
		handleError(w, err)
		return
	}
	groupID := r.PathValue("group_id")
	if err := s.canViewGroup(r.Context(), current.ID, groupID); err != nil {
		handleError(w, err)
		return
	}
	members, err := s.listGroupMembers(r.Context(), groupID)
	if err != nil {
		handleError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, members)
}

func (s *Server) handleAddGroupMember(w http.ResponseWriter, r *http.Request) {
	current, err := requireUser(r.Context())
	if err != nil {
		handleError(w, err)
		return
	}
	groupID := r.PathValue("group_id")
	actorRole, err := s.activeGroupRole(r.Context(), current.ID, groupID)
	if err != nil {
		handleError(w, err)
		return
	}
	if actorRole != "owner" && actorRole != "admin" {
		handleError(w, forbidden("insufficient group permissions"))
		return
	}

	var req struct {
		Username    string `json:"username"`
		DisplayName string `json:"display_name"`
		Role        string `json:"role"`
		Status      string `json:"status"`
	}
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid JSON request")
		return
	}
	if req.Username == "" && req.DisplayName == "" {
		writeError(w, http.StatusBadRequest, "username or display_name is required")
		return
	}
	if req.Username == "" {
		req.Username = slugify(req.DisplayName)
	} else {
		req.Username = slugify(req.Username)
	}
	if req.DisplayName == "" {
		req.DisplayName = req.Username
	}
	if req.Role == "" {
		req.Role = "member"
	}
	if req.Status == "" {
		req.Status = "active"
	}
	if !validGroupRole(req.Role) {
		writeError(w, http.StatusBadRequest, "role must be owner, admin, or member")
		return
	}
	if !validGroupStatus(req.Status) {
		writeError(w, http.StatusBadRequest, "status must be invited, active, removed, or left")
		return
	}
	if actorRole == "admin" && req.Role != "member" {
		writeError(w, http.StatusForbidden, "admins can only add regular members")
		return
	}

	tx, err := s.db.Begin(r.Context())
	if err != nil {
		handleError(w, err)
		return
	}
	defer tx.Rollback(r.Context())

	var userID string
	for attempt := 0; attempt < 6 && userID == ""; attempt++ {
		friendCode, err := generateFriendCode()
		if err != nil {
			handleError(w, err)
			return
		}
		err = tx.QueryRow(r.Context(), `
			insert into users (username, email, display_name, password_hash, friend_code)
			values ($1, $2, $3, $4, $5)
			on conflict (username) do nothing
			returning id::text
		`, req.Username, placeholderEmail(req.Username), req.DisplayName, disabledPasswordHash, friendCode).Scan(&userID)
		if err == nil {
			break
		}
		if errors.Is(err, pgx.ErrNoRows) {
			if err := tx.QueryRow(r.Context(), `select id::text from users where username = $1`, req.Username).Scan(&userID); err != nil {
				handleError(w, err)
				return
			}
			break
		}
		if isUniqueConstraint(err, "users_friend_code_unique") {
			continue
		}
		handleError(w, err)
		return
	}
	if userID == "" {
		handleError(w, errors.New("create user friend code"))
		return
	}

	existing, err := s.groupMemberState(r.Context(), groupID, userID)
	if err == nil {
		if err := s.guardGroupMemberChange(r.Context(), actorRole, groupID, existing, req.Role, req.Status); err != nil {
			handleError(w, err)
			return
		}
	} else {
		var status statusError
		if !errors.As(err, &status) || status.status != http.StatusNotFound {
			handleError(w, err)
			return
		}
	}

	if _, err := tx.Exec(r.Context(), `
		insert into group_memberships (group_id, user_id, role, status, joined_at)
		values ($1, $2, $3, $4, case when $4 = 'active' then now() else null end)
		on conflict (group_id, user_id) do update set
			role = excluded.role,
			status = excluded.status,
			joined_at = coalesce(group_memberships.joined_at, excluded.joined_at)
	`, groupID, userID, req.Role, req.Status); err != nil {
		handleError(w, err)
		return
	}

	if err := tx.Commit(r.Context()); err != nil {
		handleError(w, err)
		return
	}

	members, err := s.listGroupMembers(r.Context(), groupID)
	if err != nil {
		handleError(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, members)
}

func (s *Server) handlePatchGroupMember(w http.ResponseWriter, r *http.Request) {
	current, err := requireUser(r.Context())
	if err != nil {
		handleError(w, err)
		return
	}
	groupID := r.PathValue("group_id")
	targetUserID := r.PathValue("user_id")
	actorRole, err := s.activeGroupRole(r.Context(), current.ID, groupID)
	if err != nil {
		handleError(w, err)
		return
	}
	if actorRole != "owner" && actorRole != "admin" {
		handleError(w, forbidden("insufficient group permissions"))
		return
	}

	var req struct {
		Role   *string `json:"role"`
		Status *string `json:"status"`
	}
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid JSON request")
		return
	}
	if req.Role != nil && !validGroupRole(*req.Role) {
		writeError(w, http.StatusBadRequest, "role must be owner, admin, or member")
		return
	}
	if req.Status != nil && !validGroupStatus(*req.Status) {
		writeError(w, http.StatusBadRequest, "status must be invited, active, removed, or left")
		return
	}

	target, err := s.groupMemberState(r.Context(), groupID, targetUserID)
	if err != nil {
		handleError(w, err)
		return
	}
	finalRole := target.Role
	finalStatus := target.Status
	if req.Role != nil {
		finalRole = *req.Role
	}
	if req.Status != nil {
		finalStatus = *req.Status
	}
	if err := s.guardGroupMemberChange(r.Context(), actorRole, groupID, target, finalRole, finalStatus); err != nil {
		handleError(w, err)
		return
	}

	tag, err := s.db.Exec(r.Context(), `
		update group_memberships
		set role = coalesce($3, role),
		    status = coalesce($4, status),
		    joined_at = case
		    	when coalesce($4, status) = 'active' then coalesce(joined_at, now())
		    	else joined_at
		    end
		where group_id = $1 and user_id = $2
	`, groupID, targetUserID, req.Role, req.Status)
	if err != nil {
		handleError(w, err)
		return
	}
	if tag.RowsAffected() == 0 {
		writeError(w, http.StatusNotFound, "group member not found")
		return
	}

	members, err := s.listGroupMembers(r.Context(), groupID)
	if err != nil {
		handleError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, members)
}

func (s *Server) handleDeleteGroupMember(w http.ResponseWriter, r *http.Request) {
	current, err := requireUser(r.Context())
	if err != nil {
		handleError(w, err)
		return
	}
	groupID := r.PathValue("group_id")
	targetUserID := r.PathValue("user_id")
	actorRole, err := s.activeGroupRole(r.Context(), current.ID, groupID)
	if err != nil {
		handleError(w, err)
		return
	}
	if actorRole != "owner" && actorRole != "admin" {
		handleError(w, forbidden("insufficient group permissions"))
		return
	}
	target, err := s.groupMemberState(r.Context(), groupID, targetUserID)
	if err != nil {
		handleError(w, err)
		return
	}
	if err := s.guardGroupMemberChange(r.Context(), actorRole, groupID, target, target.Role, "removed"); err != nil {
		handleError(w, err)
		return
	}

	tag, err := s.db.Exec(r.Context(), `
		delete from group_memberships
		where group_id = $1 and user_id = $2
	`, groupID, targetUserID)
	if err != nil {
		handleError(w, err)
		return
	}
	if tag.RowsAffected() == 0 {
		writeError(w, http.StatusNotFound, "group member not found")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) getGroup(ctx context.Context, groupID string) (Group, error) {
	current, err := requireUser(ctx)
	if err != nil {
		return Group{}, err
	}
	group, err := scanGroup(s.db.QueryRow(ctx, `
		select
			g.id::text,
			g.name,
			g.slug,
			g.description,
			g.visibility,
			g.created_by_user_id::text,
			gm.role,
			gm.status,
			g.created_at,
			g.updated_at
		from groups g
		left join group_memberships gm on gm.group_id = g.id and gm.user_id = $2
		where g.id = $1
	`, groupID, current.ID))
	if errors.Is(err, pgx.ErrNoRows) {
		return Group{}, errNotFound("group")
	}
	return group, err
}

func scanGroup(row pgx.Row) (Group, error) {
	var group Group
	var description sql.NullString
	var role sql.NullString
	var status sql.NullString
	if err := row.Scan(
		&group.ID,
		&group.Name,
		&group.Slug,
		&description,
		&group.Visibility,
		&group.CreatedByUserID,
		&role,
		&status,
		&group.CreatedAt,
		&group.UpdatedAt,
	); err != nil {
		return Group{}, err
	}
	group.Description = nullStringPtr(description)
	group.MyRole = nullStringPtr(role)
	group.MyStatus = nullStringPtr(status)
	return group, nil
}

func (s *Server) listGroupMembers(ctx context.Context, groupID string) ([]GroupMember, error) {
	rows, err := s.db.Query(ctx, `
		select
			u.id::text,
			u.username,
			u.display_name,
			u.avatar_url,
			gm.role,
			gm.status,
			gm.joined_at,
			gm.created_at,
			gm.updated_at
		from group_memberships gm
		join users u on u.id = gm.user_id
		where gm.group_id = $1
		order by
			case gm.role when 'owner' then 0 when 'admin' then 1 else 2 end,
			u.display_name
	`, groupID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	members := []GroupMember{}
	for rows.Next() {
		member, err := scanGroupMember(rows)
		if err != nil {
			return nil, err
		}
		members = append(members, member)
	}
	return members, rows.Err()
}

func scanGroupMember(row pgx.Row) (GroupMember, error) {
	var member GroupMember
	var avatar sql.NullString
	var joinedAt sql.NullTime
	if err := row.Scan(
		&member.UserID,
		&member.Username,
		&member.DisplayName,
		&avatar,
		&member.Role,
		&member.Status,
		&joinedAt,
		&member.CreatedAt,
		&member.UpdatedAt,
	); err != nil {
		return GroupMember{}, err
	}
	member.AvatarURL = nullStringPtr(avatar)
	member.JoinedAt = nullTimePtr(joinedAt)
	return member, nil
}
