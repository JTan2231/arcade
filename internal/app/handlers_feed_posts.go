package app

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
)

type createGroupFeedPostRequest struct {
	EvidenceText string           `json:"evidence_text"`
	Caption      *string          `json:"caption"`
	TagIDs       stringSliceField `json:"tag_ids"`
}

type patchGroupFeedPostRequest struct {
	EvidenceText optionalStringField         `json:"evidence_text"`
	Caption      optionalNullableStringField `json:"caption"`
	TagIDs       optionalStringSliceField    `json:"tag_ids"`
}

type optionalStringField struct {
	Set   bool
	Value string
}

func (field *optionalStringField) UnmarshalJSON(data []byte) error {
	field.Set = true
	if strings.TrimSpace(string(data)) == "null" {
		return errors.New("field must be a string")
	}
	return json.Unmarshal(data, &field.Value)
}

type optionalNullableStringField struct {
	Set   bool
	Value *string
}

func (field *optionalNullableStringField) UnmarshalJSON(data []byte) error {
	field.Set = true
	if strings.TrimSpace(string(data)) == "null" {
		field.Value = nil
		return nil
	}
	var value string
	if err := json.Unmarshal(data, &value); err != nil {
		return err
	}
	field.Value = &value
	return nil
}

type normalizedGroupFeedPostPayload struct {
	EvidenceText string
	Caption      *string
	TagIDs       []string
}

type normalizedGroupFeedPostPatch struct {
	EvidenceText *string
	CaptionSet   bool
	Caption      *string
	TagIDsSet    bool
	TagIDs       []string
}

func (s *Server) handleListGroupFeedPosts(w http.ResponseWriter, r *http.Request) {
	current, err := requireUser(r.Context())
	if err != nil {
		handleError(w, err)
		return
	}

	feedDate, err := parseDailyFeedPathDate(r.PathValue("date"))
	if err != nil {
		handleError(w, err)
		return
	}

	groupID := r.PathValue("group_id")
	feedID := r.PathValue("feed_id")
	resolvedDate, err := s.authorizeGroupFeedPostTarget(r.Context(), current.ID, groupID, feedID, feedDate, true)
	if err != nil {
		handleError(w, err)
		return
	}

	posts, err := s.listGroupFeedPosts(r.Context(), groupID, feedID, resolvedDate)
	if err != nil {
		handleError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, posts)
}

func (s *Server) handleCreateGroupFeedPost(w http.ResponseWriter, r *http.Request) {
	current, err := requireUser(r.Context())
	if err != nil {
		handleError(w, err)
		return
	}

	var req createGroupFeedPostRequest
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid JSON request")
		return
	}
	payload, err := normalizeCreateGroupFeedPostRequest(req)
	if err != nil {
		handleError(w, err)
		return
	}

	feedDate, err := parseDailyFeedPathDate(r.PathValue("date"))
	if err != nil {
		handleError(w, err)
		return
	}

	groupID := r.PathValue("group_id")
	feedID := r.PathValue("feed_id")
	resolvedDate, err := s.authorizeGroupFeedPostTarget(r.Context(), current.ID, groupID, feedID, feedDate, false)
	if err != nil {
		handleError(w, err)
		return
	}

	evidenceFormatVersion, err := s.activeEvidenceFormatVersionForFeed(r.Context(), groupID, feedID)
	if err != nil {
		handleError(w, err)
		return
	}
	if err := validateEvidenceText(payload.EvidenceText, evidenceFormatVersion); err != nil {
		handleError(w, err)
		return
	}

	tx, err := s.db.Begin(r.Context())
	if err != nil {
		handleError(w, err)
		return
	}
	defer tx.Rollback(r.Context())

	instanceID, err := createGroupDailyFeedInstance(r.Context(), tx, groupID, feedID, resolvedDate)
	if err != nil {
		handleError(w, err)
		return
	}

	var postID string
	err = tx.QueryRow(r.Context(), `
		insert into group_feed_posts (
			group_id,
			feed_instance_id,
			author_user_id,
			evidence_text,
			evidence_format_version_id,
			caption,
			deleted_at
		)
		values (
			$1,
			$2,
			$3,
			$4,
			$5,
			$6,
			null
		)
		on conflict (feed_instance_id, author_user_id) do update set
			evidence_text = excluded.evidence_text,
			evidence_format_version_id = excluded.evidence_format_version_id,
			caption = excluded.caption,
			deleted_at = null
		returning id::text
	`, groupID, instanceID, current.ID, payload.EvidenceText, evidenceFormatVersion.ID, payload.Caption).Scan(&postID)
	if err != nil {
		handleError(w, err)
		return
	}

	if err := setGroupFeedPostTags(r.Context(), tx, groupID, postID, payload.TagIDs); err != nil {
		handleError(w, err)
		return
	}

	if err := tx.Commit(r.Context()); err != nil {
		handleError(w, err)
		return
	}

	post, err := s.getGroupFeedPost(r.Context(), groupID, postID)
	if err != nil {
		handleError(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, post)
}

func (s *Server) handleGetGroupFeedPost(w http.ResponseWriter, r *http.Request) {
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

	post, err := s.getGroupFeedPost(r.Context(), groupID, r.PathValue("post_id"))
	if err != nil {
		handleError(w, err)
		return
	}
	if post.DeletedAt != nil && post.AuthorUserID != current.ID && !canManageDailyFeeds(role) {
		handleError(w, errNotFound("feed post"))
		return
	}

	feedDate, err := parseDailyFeedPathDate(post.FeedDate)
	if err != nil {
		handleError(w, err)
		return
	}
	if _, err := s.authorizeGroupFeedPostTargetForRole(r.Context(), current.ID, role, groupID, post.FeedID, feedDate, true); err != nil {
		handleError(w, err)
		return
	}

	writeJSON(w, http.StatusOK, post)
}

func (s *Server) handleGetMeFeedPostRoute(w http.ResponseWriter, r *http.Request) {
	current, err := requireUser(r.Context())
	if err != nil {
		handleError(w, err)
		return
	}

	route, err := s.getMemberFeedPostRoute(r.Context(), current.ID, r.PathValue("post_id"))
	if err != nil {
		handleError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, route)
}

func (s *Server) handlePatchGroupFeedPost(w http.ResponseWriter, r *http.Request) {
	current, err := requireUser(r.Context())
	if err != nil {
		handleError(w, err)
		return
	}

	var req patchGroupFeedPostRequest
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid JSON request")
		return
	}
	patch, err := normalizePatchGroupFeedPostRequest(req)
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

	post, err := s.getGroupFeedPost(r.Context(), groupID, r.PathValue("post_id"))
	if err != nil {
		handleError(w, err)
		return
	}
	isAuthor := post.AuthorUserID == current.ID
	if groupFeedPostPatchTouchesContent(patch) && !isAuthor {
		handleError(w, forbidden("only post authors can edit posts"))
		return
	}
	if !groupFeedPostPatchTouchesContent(patch) && patch.TagIDsSet && !isAuthor && !canManageDailyFeeds(role) {
		handleError(w, forbidden("insufficient group permissions"))
		return
	}
	if post.DeletedAt != nil {
		handleError(w, errNotFound("feed post"))
		return
	}
	if patch.EvidenceText != nil {
		if err := validateEvidenceText(*patch.EvidenceText, post.EvidenceFormatVersion); err != nil {
			handleError(w, err)
			return
		}
	}

	tx, err := s.db.Begin(r.Context())
	if err != nil {
		handleError(w, err)
		return
	}
	defer tx.Rollback(r.Context())

	tag, err := tx.Exec(r.Context(), `
		update group_feed_posts
		set evidence_text = coalesce($3, evidence_text),
		    caption = case when $4 then $5::text else caption end
		where group_id = $1
		  and id = $2
		  and deleted_at is null
	`, groupID, post.ID, patch.EvidenceText, patch.CaptionSet, patch.Caption)
	if err != nil {
		handleError(w, err)
		return
	}
	if tag.RowsAffected() == 0 {
		handleError(w, errNotFound("feed post"))
		return
	}

	if patch.TagIDsSet {
		if err := setGroupFeedPostTags(r.Context(), tx, groupID, post.ID, patch.TagIDs); err != nil {
			handleError(w, err)
			return
		}
	}

	if err := tx.Commit(r.Context()); err != nil {
		handleError(w, err)
		return
	}

	updated, err := s.getGroupFeedPost(r.Context(), groupID, post.ID)
	if err != nil {
		handleError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, updated)
}

func (s *Server) handleDeleteGroupFeedPost(w http.ResponseWriter, r *http.Request) {
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

	post, err := s.getGroupFeedPost(r.Context(), groupID, r.PathValue("post_id"))
	if err != nil {
		handleError(w, err)
		return
	}
	if post.AuthorUserID != current.ID && !canManageDailyFeeds(role) {
		handleError(w, forbidden("insufficient group permissions"))
		return
	}

	tag, err := s.db.Exec(r.Context(), `
		update group_feed_posts
		set deleted_at = coalesce(deleted_at, now())
		where group_id = $1 and id = $2
	`, groupID, post.ID)
	if err != nil {
		handleError(w, err)
		return
	}
	if tag.RowsAffected() == 0 {
		handleError(w, errNotFound("feed post"))
		return
	}

	w.WriteHeader(http.StatusNoContent)
}

func parseDailyFeedPathDate(raw string) (time.Time, error) {
	date, err := time.Parse(dailyFeedDateLayout, raw)
	if err != nil {
		return time.Time{}, badRequest("date must use YYYY-MM-DD")
	}
	return date, nil
}

func (s *Server) authorizeGroupFeedPostTarget(ctx context.Context, userID string, groupID string, feedID string, requestedDate time.Time, allowManagerDisabled bool) (time.Time, error) {
	role, err := s.activeGroupRole(ctx, userID, groupID)
	if err != nil {
		return time.Time{}, err
	}
	return s.authorizeGroupFeedPostTargetForRole(ctx, userID, role, groupID, feedID, requestedDate, allowManagerDisabled)
}

func (s *Server) authorizeGroupFeedPostTargetForRole(ctx context.Context, userID string, role string, groupID string, feedID string, requestedDate time.Time, allowManagerDisabled bool) (time.Time, error) {
	feed, err := s.getGroupDailyFeed(ctx, groupID, feedID)
	if err != nil {
		return time.Time{}, err
	}

	if !feed.Enabled {
		if allowManagerDisabled && canManageDailyFeeds(role) {
			// Managers can inspect posts on disabled feeds; members cannot.
		} else if canManageDailyFeeds(role) {
			return time.Time{}, forbidden("daily feed must be enabled")
		} else {
			return time.Time{}, errNotFound("daily feed")
		}
	}

	ok, err := s.dailyFeedAudienceMatches(ctx, userID, feed)
	if err != nil {
		return time.Time{}, err
	}
	if !ok {
		return time.Time{}, forbidden("active group membership required")
	}

	return dailyFeedOutputDate(feed.Schedule, &requestedDate)
}

func createGroupDailyFeedInstance(ctx context.Context, tx pgx.Tx, groupID string, feedID string, feedDate time.Time) (string, error) {
	var instanceID string
	err := tx.QueryRow(ctx, `
		insert into group_daily_feed_instances (group_id, feed_id, feed_date)
		values ($1, $2, $3)
		on conflict (feed_id, feed_date) do update set
			feed_date = excluded.feed_date
		returning id::text
	`, groupID, feedID, feedDate).Scan(&instanceID)
	return instanceID, err
}

func (s *Server) listGroupFeedPosts(ctx context.Context, groupID string, feedID string, feedDate time.Time) ([]GroupFeedPost, error) {
	rows, err := s.db.Query(ctx, groupFeedPostSelect()+`
		where i.group_id = $1
		  and i.feed_id = $2
		  and i.feed_date = $3
		  and p.deleted_at is null
		order by p.created_at desc
	`, groupID, feedID, feedDate)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	posts := []GroupFeedPost{}
	for rows.Next() {
		post, err := scanGroupFeedPost(rows)
		if err != nil {
			return nil, err
		}
		posts = append(posts, post)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return s.hydrateGroupFeedPostTags(ctx, posts)
}

func (s *Server) getMemberFeedPostRoute(ctx context.Context, userID string, postID string) (GroupFeedPostRoute, error) {
	var route GroupFeedPostRoute
	var feedDate time.Time
	var deletedAt sql.NullTime
	err := s.db.QueryRow(ctx, `
		select p.group_id::text, i.feed_id::text, i.feed_date, p.deleted_at
		from group_feed_posts p
		join group_daily_feed_instances i on i.id = p.feed_instance_id and i.group_id = p.group_id
		where p.id = $1
	`, postID).Scan(&route.GroupID, &route.FeedID, &feedDate, &deletedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return GroupFeedPostRoute{}, errNotFound("feed post")
	}
	if err != nil {
		return GroupFeedPostRoute{}, err
	}
	if deletedAt.Valid {
		return GroupFeedPostRoute{}, errNotFound("feed post")
	}

	role, err := s.activeGroupRole(ctx, userID, route.GroupID)
	if err != nil {
		return GroupFeedPostRoute{}, err
	}
	resolvedDate, err := s.authorizeGroupFeedPostTargetForRole(ctx, userID, role, route.GroupID, route.FeedID, feedDate, true)
	if err != nil {
		return GroupFeedPostRoute{}, err
	}
	route.FeedDate = resolvedDate.Format(dailyFeedDateLayout)
	return route, nil
}

func (s *Server) getGroupFeedPost(ctx context.Context, groupID string, postID string) (GroupFeedPost, error) {
	post, err := scanGroupFeedPost(s.db.QueryRow(ctx, groupFeedPostSelect()+`
		where p.group_id = $1 and p.id = $2
	`, groupID, postID))
	if errors.Is(err, pgx.ErrNoRows) {
		return GroupFeedPost{}, errNotFound("feed post")
	}
	if err != nil {
		return GroupFeedPost{}, err
	}
	posts, err := s.hydrateGroupFeedPostTags(ctx, []GroupFeedPost{post})
	if err != nil {
		return GroupFeedPost{}, err
	}
	return posts[0], nil
}

func groupFeedPostSelect() string {
	return `
		select
			p.id::text,
			p.group_id::text,
			p.feed_instance_id::text,
			i.feed_id::text,
			i.feed_date,
			p.author_user_id::text,
			u.username,
			u.display_name,
			u.avatar_url,
			p.evidence_text,
			fmt.id::text,
			fmt.group_id::text,
			fmt.slug,
			fmt.name,
			fmt.description,
			fmt.archived_at,
			fmt.created_by_user_id::text,
			fmt.updated_by_user_id::text,
			fmt.created_at,
			fmt.updated_at,
			coalesce(fmt_feed_counts.assigned_feed_count, 0),
			` + evidenceFormatVersionSelectColumns("av") + `,
			` + evidenceFormatVersionSelectColumns("v") + `,
			p.caption,
			p.deleted_at,
			p.created_at,
			p.updated_at
		from group_feed_posts p
		join group_daily_feed_instances i on i.id = p.feed_instance_id and i.group_id = p.group_id
		join users u on u.id = p.author_user_id
		join group_evidence_format_versions v on v.id = p.evidence_format_version_id and v.group_id = p.group_id
		join group_evidence_formats fmt on fmt.id = v.format_id and fmt.group_id = v.group_id
		join lateral (
			select *
			from group_evidence_format_versions
			where format_id = fmt.id
			  and group_id = fmt.group_id
			order by version_number desc
			limit 1
		) av on true
		left join lateral (
			select count(*)::integer as assigned_feed_count
			from group_daily_feeds assigned
			where assigned.group_id = fmt.group_id
			  and assigned.evidence_format_id = fmt.id
		) fmt_feed_counts on true
	`
}

func scanGroupFeedPost(row pgx.Row) (GroupFeedPost, error) {
	var post GroupFeedPost
	var feedDate time.Time
	var avatarURL sql.NullString
	var caption sql.NullString
	var deletedAt sql.NullTime
	dest := []any{
		&post.ID,
		&post.GroupID,
		&post.FeedInstanceID,
		&post.FeedID,
		&feedDate,
		&post.AuthorUserID,
		&post.AuthorUsername,
		&post.AuthorDisplayName,
		&avatarURL,
		&post.EvidenceText,
	}
	dest = append(dest, scanEvidenceFormatDest(&post.EvidenceFormat)...)
	dest = append(dest, scanEvidenceFormatVersionDest(&post.EvidenceFormatVersion)...)
	dest = append(dest,
		&caption,
		&deletedAt,
		&post.CreatedAt,
		&post.UpdatedAt,
	)
	if err := row.Scan(dest...); err != nil {
		return GroupFeedPost{}, err
	}
	post.FeedDate = feedDate.Format(dailyFeedDateLayout)
	post.AuthorAvatarURL = nullStringPtr(avatarURL)
	post.Caption = nullStringPtr(caption)
	post.Tags = []GroupPostTag{}
	post.DeletedAt = nullTimePtr(deletedAt)
	return post, nil
}

func normalizeCreateGroupFeedPostRequest(req createGroupFeedPostRequest) (normalizedGroupFeedPostPayload, error) {
	evidenceText := normalizeEvidenceText(req.EvidenceText)
	if evidenceText == "" {
		return normalizedGroupFeedPostPayload{}, badRequest("evidence_text is required")
	}
	caption, err := normalizeGroupFeedPostCaption(req.Caption)
	if err != nil {
		return normalizedGroupFeedPostPayload{}, err
	}
	tagIDs, err := normalizeGroupFeedPostTagIDs([]string(req.TagIDs))
	if err != nil {
		return normalizedGroupFeedPostPayload{}, err
	}
	return normalizedGroupFeedPostPayload{
		EvidenceText: evidenceText,
		Caption:      caption,
		TagIDs:       tagIDs,
	}, nil
}

func normalizePatchGroupFeedPostRequest(req patchGroupFeedPostRequest) (normalizedGroupFeedPostPatch, error) {
	if !req.EvidenceText.Set && !req.Caption.Set && !req.TagIDs.Set {
		return normalizedGroupFeedPostPatch{}, badRequest("at least one field is required")
	}

	var patch normalizedGroupFeedPostPatch
	if req.EvidenceText.Set {
		evidenceText := normalizeEvidenceText(req.EvidenceText.Value)
		if evidenceText == "" {
			return normalizedGroupFeedPostPatch{}, badRequest("evidence_text is required")
		}
		patch.EvidenceText = &evidenceText
	}
	if req.Caption.Set {
		caption, err := normalizeGroupFeedPostCaption(req.Caption.Value)
		if err != nil {
			return normalizedGroupFeedPostPatch{}, err
		}
		patch.CaptionSet = true
		patch.Caption = caption
	}
	if req.TagIDs.Set {
		tagIDs, err := normalizeGroupFeedPostTagIDs(req.TagIDs.Value)
		if err != nil {
			return normalizedGroupFeedPostPatch{}, err
		}
		patch.TagIDsSet = true
		patch.TagIDs = tagIDs
	}
	return patch, nil
}

func groupFeedPostPatchTouchesContent(patch normalizedGroupFeedPostPatch) bool {
	return patch.EvidenceText != nil || patch.CaptionSet
}

func normalizeGroupFeedPostCaption(caption *string) (*string, error) {
	if caption == nil {
		return nil, nil
	}
	trimmed := strings.TrimSpace(*caption)
	if trimmed == "" {
		return nil, badRequest("caption cannot be empty")
	}
	return &trimmed, nil
}
