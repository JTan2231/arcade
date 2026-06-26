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
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
)

const (
	dailyFeedDateLayout        = "2006-01-02"
	dailyFeedKindCatalogDaily  = "catalog_daily"
	dailyFeedKindDailyThread   = "daily_thread"
	defaultDailyThreadFeedName = "Daily Thread"
	defaultDailyThreadFeedSlug = "daily-thread"
)

var templateFieldPattern = regexp.MustCompile(`\{([A-Za-z0-9_]+)\}`)

type createDailyFeedRequest struct {
	Name        string                `json:"name"`
	Slug        string                `json:"slug"`
	Kind        string                `json:"kind"`
	Description *string               `json:"description"`
	Enabled     *bool                 `json:"enabled"`
	SourceID    string                `json:"source_id"`
	ItemCount   int                   `json:"item_count"`
	Schedule    *DailyFeedSchedule    `json:"schedule"`
	Filters     []DailyFeedRuleFilter `json:"filters"`
}

type patchDailyFeedRequest struct {
	Name        optionalStringField           `json:"name"`
	Slug        optionalStringField           `json:"slug"`
	Description optionalNullableStringField   `json:"description"`
	Enabled     *bool                         `json:"enabled"`
	SourceID    optionalStringField           `json:"source_id"`
	ItemCount   optionalIntField              `json:"item_count"`
	Schedule    *DailyFeedSchedule            `json:"schedule"`
	Filters     optionalDailyFeedFiltersField `json:"filters"`
}

type optionalIntField struct {
	Set   bool
	Value int
}

func (field *optionalIntField) UnmarshalJSON(data []byte) error {
	field.Set = true
	if strings.TrimSpace(string(data)) == "null" {
		return errors.New("field must be an integer")
	}
	return json.Unmarshal(data, &field.Value)
}

type optionalDailyFeedFiltersField struct {
	Set   bool
	Value []DailyFeedRuleFilter
}

func (field *optionalDailyFeedFiltersField) UnmarshalJSON(data []byte) error {
	field.Set = true
	if strings.TrimSpace(string(data)) == "null" {
		field.Value = nil
		return nil
	}
	return json.Unmarshal(data, &field.Value)
}

type normalizedDailyFeedInput struct {
	Name        string
	Slug        string
	Kind        string
	Description *string
	Enabled     bool
	SourceID    *string
	ItemCount   *int
	Schedule    DailyFeedSchedule
	Filters     []DailyFeedRuleFilter
}

type dailyCatalogCandidate struct {
	ID            string
	SourceID      string
	SourceName    string
	Title         string
	Data          map[string]any
	Rendered      string
	MissingFields []string
	Action        DailyFeedAction
}

type dailyFeedSelection struct {
	Output              DailyFeedOutput
	CandidateItemCount  int
	EligibleItemCount   int
	IneligibleItemCount int
	IneligibleItems     []CatalogItemEligibility
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
		if canManageDailyFeeds(role) || feed.Enabled {
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

	input, err := s.normalizeCreateDailyFeed(r.Context(), groupID, req)
	if err != nil {
		handleError(w, err)
		return
	}

	if input.Enabled && input.Kind == dailyFeedKindCatalogDaily {
		if err := s.validatePracticeFeedReady(r.Context(), *input.SourceID, *input.ItemCount, input.Filters); err != nil {
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

	var feedID string
	err = tx.QueryRow(r.Context(), `
		insert into group_daily_feeds (
			group_id,
			name,
			slug,
			kind,
			description,
			enabled,
			source_id,
			item_count,
			schedule_starts_at,
			schedule_timezone,
			schedule_interval_seconds,
			created_by_user_id
		)
		values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
		returning id::text
	`, groupID, input.Name, input.Slug, input.Kind, input.Description, input.Enabled, input.SourceID, input.ItemCount, input.Schedule.StartsAt, input.Schedule.Timezone, input.Schedule.IntervalSeconds, current.ID).Scan(&feedID)
	if err != nil {
		handleError(w, err)
		return
	}

	if input.Kind == dailyFeedKindCatalogDaily {
		if err := insertDailyFeedFilters(r.Context(), tx, feedID, *input.SourceID, input.Filters); err != nil {
			handleError(w, err)
			return
		}
	}

	if err := tx.Commit(r.Context()); err != nil {
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

func (s *Server) handlePreviewGroupDailyFeed(w http.ResponseWriter, r *http.Request) {
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
	req.Kind = dailyFeedKindCatalogDaily
	if strings.TrimSpace(req.Name) == "" {
		req.Name = "Daily Practice"
	}

	input, err := s.normalizeCreateDailyFeed(r.Context(), groupID, req)
	if err != nil {
		handleError(w, err)
		return
	}

	feed := DailyFeed{
		ID:        "preview",
		GroupID:   groupID,
		Name:      input.Name,
		Slug:      input.Slug,
		Kind:      input.Kind,
		Enabled:   true,
		SourceID:  input.SourceID,
		ItemCount: input.ItemCount,
		Schedule:  input.Schedule,
		Filters:   input.Filters,
	}
	selection, err := s.selectDailyFeedItems(r.Context(), feed, nil, false)
	if err != nil {
		handleError(w, err)
		return
	}

	writeJSON(w, http.StatusOK, DailyFeedPreview{
		Output:              selection.Output,
		CandidateItemCount:  selection.CandidateItemCount,
		EligibleItemCount:   selection.EligibleItemCount,
		IneligibleItemCount: selection.IneligibleItemCount,
		IneligibleItems:     selection.IneligibleItems,
	})
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
	if !canManageDailyFeeds(role) && !feed.Enabled {
		handleError(w, errNotFound("daily feed"))
		return
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

	currentFeed, err := s.getGroupDailyFeed(r.Context(), groupID, r.PathValue("feed_id"))
	if err != nil {
		handleError(w, err)
		return
	}

	name := currentFeed.Name
	if req.Name.Set {
		name = strings.TrimSpace(req.Name.Value)
		if name == "" {
			writeError(w, http.StatusBadRequest, "name cannot be empty")
			return
		}
	}

	slug := currentFeed.Slug
	if req.Slug.Set {
		slug = slugify(req.Slug.Value)
	}

	descriptionSet := req.Description.Set
	description := currentFeed.Description
	if req.Description.Set {
		description = trimOptionalString(req.Description.Value)
	}

	enabled := currentFeed.Enabled
	if req.Enabled != nil {
		enabled = *req.Enabled
	}

	schedule := currentFeed.Schedule
	if req.Schedule != nil {
		normalized, err := normalizeDailyFeedSchedule(req.Schedule)
		if err != nil {
			handleError(w, err)
			return
		}
		schedule = normalized
	}

	sourceID := currentFeed.SourceID
	itemCount := currentFeed.ItemCount
	filters := currentFeed.Filters

	if currentFeed.Kind == dailyFeedKindDailyThread {
		if req.SourceID.Set || req.ItemCount.Set || req.Filters.Set {
			handleError(w, badRequest("daily thread feeds do not support source, item count, or filters"))
			return
		}
	} else {
		if req.SourceID.Set {
			value := strings.TrimSpace(req.SourceID.Value)
			sourceID = &value
		}
		if req.ItemCount.Set {
			value := req.ItemCount.Value
			itemCount = &value
		}
		if req.Filters.Set {
			filters = req.Filters.Value
		}

		if sourceID == nil || strings.TrimSpace(*sourceID) == "" {
			handleError(w, badRequest("source_id is required"))
			return
		}
		if itemCount == nil {
			handleError(w, badRequest("item_count is required"))
			return
		}
		normalizedFilters, err := s.normalizePracticeFeedConfig(r.Context(), groupID, *sourceID, *itemCount, filters)
		if err != nil {
			handleError(w, err)
			return
		}
		filters = normalizedFilters

		if enabled {
			if err := s.validatePracticeFeedReady(r.Context(), *sourceID, *itemCount, filters); err != nil {
				handleError(w, err)
				return
			}
		}
	}

	tx, err := s.db.Begin(r.Context())
	if err != nil {
		handleError(w, err)
		return
	}
	defer tx.Rollback(r.Context())

	replaceFilters := currentFeed.Kind == dailyFeedKindCatalogDaily && req.Filters.Set
	if replaceFilters {
		if _, err := tx.Exec(r.Context(), `delete from feed_rule_filters where feed_id = $1`, currentFeed.ID); err != nil {
			handleError(w, err)
			return
		}
	}

	tag, err := tx.Exec(r.Context(), `
		update group_daily_feeds
		set name = $3,
		    slug = $4,
		    description = case when $5 then $6 else description end,
		    enabled = $7,
		    source_id = $8,
		    item_count = $9,
		    schedule_starts_at = $10,
		    schedule_timezone = $11,
		    schedule_interval_seconds = $12
		where group_id = $1 and id = $2
	`, groupID, currentFeed.ID, name, slug, descriptionSet, description, enabled, sourceID, itemCount, schedule.StartsAt, schedule.Timezone, schedule.IntervalSeconds)
	if err != nil {
		handleError(w, err)
		return
	}
	if tag.RowsAffected() == 0 {
		handleError(w, errNotFound("daily feed"))
		return
	}

	if replaceFilters {
		if err := insertDailyFeedFilters(r.Context(), tx, currentFeed.ID, *sourceID, filters); err != nil {
			handleError(w, err)
			return
		}
	}

	if err := tx.Commit(r.Context()); err != nil {
		handleError(w, err)
		return
	}

	feed, err := s.getGroupDailyFeed(r.Context(), groupID, currentFeed.ID)
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

	date, err := parseDailyFeedPathDate(r.PathValue("date"))
	if err != nil {
		handleError(w, err)
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
	rows, err := s.db.Query(ctx, dailyFeedSelectSQL()+`
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
		if err := s.hydrateDailyFeedFilters(ctx, &feed); err != nil {
			return nil, err
		}
		feeds = append(feeds, feed)
	}
	return feeds, rows.Err()
}

func (s *Server) listMeDailyFeeds(ctx context.Context, userID string) ([]DailyFeed, error) {
	rows, err := s.db.Query(ctx, dailyFeedSelectSQL()+`
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
		if err := s.hydrateDailyFeedFilters(ctx, &feed); err != nil {
			return nil, err
		}
		feeds = append(feeds, feed)
	}
	return feeds, rows.Err()
}

func (s *Server) getGroupDailyFeed(ctx context.Context, groupID string, feedID string) (DailyFeed, error) {
	feed, err := scanDailyFeed(s.db.QueryRow(ctx, dailyFeedSelectSQL()+`
		where f.group_id = $1 and f.id = $2
	`, groupID, feedID))
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

func dailyFeedSelectSQL() string {
	return `
		select
			f.id::text,
			f.group_id::text,
			g.name,
			f.name,
			f.slug,
			f.kind,
			f.description,
			f.enabled,
			f.source_id::text,
			cs.name,
			f.item_count,
			f.schedule_starts_at,
			f.schedule_timezone,
			f.schedule_interval_seconds,
			f.created_by_user_id::text,
			f.created_at,
			f.updated_at
		from group_daily_feeds f
		join groups g on g.id = f.group_id
		left join catalog_sources cs on cs.id = f.source_id
	`
}

func scanDailyFeed(row pgx.Row) (DailyFeed, error) {
	var feed DailyFeed
	var groupName sql.NullString
	var description sql.NullString
	var sourceID sql.NullString
	var sourceName sql.NullString
	var itemCount sql.NullInt64
	var createdByUserID sql.NullString
	if err := row.Scan(
		&feed.ID,
		&feed.GroupID,
		&groupName,
		&feed.Name,
		&feed.Slug,
		&feed.Kind,
		&description,
		&feed.Enabled,
		&sourceID,
		&sourceName,
		&itemCount,
		&feed.Schedule.StartsAt,
		&feed.Schedule.Timezone,
		&feed.Schedule.IntervalSeconds,
		&createdByUserID,
		&feed.CreatedAt,
		&feed.UpdatedAt,
	); err != nil {
		return DailyFeed{}, err
	}
	feed.GroupName = nullStringPtr(groupName)
	feed.Description = nullStringPtr(description)
	feed.SourceID = nullStringPtr(sourceID)
	feed.SourceName = nullStringPtr(sourceName)
	feed.ItemCount = nullIntPtr(itemCount)
	feed.CreatedByUserID = nullStringPtr(createdByUserID)
	feed.Filters = []DailyFeedRuleFilter{}
	return feed, nil
}

func (s *Server) hydrateDailyFeedFilters(ctx context.Context, feed *DailyFeed) error {
	if feed.SourceID == nil {
		feed.Filters = []DailyFeedRuleFilter{}
		return nil
	}
	rows, err := s.db.Query(ctx, `
		select
			frf.id::text,
			frf.feed_id::text,
			frf.source_id::text,
			frf.field_id::text,
			csf.key,
			csf.label,
			csf.value_type,
			csf.is_array,
			frf.position,
			frf.op,
			frf.text_values,
			frf.number_values::double precision[],
			frf.created_at,
			frf.updated_at
		from feed_rule_filters frf
		join catalog_source_fields csf on csf.id = frf.field_id and csf.source_id = frf.source_id
		where frf.feed_id = $1
		order by frf.position
	`, feed.ID)
	if err != nil {
		return err
	}
	defer rows.Close()

	filters := []DailyFeedRuleFilter{}
	for rows.Next() {
		var filter DailyFeedRuleFilter
		if err := rows.Scan(
			&filter.ID,
			&filter.FeedID,
			&filter.SourceID,
			&filter.FieldID,
			&filter.FieldKey,
			&filter.FieldLabel,
			&filter.ValueType,
			&filter.IsArray,
			&filter.Position,
			&filter.Op,
			&filter.TextValues,
			&filter.NumberValues,
			&filter.CreatedAt,
			&filter.UpdatedAt,
		); err != nil {
			return err
		}
		filters = append(filters, filter)
	}
	feed.Filters = filters
	return rows.Err()
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

	return s.generateDailyFeedOutputForFeed(ctx, feed, requestedDate)
}

func (s *Server) generateDailyFeedOutputForFeed(ctx context.Context, feed DailyFeed, requestedDate *time.Time) (DailyFeedOutput, error) {
	selection, err := s.selectDailyFeedItems(ctx, feed, requestedDate, true)
	if err != nil {
		return DailyFeedOutput{}, err
	}
	return selection.Output, nil
}

func (s *Server) selectDailyFeedItems(ctx context.Context, feed DailyFeed, requestedDate *time.Time, requireFullCount bool) (dailyFeedSelection, error) {
	date, err := dailyFeedOutputDate(feed.Schedule, requestedDate)
	if err != nil {
		return dailyFeedSelection{}, err
	}
	dateString := date.Format(dailyFeedDateLayout)

	selection := dailyFeedSelection{
		Output: DailyFeedOutput{
			FeedID:    feed.ID,
			GroupID:   feed.GroupID,
			GroupName: feed.GroupName,
			Date:      dateString,
			Title:     feed.Name,
			Items:     []DailyFeedOutputItem{},
		},
	}

	if feed.Kind == dailyFeedKindDailyThread {
		return selection, nil
	}
	if feed.SourceID == nil || feed.ItemCount == nil {
		return dailyFeedSelection{}, badRequest("practice feed source and item count are required")
	}

	candidates, err := s.dailyCatalogCandidates(ctx, *feed.SourceID)
	if err != nil {
		return dailyFeedSelection{}, err
	}
	selection.CandidateItemCount = len(candidates)

	matching := make([]dailyCatalogCandidate, 0, len(candidates))
	for _, candidate := range candidates {
		if len(candidate.MissingFields) > 0 {
			selection.IneligibleItems = append(selection.IneligibleItems, CatalogItemEligibility{
				ID:            candidate.ID,
				SourceID:      candidate.SourceID,
				Title:         candidate.Title,
				MissingFields: candidate.MissingFields,
			})
			continue
		}
		if !dailyCandidateMatchesFilters(candidate, feed.Filters) {
			continue
		}
		action, ok := resolveDailyAction(candidate)
		if !ok {
			continue
		}
		candidate.Action = action
		matching = append(matching, candidate)
	}

	selection.EligibleItemCount = len(matching)
	selection.IneligibleItemCount = len(selection.IneligibleItems)
	sortDailyCandidates(matching, dailyFeedSelectionKey(feed), dateString)
	if requireFullCount && len(matching) < *feed.ItemCount {
		return dailyFeedSelection{}, statusError{
			status:  http.StatusUnprocessableEntity,
			message: fmt.Sprintf("daily feed could select only %d of %d items", len(matching), *feed.ItemCount),
		}
	}

	limit := *feed.ItemCount
	if len(matching) < limit {
		limit = len(matching)
	}
	for index, candidate := range matching[:limit] {
		role := dailyFeedRole(index, limit)
		selection.Output.Items = append(selection.Output.Items, DailyFeedOutputItem{
			Position: index + 1,
			Role:     role,
			Points:   1,
			Reason:   dailyFeedReason(candidate, feed.Filters),
			Item: DailyCatalogItem{
				ID:         candidate.ID,
				SourceID:   candidate.SourceID,
				SourceName: candidate.SourceName,
				Title:      candidate.Title,
				Data:       candidate.Data,
			},
			Action: candidate.Action,
		})
	}

	return selection, nil
}

func (s *Server) dailyCatalogCandidates(ctx context.Context, sourceID string) ([]dailyCatalogCandidate, error) {
	rows, err := s.db.Query(ctx, `
		select
			ci.id::text,
			src.id::text,
			src.name,
			src.template,
			ci.data
		from catalog_items ci
		join catalog_sources src on src.id = ci.source_id
		where src.id = $1
	`, sourceID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	candidates := []dailyCatalogCandidate{}
	for rows.Next() {
		var candidate dailyCatalogCandidate
		var template string
		var dataJSON []byte
		if err := rows.Scan(
			&candidate.ID,
			&candidate.SourceID,
			&candidate.SourceName,
			&template,
			&dataJSON,
		); err != nil {
			return nil, err
		}
		if err := json.Unmarshal(dataJSON, &candidate.Data); err != nil {
			return nil, fmt.Errorf("decode catalog item data: %w", err)
		}
		candidate.Title = catalogItemDisplayName(candidate.Data)
		candidate.Rendered, candidate.MissingFields = renderCatalogTemplate(template, candidate.Data)
		candidates = append(candidates, candidate)
	}
	return candidates, rows.Err()
}

func dailyCandidateMatchesFilters(candidate dailyCatalogCandidate, filters []DailyFeedRuleFilter) bool {
	for _, filter := range filters {
		if !dailyCandidateMatchesFilter(candidate, filter) {
			return false
		}
	}
	return true
}

func dailyCandidateMatchesFilter(candidate dailyCatalogCandidate, filter DailyFeedRuleFilter) bool {
	value, ok := candidate.Data[filter.FieldKey]
	if !ok || value == nil {
		return false
	}

	if filter.ValueType == "number" {
		number, ok := dailyMetadataNumber(value)
		if !ok {
			return false
		}
		return dailyNumberMatches(number, filter.Op, filter.NumberValues)
	}

	if filter.IsArray {
		values := dailyMetadataStringArray(value)
		if len(values) == 0 {
			return false
		}
		return dailyStringArrayMatches(values, filter.Op, filter.TextValues)
	}

	text, ok := dailyMetadataString(value)
	if !ok {
		return false
	}
	return dailyStringMatches(text, filter.Op, filter.TextValues)
}

func dailyNumberMatches(value float64, op string, operands []float64) bool {
	switch op {
	case "eq":
		return len(operands) == 1 && value == operands[0]
	case "gt":
		return len(operands) == 1 && value > operands[0]
	case "gte":
		return len(operands) == 1 && value >= operands[0]
	case "lt":
		return len(operands) == 1 && value < operands[0]
	case "lte":
		return len(operands) == 1 && value <= operands[0]
	case "between":
		return len(operands) == 2 && value >= operands[0] && value <= operands[1]
	default:
		return false
	}
}

func dailyStringMatches(value string, op string, operands []string) bool {
	if len(operands) != 1 {
		return false
	}
	switch op {
	case "eq":
		return value == operands[0]
	case "contains":
		return strings.Contains(strings.ToLower(value), strings.ToLower(operands[0]))
	case "like":
		return dailyLikeMatches(value, operands[0])
	default:
		return false
	}
}

func dailyStringArrayMatches(values []string, op string, operands []string) bool {
	switch op {
	case "contains":
		return len(operands) == 1 && stringSliceContainsFold(values, operands[0])
	case "contains_any":
		for _, operand := range operands {
			if stringSliceContainsFold(values, operand) {
				return true
			}
		}
		return false
	case "contains_all":
		for _, operand := range operands {
			if !stringSliceContainsFold(values, operand) {
				return false
			}
		}
		return len(operands) > 0
	default:
		return false
	}
}

func dailyLikeMatches(value string, pattern string) bool {
	var builder strings.Builder
	builder.WriteString("(?is)^")
	for _, char := range pattern {
		switch char {
		case '%':
			builder.WriteString(".*")
		case '_':
			builder.WriteString(".")
		default:
			builder.WriteString(regexp.QuoteMeta(string(char)))
		}
	}
	builder.WriteString("$")
	matched, err := regexp.MatchString(builder.String(), value)
	return err == nil && matched
}

func stringSliceContainsFold(values []string, needle string) bool {
	for _, value := range values {
		if strings.EqualFold(value, needle) {
			return true
		}
	}
	return false
}

func sortDailyCandidates(candidates []dailyCatalogCandidate, feedKey string, date string) {
	sort.SliceStable(candidates, func(i, j int) bool {
		leftHash := stableDailyHash(feedKey, date, candidates[i].ID)
		rightHash := stableDailyHash(feedKey, date, candidates[j].ID)
		if leftHash != rightHash {
			return leftHash < rightHash
		}
		return candidates[i].ID < candidates[j].ID
	})
}

func dailyFeedSelectionKey(feed DailyFeed) string {
	if feed.GroupID != "" && feed.Slug != "" {
		return feed.GroupID + "/" + feed.Slug
	}
	return feed.ID
}

func stableDailyHash(feedKey string, date string, itemID string) uint64 {
	sum := sha256.Sum256([]byte(feedKey + "\x00" + date + "\x00" + itemID))
	return binary.BigEndian.Uint64(sum[:8])
}

func resolveDailyAction(candidate dailyCatalogCandidate) (DailyFeedAction, bool) {
	rendered := strings.TrimSpace(candidate.Rendered)
	if rendered == "" {
		return DailyFeedAction{}, false
	}
	if strings.HasPrefix(rendered, "https://") && validDailyExternalURL(rendered) {
		return DailyFeedAction{
			Type:  "external_url",
			Label: "Open",
			URL:   rendered,
		}, true
	}
	return DailyFeedAction{
		Type:  "text",
		Label: "Prompt",
		Text:  rendered,
	}, true
}

func validDailyExternalURL(rawURL string) bool {
	parsed, err := url.Parse(rawURL)
	return err == nil && parsed.Scheme == "https" && parsed.Host != ""
}

func dailyMetadataNumber(value any) (float64, bool) {
	switch typed := value.(type) {
	case int:
		return float64(typed), true
	case int64:
		return float64(typed), true
	case float64:
		return typed, true
	case json.Number:
		parsed, err := typed.Float64()
		return parsed, err == nil
	default:
		return 0, false
	}
}

func dailyMetadataString(value any) (string, bool) {
	switch typed := value.(type) {
	case string:
		return typed, true
	default:
		return "", false
	}
}

func dailyMetadataStringArray(value any) []string {
	values := []string{}
	switch typed := value.(type) {
	case []string:
		values = append(values, typed...)
	case []any:
		for _, item := range typed {
			if text, ok := item.(string); ok {
				values = append(values, text)
			}
		}
	}
	return values
}

func dailyFeedRole(index int, count int) string {
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

func dailyFeedReason(candidate dailyCatalogCandidate, filters []DailyFeedRuleFilter) string {
	for _, filter := range filters {
		if filter.FieldLabel != "" && filter.Op != "" {
			return fmt.Sprintf("selected by %s filter", strings.ToLower(filter.FieldLabel))
		}
	}
	if candidate.SourceName != "" {
		return "selected from " + candidate.SourceName
	}
	return "selected by deterministic date rotation"
}

func dailyFeedOutputDate(schedule DailyFeedSchedule, requestedDate *time.Time) (time.Time, error) {
	timezone := schedule.Timezone
	if timezone == "" {
		timezone = "UTC"
	}
	location, err := time.LoadLocation(timezone)
	if err != nil {
		return time.Time{}, badRequest("schedule timezone is invalid")
	}
	if requestedDate != nil {
		local := requestedDate.In(location)
		return time.Date(local.Year(), local.Month(), local.Day(), 0, 0, 0, 0, location), nil
	}
	if schedule.IntervalSeconds <= 0 {
		return time.Time{}, badRequest("schedule interval_seconds must be positive")
	}

	start := schedule.StartsAt
	if start.IsZero() {
		start = defaultScheduleStartsAt(location)
	}

	boundary := start
	now := time.Now()
	if !now.Before(start) {
		interval := time.Duration(schedule.IntervalSeconds) * time.Second
		elapsedIntervals := int64(now.Sub(start) / interval)
		boundary = start.Add(time.Duration(elapsedIntervals) * interval)
	}
	local := boundary.In(location)
	return time.Date(local.Year(), local.Month(), local.Day(), 0, 0, 0, 0, location), nil
}

func (s *Server) validatePracticeFeedReady(ctx context.Context, sourceID string, itemCount int, filters []DailyFeedRuleFilter) error {
	candidates, err := s.dailyCatalogCandidates(ctx, sourceID)
	if err != nil {
		return err
	}
	eligible := 0
	for _, candidate := range candidates {
		if len(candidate.MissingFields) > 0 || !dailyCandidateMatchesFilters(candidate, filters) {
			continue
		}
		if _, ok := resolveDailyAction(candidate); ok {
			eligible++
		}
	}
	if eligible < itemCount {
		return statusError{
			status:  http.StatusUnprocessableEntity,
			message: fmt.Sprintf("daily feed has only %d eligible items for %d requested", eligible, itemCount),
		}
	}
	return nil
}

func normalizeDailyFeedSchedule(schedule *DailyFeedSchedule) (DailyFeedSchedule, error) {
	if schedule == nil {
		location := time.UTC
		return DailyFeedSchedule{
			StartsAt:        defaultScheduleStartsAt(location),
			Timezone:        "UTC",
			IntervalSeconds: 86400,
		}, nil
	}
	normalized := *schedule
	if normalized.Timezone == "" {
		normalized.Timezone = "UTC"
	}
	location, err := time.LoadLocation(normalized.Timezone)
	if err != nil {
		return DailyFeedSchedule{}, badRequest("schedule timezone is invalid")
	}
	if normalized.StartsAt.IsZero() {
		normalized.StartsAt = defaultScheduleStartsAt(location)
	}
	if normalized.IntervalSeconds == 0 {
		normalized.IntervalSeconds = 86400
	}
	if normalized.IntervalSeconds < 1 {
		return DailyFeedSchedule{}, badRequest("schedule interval_seconds must be positive")
	}
	return normalized, nil
}

func defaultScheduleStartsAt(location *time.Location) time.Time {
	now := time.Now().In(location)
	return time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, location)
}

func normalizeDailyFeedKind(kind string) (string, error) {
	normalized := strings.TrimSpace(kind)
	if normalized == "" {
		return dailyFeedKindCatalogDaily, nil
	}
	switch normalized {
	case dailyFeedKindCatalogDaily, dailyFeedKindDailyThread:
		return normalized, nil
	default:
		return "", badRequest("daily feed kind must be catalog_daily or daily_thread")
	}
}

func (s *Server) normalizeCreateDailyFeed(ctx context.Context, groupID string, req createDailyFeedRequest) (normalizedDailyFeedInput, error) {
	kind, err := normalizeDailyFeedKind(req.Kind)
	if err != nil {
		return normalizedDailyFeedInput{}, err
	}

	name := strings.TrimSpace(req.Name)
	if name == "" {
		if kind != dailyFeedKindDailyThread {
			return normalizedDailyFeedInput{}, badRequest("name is required")
		}
		name = defaultDailyThreadFeedName
	}

	slug := strings.TrimSpace(req.Slug)
	if slug == "" {
		if kind == dailyFeedKindDailyThread {
			slug = defaultDailyThreadFeedSlug
		} else {
			slug = slugify(name)
		}
	} else {
		slug = slugify(slug)
	}

	schedule, err := normalizeDailyFeedSchedule(req.Schedule)
	if err != nil {
		return normalizedDailyFeedInput{}, err
	}

	enabled := true
	if req.Enabled != nil {
		enabled = *req.Enabled
	}

	input := normalizedDailyFeedInput{
		Name:        name,
		Slug:        slug,
		Kind:        kind,
		Description: trimOptionalString(req.Description),
		Enabled:     enabled,
		Schedule:    schedule,
	}

	if kind == dailyFeedKindDailyThread {
		if strings.TrimSpace(req.SourceID) != "" || req.ItemCount != 0 || len(req.Filters) > 0 {
			return normalizedDailyFeedInput{}, badRequest("daily thread feeds do not support source, item count, or filters")
		}
		return input, nil
	}

	sourceID := strings.TrimSpace(req.SourceID)
	filters, err := s.normalizePracticeFeedConfig(ctx, groupID, sourceID, req.ItemCount, req.Filters)
	if err != nil {
		return normalizedDailyFeedInput{}, err
	}
	input.SourceID = &sourceID
	input.ItemCount = &req.ItemCount
	input.Filters = filters
	return input, nil
}

func (s *Server) normalizePracticeFeedConfig(ctx context.Context, groupID string, sourceID string, itemCount int, filters []DailyFeedRuleFilter) ([]DailyFeedRuleFilter, error) {
	sourceID = strings.TrimSpace(sourceID)
	if sourceID == "" {
		return nil, badRequest("source_id is required")
	}
	if itemCount < 1 || itemCount > 50 {
		return nil, badRequest("item_count must be between 1 and 50")
	}
	if ok, err := s.catalogSourceAvailableToGroup(ctx, groupID, sourceID); err != nil {
		return nil, err
	} else if !ok {
		return nil, errNotFound("catalog source")
	}
	return s.normalizeDailyFeedFilters(ctx, sourceID, filters)
}

func (s *Server) normalizeDailyFeedFilters(ctx context.Context, sourceID string, filters []DailyFeedRuleFilter) ([]DailyFeedRuleFilter, error) {
	fields, err := s.listCatalogSourceFields(ctx, sourceID)
	if err != nil {
		return nil, err
	}
	fieldsByID := map[string]CatalogSourceField{}
	for _, field := range fields {
		fieldsByID[field.ID] = field
	}

	normalized := make([]DailyFeedRuleFilter, 0, len(filters))
	for index, filter := range filters {
		fieldID := strings.TrimSpace(filter.FieldID)
		if fieldID == "" {
			return nil, badRequest(fmt.Sprintf("filter %d field_id is required", index+1))
		}
		field, ok := fieldsByID[fieldID]
		if !ok {
			return nil, badRequest(fmt.Sprintf("filter %d field is not filterable for the selected source", index+1))
		}

		op := strings.TrimSpace(filter.Op)
		if !dailyFilterOperatorAllowed(field, op) {
			return nil, badRequest(fmt.Sprintf("filter %d operator is not allowed for %s", index+1, field.Label))
		}

		cleanFilter := DailyFeedRuleFilter{
			SourceID:   sourceID,
			FieldID:    field.ID,
			FieldKey:   field.Key,
			FieldLabel: field.Label,
			ValueType:  field.ValueType,
			IsArray:    field.IsArray,
			Position:   index,
			Op:         op,
		}

		if field.ValueType == "number" {
			if len(filter.TextValues) > 0 || len(filter.NumberValues) == 0 {
				return nil, badRequest(fmt.Sprintf("filter %d requires number_values", index+1))
			}
			values, err := normalizeDailyNumberValues(op, filter.NumberValues)
			if err != nil {
				return nil, badRequest(fmt.Sprintf("filter %d %s", index+1, err.Error()))
			}
			cleanFilter.NumberValues = values
		} else {
			if len(filter.NumberValues) > 0 || len(filter.TextValues) == 0 {
				return nil, badRequest(fmt.Sprintf("filter %d requires text_values", index+1))
			}
			values, err := normalizeDailyTextValues(op, field.IsArray, filter.TextValues)
			if err != nil {
				return nil, badRequest(fmt.Sprintf("filter %d %s", index+1, err.Error()))
			}
			cleanFilter.TextValues = values
		}

		normalized = append(normalized, cleanFilter)
	}
	return normalized, nil
}

func dailyFilterOperatorAllowed(field CatalogSourceField, op string) bool {
	if field.ValueType == "number" && !field.IsArray {
		switch op {
		case "eq", "gt", "gte", "lt", "lte", "between":
			return true
		}
		return false
	}
	if field.ValueType == "string" && field.IsArray {
		switch op {
		case "contains", "contains_any", "contains_all":
			return true
		}
		return false
	}
	if field.ValueType == "string" {
		switch op {
		case "eq", "contains", "like":
			return true
		}
		return false
	}
	return false
}

func normalizeDailyNumberValues(op string, values []float64) ([]float64, error) {
	expected := 1
	if op == "between" {
		expected = 2
	}
	if len(values) != expected {
		if expected == 1 {
			return nil, errors.New("requires exactly one number")
		}
		return nil, errors.New("requires exactly two numbers")
	}
	normalized := append([]float64(nil), values...)
	for _, value := range normalized {
		if math.IsNaN(value) || math.IsInf(value, 0) {
			return nil, errors.New("number_values must be finite")
		}
	}
	if op == "between" && normalized[0] > normalized[1] {
		normalized[0], normalized[1] = normalized[1], normalized[0]
	}
	return normalized, nil
}

func normalizeDailyTextValues(op string, isArray bool, values []string) ([]string, error) {
	if !isArray || op == "contains" {
		if len(values) != 1 {
			return nil, errors.New("requires exactly one text value")
		}
	}

	normalized := []string{}
	seen := map[string]bool{}
	for _, value := range values {
		clean := strings.TrimSpace(value)
		if clean == "" {
			continue
		}
		key := strings.ToLower(clean)
		if seen[key] {
			continue
		}
		seen[key] = true
		normalized = append(normalized, clean)
	}
	if len(normalized) == 0 {
		return nil, errors.New("requires at least one text value")
	}
	if (!isArray || op == "contains") && len(normalized) != 1 {
		return nil, errors.New("requires exactly one text value")
	}
	return normalized, nil
}

func insertDailyFeedFilters(ctx context.Context, tx pgx.Tx, feedID string, sourceID string, filters []DailyFeedRuleFilter) error {
	for index, filter := range filters {
		var textValues any
		var numberValues any
		if len(filter.TextValues) > 0 {
			textValues = filter.TextValues
		}
		if len(filter.NumberValues) > 0 {
			numberValues = filter.NumberValues
		}
		if _, err := tx.Exec(ctx, `
			insert into feed_rule_filters (
				feed_id,
				source_id,
				field_id,
				position,
				op,
				text_values,
				number_values
			)
			values ($1, $2, $3, $4, $5, $6::text[], $7::double precision[]::numeric[])
		`, feedID, sourceID, filter.FieldID, index, filter.Op, textValues, numberValues); err != nil {
			return err
		}
	}
	return nil
}

func trimOptionalString(value *string) *string {
	if value == nil {
		return nil
	}
	trimmed := strings.TrimSpace(*value)
	if trimmed == "" {
		return nil
	}
	return &trimmed
}

func dailyFeedKindRequiresReady(kind string) bool {
	return kind == "" || kind == dailyFeedKindCatalogDaily
}

func (s *Server) catalogSourceAvailableToGroup(ctx context.Context, groupID string, sourceID string) (bool, error) {
	var exists bool
	err := s.db.QueryRow(ctx, `
		select exists(
			select 1
			from catalog_sources
			where id = $2
			  and (group_id = $1 or scope = 'global')
		)
	`, groupID, sourceID).Scan(&exists)
	return exists, err
}

func (s *Server) dailyFeedAudienceMatches(context.Context, string, DailyFeed) (bool, error) {
	return true, nil
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
