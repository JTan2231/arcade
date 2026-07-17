package app

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"time"

	"github.com/jackc/pgx/v5"
)

func (s *Server) handlePublicGroup(w http.ResponseWriter, r *http.Request) {
	group, err := s.getPublicGroup(r.Context(), r.PathValue("group_slug"))
	if err != nil {
		handleError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, group)
}

func (s *Server) handlePublicFeedToday(w http.ResponseWriter, r *http.Request) {
	feed, err := s.getPublicFeed(r.Context(), r.PathValue("feed_id"), nil)
	if err != nil {
		handleError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, feed)
}

func (s *Server) handlePublicFeedOutput(w http.ResponseWriter, r *http.Request) {
	date, err := parseDailyFeedPathDate(r.PathValue("date"))
	if err != nil {
		handleError(w, err)
		return
	}

	feed, err := s.getPublicFeed(r.Context(), r.PathValue("feed_id"), &date)
	if err != nil {
		handleError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, feed)
}

func (s *Server) handlePublicFeedOutputSummaries(w http.ResponseWriter, r *http.Request) {
	summaries, err := s.listPublicFeedOutputSummaries(
		r.Context(),
		r.PathValue("feed_id"),
		r.URL.Query().Get("selected_date"),
	)
	if err != nil {
		handleError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, summaries)
}

func (s *Server) handlePublicPost(w http.ResponseWriter, r *http.Request) {
	post, err := s.getPublicPost(r.Context(), r.PathValue("post_id"))
	if err != nil {
		handleError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, post)
}

func (s *Server) getPublicGroup(ctx context.Context, slug string) (PublicGroup, error) {
	var group PublicGroup
	var description sql.NullString
	err := s.db.QueryRow(ctx, `
		select id::text, name, slug, description, visibility, join_policy, created_at, updated_at
		from groups
		where slug = $1 and visibility = 'public'
	`, slug).Scan(&group.ID, &group.Name, &group.Slug, &description, &group.Visibility, &group.JoinPolicy, &group.CreatedAt, &group.UpdatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return PublicGroup{}, errNotFound("group")
	}
	if err != nil {
		return PublicGroup{}, err
	}
	group.Description = nullStringPtr(description)
	group.Feeds = []PublicGroupFeed{}

	rows, err := s.db.Query(ctx, `
		select
			f.id::text,
			f.name,
			f.slug,
			f.kind,
			f.description,
			f.enabled,
			f.captions_enabled,
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
			`+evidenceFormatVersionSelectColumns("v")+`,
			f.schedule_starts_at,
			f.schedule_timezone,
			f.schedule_interval_seconds,
			f.created_at,
			f.updated_at
		from group_daily_feeds f
		join group_evidence_formats fmt on fmt.id = f.evidence_format_id and fmt.group_id = f.group_id
		join lateral (
			select *
			from group_evidence_format_versions
			where format_id = fmt.id
			  and group_id = fmt.group_id
			order by version_number desc
			limit 1
		) v on true
		left join lateral (
			select count(*)::integer as assigned_feed_count
			from group_daily_feeds assigned
			where assigned.group_id = fmt.group_id
			  and assigned.evidence_format_id = fmt.id
		) fmt_feed_counts on true
		where f.group_id = $1
		  and f.enabled
		order by f.name, f.id
	`, group.ID)
	if err != nil {
		return PublicGroup{}, err
	}
	defer rows.Close()

	for rows.Next() {
		var feed PublicGroupFeed
		var feedDescription sql.NullString
		dest := []any{
			&feed.ID,
			&feed.Name,
			&feed.Slug,
			&feed.Kind,
			&feedDescription,
			&feed.Enabled,
			&feed.CaptionsEnabled,
		}
		dest = append(dest, scanEvidenceFormatDest(&feed.EvidenceFormat)...)
		dest = append(dest,
			&feed.Schedule.StartsAt,
			&feed.Schedule.Timezone,
			&feed.Schedule.IntervalSeconds,
			&feed.CreatedAt,
			&feed.UpdatedAt,
		)
		if err := rows.Scan(dest...); err != nil {
			return PublicGroup{}, err
		}
		feed.Description = nullStringPtr(feedDescription)
		group.Feeds = append(group.Feeds, feed)
	}
	return group, rows.Err()
}

func (s *Server) getPublicFeed(ctx context.Context, feedID string, requestedDate *time.Time) (PublicFeed, error) {
	feed, err := s.getDailyFeedByID(ctx, feedID)
	if err != nil {
		return PublicFeed{}, err
	}
	if !feed.Enabled {
		return PublicFeed{}, errNotFound("daily feed")
	}

	group, err := s.getPublicParentGroup(ctx, feed.GroupID)
	if err != nil {
		return PublicFeed{}, err
	}
	if group.Visibility != "public" {
		return PublicFeed{}, errNotFound("daily feed")
	}

	output, err := s.generateDailyFeedOutputForFeed(ctx, feed, requestedDate)
	if err != nil {
		return PublicFeed{}, err
	}
	feedDate, err := parseDailyFeedPathDate(output.Date)
	if err != nil {
		return PublicFeed{}, err
	}

	posts, err := s.listPublicFeedPosts(ctx, feed.ID, feedDate)
	if err != nil {
		return PublicFeed{}, err
	}

	return PublicFeed{
		ID:              feed.ID,
		Group:           group,
		Name:            feed.Name,
		Slug:            feed.Slug,
		Kind:            feed.Kind,
		Description:     feed.Description,
		Enabled:         feed.Enabled,
		CaptionsEnabled: feed.CaptionsEnabled,
		EvidenceFormat:  feed.EvidenceFormat,
		Schedule:        feed.Schedule,
		Date:            output.Date,
		Event:           output.Event,
		Items:           publicFeedOutputItems(output.Items),
		Posts:           posts,
		CreatedAt:       feed.CreatedAt,
		UpdatedAt:       feed.UpdatedAt,
	}, nil
}

func (s *Server) listPublicFeedOutputSummaries(ctx context.Context, feedID string, selectedDate string) ([]DailyFeedOutputSummary, error) {
	feed, err := s.getDailyFeedByID(ctx, feedID)
	if err != nil {
		return nil, err
	}
	if !feed.Enabled {
		return nil, errNotFound("daily feed")
	}

	group, err := s.getPublicParentGroup(ctx, feed.GroupID)
	if err != nil {
		return nil, err
	}
	if group.Visibility != "public" {
		return nil, errNotFound("daily feed")
	}

	return s.listDailyFeedOutputSummariesForFeed(ctx, feed, selectedDate)
}

func (s *Server) getDailyFeedByID(ctx context.Context, feedID string) (DailyFeed, error) {
	feed, err := scanDailyFeed(s.db.QueryRow(ctx, dailyFeedSelectSQL()+`
		where f.id = $1
	`, feedID))
	if errors.Is(err, pgx.ErrNoRows) {
		return DailyFeed{}, errNotFound("daily feed")
	}
	if err != nil {
		return DailyFeed{}, err
	}
	if err := s.hydrateDailyFeedFilters(ctx, &feed); err != nil {
		return DailyFeed{}, err
	}
	return feed, nil
}

func (s *Server) getPublicParentGroup(ctx context.Context, groupID string) (PublicParentGroup, error) {
	var group PublicParentGroup
	err := s.db.QueryRow(ctx, `
		select id::text, name, slug, visibility, join_policy
		from groups
		where id = $1
	`, groupID).Scan(&group.ID, &group.Name, &group.Slug, &group.Visibility, &group.JoinPolicy)
	if errors.Is(err, pgx.ErrNoRows) {
		return PublicParentGroup{}, errNotFound("group")
	}
	return group, err
}

func publicFeedOutputItems(items []DailyFeedOutputItem) []PublicFeedOutputItem {
	publicItems := make([]PublicFeedOutputItem, 0, len(items))
	for _, item := range items {
		publicItems = append(publicItems, PublicFeedOutputItem{
			Position: item.Position,
			Title:    publicFeedOutputTitle(item),
			Action:   publicFeedAction(item.Action),
		})
	}
	return publicItems
}

func publicFeedOutputTitle(item DailyFeedOutputItem) string {
	return firstNonEmptyString(
		item.Item.Title,
		primitivePublicDisplay(item.Item.Data["name"]),
		primitivePublicDisplay(item.Item.Data["title"]),
		"Untitled",
	)
}

func publicFeedAction(action DailyFeedAction) PublicFeedAction {
	switch action.Type {
	case "external_url":
		return PublicFeedAction{
			Type:  "link",
			Label: firstNonEmptyString(action.Label, "Open"),
			URL:   action.URL,
		}
	case "text":
		return PublicFeedAction{
			Type:  "text",
			Label: firstNonEmptyString(action.Label, "Prompt"),
			Text:  action.Text,
		}
	default:
		return PublicFeedAction{
			Type:  "text",
			Label: firstNonEmptyString(action.Label, "Prompt"),
			Text:  action.Text,
		}
	}
}

func primitivePublicDisplay(value any) string {
	switch typed := value.(type) {
	case string:
		return typed
	case int, int64, float64, json.Number:
		return fmt.Sprint(typed)
	default:
		return ""
	}
}

func firstNonEmptyString(values ...string) string {
	for _, value := range values {
		if value != "" {
			return value
		}
	}
	return ""
}

func (s *Server) getPublicPost(ctx context.Context, postID string) (PublicPost, error) {
	post, err := scanPublicPost(s.db.QueryRow(ctx, publicPostSelectSQL()+`
		where p.id = $1
		  and g.visibility = 'public'
		  and p.deleted_at is null
	`, postID))
	if errors.Is(err, pgx.ErrNoRows) {
		return PublicPost{}, errNotFound("feed post")
	}
	if err != nil {
		return PublicPost{}, err
	}
	posts, err := s.hydratePublicPostTags(ctx, []PublicPost{post})
	if err != nil {
		return PublicPost{}, err
	}
	return posts[0], nil
}

func (s *Server) listPublicFeedPosts(ctx context.Context, feedID string, feedDate time.Time) ([]PublicPost, error) {
	rows, err := s.db.Query(ctx, publicPostSelectSQL()+`
		where i.feed_id = $1
		  and i.feed_date = $2
		  and g.visibility = 'public'
		  and p.deleted_at is null
		order by p.created_at desc
	`, feedID, feedDate)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	posts := []PublicPost{}
	for rows.Next() {
		post, err := scanPublicPost(rows)
		if err != nil {
			return nil, err
		}
		posts = append(posts, post)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return s.hydratePublicPostTags(ctx, posts)
}

func publicPostSelectSQL() string {
	return `
		select
			p.id::text,
			g.id::text,
			g.name,
			g.slug,
			g.visibility,
			g.join_policy,
			f.id::text,
			f.name,
			i.feed_date,
			u.id::text,
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
			p.created_at,
			p.updated_at
		from group_feed_posts p
		join group_daily_feed_instances i on i.id = p.feed_instance_id and i.group_id = p.group_id
		join group_daily_feeds f on f.id = i.feed_id and f.group_id = i.group_id
		join groups g on g.id = p.group_id
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

func scanPublicPost(row pgx.Row) (PublicPost, error) {
	var post PublicPost
	var feedDate time.Time
	var authorAvatar sql.NullString
	var caption sql.NullString
	dest := []any{
		&post.ID,
		&post.Group.ID,
		&post.Group.Name,
		&post.Group.Slug,
		&post.Group.Visibility,
		&post.Group.JoinPolicy,
		&post.Feed.ID,
		&post.Feed.Name,
		&feedDate,
		&post.Author.ID,
		&post.Author.Username,
		&post.Author.DisplayName,
		&authorAvatar,
		&post.EvidenceText,
	}
	dest = append(dest, scanEvidenceFormatDest(&post.EvidenceFormat)...)
	dest = append(dest, scanEvidenceFormatVersionDest(&post.EvidenceFormatVersion)...)
	dest = append(dest,
		&caption,
		&post.CreatedAt,
		&post.UpdatedAt,
	)
	if err := row.Scan(dest...); err != nil {
		return PublicPost{}, err
	}
	post.FeedDate = feedDate.Format(dailyFeedDateLayout)
	post.Author.AvatarURL = nullStringPtr(authorAvatar)
	post.Caption = nullStringPtr(caption)
	post.Tags = []PublicPostTag{}
	return post, nil
}

func (s *Server) hydratePublicPostTags(ctx context.Context, posts []PublicPost) ([]PublicPost, error) {
	if len(posts) == 0 {
		return posts, nil
	}

	postIDs := make([]string, 0, len(posts))
	postIndex := map[string]int{}
	for index := range posts {
		posts[index].Tags = []PublicPostTag{}
		postIDs = append(postIDs, posts[index].ID)
		postIndex[posts[index].ID] = index
	}

	rows, err := s.db.Query(ctx, `
		select fpt.post_id::text, t.id::text, t.name
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
		var postID string
		var tag PublicPostTag
		if err := rows.Scan(&postID, &tag.ID, &tag.Name); err != nil {
			return nil, err
		}
		index, ok := postIndex[postID]
		if !ok {
			continue
		}
		posts[index].Tags = append(posts[index].Tags, tag)
	}
	return posts, rows.Err()
}
