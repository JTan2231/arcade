package app

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/binary"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"net/http"
	"net/url"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
)

const dailyFeedDateLayout = "2006-01-02"

var templateFieldPattern = regexp.MustCompile(`\{([A-Za-z0-9_]+)\}`)

type createDailyFeedRequest struct {
	Name        string             `json:"name"`
	Slug        string             `json:"slug"`
	Description *string            `json:"description"`
	Enabled     *bool              `json:"enabled"`
	Audience    *DailyFeedAudience `json:"audience"`
	Schedule    *DailyFeedSchedule `json:"schedule"`
	Rules       DailyFeedRules     `json:"rules"`
}

type patchDailyFeedRequest struct {
	Name        *string            `json:"name"`
	Slug        *string            `json:"slug"`
	Description *string            `json:"description"`
	Enabled     *bool              `json:"enabled"`
	Audience    *DailyFeedAudience `json:"audience"`
	Schedule    *DailyFeedSchedule `json:"schedule"`
	Rules       *DailyFeedRules    `json:"rules"`
}

type dailySourceResolver struct {
	DefaultAction         dailySourceAction `json:"default_action"`
	RequiredLocatorFields []string          `json:"required_locator_fields"`
}

type dailySourceAction struct {
	Type     string `json:"type"`
	Label    string `json:"label"`
	Template string `json:"template"`
	Field    string `json:"field"`
}

type dailyCatalogCandidate struct {
	ID         string
	Source     string
	ExternalID string
	Kind       string
	Title      string
	Locator    map[string]any
	Metadata   map[string]any
	Resolver   dailySourceResolver
	Action     DailyFeedAction
}

func (s *Server) handleListGroupDailyFeeds(w http.ResponseWriter, r *http.Request) {
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

	feeds, err := s.listGroupDailyFeeds(r.Context(), groupID)
	if err != nil {
		handleError(w, err)
		return
	}

	visible := make([]DailyFeed, 0, len(feeds))
	for _, feed := range feeds {
		if canManageDailyFeeds(role) {
			visible = append(visible, feed)
			continue
		}
		ok, err := s.dailyFeedAudienceMatches(r.Context(), current.ID, feed)
		if err != nil {
			handleError(w, err)
			return
		}
		if feed.Enabled && ok {
			visible = append(visible, feed)
		}
	}

	writeJSON(w, http.StatusOK, visible)
}

func (s *Server) handleCreateGroupDailyFeed(w http.ResponseWriter, r *http.Request) {
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

	var req createDailyFeedRequest
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid JSON request")
		return
	}

	req.Name = strings.TrimSpace(req.Name)
	if req.Name == "" {
		writeError(w, http.StatusBadRequest, "name is required")
		return
	}
	if req.Slug == "" {
		req.Slug = slugify(req.Name)
	} else {
		req.Slug = slugify(req.Slug)
	}

	audience := defaultDailyFeedAudience(req.Audience)
	if err := s.validateDailyFeedAudience(r.Context(), groupID, audience); err != nil {
		handleError(w, err)
		return
	}

	schedule, err := normalizeDailyFeedSchedule(req.Schedule)
	if err != nil {
		handleError(w, err)
		return
	}

	rules, err := s.normalizeDailyFeedRules(r.Context(), req.Rules)
	if err != nil {
		handleError(w, err)
		return
	}

	audienceJSON, err := dailyFeedJSONParam(audience)
	if err != nil {
		handleError(w, err)
		return
	}
	scheduleJSON, err := dailyFeedJSONParam(schedule)
	if err != nil {
		handleError(w, err)
		return
	}
	rulesJSON, err := dailyFeedJSONParam(rules)
	if err != nil {
		handleError(w, err)
		return
	}

	enabled := true
	if req.Enabled != nil {
		enabled = *req.Enabled
	}

	var feedID string
	err = s.db.QueryRow(r.Context(), `
		insert into group_daily_feeds (
			group_id,
			name,
			slug,
			description,
			enabled,
			audience,
			schedule,
			rules_schema_version,
			rules,
			created_by_user_id
		)
		values ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, 1, $8::jsonb, $9)
		returning id::text
	`, groupID, req.Name, req.Slug, req.Description, enabled, audienceJSON, scheduleJSON, rulesJSON, current.ID).Scan(&feedID)
	if err != nil {
		handleError(w, err)
		return
	}

	feed, err := s.getGroupDailyFeed(r.Context(), groupID, feedID)
	if err != nil {
		handleError(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, feed)
}

func (s *Server) handleGetGroupDailyFeed(w http.ResponseWriter, r *http.Request) {
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

	feed, err := s.getGroupDailyFeed(r.Context(), groupID, r.PathValue("feed_id"))
	if err != nil {
		handleError(w, err)
		return
	}
	if !canManageDailyFeeds(role) {
		ok, err := s.dailyFeedAudienceMatches(r.Context(), current.ID, feed)
		if err != nil {
			handleError(w, err)
			return
		}
		if !feed.Enabled || !ok {
			handleError(w, errNotFound("daily feed"))
			return
		}
	}

	writeJSON(w, http.StatusOK, feed)
}

func (s *Server) handlePatchGroupDailyFeed(w http.ResponseWriter, r *http.Request) {
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

	var req patchDailyFeedRequest
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid JSON request")
		return
	}

	var name any
	if req.Name != nil {
		trimmed := strings.TrimSpace(*req.Name)
		if trimmed == "" {
			writeError(w, http.StatusBadRequest, "name cannot be empty")
			return
		}
		name = trimmed
	}

	var slug any
	if req.Slug != nil {
		slug = slugify(*req.Slug)
	}

	var audienceJSON any
	if req.Audience != nil {
		audience := defaultDailyFeedAudience(req.Audience)
		if err := s.validateDailyFeedAudience(r.Context(), groupID, audience); err != nil {
			handleError(w, err)
			return
		}
		value, err := dailyFeedJSONParam(audience)
		if err != nil {
			handleError(w, err)
			return
		}
		audienceJSON = value
	}

	var scheduleJSON any
	if req.Schedule != nil {
		schedule, err := normalizeDailyFeedSchedule(req.Schedule)
		if err != nil {
			handleError(w, err)
			return
		}
		value, err := dailyFeedJSONParam(schedule)
		if err != nil {
			handleError(w, err)
			return
		}
		scheduleJSON = value
	}

	var rulesJSON any
	if req.Rules != nil {
		rules, err := s.normalizeDailyFeedRules(r.Context(), *req.Rules)
		if err != nil {
			handleError(w, err)
			return
		}
		value, err := dailyFeedJSONParam(rules)
		if err != nil {
			handleError(w, err)
			return
		}
		rulesJSON = value
	}

	tag, err := s.db.Exec(r.Context(), `
		update group_daily_feeds
		set name = coalesce($3, name),
		    slug = coalesce($4, slug),
		    description = coalesce($5, description),
		    enabled = coalesce($6, enabled),
		    audience = coalesce($7::jsonb, audience),
		    schedule = coalesce($8::jsonb, schedule),
		    rules = coalesce($9::jsonb, rules),
		    rules_schema_version = case when $9::jsonb is null then rules_schema_version else 1 end
		where group_id = $1 and id = $2
	`, groupID, r.PathValue("feed_id"), name, slug, req.Description, req.Enabled, audienceJSON, scheduleJSON, rulesJSON)
	if err != nil {
		handleError(w, err)
		return
	}
	if tag.RowsAffected() == 0 {
		handleError(w, errNotFound("daily feed"))
		return
	}

	feed, err := s.getGroupDailyFeed(r.Context(), groupID, r.PathValue("feed_id"))
	if err != nil {
		handleError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, feed)
}

func (s *Server) handleDeleteGroupDailyFeed(w http.ResponseWriter, r *http.Request) {
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
		delete from group_daily_feeds
		where group_id = $1 and id = $2
	`, groupID, r.PathValue("feed_id"))
	if err != nil {
		handleError(w, err)
		return
	}
	if tag.RowsAffected() == 0 {
		handleError(w, errNotFound("daily feed"))
		return
	}

	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) handleGetGroupDailyFeedToday(w http.ResponseWriter, r *http.Request) {
	current, err := requireUser(r.Context())
	if err != nil {
		handleError(w, err)
		return
	}

	output, err := s.generateDailyFeedOutput(r.Context(), current.ID, r.PathValue("group_id"), r.PathValue("feed_id"), nil)
	if err != nil {
		handleError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, output)
}

func (s *Server) handleGetGroupDailyFeedOutput(w http.ResponseWriter, r *http.Request) {
	current, err := requireUser(r.Context())
	if err != nil {
		handleError(w, err)
		return
	}

	date, err := time.Parse(dailyFeedDateLayout, r.PathValue("date"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "date must use YYYY-MM-DD")
		return
	}

	output, err := s.generateDailyFeedOutput(r.Context(), current.ID, r.PathValue("group_id"), r.PathValue("feed_id"), &date)
	if err != nil {
		handleError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, output)
}

func (s *Server) handleListMeDailyFeeds(w http.ResponseWriter, r *http.Request) {
	current, err := requireUser(r.Context())
	if err != nil {
		handleError(w, err)
		return
	}

	feeds, err := s.listMeDailyFeeds(r.Context(), current.ID)
	if err != nil {
		handleError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, feeds)
}

func (s *Server) handleListMeDailyFeedOutputs(w http.ResponseWriter, r *http.Request) {
	current, err := requireUser(r.Context())
	if err != nil {
		handleError(w, err)
		return
	}

	feeds, err := s.listMeDailyFeeds(r.Context(), current.ID)
	if err != nil {
		handleError(w, err)
		return
	}

	outputs := make([]DailyFeedOutput, 0, len(feeds))
	for _, feed := range feeds {
		output, err := s.generateDailyFeedOutputForFeed(r.Context(), feed, nil)
		if err != nil {
			handleError(w, err)
			return
		}
		outputs = append(outputs, output)
	}

	writeJSON(w, http.StatusOK, outputs)
}

func (s *Server) listGroupDailyFeeds(ctx context.Context, groupID string) ([]DailyFeed, error) {
	rows, err := s.db.Query(ctx, `
		select
			f.id::text,
			f.group_id::text,
			g.name,
			f.name,
			f.slug,
			f.description,
			f.enabled,
			f.audience,
			f.schedule,
			f.rules_schema_version,
			f.rules,
			f.created_by_user_id::text,
			f.created_at,
			f.updated_at
		from group_daily_feeds f
		join groups g on g.id = f.group_id
		where f.group_id = $1
		order by f.name
	`, groupID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	feeds := []DailyFeed{}
	for rows.Next() {
		feed, err := scanDailyFeed(rows)
		if err != nil {
			return nil, err
		}
		feeds = append(feeds, feed)
	}
	return feeds, rows.Err()
}

func (s *Server) listMeDailyFeeds(ctx context.Context, userID string) ([]DailyFeed, error) {
	rows, err := s.db.Query(ctx, `
		select
			f.id::text,
			f.group_id::text,
			g.name,
			f.name,
			f.slug,
			f.description,
			f.enabled,
			f.audience,
			f.schedule,
			f.rules_schema_version,
			f.rules,
			f.created_by_user_id::text,
			f.created_at,
			f.updated_at
		from group_daily_feeds f
		join groups g on g.id = f.group_id
		join group_memberships gm on gm.group_id = f.group_id
		where gm.user_id = $1
		  and gm.status = 'active'
		  and f.enabled
		order by g.name, f.name
	`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	feeds := []DailyFeed{}
	for rows.Next() {
		feed, err := scanDailyFeed(rows)
		if err != nil {
			return nil, err
		}
		ok, err := s.dailyFeedAudienceMatches(ctx, userID, feed)
		if err != nil {
			return nil, err
		}
		if ok {
			feeds = append(feeds, feed)
		}
	}
	return feeds, rows.Err()
}

func (s *Server) getGroupDailyFeed(ctx context.Context, groupID string, feedID string) (DailyFeed, error) {
	feed, err := scanDailyFeed(s.db.QueryRow(ctx, `
		select
			f.id::text,
			f.group_id::text,
			g.name,
			f.name,
			f.slug,
			f.description,
			f.enabled,
			f.audience,
			f.schedule,
			f.rules_schema_version,
			f.rules,
			f.created_by_user_id::text,
			f.created_at,
			f.updated_at
		from group_daily_feeds f
		join groups g on g.id = f.group_id
		where f.group_id = $1 and f.id = $2
	`, groupID, feedID))
	if errors.Is(err, pgx.ErrNoRows) {
		return DailyFeed{}, errNotFound("daily feed")
	}
	return feed, err
}

func scanDailyFeed(row pgx.Row) (DailyFeed, error) {
	var feed DailyFeed
	var groupName sql.NullString
	var description sql.NullString
	var createdByUserID sql.NullString
	var audienceJSON []byte
	var scheduleJSON []byte
	var rulesJSON []byte
	if err := row.Scan(
		&feed.ID,
		&feed.GroupID,
		&groupName,
		&feed.Name,
		&feed.Slug,
		&description,
		&feed.Enabled,
		&audienceJSON,
		&scheduleJSON,
		&feed.RulesSchemaVersion,
		&rulesJSON,
		&createdByUserID,
		&feed.CreatedAt,
		&feed.UpdatedAt,
	); err != nil {
		return DailyFeed{}, err
	}
	if err := json.Unmarshal(audienceJSON, &feed.Audience); err != nil {
		return DailyFeed{}, fmt.Errorf("decode daily feed audience: %w", err)
	}
	if err := json.Unmarshal(scheduleJSON, &feed.Schedule); err != nil {
		return DailyFeed{}, fmt.Errorf("decode daily feed schedule: %w", err)
	}
	if err := json.Unmarshal(rulesJSON, &feed.Rules); err != nil {
		return DailyFeed{}, fmt.Errorf("decode daily feed rules: %w", err)
	}
	feed.GroupName = nullStringPtr(groupName)
	feed.Description = nullStringPtr(description)
	feed.CreatedByUserID = nullStringPtr(createdByUserID)
	return feed, nil
}

func (s *Server) generateDailyFeedOutput(ctx context.Context, userID string, groupID string, feedID string, requestedDate *time.Time) (DailyFeedOutput, error) {
	role, err := s.activeGroupRole(ctx, userID, groupID)
	if err != nil {
		return DailyFeedOutput{}, err
	}

	feed, err := s.getGroupDailyFeed(ctx, groupID, feedID)
	if err != nil {
		return DailyFeedOutput{}, err
	}

	if !feed.Enabled && !canManageDailyFeeds(role) {
		return DailyFeedOutput{}, errNotFound("daily feed")
	}

	ok, err := s.dailyFeedAudienceMatches(ctx, userID, feed)
	if err != nil {
		return DailyFeedOutput{}, err
	}
	if !ok {
		return DailyFeedOutput{}, forbidden("daily feed audience required")
	}

	return s.generateDailyFeedOutputForFeed(ctx, feed, requestedDate)
}

func (s *Server) generateDailyFeedOutputForFeed(ctx context.Context, feed DailyFeed, requestedDate *time.Time) (DailyFeedOutput, error) {
	date, err := dailyFeedOutputDate(feed.Schedule, requestedDate)
	if err != nil {
		return DailyFeedOutput{}, err
	}
	dateString := date.Format(dailyFeedDateLayout)

	output := DailyFeedOutput{
		FeedID:    feed.ID,
		GroupID:   feed.GroupID,
		GroupName: feed.GroupName,
		Date:      dateString,
		Title:     feed.Name,
		Items:     []DailyFeedOutputItem{},
	}
	selected := map[string]bool{}

	for blockIndex, block := range feed.Rules.Blocks {
		candidates, err := s.dailyCatalogCandidates(ctx, block.Source, block.Kind)
		if err != nil {
			return DailyFeedOutput{}, err
		}

		matching := make([]dailyCatalogCandidate, 0, len(candidates))
		for _, candidate := range candidates {
			if selected[candidate.ID] || !dailyCandidateMatchesBlock(candidate, block) {
				continue
			}
			action, ok := resolveDailyAction(candidate)
			if !ok {
				continue
			}
			candidate.Action = action
			matching = append(matching, candidate)
		}

		target := dailyBlockTargetRating(block)
		sortDailyCandidates(matching, feed.ID, dateString, blockIndex, target)
		if len(matching) < block.Count {
			return DailyFeedOutput{}, statusError{
				status:  http.StatusUnprocessableEntity,
				message: fmt.Sprintf("daily feed block %d could select only %d of %d items", blockIndex+1, len(matching), block.Count),
			}
		}

		for localIndex, candidate := range matching[:block.Count] {
			selected[candidate.ID] = true
			role := dailyFeedRole(localIndex, block.Count, block.Roles)
			points := dailyFeedPoints(localIndex, block.Points)
			output.Items = append(output.Items, DailyFeedOutputItem{
				Position: len(output.Items) + 1,
				Role:     role,
				Points:   points,
				Reason:   dailyFeedReason(candidate, block, role),
				Item: DailyCatalogItem{
					ID:         candidate.ID,
					Source:     candidate.Source,
					ExternalID: candidate.ExternalID,
					Kind:       candidate.Kind,
					Title:      candidate.Title,
					Metadata:   candidate.Metadata,
				},
				Action: candidate.Action,
			})
		}
	}

	return output, nil
}

func (s *Server) dailyCatalogCandidates(ctx context.Context, source string, kind string) ([]dailyCatalogCandidate, error) {
	rows, err := s.db.Query(ctx, `
		select
			ci.id::text,
			src.slug,
			ci.external_id,
			ci.kind,
			ci.title,
			ci.locator,
			ci.metadata,
			src.resolver
		from catalog_items ci
		join item_sources src on src.id = ci.source_id
		where src.slug = $1 and ci.kind = $2
	`, source, kind)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	candidates := []dailyCatalogCandidate{}
	for rows.Next() {
		var candidate dailyCatalogCandidate
		var locatorJSON []byte
		var metadataJSON []byte
		var resolverJSON []byte
		if err := rows.Scan(
			&candidate.ID,
			&candidate.Source,
			&candidate.ExternalID,
			&candidate.Kind,
			&candidate.Title,
			&locatorJSON,
			&metadataJSON,
			&resolverJSON,
		); err != nil {
			return nil, err
		}
		if err := json.Unmarshal(locatorJSON, &candidate.Locator); err != nil {
			return nil, fmt.Errorf("decode catalog item locator: %w", err)
		}
		if err := json.Unmarshal(metadataJSON, &candidate.Metadata); err != nil {
			return nil, fmt.Errorf("decode catalog item metadata: %w", err)
		}
		if err := json.Unmarshal(resolverJSON, &candidate.Resolver); err != nil {
			return nil, fmt.Errorf("decode item source resolver: %w", err)
		}
		candidates = append(candidates, candidate)
	}
	return candidates, rows.Err()
}

func dailyCandidateMatchesBlock(candidate dailyCatalogCandidate, block DailyFeedRuleBlock) bool {
	if block.Filters.Rating != nil {
		rating := dailyMetadataInt(candidate.Metadata, "rating")
		if block.Filters.Rating.Min != nil && (rating == nil || *rating < *block.Filters.Rating.Min) {
			return false
		}
		if block.Filters.Rating.Max != nil && (rating == nil || *rating > *block.Filters.Rating.Max) {
			return false
		}
	}

	if block.Filters.Tags != nil {
		tags := dailyMetadataStrings(candidate.Metadata, "tags")
		if len(block.Filters.Tags.IncludeAny) > 0 && !stringSetsOverlap(tags, block.Filters.Tags.IncludeAny) {
			return false
		}
		if len(block.Filters.Tags.ExcludeAny) > 0 && stringSetsOverlap(tags, block.Filters.Tags.ExcludeAny) {
			return false
		}
	}

	return true
}

func sortDailyCandidates(candidates []dailyCatalogCandidate, feedID string, date string, blockIndex int, target *int) {
	sort.SliceStable(candidates, func(i, j int) bool {
		if target != nil {
			leftRating := dailyMetadataInt(candidates[i].Metadata, "rating")
			rightRating := dailyMetadataInt(candidates[j].Metadata, "rating")
			leftDistance := ratingDistance(leftRating, *target)
			rightDistance := ratingDistance(rightRating, *target)
			if leftDistance != rightDistance {
				return leftDistance < rightDistance
			}
		}

		leftHash := stableDailyHash(feedID, date, blockIndex, candidates[i].ID)
		rightHash := stableDailyHash(feedID, date, blockIndex, candidates[j].ID)
		if leftHash != rightHash {
			return leftHash < rightHash
		}
		return candidates[i].ID < candidates[j].ID
	})
}

func stableDailyHash(feedID string, date string, blockIndex int, itemID string) uint64 {
	sum := sha256.Sum256([]byte(feedID + "\x00" + date + "\x00" + strconv.Itoa(blockIndex) + "\x00" + itemID))
	return binary.BigEndian.Uint64(sum[:8])
}

func ratingDistance(rating *int, target int) int {
	if rating == nil {
		return math.MaxInt
	}
	if *rating > target {
		return *rating - target
	}
	return target - *rating
}

func resolveDailyAction(candidate dailyCatalogCandidate) (DailyFeedAction, bool) {
	resolver := candidate.Resolver
	for _, field := range resolver.RequiredLocatorFields {
		if value, ok := locatorString(candidate.Locator, field); !ok || strings.TrimSpace(value) == "" {
			return DailyFeedAction{}, false
		}
	}

	action := resolver.DefaultAction
	if action.Type != "external_url" {
		return DailyFeedAction{}, false
	}

	label := strings.TrimSpace(action.Label)
	if label == "" {
		label = "Open"
	}

	var rawURL string
	switch {
	case action.Template != "":
		var missing bool
		rawURL = templateFieldPattern.ReplaceAllStringFunc(action.Template, func(match string) string {
			field := strings.TrimSuffix(strings.TrimPrefix(match, "{"), "}")
			value, ok := locatorString(candidate.Locator, field)
			if !ok || strings.TrimSpace(value) == "" {
				missing = true
				return ""
			}
			return url.PathEscape(value)
		})
		if missing {
			return DailyFeedAction{}, false
		}
	case action.Field != "":
		value, ok := locatorString(candidate.Locator, action.Field)
		if !ok {
			return DailyFeedAction{}, false
		}
		rawURL = value
	default:
		return DailyFeedAction{}, false
	}

	if !validDailyExternalURL(rawURL) {
		return DailyFeedAction{}, false
	}

	return DailyFeedAction{
		Type:  "external_url",
		Label: label,
		URL:   rawURL,
	}, true
}

func validDailyExternalURL(rawURL string) bool {
	parsed, err := url.Parse(rawURL)
	return err == nil && parsed.Scheme == "https" && parsed.Host != ""
}

func locatorString(locator map[string]any, key string) (string, bool) {
	value, ok := locator[key]
	if !ok || value == nil {
		return "", false
	}
	switch typed := value.(type) {
	case string:
		return typed, true
	case float64:
		if typed == math.Trunc(typed) {
			return strconv.FormatInt(int64(typed), 10), true
		}
		return strconv.FormatFloat(typed, 'f', -1, 64), true
	default:
		return fmt.Sprint(typed), true
	}
}

func dailyMetadataInt(metadata map[string]any, key string) *int {
	value, ok := metadata[key]
	if !ok || value == nil {
		return nil
	}
	switch typed := value.(type) {
	case int:
		return &typed
	case int64:
		converted := int(typed)
		return &converted
	case float64:
		converted := int(typed)
		if float64(converted) == typed {
			return &converted
		}
	case json.Number:
		parsed, err := typed.Int64()
		if err == nil {
			converted := int(parsed)
			return &converted
		}
	}
	return nil
}

func dailyMetadataStrings(metadata map[string]any, key string) []string {
	value, ok := metadata[key]
	if !ok || value == nil {
		return nil
	}
	values := []string{}
	switch typed := value.(type) {
	case []string:
		values = append(values, typed...)
	case []any:
		for _, item := range typed {
			if tag, ok := item.(string); ok {
				values = append(values, strings.ToLower(tag))
			}
		}
	}
	return values
}

func stringSetsOverlap(left []string, right []string) bool {
	if len(left) == 0 || len(right) == 0 {
		return false
	}
	seen := map[string]bool{}
	for _, value := range left {
		seen[strings.ToLower(value)] = true
	}
	for _, value := range right {
		if seen[strings.ToLower(value)] {
			return true
		}
	}
	return false
}

func dailyBlockTargetRating(block DailyFeedRuleBlock) *int {
	if block.Filters.Rating == nil {
		return nil
	}
	return block.Filters.Rating.Target
}

func dailyFeedRole(index int, count int, roles []string) string {
	if index < len(roles) {
		return roles[index]
	}
	if count == 1 {
		return "target"
	}
	switch index {
	case 0:
		return "warmup"
	case 1:
		return "target"
	case 2:
		return "stretch"
	default:
		return "bonus"
	}
}

func dailyFeedPoints(index int, points []int) int {
	if index < len(points) {
		return points[index]
	}
	return 1
}

func dailyFeedReason(candidate dailyCatalogCandidate, block DailyFeedRuleBlock, role string) string {
	if target := dailyBlockTargetRating(block); target != nil {
		if rating := dailyMetadataInt(candidate.Metadata, "rating"); rating != nil {
			return fmt.Sprintf("%s pick, rating %d within %d of target", role, *rating, ratingDistance(rating, *target))
		}
	}

	if block.Filters.Tags != nil && len(block.Filters.Tags.IncludeAny) > 0 {
		tags := dailyMetadataStrings(candidate.Metadata, "tags")
		for _, tag := range block.Filters.Tags.IncludeAny {
			if stringSetsOverlap(tags, []string{tag}) {
				return fmt.Sprintf("%s pick from %s tag", role, tag)
			}
		}
	}

	return "selected by deterministic date rotation"
}

func dailyFeedOutputDate(schedule DailyFeedSchedule, requestedDate *time.Time) (time.Time, error) {
	if requestedDate != nil {
		return *requestedDate, nil
	}

	timezone := schedule.Timezone
	if timezone == "" {
		timezone = "UTC"
	}
	location, err := time.LoadLocation(timezone)
	if err != nil {
		return time.Time{}, badRequest("schedule timezone is invalid")
	}
	now := time.Now().In(location)
	return time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, location), nil
}

func defaultDailyFeedAudience(audience *DailyFeedAudience) DailyFeedAudience {
	if audience == nil || audience.Type == "" {
		return DailyFeedAudience{Type: "all_group_members"}
	}
	normalized := *audience
	if normalized.Type == "all_group_members" {
		normalized.DivisionID = nil
	}
	return normalized
}

func normalizeDailyFeedSchedule(schedule *DailyFeedSchedule) (DailyFeedSchedule, error) {
	if schedule == nil {
		return DailyFeedSchedule{Cadence: "daily", Timezone: "UTC"}, nil
	}
	normalized := *schedule
	if normalized.Cadence == "" {
		normalized.Cadence = "daily"
	}
	if normalized.Timezone == "" {
		normalized.Timezone = "UTC"
	}
	if normalized.Cadence != "daily" {
		return DailyFeedSchedule{}, badRequest("schedule cadence must be daily")
	}
	if _, err := time.LoadLocation(normalized.Timezone); err != nil {
		return DailyFeedSchedule{}, badRequest("schedule timezone is invalid")
	}
	return normalized, nil
}

func (s *Server) validateDailyFeedAudience(ctx context.Context, groupID string, audience DailyFeedAudience) error {
	switch audience.Type {
	case "all_group_members":
		return nil
	case "division":
		if audience.DivisionID == nil || *audience.DivisionID == "" {
			return badRequest("division audience requires division_id")
		}
		var exists bool
		if err := s.db.QueryRow(ctx, `
			select exists (
				select 1
				from divisions
				where id = $1 and group_id = $2
			)
		`, *audience.DivisionID, groupID).Scan(&exists); err != nil {
			return err
		}
		if !exists {
			return errNotFound("division")
		}
		return nil
	default:
		return badRequest("audience type must be all_group_members or division")
	}
}

func (s *Server) dailyFeedAudienceMatches(ctx context.Context, userID string, feed DailyFeed) (bool, error) {
	switch feed.Audience.Type {
	case "", "all_group_members":
		return true, nil
	case "division":
		if feed.Audience.DivisionID == nil || *feed.Audience.DivisionID == "" {
			return false, nil
		}
		var exists bool
		err := s.db.QueryRow(ctx, `
			select exists (
				select 1
				from divisions d
				join group_memberships gm on gm.group_id = d.group_id
				where d.id = $1
				  and d.group_id = $2
				  and gm.user_id = $3
				  and gm.status = 'active'
			)
		`, *feed.Audience.DivisionID, feed.GroupID, userID).Scan(&exists)
		return exists, err
	default:
		return false, nil
	}
}

func (s *Server) normalizeDailyFeedRules(ctx context.Context, rules DailyFeedRules) (DailyFeedRules, error) {
	if len(rules.Blocks) == 0 {
		return DailyFeedRules{}, badRequest("rules.blocks is required")
	}

	for blockIndex := range rules.Blocks {
		block := &rules.Blocks[blockIndex]
		block.Source = slugify(block.Source)
		block.Kind = strings.TrimSpace(block.Kind)
		if block.Source == "" || block.Source == "untitled" {
			return DailyFeedRules{}, badRequest("rule block source is required")
		}
		if block.Kind == "" {
			return DailyFeedRules{}, badRequest("rule block kind is required")
		}
		if block.Count < 1 || block.Count > 50 {
			return DailyFeedRules{}, badRequest("rule block count must be between 1 and 50")
		}

		if ok, err := s.itemSourceExists(ctx, block.Source); err != nil {
			return DailyFeedRules{}, err
		} else if !ok {
			return DailyFeedRules{}, errNotFound("item source")
		}

		if block.Filters.Rating != nil && block.Filters.Rating.Min != nil && block.Filters.Rating.Max != nil && *block.Filters.Rating.Min > *block.Filters.Rating.Max {
			return DailyFeedRules{}, badRequest("rating min cannot exceed max")
		}

		if block.Filters.Tags != nil {
			block.Filters.Tags.IncludeAny = cleanTags(block.Filters.Tags.IncludeAny)
			block.Filters.Tags.ExcludeAny = cleanTags(block.Filters.Tags.ExcludeAny)
		}

		if len(block.Roles) > 0 {
			if len(block.Roles) < block.Count {
				return DailyFeedRules{}, badRequest("roles must include at least count entries")
			}
			for _, role := range block.Roles {
				if !validDailyFeedRole(role) {
					return DailyFeedRules{}, badRequest("roles must be warmup, target, stretch, or bonus")
				}
			}
		}

		if len(block.Points) > 0 {
			if len(block.Points) < block.Count {
				return DailyFeedRules{}, badRequest("points must include at least count entries")
			}
			for _, points := range block.Points {
				if points < 1 {
					return DailyFeedRules{}, badRequest("points must be positive")
				}
			}
		}
	}

	return rules, nil
}

func (s *Server) itemSourceExists(ctx context.Context, slug string) (bool, error) {
	var exists bool
	err := s.db.QueryRow(ctx, `select exists(select 1 from item_sources where slug = $1)`, slug).Scan(&exists)
	return exists, err
}

func validDailyFeedRole(role string) bool {
	switch role {
	case "warmup", "target", "stretch", "bonus":
		return true
	default:
		return false
	}
}

func canManageDailyFeeds(role string) bool {
	return role == "owner" || role == "admin"
}

func dailyFeedJSONParam(value any) (string, error) {
	encoded, err := json.Marshal(value)
	if err != nil {
		return "", err
	}
	return string(encoded), nil
}
