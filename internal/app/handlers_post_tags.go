package app

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"net/http"
	"regexp"
	"strings"
	"unicode/utf8"

	"github.com/jackc/pgx/v5"
)

const maxGroupFeedPostTags = 20

var uuidStringPattern = regexp.MustCompile(`(?i)^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$`)

type createGroupPostTagRequest struct {
	Name         string           `json:"name"`
	DisplayOrder optionalIntField `json:"display_order"`
}

type patchGroupPostTagRequest struct {
	Name         optionalStringField `json:"name"`
	DisplayOrder optionalIntField    `json:"display_order"`
	Archived     optionalBoolField   `json:"archived"`
}

type optionalBoolField struct {
	Set   bool
	Value bool
}

func (field *optionalBoolField) UnmarshalJSON(data []byte) error {
	field.Set = true
	if strings.TrimSpace(string(data)) == "null" {
		return errors.New("field must be a boolean")
	}
	return json.Unmarshal(data, &field.Value)
}

type optionalStringSliceField struct {
	Set   bool
	Value []string
}

func (field *optionalStringSliceField) UnmarshalJSON(data []byte) error {
	field.Set = true
	if strings.TrimSpace(string(data)) == "null" {
		return errors.New("field must be an array")
	}
	return json.Unmarshal(data, &field.Value)
}

type stringSliceField []string

func (field *stringSliceField) UnmarshalJSON(data []byte) error {
	if strings.TrimSpace(string(data)) == "null" {
		return errors.New("field must be an array")
	}
	var values []string
	if err := json.Unmarshal(data, &values); err != nil {
		return err
	}
	*field = values
	return nil
}

type normalizedGroupPostTagInput struct {
	Name         string
	DisplayOrder int
}

type normalizedGroupPostTagPatch struct {
	Name         *string
	DisplayOrder *int
	Archived     *bool
}

type groupPostTagScanner interface {
	Scan(dest ...any) error
}

func (s *Server) handleListGroupPostTags(w http.ResponseWriter, r *http.Request) {
	current, err := requireUser(r.Context())
	if err != nil {
		handleError(w, err)
		return
	}

	groupID := r.PathValue("group_id")
	role, err := s.activeGroupRole(r.Context(), current.ID, groupID)
	if err != nil {
		handleError(w, err)
		return
	}

	includeArchived := r.URL.Query().Get("include_archived") == "true"
	if includeArchived && !canManageDailyFeeds(role) {
		handleError(w, forbidden("insufficient group permissions"))
		return
	}

	tags, err := s.listGroupPostTags(r.Context(), groupID, includeArchived)
	if err != nil {
		handleError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, tags)
}

func (s *Server) handleCreateGroupPostTag(w http.ResponseWriter, r *http.Request) {
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

	var req createGroupPostTagRequest
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid JSON request")
		return
	}
	input, err := normalizeCreateGroupPostTagRequest(req)
	if err != nil {
		handleError(w, err)
		return
	}

	var tagID string
	err = s.db.QueryRow(r.Context(), `
		insert into group_post_tags (
			group_id,
			name,
			display_order,
			created_by_user_id,
			updated_by_user_id
		)
		values ($1, $2, $3, $4, $4)
		returning id::text
	`, groupID, input.Name, input.DisplayOrder, current.ID).Scan(&tagID)
	if err != nil {
		handleError(w, err)
		return
	}

	tag, err := s.getGroupPostTag(r.Context(), groupID, tagID)
	if err != nil {
		handleError(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, tag)
}

func (s *Server) handleGetGroupPostTag(w http.ResponseWriter, r *http.Request) {
	current, err := requireUser(r.Context())
	if err != nil {
		handleError(w, err)
		return
	}

	groupID := r.PathValue("group_id")
	role, err := s.activeGroupRole(r.Context(), current.ID, groupID)
	if err != nil {
		handleError(w, err)
		return
	}

	tag, err := s.getGroupPostTag(r.Context(), groupID, r.PathValue("tag_id"))
	if err != nil {
		handleError(w, err)
		return
	}
	if tag.ArchivedAt != nil && !canManageDailyFeeds(role) {
		handleError(w, forbidden("insufficient group permissions"))
		return
	}
	writeJSON(w, http.StatusOK, tag)
}

func (s *Server) handlePatchGroupPostTag(w http.ResponseWriter, r *http.Request) {
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

	var req patchGroupPostTagRequest
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid JSON request")
		return
	}
	patch, err := normalizePatchGroupPostTagRequest(req)
	if err != nil {
		handleError(w, err)
		return
	}

	tagID := r.PathValue("tag_id")
	commandTag, err := s.db.Exec(r.Context(), `
		update group_post_tags
		set name = coalesce($3, name),
		    display_order = coalesce($4, display_order),
		    archived_at = case
		        when $5 then case when $6 then coalesce(archived_at, now()) else null end
		        else archived_at
		    end,
		    updated_by_user_id = $7
		where group_id = $1 and id = $2
	`, groupID, tagID, patch.Name, patch.DisplayOrder, patch.Archived != nil, patch.Archived != nil && *patch.Archived, current.ID)
	if err != nil {
		handleError(w, err)
		return
	}
	if commandTag.RowsAffected() == 0 {
		handleError(w, errNotFound("post tag"))
		return
	}

	tag, err := s.getGroupPostTag(r.Context(), groupID, tagID)
	if err != nil {
		handleError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, tag)
}

func (s *Server) handleDeleteGroupPostTag(w http.ResponseWriter, r *http.Request) {
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

	commandTag, err := s.db.Exec(r.Context(), `
		update group_post_tags
		set archived_at = coalesce(archived_at, now()),
		    updated_by_user_id = $3
		where group_id = $1 and id = $2
	`, groupID, r.PathValue("tag_id"), current.ID)
	if err != nil {
		handleError(w, err)
		return
	}
	if commandTag.RowsAffected() == 0 {
		handleError(w, errNotFound("post tag"))
		return
	}

	w.WriteHeader(http.StatusNoContent)
}

func normalizeCreateGroupPostTagRequest(req createGroupPostTagRequest) (normalizedGroupPostTagInput, error) {
	name, err := normalizeGroupPostTagName(req.Name)
	if err != nil {
		return normalizedGroupPostTagInput{}, err
	}

	displayOrder := 0
	if req.DisplayOrder.Set {
		displayOrder, err = normalizeGroupPostTagDisplayOrder(req.DisplayOrder.Value)
		if err != nil {
			return normalizedGroupPostTagInput{}, err
		}
	}

	return normalizedGroupPostTagInput{Name: name, DisplayOrder: displayOrder}, nil
}

func normalizePatchGroupPostTagRequest(req patchGroupPostTagRequest) (normalizedGroupPostTagPatch, error) {
	if !req.Name.Set && !req.DisplayOrder.Set && !req.Archived.Set {
		return normalizedGroupPostTagPatch{}, badRequest("at least one field is required")
	}

	var patch normalizedGroupPostTagPatch
	if req.Name.Set {
		name, err := normalizeGroupPostTagName(req.Name.Value)
		if err != nil {
			return normalizedGroupPostTagPatch{}, err
		}
		patch.Name = &name
	}
	if req.DisplayOrder.Set {
		displayOrder, err := normalizeGroupPostTagDisplayOrder(req.DisplayOrder.Value)
		if err != nil {
			return normalizedGroupPostTagPatch{}, err
		}
		patch.DisplayOrder = &displayOrder
	}
	if req.Archived.Set {
		patch.Archived = &req.Archived.Value
	}
	return patch, nil
}

func normalizeGroupPostTagName(name string) (string, error) {
	trimmed := strings.TrimSpace(name)
	if trimmed == "" {
		return "", badRequest("tag name is required")
	}
	if utf8.RuneCountInString(trimmed) > 48 {
		return "", badRequest("tag name must be 48 characters or fewer")
	}
	return trimmed, nil
}

func normalizeGroupPostTagDisplayOrder(displayOrder int) (int, error) {
	if displayOrder < 0 {
		return 0, badRequest("display_order must be non-negative")
	}
	return displayOrder, nil
}

func normalizeGroupFeedPostTagIDs(rawIDs []string) ([]string, error) {
	tagIDs := make([]string, 0, len(rawIDs))
	seen := map[string]bool{}
	for _, rawID := range rawIDs {
		trimmed := strings.TrimSpace(rawID)
		if trimmed == "" {
			return nil, badRequest("tag_ids cannot include empty values")
		}
		key := strings.ToLower(trimmed)
		if seen[key] {
			continue
		}
		seen[key] = true
		tagIDs = append(tagIDs, key)
	}
	if len(tagIDs) > maxGroupFeedPostTags {
		return nil, badRequest("tag_ids cannot include more than 20 tags")
	}
	for _, tagID := range tagIDs {
		if !uuidStringPattern.MatchString(tagID) {
			return nil, badRequest("tag_ids must contain UUID strings")
		}
	}
	return tagIDs, nil
}

func (s *Server) listGroupPostTags(ctx context.Context, groupID string, includeArchived bool) ([]GroupPostTag, error) {
	rows, err := s.db.Query(ctx, groupPostTagSelect()+`
			where group_id = $1
			  and ($2::boolean or archived_at is null)
			order by lower(name), id
	`, groupID, includeArchived)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	tags := []GroupPostTag{}
	for rows.Next() {
		tag, err := scanGroupPostTag(rows)
		if err != nil {
			return nil, err
		}
		tags = append(tags, tag)
	}
	return tags, rows.Err()
}

func (s *Server) getGroupPostTag(ctx context.Context, groupID string, tagID string) (GroupPostTag, error) {
	tag, err := scanGroupPostTag(s.db.QueryRow(ctx, groupPostTagSelect()+`
		where group_id = $1 and id = $2
	`, groupID, tagID))
	if errors.Is(err, pgx.ErrNoRows) {
		return GroupPostTag{}, errNotFound("post tag")
	}
	return tag, err
}

func setGroupFeedPostTags(ctx context.Context, tx pgx.Tx, groupID string, postID string, tagIDs []string) error {
	if len(tagIDs) > 0 {
		var activeCount int
		if err := tx.QueryRow(ctx, `
			select count(*)::integer
			from group_post_tags
			where group_id = $1
			  and id = any($2::uuid[])
			  and archived_at is null
		`, groupID, tagIDs).Scan(&activeCount); err != nil {
			return err
		}
		if activeCount != len(tagIDs) {
			return badRequest("tag_ids must reference active tags in this group")
		}
	}

	if _, err := tx.Exec(ctx, `
		delete from group_feed_post_tags
		where group_id = $1 and post_id = $2
	`, groupID, postID); err != nil {
		return err
	}
	if len(tagIDs) == 0 {
		return nil
	}

	_, err := tx.Exec(ctx, `
		insert into group_feed_post_tags (group_id, post_id, tag_id)
		select $1, $2, unnest($3::uuid[])
	`, groupID, postID, tagIDs)
	return err
}

func (s *Server) hydrateGroupFeedPostTags(ctx context.Context, posts []GroupFeedPost) ([]GroupFeedPost, error) {
	if len(posts) == 0 {
		return posts, nil
	}

	postIDs := make([]string, 0, len(posts))
	postIndex := map[string]int{}
	for index := range posts {
		posts[index].Tags = []GroupPostTag{}
		postIDs = append(postIDs, posts[index].ID)
		postIndex[posts[index].ID] = index
	}

	rows, err := s.db.Query(ctx, `
		select
			fpt.post_id::text,
			t.id::text,
			t.group_id::text,
			t.name,
			t.display_order,
			t.archived_at,
			t.created_by_user_id::text,
			t.updated_by_user_id::text,
			t.created_at,
			t.updated_at
		from group_feed_post_tags fpt
			join group_post_tags t on t.id = fpt.tag_id and t.group_id = fpt.group_id
			where fpt.post_id = any($1::uuid[])
			order by fpt.post_id, lower(t.name), t.id
	`, postIDs)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	for rows.Next() {
		postID, tag, err := scanGroupPostTagAttachment(rows)
		if err != nil {
			return nil, err
		}
		index, ok := postIndex[postID]
		if !ok {
			continue
		}
		posts[index].Tags = append(posts[index].Tags, tag)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return posts, nil
}

func groupPostTagSelect() string {
	return `
		select
			id::text,
			group_id::text,
			name,
			display_order,
			archived_at,
			created_by_user_id::text,
			updated_by_user_id::text,
			created_at,
			updated_at
		from group_post_tags
	`
}

func scanGroupPostTag(row groupPostTagScanner) (GroupPostTag, error) {
	var tag GroupPostTag
	var archivedAt sql.NullTime
	var createdByUserID sql.NullString
	var updatedByUserID sql.NullString
	if err := row.Scan(
		&tag.ID,
		&tag.GroupID,
		&tag.Name,
		&tag.DisplayOrder,
		&archivedAt,
		&createdByUserID,
		&updatedByUserID,
		&tag.CreatedAt,
		&tag.UpdatedAt,
	); err != nil {
		return GroupPostTag{}, err
	}
	tag.ArchivedAt = nullTimePtr(archivedAt)
	tag.CreatedByUserID = nullStringPtr(createdByUserID)
	tag.UpdatedByUserID = nullStringPtr(updatedByUserID)
	return tag, nil
}

func scanGroupPostTagAttachment(row groupPostTagScanner) (string, GroupPostTag, error) {
	var postID string
	var tag GroupPostTag
	var archivedAt sql.NullTime
	var createdByUserID sql.NullString
	var updatedByUserID sql.NullString
	if err := row.Scan(
		&postID,
		&tag.ID,
		&tag.GroupID,
		&tag.Name,
		&tag.DisplayOrder,
		&archivedAt,
		&createdByUserID,
		&updatedByUserID,
		&tag.CreatedAt,
		&tag.UpdatedAt,
	); err != nil {
		return "", GroupPostTag{}, err
	}
	tag.ArchivedAt = nullTimePtr(archivedAt)
	tag.CreatedByUserID = nullStringPtr(createdByUserID)
	tag.UpdatedByUserID = nullStringPtr(updatedByUserID)
	return postID, tag, nil
}
