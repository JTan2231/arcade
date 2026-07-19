package app

import (
	"context"
	"database/sql"
	"errors"
	"net/http"
	"regexp"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

const (
	dailyFeedEventStatusUpcoming = "upcoming"
	dailyFeedEventStatusActive   = "active"
	dailyFeedEventStatusEnded    = "ended"
)

var dailyFeedEventSelectionTokenPattern = regexp.MustCompile(`^[0-9a-f]{32}$`)

type createDailyFeedEventRequest struct {
	Name           string                        `json:"name"`
	Description    *string                       `json:"description"`
	StartsOn       string                        `json:"starts_on"`
	EndsOn         string                        `json:"ends_on"`
	SourceID       optionalStringField           `json:"source_id"`
	ItemCount      optionalIntField              `json:"item_count"`
	Filters        optionalDailyFeedFiltersField `json:"filters"`
	PreviewDate    string                        `json:"preview_date"`
	SelectionToken string                        `json:"selection_token"`
}

type patchDailyFeedEventRequest struct {
	Name           optionalStringField           `json:"name"`
	Description    optionalNullableStringField   `json:"description"`
	StartsOn       optionalStringField           `json:"starts_on"`
	EndsOn         optionalStringField           `json:"ends_on"`
	SourceID       optionalStringField           `json:"source_id"`
	ItemCount      optionalIntField              `json:"item_count"`
	Filters        optionalDailyFeedFiltersField `json:"filters"`
	SelectionToken optionalStringField           `json:"selection_token"`
}

type normalizedDailyFeedEventInput struct {
	Name        string
	Description *string
	StartsOn    time.Time
	EndsBefore  time.Time
	SourceID    string
	ItemCount   int
	Filters     []DailyFeedRuleFilter
}

type dailyFeedSelectionConfig struct {
	SourceID  string
	ItemCount int
	Filters   []DailyFeedRuleFilter
	Event     *DailyFeedEvent
}

type dailyFeedEventQuerier interface {
	Query(context.Context, string, ...any) (pgx.Rows, error)
	QueryRow(context.Context, string, ...any) pgx.Row
}

func (s *Server) handleListDailyFeedEvents(w http.ResponseWriter, r *http.Request) {
	_, feed, err := s.authorizeDailyFeedEventManagement(r)
	if err != nil {
		handleError(w, err)
		return
	}
	events, err := s.listDailyFeedEvents(r.Context(), feed)
	if err != nil {
		handleError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, events)
}

func (s *Server) handleCreateDailyFeedEvent(w http.ResponseWriter, r *http.Request) {
	current, feed, err := s.authorizeDailyFeedEventManagement(r)
	if err != nil {
		handleError(w, err)
		return
	}
	var req createDailyFeedEventRequest
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid JSON request")
		return
	}
	seed, err := normalizeDailyFeedEventSelectionToken(req.SelectionToken)
	if err != nil {
		handleError(w, err)
		return
	}

	tx, err := s.db.Begin(r.Context())
	if err != nil {
		handleError(w, err)
		return
	}
	defer tx.Rollback(r.Context())
	if err := lockDailyFeedForEventWrite(r.Context(), tx, feed.GroupID, feed.ID); err != nil {
		handleError(w, err)
		return
	}
	feed, err = s.getGroupDailyFeed(r.Context(), feed.GroupID, feed.ID)
	if err != nil {
		handleError(w, err)
		return
	}
	input, err := s.normalizeCreateDailyFeedEvent(r.Context(), feed, req, time.Now(), false)
	if err != nil {
		handleError(w, err)
		return
	}
	if err := ensureDailyFeedEventDoesNotOverlapCycles(r.Context(), tx, feed.ID, input.StartsOn, input.EndsBefore); err != nil {
		handleError(w, err)
		return
	}
	if err := s.validatePracticeFeedReady(r.Context(), input.SourceID, input.ItemCount, input.Filters); err != nil {
		handleError(w, err)
		return
	}
	if err := ensureDailyFeedEventRangeUnused(r.Context(), tx, feed.ID, input.StartsOn, input.EndsBefore); err != nil {
		handleError(w, err)
		return
	}

	var eventID string
	err = tx.QueryRow(r.Context(), `
		insert into group_daily_feed_events (
			group_id, feed_id, name, description, starts_on, ends_before,
			source_id, item_count, selection_seed, created_by_user_id, updated_by_user_id
		)
		values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $10)
		returning id::text
	`, feed.GroupID, feed.ID, input.Name, input.Description, input.StartsOn, input.EndsBefore,
		input.SourceID, input.ItemCount, seed, current.ID).Scan(&eventID)
	if err != nil {
		handleError(w, dailyFeedEventWriteError(err))
		return
	}
	if err := insertDailyFeedEventFilters(r.Context(), tx, eventID, input.SourceID, input.Filters); err != nil {
		handleError(w, err)
		return
	}
	if err := tx.Commit(r.Context()); err != nil {
		handleError(w, dailyFeedEventWriteError(err))
		return
	}
	event, err := s.getDailyFeedEvent(r.Context(), feed, eventID)
	if err != nil {
		handleError(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, event)
}

func (s *Server) handlePreviewDailyFeedEvent(w http.ResponseWriter, r *http.Request) {
	_, feed, err := s.authorizeDailyFeedEventManagement(r)
	if err != nil {
		handleError(w, err)
		return
	}
	var req createDailyFeedEventRequest
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid JSON request")
		return
	}
	if strings.TrimSpace(req.Name) == "" {
		req.Name = "Event preview"
	}
	previewedAt := time.Now()
	input, err := s.normalizeCreateDailyFeedEvent(r.Context(), feed, req, previewedAt, true)
	if err != nil {
		handleError(w, err)
		return
	}
	if err := ensureDailyFeedEventDoesNotOverlapCycles(r.Context(), s.db, feed.ID, input.StartsOn, input.EndsBefore); err != nil {
		handleError(w, err)
		return
	}
	previewDate := input.StartsOn
	if strings.TrimSpace(req.PreviewDate) != "" {
		previewDate, err = parseDailyFeedPathDate(req.PreviewDate)
		if err != nil {
			handleError(w, err)
			return
		}
		if previewDate.Before(input.StartsOn) || !previewDate.Before(input.EndsBefore) {
			handleError(w, badRequest("preview_date must be inside the event date range"))
			return
		}
	}
	seed, err := normalizeDailyFeedEventSelectionToken(req.SelectionToken)
	if err != nil {
		handleError(w, err)
		return
	}
	var sourceName string
	if err := s.db.QueryRow(r.Context(), `select name from catalog_sources where id = $1`, input.SourceID).Scan(&sourceName); err != nil {
		handleError(w, err)
		return
	}
	event := dailyFeedEventFromInput("preview", feed, input, seed, sourceName)
	event.CreatedAt = previewedAt
	event.UpdatedAt = previewedAt
	currentDate, err := s.dailyFeedEventCurrentDate(r.Context(), feed, previewedAt)
	if err != nil {
		handleError(w, err)
		return
	}
	event.Status = dailyFeedEventStatus(event, currentDate)
	previewFeed := feed
	previewFeed.SourceID = stringPtr(input.SourceID)
	previewFeed.SourceName = stringPtr(sourceName)
	previewFeed.ItemCount = &input.ItemCount
	previewFeed.Filters = input.Filters
	selection, err := s.selectDailyFeedItemsForDate(r.Context(), previewFeed, dailyFeedSelectionConfig{
		SourceID:  input.SourceID,
		ItemCount: input.ItemCount,
		Filters:   input.Filters,
		Event:     &event,
	}, previewDate, nil, false)
	if err != nil {
		handleError(w, err)
		return
	}
	selection.Output.Event = dailyFeedOutputEvent(&event)
	writeJSON(w, http.StatusOK, DailyFeedEventPreview{
		SelectionToken:      seed,
		Event:               event,
		Output:              selection.Output,
		CandidateItemCount:  selection.CandidateItemCount,
		EligibleItemCount:   selection.EligibleItemCount,
		IneligibleItemCount: selection.IneligibleItemCount,
		IneligibleItems:     selection.IneligibleItems,
	})
}

func (s *Server) handleGetDailyFeedEvent(w http.ResponseWriter, r *http.Request) {
	_, feed, err := s.authorizeDailyFeedEventManagement(r)
	if err != nil {
		handleError(w, err)
		return
	}
	event, err := s.getDailyFeedEvent(r.Context(), feed, r.PathValue("event_id"))
	if err != nil {
		handleError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, event)
}

func (s *Server) handlePatchDailyFeedEvent(w http.ResponseWriter, r *http.Request) {
	current, feed, err := s.authorizeDailyFeedEventManagement(r)
	if err != nil {
		handleError(w, err)
		return
	}
	var req patchDailyFeedEventRequest
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid JSON request")
		return
	}
	tx, err := s.db.Begin(r.Context())
	if err != nil {
		handleError(w, err)
		return
	}
	defer tx.Rollback(r.Context())
	if err := lockDailyFeedForEventWrite(r.Context(), tx, feed.GroupID, feed.ID); err != nil {
		handleError(w, err)
		return
	}
	feed, err = s.getGroupDailyFeed(r.Context(), feed.GroupID, feed.ID)
	if err != nil {
		handleError(w, err)
		return
	}
	event, err := s.loadDailyFeedEvent(r.Context(), tx, feed, r.PathValue("event_id"))
	if err != nil {
		handleError(w, err)
		return
	}
	today, err := s.dailyFeedEventCurrentDate(r.Context(), feed, time.Now())
	if err != nil {
		handleError(w, err)
		return
	}
	status := dailyFeedEventStatus(event, today)
	if status == dailyFeedEventStatusEnded {
		handleError(w, statusError{status: http.StatusConflict, message: "ended daily feed events are immutable"})
		return
	}
	if status == dailyFeedEventStatusActive && !activeDailyFeedEventPatchAllowed(req) {
		handleError(w, statusError{status: http.StatusConflict, message: "active daily feed events only allow changing ends_on"})
		return
	}

	input, err := s.normalizeDailyFeedEventPatch(r.Context(), feed, event, req, today)
	if err != nil {
		handleError(w, err)
		return
	}
	if status == dailyFeedEventStatusActive && !today.Before(input.EndsBefore) {
		handleError(w, badRequest("ends_on must keep the current feed date covered"))
		return
	}
	if err := ensureDailyFeedEventDoesNotOverlapCycles(r.Context(), tx, feed.ID, input.StartsOn, input.EndsBefore); err != nil {
		handleError(w, err)
		return
	}
	selectionSeed := event.SelectionSeed
	if req.SelectionToken.Set {
		selectionSeed, err = normalizeDailyFeedEventSelectionToken(req.SelectionToken.Value)
		if err != nil {
			handleError(w, err)
			return
		}
	}
	configChanged := input.SourceID != event.SourceID || input.ItemCount != event.ItemCount || req.Filters.Set || selectionSeed != event.SelectionSeed
	if configChanged {
		if err := s.validatePracticeFeedReady(r.Context(), input.SourceID, input.ItemCount, input.Filters); err != nil {
			handleError(w, err)
			return
		}
	}

	if configChanged {
		oldStart, oldEnd := dailyFeedEventRange(event)
		start := minDailyFeedDate(oldStart, input.StartsOn)
		end := maxDailyFeedDate(oldEnd, input.EndsBefore)
		if err := ensureDailyFeedEventRangeUnused(r.Context(), tx, feed.ID, start, end); err != nil {
			handleError(w, err)
			return
		}
	} else if !sameDailyFeedDateRange(event, input) {
		if err := ensureDailyFeedEventDateChangeUnused(r.Context(), tx, feed.ID, event, input); err != nil {
			handleError(w, err)
			return
		}
	}

	if input.SourceID != event.SourceID || req.Filters.Set {
		if _, err := tx.Exec(r.Context(), `delete from group_daily_feed_event_filters where event_id = $1`, event.ID); err != nil {
			handleError(w, err)
			return
		}
	}
	_, err = tx.Exec(r.Context(), `
		update group_daily_feed_events
		set name = $4, description = $5, starts_on = $6, ends_before = $7,
		    source_id = $8, item_count = $9, selection_seed = $10, updated_by_user_id = $11
		where group_id = $1 and feed_id = $2 and id = $3
	`, feed.GroupID, feed.ID, event.ID, input.Name, input.Description, input.StartsOn,
		input.EndsBefore, input.SourceID, input.ItemCount, selectionSeed, current.ID)
	if err != nil {
		handleError(w, dailyFeedEventWriteError(err))
		return
	}
	if input.SourceID != event.SourceID || req.Filters.Set {
		if err := insertDailyFeedEventFilters(r.Context(), tx, event.ID, input.SourceID, input.Filters); err != nil {
			handleError(w, err)
			return
		}
	}
	if err := tx.Commit(r.Context()); err != nil {
		handleError(w, dailyFeedEventWriteError(err))
		return
	}
	updated, err := s.getDailyFeedEvent(r.Context(), feed, event.ID)
	if err != nil {
		handleError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, updated)
}

func (s *Server) handleDeleteDailyFeedEvent(w http.ResponseWriter, r *http.Request) {
	_, feed, err := s.authorizeDailyFeedEventManagement(r)
	if err != nil {
		handleError(w, err)
		return
	}
	tx, err := s.db.Begin(r.Context())
	if err != nil {
		handleError(w, err)
		return
	}
	defer tx.Rollback(r.Context())
	if err := lockDailyFeedForEventWrite(r.Context(), tx, feed.GroupID, feed.ID); err != nil {
		handleError(w, err)
		return
	}
	feed, err = s.getGroupDailyFeed(r.Context(), feed.GroupID, feed.ID)
	if err != nil {
		handleError(w, err)
		return
	}
	event, err := s.loadDailyFeedEvent(r.Context(), tx, feed, r.PathValue("event_id"))
	if err != nil {
		handleError(w, err)
		return
	}
	today, err := s.dailyFeedEventCurrentDate(r.Context(), feed, time.Now())
	if err != nil {
		handleError(w, err)
		return
	}
	if dailyFeedEventStatus(event, today) != dailyFeedEventStatusUpcoming {
		handleError(w, statusError{status: http.StatusConflict, message: "only upcoming daily feed events can be deleted"})
		return
	}
	start, end := dailyFeedEventRange(event)
	if err := ensureDailyFeedEventRangeUnused(r.Context(), tx, feed.ID, start, end); err != nil {
		handleError(w, err)
		return
	}
	tag, err := tx.Exec(r.Context(), `
		delete from group_daily_feed_events
		where group_id = $1 and feed_id = $2 and id = $3
	`, feed.GroupID, feed.ID, event.ID)
	if err != nil {
		handleError(w, err)
		return
	}
	if tag.RowsAffected() == 0 {
		handleError(w, errNotFound("daily feed event"))
		return
	}
	if err := tx.Commit(r.Context()); err != nil {
		handleError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) authorizeDailyFeedEventManagement(r *http.Request) (User, DailyFeed, error) {
	current, err := requireUser(r.Context())
	if err != nil {
		return User{}, DailyFeed{}, err
	}
	groupID := r.PathValue("group_id")
	if err := s.requireGroupRole(r.Context(), current.ID, groupID, "owner", "admin"); err != nil {
		return User{}, DailyFeed{}, err
	}
	feed, err := s.getGroupDailyFeed(r.Context(), groupID, r.PathValue("feed_id"))
	if err != nil {
		return User{}, DailyFeed{}, err
	}
	if feed.Kind != dailyFeedKindCatalogDaily {
		return User{}, DailyFeed{}, badRequest("daily thread feeds do not support events")
	}
	return current, feed, nil
}

func (s *Server) normalizeCreateDailyFeedEvent(ctx context.Context, feed DailyFeed, req createDailyFeedEventRequest, now time.Time, allowSourceOverride bool) (normalizedDailyFeedEventInput, error) {
	name := strings.TrimSpace(req.Name)
	if name == "" {
		return normalizedDailyFeedEventInput{}, badRequest("name is required")
	}
	startsOn, err := parseDailyFeedPathDate(req.StartsOn)
	if err != nil {
		return normalizedDailyFeedEventInput{}, badRequest("starts_on must use YYYY-MM-DD")
	}
	endsOn, err := parseDailyFeedPathDate(req.EndsOn)
	if err != nil {
		return normalizedDailyFeedEventInput{}, badRequest("ends_on must use YYYY-MM-DD")
	}
	if endsOn.Before(startsOn) {
		return normalizedDailyFeedEventInput{}, badRequest("ends_on must be on or after starts_on")
	}
	today, err := s.dailyFeedEventCurrentDate(ctx, feed, now)
	if err != nil {
		return normalizedDailyFeedEventInput{}, err
	}
	if startsOn.Before(today) {
		return normalizedDailyFeedEventInput{}, badRequest("starts_on cannot be in the past")
	}
	if feed.SourceID == nil || feed.ItemCount == nil {
		return normalizedDailyFeedEventInput{}, badRequest("catalog daily feed source and item count are required")
	}
	sourceID := *feed.SourceID
	itemCount := *feed.ItemCount
	filters := feed.Filters
	if req.SourceID.Set {
		sourceID = strings.TrimSpace(req.SourceID.Value)
		if !allowSourceOverride && sourceID != *feed.SourceID {
			return normalizedDailyFeedEventInput{}, badRequest("daily feed events cannot change source_id")
		}
	}
	if req.ItemCount.Set {
		itemCount = req.ItemCount.Value
	}
	if req.Filters.Set {
		filters = req.Filters.Value
	}
	filters, err = s.normalizePracticeFeedConfig(ctx, feed.GroupID, sourceID, itemCount, filters)
	if err != nil {
		return normalizedDailyFeedEventInput{}, err
	}
	return normalizedDailyFeedEventInput{
		Name: name, Description: trimOptionalString(req.Description), StartsOn: startsOn,
		EndsBefore: endsOn.AddDate(0, 0, 1), SourceID: sourceID, ItemCount: itemCount, Filters: filters,
	}, nil
}

func (s *Server) normalizeDailyFeedEventPatch(ctx context.Context, feed DailyFeed, event DailyFeedEvent, req patchDailyFeedEventRequest, today time.Time) (normalizedDailyFeedEventInput, error) {
	start, end := dailyFeedEventRange(event)
	input := normalizedDailyFeedEventInput{
		Name: event.Name, Description: event.Description, StartsOn: start, EndsBefore: end,
		SourceID: event.SourceID, ItemCount: event.ItemCount, Filters: event.Filters,
	}
	if req.Name.Set {
		input.Name = strings.TrimSpace(req.Name.Value)
		if input.Name == "" {
			return normalizedDailyFeedEventInput{}, badRequest("name cannot be empty")
		}
	}
	if req.Description.Set {
		input.Description = trimOptionalString(req.Description.Value)
	}
	var err error
	if req.StartsOn.Set {
		input.StartsOn, err = parseDailyFeedPathDate(req.StartsOn.Value)
		if err != nil {
			return normalizedDailyFeedEventInput{}, badRequest("starts_on must use YYYY-MM-DD")
		}
	}
	if req.EndsOn.Set {
		endsOn, parseErr := parseDailyFeedPathDate(req.EndsOn.Value)
		if parseErr != nil {
			return normalizedDailyFeedEventInput{}, badRequest("ends_on must use YYYY-MM-DD")
		}
		input.EndsBefore = endsOn.AddDate(0, 0, 1)
	}
	if req.StartsOn.Set && input.StartsOn.Before(today) {
		return normalizedDailyFeedEventInput{}, badRequest("starts_on cannot be in the past")
	}
	if !input.StartsOn.Before(input.EndsBefore) {
		return normalizedDailyFeedEventInput{}, badRequest("ends_on must be on or after starts_on")
	}
	if req.SourceID.Set {
		input.SourceID = strings.TrimSpace(req.SourceID.Value)
		if input.SourceID != event.SourceID {
			return normalizedDailyFeedEventInput{}, badRequest("daily feed events cannot change source_id")
		}
	}
	if req.ItemCount.Set {
		input.ItemCount = req.ItemCount.Value
	}
	if req.Filters.Set {
		input.Filters = req.Filters.Value
	}
	input.Filters, err = s.normalizePracticeFeedConfig(ctx, feed.GroupID, input.SourceID, input.ItemCount, input.Filters)
	if err != nil {
		return normalizedDailyFeedEventInput{}, err
	}
	return input, nil
}

func activeDailyFeedEventPatchAllowed(req patchDailyFeedEventRequest) bool {
	return req.EndsOn.Set && !req.Name.Set && !req.Description.Set && !req.StartsOn.Set &&
		!req.SourceID.Set && !req.ItemCount.Set && !req.Filters.Set && !req.SelectionToken.Set
}

func ensureDailyFeedEventDoesNotOverlapCycles(ctx context.Context, querier dailyFeedEventQuerier, feedID string, startsOn, endsBefore time.Time) error {
	var cycleStartsOn time.Time
	err := querier.QueryRow(ctx, `
		select min(starts_on)
		from group_daily_feed_cycle_settings
		where feed_id = $1
		having count(*) > 0
	`, feedID).Scan(&cycleStartsOn)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil
	}
	if err != nil {
		return err
	}
	overlaps := dailyFeedCycleDateAfter(endsBefore, cycleStartsOn)
	if endsBefore.Format(dailyFeedDateLayout) == cycleStartsOn.Format(dailyFeedDateLayout) {
		overlaps = false
	}
	if overlaps {
		return statusError{status: http.StatusConflict, message: "daily feed events must end before the first cycle boundary"}
	}
	return nil
}

func (s *Server) listDailyFeedEvents(ctx context.Context, feed DailyFeed) ([]DailyFeedEvent, error) {
	rows, err := s.db.Query(ctx, dailyFeedEventSelectSQL()+`
		where e.group_id = $1 and e.feed_id = $2
		order by e.starts_on desc, e.created_at desc
	`, feed.GroupID, feed.ID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	events := []DailyFeedEvent{}
	for rows.Next() {
		event, err := scanDailyFeedEvent(rows)
		if err != nil {
			return nil, err
		}
		events = append(events, event)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	today, err := s.dailyFeedEventCurrentDate(ctx, feed, time.Now())
	if err != nil {
		return nil, err
	}
	for i := range events {
		if err := s.hydrateDailyFeedEventFilters(ctx, &events[i]); err != nil {
			return nil, err
		}
		events[i].Status = dailyFeedEventStatus(events[i], today)
	}
	return events, nil
}

func (s *Server) getDailyFeedEvent(ctx context.Context, feed DailyFeed, eventID string) (DailyFeedEvent, error) {
	event, err := s.loadDailyFeedEvent(ctx, s.db, feed, eventID)
	if err != nil {
		return DailyFeedEvent{}, err
	}
	today, err := s.dailyFeedEventCurrentDate(ctx, feed, time.Now())
	if err != nil {
		return DailyFeedEvent{}, err
	}
	event.Status = dailyFeedEventStatus(event, today)
	return event, nil
}

func (s *Server) loadDailyFeedEvent(ctx context.Context, querier dailyFeedEventQuerier, feed DailyFeed, eventID string) (DailyFeedEvent, error) {
	event, err := scanDailyFeedEvent(querier.QueryRow(ctx, dailyFeedEventSelectSQL()+`
		where e.group_id = $1 and e.feed_id = $2 and e.id = $3
	`, feed.GroupID, feed.ID, eventID))
	if errors.Is(err, pgx.ErrNoRows) {
		return DailyFeedEvent{}, errNotFound("daily feed event")
	}
	if err != nil {
		return DailyFeedEvent{}, err
	}
	if err := hydrateDailyFeedEventFilters(ctx, querier, &event); err != nil {
		return DailyFeedEvent{}, err
	}
	return event, nil
}

func dailyFeedEventSelectSQL() string {
	return `
		select e.id::text, e.group_id::text, e.feed_id::text, e.name, e.description,
		       e.starts_on, e.ends_before - 1, e.source_id::text, src.name, e.item_count,
		       e.selection_seed, e.created_by_user_id::text, e.updated_by_user_id::text,
		       e.created_at, e.updated_at
		from group_daily_feed_events e
		join catalog_sources src on src.id = e.source_id
	`
}

func scanDailyFeedEvent(row pgx.Row) (DailyFeedEvent, error) {
	var event DailyFeedEvent
	var description, createdBy, updatedBy sql.NullString
	var startsOn, endsOn time.Time
	err := row.Scan(&event.ID, &event.GroupID, &event.FeedID, &event.Name, &description,
		&startsOn, &endsOn, &event.SourceID, &event.SourceName, &event.ItemCount,
		&event.SelectionSeed, &createdBy, &updatedBy, &event.CreatedAt, &event.UpdatedAt)
	if err != nil {
		return DailyFeedEvent{}, err
	}
	event.Description = nullStringPtr(description)
	event.CreatedByUserID = nullStringPtr(createdBy)
	event.UpdatedByUserID = nullStringPtr(updatedBy)
	event.StartsOn = startsOn.Format(dailyFeedDateLayout)
	event.EndsOn = endsOn.Format(dailyFeedDateLayout)
	event.Filters = []DailyFeedRuleFilter{}
	return event, nil
}

func (s *Server) hydrateDailyFeedEventFilters(ctx context.Context, event *DailyFeedEvent) error {
	return hydrateDailyFeedEventFilters(ctx, s.db, event)
}

func hydrateDailyFeedEventFilters(ctx context.Context, querier dailyFeedEventQuerier, event *DailyFeedEvent) error {
	rows, err := querier.Query(ctx, `
		select f.id::text, f.source_id::text, f.field_id::text, sf.key, sf.label,
		       sf.value_type, sf.is_array, f.position, f.op, f.text_values,
		       f.number_values::double precision[], f.created_at, f.updated_at
		from group_daily_feed_event_filters f
		join catalog_source_fields sf on sf.id = f.field_id and sf.source_id = f.source_id
		where f.event_id = $1
		order by f.position
	`, event.ID)
	if err != nil {
		return err
	}
	defer rows.Close()
	event.Filters = []DailyFeedRuleFilter{}
	for rows.Next() {
		var filter DailyFeedRuleFilter
		filter.FeedID = event.FeedID
		if err := rows.Scan(&filter.ID, &filter.SourceID, &filter.FieldID, &filter.FieldKey,
			&filter.FieldLabel, &filter.ValueType, &filter.IsArray, &filter.Position, &filter.Op,
			&filter.TextValues, &filter.NumberValues, &filter.CreatedAt, &filter.UpdatedAt); err != nil {
			return err
		}
		event.Filters = append(event.Filters, filter)
	}
	return rows.Err()
}

func (s *Server) resolveDailyFeedSelectionConfig(ctx context.Context, feed DailyFeed, feedDate time.Time) (dailyFeedSelectionConfig, error) {
	if feed.Kind == dailyFeedKindDailyThread {
		return dailyFeedSelectionConfig{}, nil
	}
	if feed.SourceID == nil || feed.ItemCount == nil {
		return dailyFeedSelectionConfig{}, badRequest("practice feed source and item count are required")
	}
	baseline := dailyFeedSelectionConfig{SourceID: *feed.SourceID, ItemCount: *feed.ItemCount, Filters: feed.Filters}
	if s.db == nil || !uuidStringPattern.MatchString(feed.ID) {
		return baseline, nil
	}
	event, err := scanDailyFeedEvent(s.db.QueryRow(ctx, dailyFeedEventSelectSQL()+`
		where e.feed_id = $1 and e.starts_on <= $2::date and e.ends_before > $2::date
	`, feed.ID, feedDate.Format(dailyFeedDateLayout)))
	if errors.Is(err, pgx.ErrNoRows) {
		return baseline, nil
	}
	if err != nil {
		return dailyFeedSelectionConfig{}, err
	}
	if err := s.hydrateDailyFeedEventFilters(ctx, &event); err != nil {
		return dailyFeedSelectionConfig{}, err
	}
	event.Status = dailyFeedEventStatusActive
	return dailyFeedSelectionConfig{SourceID: event.SourceID, ItemCount: event.ItemCount, Filters: event.Filters, Event: &event}, nil
}

func dailyFeedOutputEvent(event *DailyFeedEvent) *DailyFeedOutputEvent {
	if event == nil {
		return nil
	}
	return &DailyFeedOutputEvent{ID: event.ID, Name: event.Name, StartsOn: event.StartsOn, EndsOn: event.EndsOn}
}

func insertDailyFeedEventFilters(ctx context.Context, tx pgx.Tx, eventID, sourceID string, filters []DailyFeedRuleFilter) error {
	for index, filter := range filters {
		var textValues, numberValues any
		if len(filter.TextValues) > 0 {
			textValues = filter.TextValues
		}
		if len(filter.NumberValues) > 0 {
			numberValues = filter.NumberValues
		}
		_, err := tx.Exec(ctx, `
			insert into group_daily_feed_event_filters (
				event_id, source_id, field_id, position, op, text_values, number_values
			) values ($1, $2, $3, $4, $5, $6::text[], $7::double precision[]::numeric[])
		`, eventID, sourceID, filter.FieldID, index, filter.Op, textValues, numberValues)
		if err != nil {
			return err
		}
	}
	return nil
}

func lockDailyFeedForEventWrite(ctx context.Context, tx pgx.Tx, groupID, feedID string) error {
	kind, err := lockGroupDailyFeedForWrite(ctx, tx, groupID, feedID)
	if err != nil {
		return err
	}
	if kind != dailyFeedKindCatalogDaily {
		return badRequest("daily thread feeds do not support events")
	}
	return nil
}

func lockGroupDailyFeedForWrite(ctx context.Context, tx pgx.Tx, groupID, feedID string) (string, error) {
	var kind string
	err := tx.QueryRow(ctx, `
		select kind from group_daily_feeds where group_id = $1 and id = $2 for update
	`, groupID, feedID).Scan(&kind)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", errNotFound("daily feed")
	}
	if err != nil {
		return "", err
	}
	return kind, nil
}

func ensureDailyFeedEventRangeUnused(ctx context.Context, tx pgx.Tx, feedID string, startsOn, endsBefore time.Time) error {
	if !startsOn.Before(endsBefore) {
		return nil
	}
	var used bool
	err := tx.QueryRow(ctx, `
		select exists (
			select 1 from group_daily_feed_generations g
			where g.feed_id = $1 and g.feed_date >= $2 and g.feed_date < $3
			union all
			select 1
			from group_daily_feed_instances i
			join group_feed_posts p on p.feed_instance_id = i.id and p.group_id = i.group_id
			where i.feed_id = $1 and i.feed_date >= $2 and i.feed_date < $3 and p.deleted_at is null
		)
	`, feedID, startsOn, endsBefore).Scan(&used)
	if err != nil {
		return err
	}
	if used {
		return statusError{status: http.StatusConflict, message: "daily feed event dates already have a generation or posts"}
	}
	return nil
}

func ensureDailyFeedEventDateChangeUnused(ctx context.Context, tx pgx.Tx, feedID string, event DailyFeedEvent, input normalizedDailyFeedEventInput) error {
	oldStart, oldEnd := dailyFeedEventRange(event)
	if input.StartsOn.Before(oldStart) {
		if err := ensureDailyFeedEventRangeUnused(ctx, tx, feedID, input.StartsOn, oldStart); err != nil {
			return err
		}
	} else if oldStart.Before(input.StartsOn) {
		if err := ensureDailyFeedEventRangeUnused(ctx, tx, feedID, oldStart, input.StartsOn); err != nil {
			return err
		}
	}
	if oldEnd.Before(input.EndsBefore) {
		return ensureDailyFeedEventRangeUnused(ctx, tx, feedID, oldEnd, input.EndsBefore)
	}
	if input.EndsBefore.Before(oldEnd) {
		return ensureDailyFeedEventRangeUnused(ctx, tx, feedID, input.EndsBefore, oldEnd)
	}
	return nil
}

func dailyFeedEventWriteError(err error) error {
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) && pgErr.Code == "23P01" && pgErr.ConstraintName == "group_daily_feed_events_no_overlap" {
		return statusError{status: http.StatusConflict, message: "daily feed event overlaps an existing event"}
	}
	return err
}

func normalizeDailyFeedEventSelectionToken(raw string) (string, error) {
	token := strings.TrimSpace(raw)
	if token == "" {
		return randomHex(16)
	}
	if !dailyFeedEventSelectionTokenPattern.MatchString(token) {
		return "", badRequest("selection_token must be 32 lowercase hexadecimal characters")
	}
	return token, nil
}

func (s *Server) dailyFeedEventCurrentDate(ctx context.Context, feed DailyFeed, now time.Time) (time.Time, error) {
	date, err := s.dailyFeedOutputDateForFeed(ctx, feed, nil, now)
	if err != nil {
		return time.Time{}, err
	}
	return time.Parse(dailyFeedDateLayout, date.Format(dailyFeedDateLayout))
}

func dailyFeedEventStatus(event DailyFeedEvent, today time.Time) string {
	start, end := dailyFeedEventRange(event)
	if today.Before(start) {
		return dailyFeedEventStatusUpcoming
	}
	if today.Before(end) {
		return dailyFeedEventStatusActive
	}
	return dailyFeedEventStatusEnded
}

func dailyFeedEventRange(event DailyFeedEvent) (time.Time, time.Time) {
	start, _ := time.Parse(dailyFeedDateLayout, event.StartsOn)
	end, _ := time.Parse(dailyFeedDateLayout, event.EndsOn)
	return start, end.AddDate(0, 0, 1)
}

func dailyFeedEventFromInput(id string, feed DailyFeed, input normalizedDailyFeedEventInput, seed string, sourceName string) DailyFeedEvent {
	return DailyFeedEvent{
		ID: id, GroupID: feed.GroupID, FeedID: feed.ID, Name: input.Name, Description: input.Description,
		StartsOn: input.StartsOn.Format(dailyFeedDateLayout), EndsOn: input.EndsBefore.AddDate(0, 0, -1).Format(dailyFeedDateLayout),
		SourceID: input.SourceID, SourceName: sourceName, ItemCount: input.ItemCount, Filters: input.Filters,
		Status: dailyFeedEventStatusUpcoming, SelectionSeed: seed,
	}
}

func sameDailyFeedDateRange(event DailyFeedEvent, input normalizedDailyFeedEventInput) bool {
	start, end := dailyFeedEventRange(event)
	return start.Equal(input.StartsOn) && end.Equal(input.EndsBefore)
}

func minDailyFeedDate(left, right time.Time) time.Time {
	if right.Before(left) {
		return right
	}
	return left
}
func maxDailyFeedDate(left, right time.Time) time.Time {
	if left.Before(right) {
		return right
	}
	return left
}
