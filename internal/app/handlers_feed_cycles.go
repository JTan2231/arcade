package app

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/binary"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
)

const minimumCycleScheduleIntervalSeconds = 86400

var dailyFeedCycleConfigurationKeyPattern = regexp.MustCompile(`^[a-z0-9][a-z0-9_-]{0,63}$`)

type upsertDailyFeedCycleSettingsRequest struct {
	StartsOn       string                        `json:"starts_on"`
	OutputCount    int                           `json:"output_count"`
	SelectionToken string                        `json:"selection_token"`
	Configurations []DailyFeedCycleConfiguration `json:"configurations"`
}

type dailyFeedCycleRevision struct {
	ID             string
	SettingsID     string
	StartsOn       time.Time
	OutputCount    int
	SelectionSeed  string
	Configurations []DailyFeedCycleConfiguration
}

type dailyFeedCycleContext struct {
	SettingsID          string
	GroupID             string
	FeedID              string
	SettingsStarts      time.Time
	SettingsEnd         *time.Time
	Schedule            DailyFeedSchedule
	Revision            dailyFeedCycleRevision
	Configuration       DailyFeedCycleConfiguration
	CycleNumber         int64
	RevisionCycleNumber int64
	StartsOn            time.Time
	EndsBefore          time.Time
	Dates               []time.Time
}

type dailyFeedCycleSelection struct {
	Candidates         int
	Matching           int
	DistinctValueCount *int
	Selected           []dailyCatalogCandidate
}

type dailyFeedCycleSettingsRow struct {
	ID         string
	GroupID    string
	FeedID     string
	StartsOn   time.Time
	EndsBefore *time.Time
	Schedule   DailyFeedSchedule
	CreatedAt  time.Time
	UpdatedAt  time.Time
}

func (s *Server) handleGetDailyFeedCycleSettings(w http.ResponseWriter, r *http.Request) {
	_, feed, err := s.authorizeDailyFeedCycleManagement(r)
	if err != nil {
		handleError(w, err)
		return
	}
	settings, err := s.getDailyFeedCycleSettings(r.Context(), feed)
	if err != nil {
		handleError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, settings)
}

func (s *Server) handlePreviewDailyFeedCycleSettings(w http.ResponseWriter, r *http.Request) {
	_, feed, err := s.authorizeDailyFeedCycleManagement(r)
	if err != nil {
		handleError(w, err)
		return
	}
	var req upsertDailyFeedCycleSettingsRequest
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid JSON request")
		return
	}
	normalized, seed, startsOn, err := s.normalizeDailyFeedCycleSettings(r.Context(), feed, req)
	if err != nil {
		handleError(w, err)
		return
	}
	dates, err := cycleScheduledDates(feed.Schedule, startsOn, normalized.OutputCount)
	if err != nil {
		handleError(w, err)
		return
	}
	preview, err := s.previewDailyFeedCycle(r.Context(), feed, normalized.Configurations[0], dates, seed)
	if err != nil {
		handleError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, preview)
}

func (s *Server) handlePutDailyFeedCycleSettings(w http.ResponseWriter, r *http.Request) {
	current, feed, err := s.authorizeDailyFeedCycleManagement(r)
	if err != nil {
		handleError(w, err)
		return
	}
	var req upsertDailyFeedCycleSettingsRequest
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid JSON request")
		return
	}
	normalized, seed, startsOn, err := s.normalizeDailyFeedCycleSettings(r.Context(), feed, req)
	if err != nil {
		handleError(w, err)
		return
	}
	settings, err := s.putDailyFeedCycleSettings(r.Context(), current.ID, feed, normalized, seed, startsOn)
	if err != nil {
		handleError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, settings)
}

func (s *Server) handleDeleteDailyFeedCycleSettings(w http.ResponseWriter, r *http.Request) {
	current, feed, err := s.authorizeDailyFeedCycleManagement(r)
	if err != nil {
		handleError(w, err)
		return
	}
	if err := s.endDailyFeedCycleSettings(r.Context(), current.ID, feed); err != nil {
		handleError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) handleListDailyFeedCycles(w http.ResponseWriter, r *http.Request) {
	_, feed, err := s.authorizeDailyFeedCycleManagement(r)
	if err != nil {
		handleError(w, err)
		return
	}
	cycles, err := s.listDailyFeedCycles(r.Context(), feed)
	if err != nil {
		handleError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, cycles)
}

func (s *Server) handleRefreshDailyFeedCycle(w http.ResponseWriter, r *http.Request) {
	current, feed, err := s.authorizeDailyFeedCycleManagement(r)
	if err != nil {
		handleError(w, err)
		return
	}
	cycle, err := s.refreshDailyFeedCycle(r.Context(), current.ID, feed, r.PathValue("cycle_id"))
	if err != nil {
		handleError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, cycle)
}

func (s *Server) authorizeDailyFeedCycleManagement(r *http.Request) (User, DailyFeed, error) {
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
		return User{}, DailyFeed{}, badRequest("daily thread feeds do not support cycles")
	}
	return current, feed, nil
}

func (s *Server) normalizeDailyFeedCycleSettings(ctx context.Context, feed DailyFeed, req upsertDailyFeedCycleSettingsRequest) (upsertDailyFeedCycleSettingsRequest, string, time.Time, error) {
	if feed.SourceID == nil || strings.TrimSpace(*feed.SourceID) == "" {
		return upsertDailyFeedCycleSettingsRequest{}, "", time.Time{}, badRequest("catalog daily feed source is required")
	}
	if feed.Schedule.IntervalSeconds < minimumCycleScheduleIntervalSeconds {
		return upsertDailyFeedCycleSettingsRequest{}, "", time.Time{}, badRequest("cycles require a feed schedule interval of at least one day")
	}
	startsOn, err := parseDailyFeedPathDate(req.StartsOn)
	if err != nil {
		return upsertDailyFeedCycleSettingsRequest{}, "", time.Time{}, badRequest("starts_on must use YYYY-MM-DD")
	}
	if req.OutputCount < 1 || req.OutputCount > 50 {
		return upsertDailyFeedCycleSettingsRequest{}, "", time.Time{}, badRequest("output_count must be between 1 and 50")
	}
	if len(req.Configurations) == 0 {
		return upsertDailyFeedCycleSettingsRequest{}, "", time.Time{}, badRequest("at least one cycle configuration is required")
	}
	if ok, err := cycleDateIsScheduled(feed.Schedule, startsOn); err != nil {
		return upsertDailyFeedCycleSettingsRequest{}, "", time.Time{}, err
	} else if !ok {
		return upsertDailyFeedCycleSettingsRequest{}, "", time.Time{}, badRequest("starts_on must be a scheduled feed output date")
	}
	currentDate, err := s.dailyFeedOutputDateForFeed(ctx, feed, nil, time.Now())
	if err != nil {
		return upsertDailyFeedCycleSettingsRequest{}, "", time.Time{}, err
	}
	if dailyFeedCycleDateBefore(startsOn, currentDate) {
		return upsertDailyFeedCycleSettingsRequest{}, "", time.Time{}, badRequest("starts_on cannot be before the current feed date")
	}

	fields, err := s.listCatalogSourceFields(ctx, *feed.SourceID)
	if err != nil {
		return upsertDailyFeedCycleSettingsRequest{}, "", time.Time{}, err
	}
	fieldsByID := make(map[string]CatalogSourceField, len(fields))
	for _, field := range fields {
		fieldsByID[field.ID] = field
	}
	keys := map[string]bool{}
	normalized := req
	normalized.Configurations = make([]DailyFeedCycleConfiguration, 0, len(req.Configurations))
	for position, raw := range req.Configurations {
		configuration, err := s.normalizeDailyFeedCycleConfiguration(ctx, *feed.SourceID, raw, position, fieldsByID)
		if err != nil {
			return upsertDailyFeedCycleSettingsRequest{}, "", time.Time{}, err
		}
		if keys[configuration.Key] {
			return upsertDailyFeedCycleSettingsRequest{}, "", time.Time{}, badRequest("cycle configuration keys must be unique")
		}
		keys[configuration.Key] = true
		normalized.Configurations = append(normalized.Configurations, configuration)
	}
	seed, err := normalizeDailyFeedEventSelectionToken(req.SelectionToken)
	if err != nil {
		return upsertDailyFeedCycleSettingsRequest{}, "", time.Time{}, err
	}
	normalized.StartsOn = startsOn.Format(dailyFeedDateLayout)
	normalized.SelectionToken = seed
	return normalized, seed, startsOn, nil
}

func (s *Server) normalizeDailyFeedCycleConfiguration(ctx context.Context, sourceID string, raw DailyFeedCycleConfiguration, position int, fieldsByID map[string]CatalogSourceField) (DailyFeedCycleConfiguration, error) {
	key := strings.TrimSpace(strings.ToLower(raw.Key))
	if !dailyFeedCycleConfigurationKeyPattern.MatchString(key) {
		return DailyFeedCycleConfiguration{}, badRequest(fmt.Sprintf("cycle configuration %d key is invalid", position+1))
	}
	name := strings.TrimSpace(raw.Name)
	if name == "" {
		return DailyFeedCycleConfiguration{}, badRequest(fmt.Sprintf("cycle configuration %d name is required", position+1))
	}
	filters, err := s.normalizeDailyFeedFilters(ctx, sourceID, raw.Filters)
	if err != nil {
		return DailyFeedCycleConfiguration{}, err
	}
	configuration := DailyFeedCycleConfiguration{
		SourceID: sourceID, Key: key, Name: name, Description: trimOptionalString(raw.Description), Position: position,
		Filters: filters, Distinct: DailyFeedCycleDistinct{Kind: raw.Distinct.Kind},
		Order: DailyFeedCycleOrder{Kind: raw.Order.Kind, Direction: raw.Order.Direction},
	}
	switch raw.Distinct.Kind {
	case "none":
		configuration.Distinct = DailyFeedCycleDistinct{Kind: "none"}
	case "field":
		field, ok := fieldsByID[strings.TrimSpace(raw.Distinct.FieldID)]
		if !ok || field.IsArray || (field.ValueType != "number" && field.ValueType != "string") {
			return DailyFeedCycleConfiguration{}, badRequest(fmt.Sprintf("cycle configuration %d distinct field must be a scalar catalog field", position+1))
		}
		configuration.Distinct = cycleDistinctForField(field)
	default:
		return DailyFeedCycleConfiguration{}, badRequest(fmt.Sprintf("cycle configuration %d distinct kind must be none or field", position+1))
	}
	switch raw.Order.Kind {
	case "seeded_shuffle":
		configuration.Order = DailyFeedCycleOrder{Kind: "seeded_shuffle"}
	case "field":
		field, ok := fieldsByID[strings.TrimSpace(raw.Order.FieldID)]
		if !ok || field.IsArray || (field.ValueType != "number" && field.ValueType != "string") {
			return DailyFeedCycleConfiguration{}, badRequest(fmt.Sprintf("cycle configuration %d order field must be a scalar catalog field", position+1))
		}
		if raw.Order.Direction != "asc" && raw.Order.Direction != "desc" {
			return DailyFeedCycleConfiguration{}, badRequest(fmt.Sprintf("cycle configuration %d order direction must be asc or desc", position+1))
		}
		configuration.Order = cycleOrderForField(field, raw.Order.Direction)
	default:
		return DailyFeedCycleConfiguration{}, badRequest(fmt.Sprintf("cycle configuration %d order kind must be seeded_shuffle or field", position+1))
	}
	return configuration, nil
}

func cycleDistinctForField(field CatalogSourceField) DailyFeedCycleDistinct {
	return DailyFeedCycleDistinct{Kind: "field", DailyFeedCycleConfigurationField: DailyFeedCycleConfigurationField{
		FieldID: field.ID, FieldKey: field.Key, FieldLabel: field.Label, ValueType: field.ValueType, IsArray: field.IsArray,
	}}
}

func cycleOrderForField(field CatalogSourceField, direction string) DailyFeedCycleOrder {
	return DailyFeedCycleOrder{Kind: "field", Direction: direction, DailyFeedCycleConfigurationField: DailyFeedCycleConfigurationField{
		FieldID: field.ID, FieldKey: field.Key, FieldLabel: field.Label, ValueType: field.ValueType, IsArray: field.IsArray,
	}}
}

func cycleDateIsScheduled(schedule DailyFeedSchedule, date time.Time) (bool, error) {
	windows, err := scheduledFeedDateWindows(schedule, date, date)
	if err != nil {
		return false, err
	}
	for _, window := range windows {
		if window.Date.Format(dailyFeedDateLayout) == date.Format(dailyFeedDateLayout) {
			return true, nil
		}
	}
	return false, nil
}

func dailyFeedCycleDateBefore(left, right time.Time) bool {
	return left.Format(dailyFeedDateLayout) < right.Format(dailyFeedDateLayout)
}

func dailyFeedCycleDateAfter(left, right time.Time) bool {
	return left.Format(dailyFeedDateLayout) > right.Format(dailyFeedDateLayout)
}

func dailyFeedCycleCurrentDate(settings dailyFeedCycleSettingsRow, now time.Time) (time.Time, error) {
	return dailyFeedOutputDateAt(settings.Schedule, nil, now)
}

func sameOptionalString(left, right *string) bool {
	if left == nil || right == nil {
		return left == nil && right == nil
	}
	return *left == *right
}

func cycleScheduledDates(schedule DailyFeedSchedule, startsOn time.Time, count int) ([]time.Time, error) {
	if count < 1 {
		return nil, badRequest("cycle output_count must be positive")
	}
	if schedule.IntervalSeconds < minimumCycleScheduleIntervalSeconds {
		return nil, badRequest("cycles require a feed schedule interval of at least one day")
	}
	intervalDays := schedule.IntervalSeconds / minimumCycleScheduleIntervalSeconds
	if intervalDays < 1 {
		intervalDays = 1
	}
	horizon := count*intervalDays + count + 7
	for attempts := 0; attempts < 6; attempts++ {
		to := startsOn.AddDate(0, 0, horizon)
		windows, err := scheduledFeedDateWindows(schedule, startsOn, to)
		if err != nil {
			return nil, err
		}
		dates := make([]time.Time, 0, count)
		for _, window := range windows {
			if dailyFeedCycleDateBefore(window.Date, startsOn) {
				continue
			}
			dates = append(dates, window.Date)
			if len(dates) == count {
				return dates, nil
			}
		}
		horizon *= 2
	}
	return nil, statusError{status: http.StatusUnprocessableEntity, message: "could not resolve all scheduled dates for cycle"}
}

func (s *Server) previewDailyFeedCycle(ctx context.Context, feed DailyFeed, configuration DailyFeedCycleConfiguration, dates []time.Time, seed string) (DailyFeedCyclePreview, error) {
	selectionSeed := dailyFeedCycleSelectionSeed(seed, dates[0], configuration.Key)
	selection, err := s.selectDailyFeedCycleItems(ctx, configuration, len(dates), selectionSeed)
	if err != nil {
		return DailyFeedCyclePreview{}, err
	}
	startsOn := dates[0]
	endsOn := dates[len(dates)-1]
	summary := dailyFeedCycleConfigurationSummary(configuration)
	outputs := make([]DailyFeedOutput, 0, len(dates))
	for index, candidate := range selection.Selected {
		output := DailyFeedOutput{
			FeedID: feed.ID, GroupID: feed.GroupID, GroupName: feed.GroupName,
			Date: dates[index].Format(dailyFeedDateLayout), Title: feed.Name,
			Cycle: &DailyFeedOutputCycle{
				ID: "preview", Name: configuration.Name, ConfigurationKey: configuration.Key,
				StartsOn: startsOn.Format(dailyFeedDateLayout), EndsOn: endsOn.Format(dailyFeedDateLayout),
				Position: index + 1, PositionCount: len(dates), Summary: summary,
			},
			Items: []DailyFeedOutputItem{dailyFeedOutputItemFromCycleCandidate(candidate)},
		}
		outputs = append(outputs, output)
	}
	return DailyFeedCyclePreview{
		SelectionToken: seed,
		Cycle: DailyFeedCyclePreviewSummary{
			StartsOn: startsOn.Format(dailyFeedDateLayout), EndsOn: endsOn.Format(dailyFeedDateLayout),
			ConfigurationKey: configuration.Key, Name: configuration.Name, PositionCount: len(dates),
		},
		Counts: DailyFeedCyclePreviewCounts{
			CandidateItemCount: selection.Candidates, MatchingItemCount: selection.Matching,
			DistinctValueCount: selection.DistinctValueCount, RequestedItemCount: len(dates), SelectedItemCount: len(selection.Selected),
		},
		Outputs: outputs,
	}, nil
}

func (s *Server) selectDailyFeedCycleItems(ctx context.Context, configuration DailyFeedCycleConfiguration, count int, seed string) (dailyFeedCycleSelection, error) {
	if len(configuration.Filters) > 0 && configuration.Filters[0].SourceID == "" {
		return dailyFeedCycleSelection{}, badRequest("cycle configuration source metadata is missing")
	}
	sourceID := configuration.SourceID
	if sourceID == "" && len(configuration.Filters) > 0 {
		sourceID = configuration.Filters[0].SourceID
	}
	// Configuration filters can be empty, so load the source from its persisted
	// configuration id when selection is not operating on a request draft.
	if sourceID == "" && configuration.ID != "" {
		err := s.db.QueryRow(ctx, `select source_id::text from group_daily_feed_cycle_configurations where id = $1`, configuration.ID).Scan(&sourceID)
		if err != nil && !errors.Is(err, pgx.ErrNoRows) {
			return dailyFeedCycleSelection{}, err
		}
	}
	if sourceID == "" {
		return dailyFeedCycleSelection{}, badRequest("cycle configuration source is required")
	}
	candidates, err := s.dailyCatalogCandidates(ctx, sourceID)
	if err != nil {
		return dailyFeedCycleSelection{}, err
	}
	selection := dailyFeedCycleSelection{Candidates: len(candidates)}
	matching := make([]dailyCatalogCandidate, 0, len(candidates))
	for _, candidate := range candidates {
		if len(candidate.MissingFields) > 0 || !dailyCandidateMatchesFilters(candidate, configuration.Filters) {
			continue
		}
		action, ok := resolveDailyAction(candidate)
		if !ok {
			continue
		}
		candidate.Action = action
		if configuration.Distinct.Kind == "field" {
			if _, _, ok := dailyFeedCycleScalar(candidate.Data[configuration.Distinct.FieldKey], configuration.Distinct.ValueType); !ok {
				continue
			}
		}
		matching = append(matching, candidate)
	}
	selection.Matching = len(matching)

	selected := make([]dailyCatalogCandidate, 0, count)
	if configuration.Distinct.Kind == "field" {
		groups := map[string][]dailyCatalogCandidate{}
		for _, candidate := range matching {
			key, _, _ := dailyFeedCycleScalar(candidate.Data[configuration.Distinct.FieldKey], configuration.Distinct.ValueType)
			groups[key] = append(groups[key], candidate)
		}
		distinctCount := len(groups)
		selection.DistinctValueCount = &distinctCount
		keys := make([]string, 0, len(groups))
		for key := range groups {
			keys = append(keys, key)
		}
		sort.Slice(keys, func(i, j int) bool {
			left := stableCycleHash(seed, "group", keys[i])
			right := stableCycleHash(seed, "group", keys[j])
			if left != right {
				return left < right
			}
			return keys[i] < keys[j]
		})
		for _, key := range keys {
			group := groups[key]
			sort.Slice(group, func(i, j int) bool {
				left := stableCycleHash(seed, "item", group[i].ID)
				right := stableCycleHash(seed, "item", group[j].ID)
				if left != right {
					return left < right
				}
				return group[i].ID < group[j].ID
			})
			selected = append(selected, group[0])
			if len(selected) == count {
				break
			}
		}
	} else {
		sort.Slice(matching, func(i, j int) bool {
			left := stableCycleHash(seed, "item", matching[i].ID)
			right := stableCycleHash(seed, "item", matching[j].ID)
			if left != right {
				return left < right
			}
			return matching[i].ID < matching[j].ID
		})
		limit := count
		if len(matching) < limit {
			limit = len(matching)
		}
		selected = append(selected, matching[:limit]...)
	}
	if len(selected) < count {
		capacity := len(matching)
		if selection.DistinctValueCount != nil {
			capacity = *selection.DistinctValueCount
		}
		return dailyFeedCycleSelection{}, statusError{
			status:  http.StatusUnprocessableEntity,
			message: fmt.Sprintf("cycle configuration can select only %d of %d required items", capacity, count),
		}
	}
	if configuration.Order.Kind == "field" {
		sort.SliceStable(selected, func(i, j int) bool {
			_, leftValue, leftOK := dailyFeedCycleScalar(selected[i].Data[configuration.Order.FieldKey], configuration.Order.ValueType)
			_, rightValue, rightOK := dailyFeedCycleScalar(selected[j].Data[configuration.Order.FieldKey], configuration.Order.ValueType)
			if leftOK != rightOK {
				return leftOK
			}
			if !leftOK {
				left := stableCycleHash(seed, "order", selected[i].ID)
				right := stableCycleHash(seed, "order", selected[j].ID)
				if left != right {
					return left < right
				}
				return selected[i].ID < selected[j].ID
			}
			comparison := compareDailyFeedCycleScalars(leftValue, rightValue, configuration.Order.ValueType)
			if comparison == 0 {
				left := stableCycleHash(seed, "order", selected[i].ID)
				right := stableCycleHash(seed, "order", selected[j].ID)
				if left != right {
					return left < right
				}
				return selected[i].ID < selected[j].ID
			}
			if configuration.Order.Direction == "desc" {
				return comparison > 0
			}
			return comparison < 0
		})
	}
	selection.Selected = selected
	return selection, nil
}

func dailyFeedCycleScalar(raw any, valueType string) (string, any, bool) {
	if valueType == "number" {
		number, ok := dailyMetadataNumber(raw)
		if !ok {
			return "", nil, false
		}
		return "n:" + strconv.FormatFloat(number, 'g', -1, 64), number, true
	}
	value, ok := dailyMetadataString(raw)
	if !ok {
		return "", nil, false
	}
	return "s:" + value, value, true
}

func compareDailyFeedCycleScalars(left any, right any, valueType string) int {
	if valueType == "number" {
		leftNumber := left.(float64)
		rightNumber := right.(float64)
		switch {
		case leftNumber < rightNumber:
			return -1
		case leftNumber > rightNumber:
			return 1
		default:
			return 0
		}
	}
	return strings.Compare(left.(string), right.(string))
}

func stableCycleHash(seed string, kind string, value string) uint64 {
	sum := sha256.Sum256([]byte(seed + "\x00" + kind + "\x00" + value))
	return binary.BigEndian.Uint64(sum[:8])
}

func dailyFeedOutputItemFromCycleCandidate(candidate dailyCatalogCandidate) DailyFeedOutputItem {
	return DailyFeedOutputItem{
		Position: 1, Role: "primary", Points: 1, Reason: "selected by cycle configuration",
		Item:   DailyCatalogItem{ID: candidate.ID, SourceID: candidate.SourceID, SourceName: candidate.SourceName, Title: candidate.Title, Data: candidate.Data},
		Action: candidate.Action,
	}
}

func (s *Server) putDailyFeedCycleSettings(ctx context.Context, userID string, feed DailyFeed, req upsertDailyFeedCycleSettingsRequest, seed string, requestedStart time.Time) (DailyFeedCycleSettings, error) {
	for _, configuration := range req.Configurations {
		cycleSeed := dailyFeedCycleSelectionSeed(seed, requestedStart, configuration.Key)
		if _, err := s.selectDailyFeedCycleItems(ctx, configuration, req.OutputCount, cycleSeed); err != nil {
			return DailyFeedCycleSettings{}, err
		}
	}

	tx, err := s.db.Begin(ctx)
	if err != nil {
		return DailyFeedCycleSettings{}, err
	}
	defer tx.Rollback(ctx)
	if err := lockDailyFeedForCycleWrite(ctx, tx, feed.GroupID, feed.ID); err != nil {
		return DailyFeedCycleSettings{}, err
	}
	lockedFeed, err := s.getGroupDailyFeed(ctx, feed.GroupID, feed.ID)
	if err != nil {
		return DailyFeedCycleSettings{}, err
	}
	if !dailyFeedSchedulesEqual(feed.Schedule, lockedFeed.Schedule) || !sameOptionalString(feed.SourceID, lockedFeed.SourceID) {
		return DailyFeedCycleSettings{}, statusError{status: http.StatusConflict, message: "daily feed source or schedule changed; retry cycle settings"}
	}

	row, found, err := loadDailyFeedCycleSettingsRow(ctx, tx, feed.ID)
	if err != nil {
		return DailyFeedCycleSettings{}, err
	}
	if found && row.EndsBefore != nil {
		currentDate, err := dailyFeedCycleCurrentDate(row, time.Now())
		if err != nil {
			return DailyFeedCycleSettings{}, err
		}
		if dailyFeedCycleDateBefore(currentDate, *row.EndsBefore) {
			return DailyFeedCycleSettings{}, statusError{status: http.StatusConflict, message: "daily feed cycle settings are ending"}
		}
		if dailyFeedCycleDateBefore(requestedStart, *row.EndsBefore) {
			return DailyFeedCycleSettings{}, statusError{
				status:  http.StatusConflict,
				message: "new cycle settings must start on or after " + row.EndsBefore.Format(dailyFeedDateLayout),
			}
		}
		found = false
		row = dailyFeedCycleSettingsRow{}
	}
	effectiveStart := requestedStart
	if found {
		effectiveStart, err = s.nextDailyFeedCycleBoundary(ctx, feed, row)
		if err != nil {
			return DailyFeedCycleSettings{}, err
		}
		if requestedStart.Format(dailyFeedDateLayout) != effectiveStart.Format(dailyFeedDateLayout) {
			return DailyFeedCycleSettings{}, statusError{
				status:  http.StatusConflict,
				message: "cycle settings changes must start on " + effectiveStart.Format(dailyFeedDateLayout),
			}
		}
	} else {
		var overlaps bool
		if err := tx.QueryRow(ctx, `
			select exists (
				select 1 from group_daily_feed_events
				where feed_id = $1 and ends_before > $2
			)
		`, feed.ID, effectiveStart).Scan(&overlaps); err != nil {
			return DailyFeedCycleSettings{}, err
		}
		if overlaps {
			return DailyFeedCycleSettings{}, statusError{status: http.StatusConflict, message: "feed events must end before cycle settings start"}
		}
		var used bool
		if err := tx.QueryRow(ctx, `
			select exists (
				select 1
				from group_daily_feed_generations g
				where g.feed_id = $1 and g.feed_date >= $2
				union all
				select 1
				from group_daily_feed_instances i
				join group_feed_posts p on p.feed_instance_id = i.id
				where i.feed_id = $1 and i.feed_date >= $2 and p.deleted_at is null
			)
		`, feed.ID, effectiveStart).Scan(&used); err != nil {
			return DailyFeedCycleSettings{}, err
		}
		if used {
			return DailyFeedCycleSettings{}, statusError{status: http.StatusConflict, message: "cycle settings cannot reinterpret a feed date with a refresh or post"}
		}
		if err := tx.QueryRow(ctx, `
				insert into group_daily_feed_cycle_settings (
					group_id, feed_id, starts_on,
					schedule_starts_at, schedule_timezone, schedule_interval_seconds,
					created_by_user_id, updated_by_user_id
				) values ($1, $2, $3, $4, $5, $6, $7, $7)
				returning id::text, created_at, updated_at
			`, feed.GroupID, feed.ID, effectiveStart, feed.Schedule.StartsAt, feed.Schedule.Timezone,
			feed.Schedule.IntervalSeconds, userID).Scan(&row.ID, &row.CreatedAt, &row.UpdatedAt); err != nil {
			return DailyFeedCycleSettings{}, err
		}
		row.GroupID = feed.GroupID
		row.FeedID = feed.ID
		row.StartsOn = effectiveStart
		row.Schedule = feed.Schedule
		found = true
	}

	// An unmaterialized replacement at the same boundary may be replaced as one
	// atomic settings edit. Referenced revisions remain immutable.
	if _, err := tx.Exec(ctx, `
		delete from group_daily_feed_cycle_setting_revisions r
		where r.settings_id = $1 and r.starts_on = $2
		  and not exists (select 1 from group_daily_feed_cycles c where c.revision_id = r.id)
	`, row.ID, effectiveStart); err != nil {
		return DailyFeedCycleSettings{}, err
	}

	var revisionID string
	if err := tx.QueryRow(ctx, `
		insert into group_daily_feed_cycle_setting_revisions (
			settings_id, feed_id, starts_on, output_count, selection_seed, created_by_user_id
		) values ($1, $2, $3, $4, $5, $6)
		returning id::text
	`, row.ID, feed.ID, effectiveStart, req.OutputCount, seed, userID).Scan(&revisionID); err != nil {
		return DailyFeedCycleSettings{}, err
	}
	for position, configuration := range req.Configurations {
		if err := insertDailyFeedCycleConfiguration(ctx, tx, revisionID, feed.ID, *feed.SourceID, position, configuration); err != nil {
			return DailyFeedCycleSettings{}, err
		}
	}
	if _, err := tx.Exec(ctx, `
		update group_daily_feed_cycle_settings
		set ends_before = null, updated_by_user_id = $2
		where id = $1
	`, row.ID, userID); err != nil {
		return DailyFeedCycleSettings{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return DailyFeedCycleSettings{}, err
	}
	return s.getDailyFeedCycleSettings(ctx, feed)
}

func insertDailyFeedCycleConfiguration(ctx context.Context, tx pgx.Tx, revisionID, feedID, sourceID string, position int, configuration DailyFeedCycleConfiguration) error {
	var distinctFieldID, orderFieldID, orderDirection any
	if configuration.Distinct.Kind == "field" {
		distinctFieldID = configuration.Distinct.FieldID
	}
	if configuration.Order.Kind == "field" {
		orderFieldID = configuration.Order.FieldID
		orderDirection = configuration.Order.Direction
	}
	var configurationID string
	if err := tx.QueryRow(ctx, `
		insert into group_daily_feed_cycle_configurations (
			revision_id, feed_id, source_id, key, name, description, position,
			distinct_field_id, order_kind, order_field_id, order_direction
		) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
		returning id::text
	`, revisionID, feedID, sourceID, configuration.Key, configuration.Name, configuration.Description,
		position, distinctFieldID, configuration.Order.Kind, orderFieldID, orderDirection).Scan(&configurationID); err != nil {
		return err
	}
	for filterPosition, filter := range configuration.Filters {
		var textValues, numberValues any
		if len(filter.TextValues) > 0 {
			textValues = filter.TextValues
		}
		if len(filter.NumberValues) > 0 {
			numberValues = filter.NumberValues
		}
		if _, err := tx.Exec(ctx, `
			insert into group_daily_feed_cycle_configuration_filters (
				configuration_id, source_id, field_id, position, op, text_values, number_values
			) values ($1,$2,$3,$4,$5,$6::text[],$7::double precision[]::numeric[])
		`, configurationID, sourceID, filter.FieldID, filterPosition, filter.Op, textValues, numberValues); err != nil {
			return err
		}
	}
	return nil
}

func lockDailyFeedForCycleWrite(ctx context.Context, tx pgx.Tx, groupID, feedID string) error {
	kind, err := lockGroupDailyFeedForWrite(ctx, tx, groupID, feedID)
	if err != nil {
		return err
	}
	if kind != dailyFeedKindCatalogDaily {
		return badRequest("daily thread feeds do not support cycles")
	}
	return nil
}

func dailyFeedCycleSelectionSeed(revisionSeed string, startsOn time.Time, configurationKey string) string {
	sum := sha256.Sum256([]byte(revisionSeed + "\x00" + startsOn.Format(dailyFeedDateLayout) + "\x00" + configurationKey))
	return fmt.Sprintf("%x", sum[:16])
}

type dailyFeedCycleRowQuerier interface {
	QueryRow(context.Context, string, ...any) pgx.Row
}

func loadDailyFeedCycleSettingsRow(ctx context.Context, querier dailyFeedCycleRowQuerier, feedID string) (dailyFeedCycleSettingsRow, bool, error) {
	var row dailyFeedCycleSettingsRow
	var endsBefore sql.NullTime
	err := querier.QueryRow(ctx, `
		select id::text, group_id::text, feed_id::text, starts_on, ends_before,
		       schedule_starts_at, schedule_timezone, schedule_interval_seconds,
		       created_at, updated_at
		from group_daily_feed_cycle_settings
		where feed_id = $1
		order by starts_on desc, created_at desc, id desc
		limit 1
	`, feedID).Scan(&row.ID, &row.GroupID, &row.FeedID, &row.StartsOn, &endsBefore,
		&row.Schedule.StartsAt, &row.Schedule.Timezone, &row.Schedule.IntervalSeconds,
		&row.CreatedAt, &row.UpdatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return dailyFeedCycleSettingsRow{}, false, nil
	}
	if err != nil {
		return dailyFeedCycleSettingsRow{}, false, err
	}
	row.EndsBefore = nullTimePtr(endsBefore)
	return row, true, nil
}

func loadDailyFeedCycleSettingsRowForDate(ctx context.Context, querier dailyFeedCycleRowQuerier, feedID string, date time.Time) (dailyFeedCycleSettingsRow, bool, error) {
	var row dailyFeedCycleSettingsRow
	var endsBefore sql.NullTime
	err := querier.QueryRow(ctx, `
		select id::text, group_id::text, feed_id::text, starts_on, ends_before,
		       schedule_starts_at, schedule_timezone, schedule_interval_seconds,
		       created_at, updated_at
		from group_daily_feed_cycle_settings
		where feed_id = $1
		  and starts_on <= $2
		  and (ends_before is null or $2 < ends_before)
		order by starts_on desc, created_at desc, id desc
		limit 1
	`, feedID, date).Scan(&row.ID, &row.GroupID, &row.FeedID, &row.StartsOn, &endsBefore,
		&row.Schedule.StartsAt, &row.Schedule.Timezone, &row.Schedule.IntervalSeconds,
		&row.CreatedAt, &row.UpdatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return dailyFeedCycleSettingsRow{}, false, nil
	}
	if err != nil {
		return dailyFeedCycleSettingsRow{}, false, err
	}
	row.EndsBefore = nullTimePtr(endsBefore)
	return row, true, nil
}

func (s *Server) getDailyFeedCycleSettings(ctx context.Context, feed DailyFeed) (DailyFeedCycleSettings, error) {
	row, found, err := loadDailyFeedCycleSettingsRow(ctx, s.db, feed.ID)
	if err != nil {
		return DailyFeedCycleSettings{}, err
	}
	if !found {
		return DailyFeedCycleSettings{}, errNotFound("daily feed cycle settings")
	}
	currentDate, err := dailyFeedCycleCurrentDate(row, time.Now())
	if err != nil {
		return DailyFeedCycleSettings{}, err
	}
	if row.EndsBefore != nil && !dailyFeedCycleDateBefore(currentDate, *row.EndsBefore) {
		return DailyFeedCycleSettings{}, errNotFound("daily feed cycle settings")
	}
	revision, err := s.loadLatestDailyFeedCycleRevision(ctx, row.ID)
	if err != nil {
		return DailyFeedCycleSettings{}, err
	}
	status := "active"
	if dailyFeedCycleDateBefore(currentDate, row.StartsOn) {
		status = "scheduled"
	}
	if row.EndsBefore != nil {
		status = "ending"
	}
	settings := DailyFeedCycleSettings{
		ID: row.ID, GroupID: row.GroupID, FeedID: row.FeedID,
		StartsOn: row.StartsOn.Format(dailyFeedDateLayout), OutputCount: revision.OutputCount,
		Status: status, EffectiveStartsOn: revision.StartsOn.Format(dailyFeedDateLayout),
		Configurations: revision.Configurations, CreatedAt: row.CreatedAt, UpdatedAt: row.UpdatedAt,
		SelectionToken: revision.SelectionSeed,
	}
	if row.EndsBefore != nil {
		value := row.EndsBefore.Format(dailyFeedDateLayout)
		settings.EndsBefore = &value
	}
	if next, err := s.nextDailyFeedCycleBoundary(ctx, feed, row); err == nil {
		value := next.Format(dailyFeedDateLayout)
		settings.NextCycleStartsOn = &value
	}
	return settings, nil
}

func (s *Server) loadLatestDailyFeedCycleRevision(ctx context.Context, settingsID string) (dailyFeedCycleRevision, error) {
	var revision dailyFeedCycleRevision
	err := s.db.QueryRow(ctx, `
		select id::text, settings_id::text, starts_on, output_count, selection_seed
		from group_daily_feed_cycle_setting_revisions
		where settings_id = $1
		order by starts_on desc, created_at desc, id desc
		limit 1
	`, settingsID).Scan(&revision.ID, &revision.SettingsID, &revision.StartsOn, &revision.OutputCount, &revision.SelectionSeed)
	if errors.Is(err, pgx.ErrNoRows) {
		return dailyFeedCycleRevision{}, errNotFound("daily feed cycle settings revision")
	}
	if err != nil {
		return dailyFeedCycleRevision{}, err
	}
	revision.Configurations, err = s.loadDailyFeedCycleConfigurations(ctx, revision.ID)
	return revision, err
}

func (s *Server) loadDailyFeedCycleRevisionForDate(ctx context.Context, settingsID string, date time.Time) (dailyFeedCycleRevision, error) {
	var revision dailyFeedCycleRevision
	err := s.db.QueryRow(ctx, `
		select id::text, settings_id::text, starts_on, output_count, selection_seed
		from group_daily_feed_cycle_setting_revisions
		where settings_id = $1 and starts_on <= $2
		order by starts_on desc, created_at desc, id desc
		limit 1
	`, settingsID, date).Scan(&revision.ID, &revision.SettingsID, &revision.StartsOn, &revision.OutputCount, &revision.SelectionSeed)
	if errors.Is(err, pgx.ErrNoRows) {
		return dailyFeedCycleRevision{}, errNotFound("daily feed cycle settings revision")
	}
	if err != nil {
		return dailyFeedCycleRevision{}, err
	}
	revision.Configurations, err = s.loadDailyFeedCycleConfigurations(ctx, revision.ID)
	return revision, err
}

func (s *Server) loadDailyFeedCycleConfigurations(ctx context.Context, revisionID string) ([]DailyFeedCycleConfiguration, error) {
	rows, err := s.db.Query(ctx, `
		select c.id::text, c.source_id::text, c.key, c.name, c.description, c.position,
		       distinct_field.id::text, distinct_field.key, distinct_field.label,
		       distinct_field.value_type, distinct_field.is_array,
		       c.order_kind, order_field.id::text, order_field.key, order_field.label,
		       order_field.value_type, order_field.is_array, c.order_direction
		from group_daily_feed_cycle_configurations c
		left join catalog_source_fields distinct_field on distinct_field.id = c.distinct_field_id
		left join catalog_source_fields order_field on order_field.id = c.order_field_id
		where c.revision_id = $1
		order by c.position
	`, revisionID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	configurations := []DailyFeedCycleConfiguration{}
	for rows.Next() {
		var configuration DailyFeedCycleConfiguration
		var description sql.NullString
		var distinctID, distinctKey, distinctLabel, distinctType sql.NullString
		var distinctArray sql.NullBool
		var orderID, orderKey, orderLabel, orderType, orderDirection sql.NullString
		var orderArray sql.NullBool
		if err := rows.Scan(
			&configuration.ID, &configuration.SourceID, &configuration.Key, &configuration.Name, &description, &configuration.Position,
			&distinctID, &distinctKey, &distinctLabel, &distinctType, &distinctArray,
			&configuration.Order.Kind, &orderID, &orderKey, &orderLabel, &orderType, &orderArray, &orderDirection,
		); err != nil {
			return nil, err
		}
		configuration.Description = nullStringPtr(description)
		configuration.Distinct = DailyFeedCycleDistinct{Kind: "none"}
		if distinctID.Valid {
			configuration.Distinct = DailyFeedCycleDistinct{Kind: "field", DailyFeedCycleConfigurationField: DailyFeedCycleConfigurationField{
				FieldID: distinctID.String, FieldKey: distinctKey.String, FieldLabel: distinctLabel.String,
				ValueType: distinctType.String, IsArray: distinctArray.Bool,
			}}
		}
		if configuration.Order.Kind == "seeded_shuffle" {
			configuration.Order = DailyFeedCycleOrder{Kind: "seeded_shuffle"}
		} else {
			configuration.Order = DailyFeedCycleOrder{Kind: "field", Direction: orderDirection.String, DailyFeedCycleConfigurationField: DailyFeedCycleConfigurationField{
				FieldID: orderID.String, FieldKey: orderKey.String, FieldLabel: orderLabel.String,
				ValueType: orderType.String, IsArray: orderArray.Bool,
			}}
		}
		configuration.Filters, err = s.loadDailyFeedCycleConfigurationFilters(ctx, configuration.ID)
		if err != nil {
			return nil, err
		}
		configurations = append(configurations, configuration)
	}
	return configurations, rows.Err()
}

func (s *Server) loadDailyFeedCycleConfigurationFilters(ctx context.Context, configurationID string) ([]DailyFeedRuleFilter, error) {
	rows, err := s.db.Query(ctx, `
		select f.id::text, f.source_id::text, f.field_id::text, sf.key, sf.label,
		       sf.value_type, sf.is_array, f.position, f.op, f.text_values,
		       f.number_values::double precision[], f.created_at
		from group_daily_feed_cycle_configuration_filters f
		join catalog_source_fields sf on sf.id = f.field_id and sf.source_id = f.source_id
		where f.configuration_id = $1
		order by f.position
	`, configurationID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	filters := []DailyFeedRuleFilter{}
	for rows.Next() {
		var filter DailyFeedRuleFilter
		if err := rows.Scan(&filter.ID, &filter.SourceID, &filter.FieldID, &filter.FieldKey, &filter.FieldLabel,
			&filter.ValueType, &filter.IsArray, &filter.Position, &filter.Op, &filter.TextValues,
			&filter.NumberValues, &filter.CreatedAt); err != nil {
			return nil, err
		}
		filters = append(filters, filter)
	}
	return filters, rows.Err()
}

func (s *Server) nextDailyFeedCycleBoundary(ctx context.Context, feed DailyFeed, settings dailyFeedCycleSettingsRow) (time.Time, error) {
	currentDate, err := dailyFeedCycleCurrentDate(settings, time.Now())
	if err != nil {
		return time.Time{}, err
	}
	if dailyFeedCycleDateBefore(currentDate, settings.StartsOn) {
		return settings.StartsOn, nil
	}
	cycleContext, applies, err := s.dailyFeedCycleContextForDate(ctx, feed, currentDate)
	if err != nil {
		return time.Time{}, err
	}
	if !applies {
		return settings.StartsOn, nil
	}
	afterLast := cycleContext.Dates[len(cycleContext.Dates)-1].AddDate(0, 0, 1)
	dates, err := cycleScheduledDates(settings.Schedule, afterLast, 1)
	if err != nil {
		return time.Time{}, err
	}
	return dates[0], nil
}

func (s *Server) dailyFeedCycleContextForDate(ctx context.Context, feed DailyFeed, date time.Time) (dailyFeedCycleContext, bool, error) {
	settings, found, err := loadDailyFeedCycleSettingsRowForDate(ctx, s.db, feed.ID, date)
	if err != nil || !found {
		return dailyFeedCycleContext{}, false, err
	}
	dateKey := date.Format(dailyFeedDateLayout)
	date, err = time.Parse(dailyFeedDateLayout, dateKey)
	if err != nil {
		return dailyFeedCycleContext{}, false, err
	}
	if dailyFeedCycleDateBefore(date, settings.StartsOn) || (settings.EndsBefore != nil && !dailyFeedCycleDateBefore(date, *settings.EndsBefore)) {
		return dailyFeedCycleContext{}, false, nil
	}
	schedule := settings.Schedule
	if ok, err := cycleDateIsScheduled(schedule, date); err != nil {
		return dailyFeedCycleContext{}, false, err
	} else if !ok {
		return dailyFeedCycleContext{}, false, badRequest("date is not a scheduled feed output")
	}
	revision, err := s.loadDailyFeedCycleRevisionForDate(ctx, settings.ID, date)
	if err != nil {
		return dailyFeedCycleContext{}, false, err
	}
	windows, err := scheduledFeedDateWindows(schedule, revision.StartsOn, date)
	if err != nil {
		return dailyFeedCycleContext{}, false, err
	}
	revisionDates := make([]time.Time, 0, len(windows))
	dateIndex := -1
	for _, window := range windows {
		if dailyFeedCycleDateBefore(window.Date, revision.StartsOn) {
			continue
		}
		if window.Date.Format(dailyFeedDateLayout) == dateKey {
			dateIndex = len(revisionDates)
		}
		revisionDates = append(revisionDates, window.Date)
	}
	if dateIndex < 0 {
		return dailyFeedCycleContext{}, false, badRequest("date is not a scheduled feed output")
	}
	revisionCycleNumber := int64(dateIndex / revision.OutputCount)
	cycleStartIndex := int(revisionCycleNumber) * revision.OutputCount
	var cycleDates []time.Time
	if len(revisionDates)-cycleStartIndex >= revision.OutputCount {
		cycleDates = append([]time.Time(nil), revisionDates[cycleStartIndex:cycleStartIndex+revision.OutputCount]...)
	} else {
		cycleDates, err = cycleScheduledDates(schedule, revisionDates[cycleStartIndex], revision.OutputCount)
		if err != nil {
			return dailyFeedCycleContext{}, false, err
		}
	}
	globalCycleNumber, err := s.dailyFeedCycleGlobalNumber(ctx, schedule, settings.ID, revision, revisionCycleNumber)
	if err != nil {
		return dailyFeedCycleContext{}, false, err
	}
	if len(revision.Configurations) == 0 {
		return dailyFeedCycleContext{}, false, statusError{status: http.StatusUnprocessableEntity, message: "cycle settings revision has no configurations"}
	}
	configuration := revision.Configurations[int(revisionCycleNumber%int64(len(revision.Configurations)))]
	return dailyFeedCycleContext{
		SettingsID: settings.ID, GroupID: settings.GroupID, FeedID: settings.FeedID,
		SettingsStarts: settings.StartsOn, SettingsEnd: settings.EndsBefore, Schedule: settings.Schedule,
		Revision: revision, Configuration: configuration,
		CycleNumber: globalCycleNumber, RevisionCycleNumber: revisionCycleNumber,
		StartsOn: cycleDates[0], EndsBefore: cycleDates[len(cycleDates)-1].AddDate(0, 0, 1), Dates: cycleDates,
	}, true, nil
}

func (s *Server) dailyFeedCycleGlobalNumber(ctx context.Context, schedule DailyFeedSchedule, settingsID string, selected dailyFeedCycleRevision, localCycle int64) (int64, error) {
	rows, err := s.db.Query(ctx, `
		select starts_on, output_count
		from group_daily_feed_cycle_setting_revisions
		where settings_id = $1 and starts_on < $2
		order by starts_on
	`, settingsID, selected.StartsOn)
	if err != nil {
		return 0, err
	}
	defer rows.Close()
	type priorRevision struct {
		StartsOn    time.Time
		OutputCount int
	}
	priors := []priorRevision{}
	for rows.Next() {
		var revision priorRevision
		if err := rows.Scan(&revision.StartsOn, &revision.OutputCount); err != nil {
			return 0, err
		}
		priors = append(priors, revision)
	}
	if err := rows.Err(); err != nil {
		return 0, err
	}
	global := int64(0)
	for index, prior := range priors {
		end := selected.StartsOn
		if index+1 < len(priors) {
			end = priors[index+1].StartsOn
		}
		windows, err := scheduledFeedDateWindows(schedule, prior.StartsOn, end.AddDate(0, 0, -1))
		if err != nil {
			return 0, err
		}
		if len(windows)%prior.OutputCount != 0 {
			return 0, statusError{status: http.StatusConflict, message: "cycle settings revision does not begin on a cycle boundary"}
		}
		global += int64(len(windows) / prior.OutputCount)
	}
	return global + localCycle, nil
}

func (s *Server) endDailyFeedCycleSettings(ctx context.Context, userID string, feed DailyFeed) error {
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	if err := lockDailyFeedForCycleWrite(ctx, tx, feed.GroupID, feed.ID); err != nil {
		return err
	}
	settings, found, err := loadDailyFeedCycleSettingsRow(ctx, tx, feed.ID)
	if err != nil {
		return err
	}
	if !found {
		return errNotFound("daily feed cycle settings")
	}
	currentDate, err := dailyFeedCycleCurrentDate(settings, time.Now())
	if err != nil {
		return err
	}
	if settings.EndsBefore != nil && !dailyFeedCycleDateBefore(currentDate, *settings.EndsBefore) {
		return errNotFound("daily feed cycle settings")
	}
	if dailyFeedCycleDateBefore(currentDate, settings.StartsOn) {
		if _, err := tx.Exec(ctx, `delete from group_daily_feed_cycle_settings where id = $1`, settings.ID); err != nil {
			return err
		}
		return tx.Commit(ctx)
	}
	nextBoundary, err := s.nextDailyFeedCycleBoundary(ctx, feed, settings)
	if err != nil {
		return err
	}
	if _, err := tx.Exec(ctx, `
		delete from group_daily_feed_cycle_setting_revisions r
		where r.settings_id = $1
		  and r.starts_on >= $2
		  and not exists (select 1 from group_daily_feed_cycles c where c.revision_id = r.id)
	`, settings.ID, nextBoundary); err != nil {
		return err
	}
	if _, err := tx.Exec(ctx, `
		update group_daily_feed_cycle_settings
		set ends_before = $2, updated_by_user_id = $3
		where id = $1
	`, settings.ID, nextBoundary, userID); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

func (s *Server) ensureDailyFeedCycleForDate(ctx context.Context, feed DailyFeed, date time.Time) (DailyFeedCycle, bool, error) {
	cycleContext, applies, err := s.dailyFeedCycleContextForDate(ctx, feed, date)
	if err != nil || !applies {
		return DailyFeedCycle{}, applies, err
	}
	currentDate, err := dailyFeedOutputDateAt(cycleContext.Schedule, nil, time.Now())
	if err != nil {
		return DailyFeedCycle{}, true, err
	}
	if dailyFeedCycleDateAfter(date, currentDate) {
		return DailyFeedCycle{}, true, statusError{status: http.StatusConflict, message: "upcoming cycles are available through preview only"}
	}
	if cycle, found, err := s.loadDailyFeedCycleForContext(ctx, feed, cycleContext); err != nil || found {
		return cycle, true, err
	}
	if err := s.insertDailyFeedCycle(ctx, feed, cycleContext); err != nil {
		return DailyFeedCycle{}, true, err
	}
	cycle, _, err := s.loadDailyFeedCycleForContext(ctx, feed, cycleContext)
	return cycle, true, err
}

func (s *Server) insertDailyFeedCycle(ctx context.Context, feed DailyFeed, cycleContext dailyFeedCycleContext) error {
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	if err := lockDailyFeedForCycleWrite(ctx, tx, feed.GroupID, feed.ID); err != nil {
		return err
	}
	resolvedContext, applies, err := s.dailyFeedCycleContextForDate(ctx, feed, cycleContext.StartsOn)
	if err != nil {
		return err
	}
	if !applies {
		return statusError{status: http.StatusConflict, message: "daily feed cycle settings changed; retry output"}
	}
	cycleContext = resolvedContext
	var exists bool
	if err := tx.QueryRow(ctx, `
		select exists (
			select 1 from group_daily_feed_cycles
			where settings_id = $1 and cycle_number = $2
		)
	`, cycleContext.SettingsID, cycleContext.CycleNumber).Scan(&exists); err != nil {
		return err
	}
	if exists {
		return tx.Commit(ctx)
	}
	seed := dailyFeedCycleSelectionSeed(cycleContext.Revision.SelectionSeed, cycleContext.StartsOn, cycleContext.Configuration.Key)
	selection, err := s.selectDailyFeedCycleItems(ctx, cycleContext.Configuration, len(cycleContext.Dates), seed)
	if err != nil {
		return err
	}
	var cycleID string
	if err := tx.QueryRow(ctx, `
		insert into group_daily_feed_cycles (
			group_id, feed_id, settings_id, revision_id, configuration_id, source_id,
			cycle_number, revision_cycle_number, starts_on, ends_before, selection_seed
		) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
		returning id::text
	`, feed.GroupID, feed.ID, cycleContext.SettingsID, cycleContext.Revision.ID,
		cycleContext.Configuration.ID, cycleContext.Configuration.SourceID,
		cycleContext.CycleNumber, cycleContext.RevisionCycleNumber,
		cycleContext.StartsOn, cycleContext.EndsBefore, seed).Scan(&cycleID); err != nil {
		return err
	}
	for index, candidate := range selection.Selected {
		if err := insertDailyFeedCycleItem(ctx, tx, cycleID, feed.ID, index+1, cycleContext.Dates[index], candidate); err != nil {
			return err
		}
	}
	return tx.Commit(ctx)
}

func insertDailyFeedCycleItem(ctx context.Context, tx pgx.Tx, cycleID, feedID string, position int, date time.Time, candidate dailyCatalogCandidate) error {
	itemData, err := json.Marshal(candidate.Data)
	if err != nil {
		return err
	}
	title := strings.TrimSpace(candidate.Title)
	if title == "" {
		title = "Untitled"
	}
	var actionURL, actionText any
	if candidate.Action.Type == "external_url" {
		actionURL = candidate.Action.URL
	} else {
		actionText = candidate.Action.Text
	}
	_, err = tx.Exec(ctx, `
		insert into group_daily_feed_cycle_items (
			cycle_id, feed_id, catalog_item_id, position, feed_date,
			item_source_id, item_source_name, item_title, item_data,
			action_type, action_label, action_url, action_text
		) values ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,$11,$12,$13)
	`, cycleID, feedID, candidate.ID, position, date,
		candidate.SourceID, candidate.SourceName, title, string(itemData),
		candidate.Action.Type, candidate.Action.Label, actionURL, actionText)
	return err
}

func (s *Server) loadDailyFeedCycleForContext(ctx context.Context, feed DailyFeed, cycleContext dailyFeedCycleContext) (DailyFeedCycle, bool, error) {
	var cycleID string
	err := s.db.QueryRow(ctx, `
		select id::text from group_daily_feed_cycles
		where settings_id = $1 and cycle_number = $2
	`, cycleContext.SettingsID, cycleContext.CycleNumber).Scan(&cycleID)
	if errors.Is(err, pgx.ErrNoRows) {
		return DailyFeedCycle{}, false, nil
	}
	if err != nil {
		return DailyFeedCycle{}, false, err
	}
	cycle, err := s.getDailyFeedCycleByID(ctx, feed, cycleID)
	return cycle, true, err
}

func (s *Server) getDailyFeedCycleByID(ctx context.Context, feed DailyFeed, cycleID string) (DailyFeedCycle, error) {
	var cycle DailyFeedCycle
	var configurationID string
	var startsOn, endsOn time.Time
	var schedule DailyFeedSchedule
	err := s.db.QueryRow(ctx, `
		select c.id::text, c.group_id::text, c.feed_id::text, c.configuration_id::text,
		       cfg.key, cfg.name, c.starts_on, c.ends_before - 1,
		       c.generation, settings.schedule_starts_at, settings.schedule_timezone,
		       settings.schedule_interval_seconds
		from group_daily_feed_cycles c
		join group_daily_feed_cycle_configurations cfg on cfg.id = c.configuration_id
		join group_daily_feed_cycle_settings settings on settings.id = c.settings_id
		where c.group_id = $1 and c.feed_id = $2 and c.id = $3
	`, feed.GroupID, feed.ID, cycleID).Scan(
		&cycle.ID, &cycle.GroupID, &cycle.FeedID, &configurationID,
		&cycle.ConfigurationKey, &cycle.Name, &startsOn, &endsOn, &cycle.Generation,
		&schedule.StartsAt, &schedule.Timezone, &schedule.IntervalSeconds,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return DailyFeedCycle{}, errNotFound("daily feed cycle")
	}
	if err != nil {
		return DailyFeedCycle{}, err
	}
	cycle.StartsOn = startsOn.Format(dailyFeedDateLayout)
	cycle.EndsOn = endsOn.Format(dailyFeedDateLayout)
	configurations, err := s.loadDailyFeedCycleConfigurationsForCycle(ctx, cycleID)
	if err != nil {
		return DailyFeedCycle{}, err
	}
	if len(configurations) != 1 || configurations[0].ID != configurationID {
		return DailyFeedCycle{}, errors.New("daily feed cycle configuration is missing")
	}
	cycle.Summary = dailyFeedCycleConfigurationSummary(configurations[0])
	cycle.Items, err = s.loadDailyFeedCycleItems(ctx, cycle.ID)
	if err != nil {
		return DailyFeedCycle{}, err
	}
	cycle.PositionCount = len(cycle.Items)
	currentDate, dateErr := dailyFeedOutputDateAt(schedule, nil, time.Now())
	if dateErr != nil {
		return DailyFeedCycle{}, dateErr
	}
	start, _ := time.Parse(dailyFeedDateLayout, cycle.StartsOn)
	end, _ := time.Parse(dailyFeedDateLayout, cycle.EndsOn)
	cycle.Status = "active"
	if dailyFeedCycleDateBefore(currentDate, start) {
		cycle.Status = "upcoming"
	} else if dailyFeedCycleDateAfter(currentDate, end) {
		cycle.Status = "ended"
	}
	return cycle, nil
}

func (s *Server) listDailyFeedCycles(ctx context.Context, feed DailyFeed) ([]DailyFeedCycle, error) {
	rows, err := s.db.Query(ctx, `
		select id::text
		from group_daily_feed_cycles
		where group_id = $1 and feed_id = $2
		order by starts_on desc, id desc
	`, feed.GroupID, feed.ID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	ids := []string{}
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		ids = append(ids, id)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}

	cycles := make([]DailyFeedCycle, 0, len(ids))
	for _, id := range ids {
		cycle, err := s.getDailyFeedCycleByID(ctx, feed, id)
		if err != nil {
			return nil, err
		}
		cycles = append(cycles, cycle)
	}
	return cycles, nil
}

func (s *Server) refreshDailyFeedCycle(ctx context.Context, userID string, feed DailyFeed, cycleID string) (DailyFeedCycle, error) {
	cycle, err := s.getDailyFeedCycleByID(ctx, feed, cycleID)
	if err != nil {
		return DailyFeedCycle{}, err
	}
	if cycle.Status != "active" {
		return DailyFeedCycle{}, statusError{status: http.StatusConflict, message: "only the current daily feed cycle can be refreshed"}
	}
	configurations, err := s.loadDailyFeedCycleConfigurationsForCycle(ctx, cycleID)
	if err != nil {
		return DailyFeedCycle{}, err
	}
	if len(configurations) != 1 {
		return DailyFeedCycle{}, errors.New("daily feed cycle configuration is missing")
	}
	dates := make([]time.Time, 0, len(cycle.Items))
	for _, item := range cycle.Items {
		date, err := parseDailyFeedPathDate(item.Date)
		if err != nil {
			return DailyFeedCycle{}, err
		}
		dates = append(dates, date)
	}

	tx, err := s.db.Begin(ctx)
	if err != nil {
		return DailyFeedCycle{}, err
	}
	defer tx.Rollback(ctx)
	if err := lockDailyFeedForCycleWrite(ctx, tx, feed.GroupID, feed.ID); err != nil {
		return DailyFeedCycle{}, err
	}
	var currentGeneration int
	var startsOn, endsBefore time.Time
	var schedule DailyFeedSchedule
	if err := tx.QueryRow(ctx, `
		select c.generation, c.starts_on, c.ends_before,
		       settings.schedule_starts_at, settings.schedule_timezone,
		       settings.schedule_interval_seconds
		from group_daily_feed_cycles c
		join group_daily_feed_cycle_settings settings on settings.id = c.settings_id
		where c.group_id = $1 and c.feed_id = $2 and c.id = $3
	`, feed.GroupID, feed.ID, cycleID).Scan(&currentGeneration, &startsOn, &endsBefore,
		&schedule.StartsAt, &schedule.Timezone, &schedule.IntervalSeconds); errors.Is(err, pgx.ErrNoRows) {
		return DailyFeedCycle{}, errNotFound("daily feed cycle")
	} else if err != nil {
		return DailyFeedCycle{}, err
	}
	if currentGeneration != cycle.Generation {
		return DailyFeedCycle{}, statusError{status: http.StatusConflict, message: "daily feed cycle changed; retry refresh"}
	}
	currentDate, err := dailyFeedOutputDateAt(schedule, nil, time.Now())
	if err != nil {
		return DailyFeedCycle{}, err
	}
	if dailyFeedCycleDateBefore(currentDate, startsOn) || !dailyFeedCycleDateBefore(currentDate, endsBefore) {
		return DailyFeedCycle{}, statusError{status: http.StatusConflict, message: "only the current daily feed cycle can be refreshed"}
	}
	var hasPosts bool
	if err := tx.QueryRow(ctx, `
		select exists (
			select 1
			from group_daily_feed_instances i
			join group_feed_posts p on p.feed_instance_id = i.id
			where i.feed_id = $1
			  and i.feed_date >= $2
			  and i.feed_date < $3
			  and p.deleted_at is null
		)
	`, feed.ID, startsOn, endsBefore).Scan(&hasPosts); err != nil {
		return DailyFeedCycle{}, err
	}
	if hasPosts {
		return DailyFeedCycle{}, statusError{status: http.StatusConflict, message: "daily feed cycle cannot be refreshed after a post exists in the cycle"}
	}
	seed, err := randomHex(16)
	if err != nil {
		return DailyFeedCycle{}, err
	}
	selection, err := s.selectDailyFeedCycleItems(ctx, configurations[0], cycle.PositionCount, seed)
	if err != nil {
		return DailyFeedCycle{}, err
	}
	if _, err := tx.Exec(ctx, `delete from group_daily_feed_cycle_items where cycle_id = $1`, cycleID); err != nil {
		return DailyFeedCycle{}, err
	}
	for index, candidate := range selection.Selected {
		if err := insertDailyFeedCycleItem(ctx, tx, cycleID, feed.ID, index+1, dates[index], candidate); err != nil {
			return DailyFeedCycle{}, err
		}
	}
	tag, err := tx.Exec(ctx, `
		update group_daily_feed_cycles
		set generation = generation + 1,
		    selection_seed = $4,
		    refreshed_by_user_id = $5,
		    refreshed_at = now()
		where group_id = $1 and feed_id = $2 and id = $3 and generation = $6
	`, feed.GroupID, feed.ID, cycleID, seed, userID, currentGeneration)
	if err != nil {
		return DailyFeedCycle{}, err
	}
	if tag.RowsAffected() == 0 {
		return DailyFeedCycle{}, statusError{status: http.StatusConflict, message: "daily feed cycle changed; retry refresh"}
	}
	if err := tx.Commit(ctx); err != nil {
		return DailyFeedCycle{}, err
	}
	return s.getDailyFeedCycleByID(ctx, feed, cycleID)
}

func dailyFeedOutputForCycleDate(feed DailyFeed, cycle DailyFeedCycle, date time.Time) (DailyFeedOutput, error) {
	dateKey := date.Format(dailyFeedDateLayout)
	for _, cycleItem := range cycle.Items {
		if cycleItem.Date != dateKey {
			continue
		}
		return DailyFeedOutput{
			FeedID:    feed.ID,
			GroupID:   feed.GroupID,
			GroupName: feed.GroupName,
			Date:      dateKey,
			Title:     feed.Name,
			Cycle: &DailyFeedOutputCycle{
				ID:               cycle.ID,
				Name:             cycle.Name,
				ConfigurationKey: cycle.ConfigurationKey,
				StartsOn:         cycle.StartsOn,
				EndsOn:           cycle.EndsOn,
				Position:         cycleItem.Position,
				PositionCount:    cycle.PositionCount,
				Summary:          cycle.Summary,
			},
			Items: []DailyFeedOutputItem{{
				Position: 1,
				Role:     "primary",
				Points:   1,
				Reason:   "selected by cycle configuration",
				Item:     cycleItem.Item,
				Action:   cycleItem.Action,
			}},
		}, nil
	}
	return DailyFeedOutput{}, errors.New("daily feed cycle item is missing for date " + dateKey)
}

func (s *Server) loadDailyFeedCycleConfigurationsForCycle(ctx context.Context, cycleID string) ([]DailyFeedCycleConfiguration, error) {
	var revisionID string
	if err := s.db.QueryRow(ctx, `select revision_id::text from group_daily_feed_cycles where id = $1`, cycleID).Scan(&revisionID); err != nil {
		return nil, err
	}
	configurations, err := s.loadDailyFeedCycleConfigurations(ctx, revisionID)
	if err != nil {
		return nil, err
	}
	var configurationID string
	if err := s.db.QueryRow(ctx, `select configuration_id::text from group_daily_feed_cycles where id = $1`, cycleID).Scan(&configurationID); err != nil {
		return nil, err
	}
	for _, configuration := range configurations {
		if configuration.ID == configurationID {
			return []DailyFeedCycleConfiguration{configuration}, nil
		}
	}
	return nil, nil
}

func (s *Server) loadDailyFeedCycleItems(ctx context.Context, cycleID string) ([]DailyFeedCycleItem, error) {
	rows, err := s.db.Query(ctx, `
		select position, feed_date, catalog_item_id::text, item_source_id::text,
		       item_source_name, item_title, item_data, action_type, action_label,
		       action_url, action_text
		from group_daily_feed_cycle_items
		where cycle_id = $1
		order by position
	`, cycleID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := []DailyFeedCycleItem{}
	for rows.Next() {
		var item DailyFeedCycleItem
		var date time.Time
		var dataJSON []byte
		var actionURL, actionText sql.NullString
		if err := rows.Scan(&item.Position, &date, &item.Item.ID, &item.Item.SourceID,
			&item.Item.SourceName, &item.Item.Title, &dataJSON, &item.Action.Type,
			&item.Action.Label, &actionURL, &actionText); err != nil {
			return nil, err
		}
		item.Date = date.Format(dailyFeedDateLayout)
		item.Item.Data = map[string]any{}
		if err := json.Unmarshal(dataJSON, &item.Item.Data); err != nil {
			return nil, err
		}
		if actionURL.Valid {
			item.Action.URL = actionURL.String
		}
		if actionText.Valid {
			item.Action.Text = actionText.String
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func dailyFeedCycleConfigurationSummary(configuration DailyFeedCycleConfiguration) DailyFeedCycleConfigurationSummary {
	filters := make([]string, 0, len(configuration.Filters))
	for _, filter := range configuration.Filters {
		filters = append(filters, dailyFeedCycleFilterSummary(filter))
	}
	distinct := "No metadata distinctness"
	if configuration.Distinct.Kind == "field" {
		distinct = "Distinct " + configuration.Distinct.FieldLabel
	}
	order := "Seeded shuffle"
	if configuration.Order.Kind == "field" {
		direction := "low to high"
		if configuration.Order.Direction == "desc" {
			direction = "high to low"
		}
		order = configuration.Order.FieldLabel + " " + direction
	}
	return DailyFeedCycleConfigurationSummary{Filters: filters, Distinct: distinct, Order: order}
}

func dailyFeedCycleFilterSummary(filter DailyFeedRuleFilter) string {
	label := firstNonEmptyString(filter.FieldLabel, filter.FieldKey, "Field")
	if filter.ValueType == "number" {
		values := make([]string, 0, len(filter.NumberValues))
		for _, value := range filter.NumberValues {
			values = append(values, strconv.FormatFloat(value, 'g', -1, 64))
		}
		if filter.Op == "between" && len(values) == 2 {
			return label + " " + values[0] + "–" + values[1]
		}
		return label + " " + filter.Op + " " + strings.Join(values, ", ")
	}
	return label + " " + strings.ReplaceAll(filter.Op, "_", " ") + " " + strings.Join(filter.TextValues, ", ")
}

func (s *Server) hydrateDailyFeedCycleSettingsSummary(ctx context.Context, feed *DailyFeed) error {
	feed.CycleSettings = nil
	if feed.Kind != dailyFeedKindCatalogDaily {
		return nil
	}
	row, found, err := loadDailyFeedCycleSettingsRow(ctx, s.db, feed.ID)
	if err != nil || !found {
		return err
	}
	currentDate, err := dailyFeedCycleCurrentDate(row, time.Now())
	if err != nil {
		return err
	}
	status := "active"
	if dailyFeedCycleDateBefore(currentDate, row.StartsOn) {
		status = "scheduled"
	}
	if row.EndsBefore != nil {
		status = "ending"
		if !dailyFeedCycleDateBefore(currentDate, *row.EndsBefore) {
			status = "ended"
		}
	}
	summary := &DailyFeedCycleSettingsSummary{
		ID:       row.ID,
		StartsOn: row.StartsOn.Format(dailyFeedDateLayout),
		Status:   status,
	}
	if row.EndsBefore != nil {
		value := row.EndsBefore.Format(dailyFeedDateLayout)
		summary.EndsBefore = &value
	}
	feed.CycleSettings = summary
	return nil
}

func dailyFeedCycleSettingsAreActive(summary *DailyFeedCycleSettingsSummary) bool {
	return summary != nil && summary.Status != "ended"
}
