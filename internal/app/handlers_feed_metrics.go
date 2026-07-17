package app

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"math"
	"net/http"
	"net/url"
	"slices"
	"sort"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
)

const (
	feedMetricKeyJudged                 = "judged"
	feedMetricKeyPostCount              = "post_count"
	feedMetricKeyAveragePostLengthWords = "average_post_length_words"
	feedMetricKeyMissedDays             = "missed_days"
	feedMetricKeyCurrentStreak          = "current_streak"
	feedMetricKeyTypicalPostingWindow   = "typical_posting_window"

	metricAggregationSum     = "sum"
	metricAggregationAverage = "average"
	metricAggregationLatest  = "latest"
	metricAggregationCount   = "count"
	metricAggregationMax     = "max"
	metricAggregationMin     = "min"
)

type createFeedMetricRequest struct {
	SystemKey      string  `json:"system_key"`
	JudgmentPrompt *string `json:"judgment_prompt"`
	Aggregation    string  `json:"aggregation"`
	DisplayName    string  `json:"display_name"`
}

type patchFeedMetricRequest struct {
	JudgmentPrompt optionalStringField `json:"judgment_prompt"`
	Aggregation    optionalStringField `json:"aggregation"`
	DisplayName    optionalStringField `json:"display_name"`
}

type createMetricJudgmentRequest struct {
	PostID string  `json:"post_id"`
	Value  float64 `json:"value"`
	Note   *string `json:"note"`
}

type patchMetricJudgmentRequest struct {
	Value optionalFloatField          `json:"value"`
	Note  optionalNullableStringField `json:"note"`
}

type optionalFloatField struct {
	Set   bool
	Value float64
}

func (field *optionalFloatField) UnmarshalJSON(data []byte) error {
	field.Set = true
	if strings.TrimSpace(string(data)) == "null" {
		return errors.New("field must be a number")
	}
	return json.Unmarshal(data, &field.Value)
}

type normalizedFeedMetricInput struct {
	SystemKey      string
	JudgmentPrompt *string
	Aggregation    string
	DisplayName    string
}

type normalizedFeedMetricPatch struct {
	JudgmentPromptSet bool
	JudgmentPrompt    *string
	Aggregation       *string
	DisplayName       *string
}

type normalizedMetricJudgmentInput struct {
	PostID string
	Value  float64
	Note   *string
}

type normalizedMetricJudgmentPatch struct {
	Value *float64
	Note  optionalNullableStringField
}

type systemMetricDefinition struct {
	Key                 string
	DefaultDisplayName  string
	DefaultAggregation  string
	AllowedAggregations []string
	Rankable            bool
	Compute             systemMetricComputeFunc
}

type systemMetricComputeFunc func(context.Context, *Server, metricComputationInput) ([]metricSample, error)

type metricComputationInput struct {
	GroupID string
	Feed    DailyFeed
	Metric  FeedMetric
	From    time.Time
	To      time.Time
	Now     time.Time
}

type metricSample struct {
	UserID    string
	Value     float64
	TextValue *string
	At        time.Time
}

type scheduledFeedDateWindow struct {
	Date     time.Time
	StartsAt time.Time
	EndsAt   time.Time
}

type feedPostDateTimestamp struct {
	UserID    string
	Date      time.Time
	CreatedAt time.Time
}

type metricAggregate struct {
	Value       any
	RawValue    *float64
	SampleCount int
}

var judgedMetricAllowedAggregations = []string{
	metricAggregationSum,
	metricAggregationAverage,
	metricAggregationLatest,
	metricAggregationCount,
	metricAggregationMax,
	metricAggregationMin,
}

var systemMetricRegistry = map[string]systemMetricDefinition{
	feedMetricKeyPostCount: {
		Key:                 feedMetricKeyPostCount,
		DefaultDisplayName:  "Post count",
		DefaultAggregation:  metricAggregationCount,
		AllowedAggregations: []string{metricAggregationCount, metricAggregationSum},
		Rankable:            true,
		Compute:             computePostCountMetricSamples,
	},
	feedMetricKeyAveragePostLengthWords: {
		Key:                 feedMetricKeyAveragePostLengthWords,
		DefaultDisplayName:  "Average post length",
		DefaultAggregation:  metricAggregationAverage,
		AllowedAggregations: []string{metricAggregationAverage, metricAggregationMax, metricAggregationMin},
		Rankable:            true,
		Compute:             computeAveragePostLengthMetricSamples,
	},
	feedMetricKeyMissedDays: {
		Key:                 feedMetricKeyMissedDays,
		DefaultDisplayName:  "Missed days",
		DefaultAggregation:  metricAggregationCount,
		AllowedAggregations: []string{metricAggregationCount, metricAggregationSum},
		Rankable:            true,
		Compute:             computeMissedDaysMetricSamples,
	},
	feedMetricKeyCurrentStreak: {
		Key:                 feedMetricKeyCurrentStreak,
		DefaultDisplayName:  "Current streak",
		DefaultAggregation:  metricAggregationLatest,
		AllowedAggregations: []string{metricAggregationLatest, metricAggregationMax},
		Rankable:            true,
		Compute:             computeCurrentStreakMetricSamples,
	},
	feedMetricKeyTypicalPostingWindow: {
		Key:                 feedMetricKeyTypicalPostingWindow,
		DefaultDisplayName:  "Typical posting window",
		DefaultAggregation:  metricAggregationLatest,
		AllowedAggregations: []string{metricAggregationLatest},
		Rankable:            false,
		Compute:             computeTypicalPostingWindowMetricSamples,
	},
}

func (s *Server) handleListFeedMetrics(w http.ResponseWriter, r *http.Request) {
	current, err := requireUser(r.Context())
	if err != nil {
		handleError(w, err)
		return
	}

	groupID := r.PathValue("group_id")
	feedID := r.PathValue("feed_id")
	if _, _, err := s.authorizeFeedMetricRead(r.Context(), current.ID, groupID, feedID); err != nil {
		handleError(w, err)
		return
	}

	metrics, err := s.listGroupDailyFeedMetrics(r.Context(), groupID, feedID)
	if err != nil {
		handleError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, metrics)
}

func (s *Server) handleCreateFeedMetric(w http.ResponseWriter, r *http.Request) {
	current, err := requireUser(r.Context())
	if err != nil {
		handleError(w, err)
		return
	}

	groupID := r.PathValue("group_id")
	feedID := r.PathValue("feed_id")
	if err := s.requireMetricManager(r.Context(), current.ID, groupID); err != nil {
		handleError(w, err)
		return
	}
	if _, err := s.getGroupDailyFeed(r.Context(), groupID, feedID); err != nil {
		handleError(w, err)
		return
	}

	var req createFeedMetricRequest
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid JSON request")
		return
	}
	input, err := normalizeCreateFeedMetricRequest(req)
	if err != nil {
		handleError(w, err)
		return
	}

	var metricID string
	err = s.db.QueryRow(r.Context(), `
		insert into group_daily_feed_metrics (
			group_id,
			feed_id,
			system_key,
			judgment_prompt,
			aggregation,
			display_name,
			created_by_user_id
		)
		values ($1, $2, $3, $4, $5, $6, $7)
		returning id::text
	`, groupID, feedID, input.SystemKey, input.JudgmentPrompt, input.Aggregation, input.DisplayName, current.ID).Scan(&metricID)
	if err != nil {
		handleError(w, err)
		return
	}

	metric, err := s.getGroupDailyFeedMetric(r.Context(), groupID, feedID, metricID)
	if err != nil {
		handleError(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, metric)
}

func (s *Server) handleGetFeedMetric(w http.ResponseWriter, r *http.Request) {
	current, err := requireUser(r.Context())
	if err != nil {
		handleError(w, err)
		return
	}

	groupID := r.PathValue("group_id")
	feedID := r.PathValue("feed_id")
	if _, _, err := s.authorizeFeedMetricRead(r.Context(), current.ID, groupID, feedID); err != nil {
		handleError(w, err)
		return
	}

	metric, err := s.getGroupDailyFeedMetric(r.Context(), groupID, feedID, r.PathValue("metric_id"))
	if err != nil {
		handleError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, metric)
}

func (s *Server) handlePatchFeedMetric(w http.ResponseWriter, r *http.Request) {
	current, err := requireUser(r.Context())
	if err != nil {
		handleError(w, err)
		return
	}

	groupID := r.PathValue("group_id")
	feedID := r.PathValue("feed_id")
	metricID := r.PathValue("metric_id")
	if err := s.requireMetricManager(r.Context(), current.ID, groupID); err != nil {
		handleError(w, err)
		return
	}

	currentMetric, err := s.getGroupDailyFeedMetric(r.Context(), groupID, feedID, metricID)
	if err != nil {
		handleError(w, err)
		return
	}

	var req patchFeedMetricRequest
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid JSON request")
		return
	}
	patch, err := normalizePatchFeedMetricRequest(currentMetric, req)
	if err != nil {
		handleError(w, err)
		return
	}

	tag, err := s.db.Exec(r.Context(), `
		update group_daily_feed_metrics
		set display_name = coalesce($4, display_name),
		    aggregation = coalesce($5, aggregation),
		    judgment_prompt = case when $6 then $7::text else judgment_prompt end
		where group_id = $1 and feed_id = $2 and id = $3
	`, groupID, feedID, metricID, patch.DisplayName, patch.Aggregation, patch.JudgmentPromptSet, patch.JudgmentPrompt)
	if err != nil {
		handleError(w, err)
		return
	}
	if tag.RowsAffected() == 0 {
		handleError(w, errNotFound("feed metric"))
		return
	}

	metric, err := s.getGroupDailyFeedMetric(r.Context(), groupID, feedID, metricID)
	if err != nil {
		handleError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, metric)
}

func (s *Server) handleDeleteFeedMetric(w http.ResponseWriter, r *http.Request) {
	current, err := requireUser(r.Context())
	if err != nil {
		handleError(w, err)
		return
	}

	groupID := r.PathValue("group_id")
	if err := s.requireMetricManager(r.Context(), current.ID, groupID); err != nil {
		handleError(w, err)
		return
	}

	tag, err := s.db.Exec(r.Context(), `
		delete from group_daily_feed_metrics
		where group_id = $1 and feed_id = $2 and id = $3
	`, groupID, r.PathValue("feed_id"), r.PathValue("metric_id"))
	if err != nil {
		handleError(w, err)
		return
	}
	if tag.RowsAffected() == 0 {
		handleError(w, errNotFound("feed metric"))
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) handleGetMetricLeaderboard(w http.ResponseWriter, r *http.Request) {
	current, err := requireUser(r.Context())
	if err != nil {
		handleError(w, err)
		return
	}

	groupID := r.PathValue("group_id")
	feedID := r.PathValue("feed_id")
	_, feed, err := s.authorizeFeedMetricRead(r.Context(), current.ID, groupID, feedID)
	if err != nil {
		handleError(w, err)
		return
	}

	metric, err := s.getGroupDailyFeedMetric(r.Context(), groupID, feedID, r.PathValue("metric_id"))
	if err != nil {
		handleError(w, err)
		return
	}

	now := time.Now()
	from, to, err := metricLeaderboardRange(feed, r.URL.Query(), now)
	if err != nil {
		handleError(w, err)
		return
	}

	members, err := s.listActiveGroupMembers(r.Context(), groupID)
	if err != nil {
		handleError(w, err)
		return
	}

	samples, err := s.computeMetricSamples(r.Context(), metricComputationInput{
		GroupID: groupID,
		Feed:    feed,
		Metric:  metric,
		From:    from,
		To:      to,
		Now:     now,
	})
	if err != nil {
		handleError(w, err)
		return
	}

	writeJSON(w, http.StatusOK, MetricLeaderboard{
		Metric: metric,
		From:   from.Format(dailyFeedDateLayout),
		To:     to.Format(dailyFeedDateLayout),
		Rows:   buildMetricLeaderboardRows(metric, members, samples),
	})
}

func (s *Server) handleCreateMetricJudgment(w http.ResponseWriter, r *http.Request) {
	current, err := requireUser(r.Context())
	if err != nil {
		handleError(w, err)
		return
	}

	groupID := r.PathValue("group_id")
	feedID := r.PathValue("feed_id")
	metricID := r.PathValue("metric_id")
	role, err := s.activeGroupRole(r.Context(), current.ID, groupID)
	if err != nil {
		handleError(w, err)
		return
	}
	if !canManageDailyFeeds(role) {
		handleError(w, forbidden("insufficient group permissions"))
		return
	}

	metric, err := s.getGroupDailyFeedMetric(r.Context(), groupID, feedID, metricID)
	if err != nil {
		handleError(w, err)
		return
	}
	if metric.SystemKey != feedMetricKeyJudged {
		handleError(w, badRequest("only judged metrics accept judgments"))
		return
	}

	var req createMetricJudgmentRequest
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid JSON request")
		return
	}
	input, err := normalizeCreateMetricJudgmentRequest(req)
	if err != nil {
		handleError(w, err)
		return
	}

	post, err := s.canJudgeMetric(r.Context(), current.ID, groupID, metricID, input.PostID)
	if err != nil {
		handleError(w, err)
		return
	}

	var judgmentID string
	err = s.db.QueryRow(r.Context(), `
		insert into group_daily_feed_metric_judgments (
			metric_id,
			group_id,
			post_id,
			subject_user_id,
			evaluator_user_id,
			value,
			note
		)
		values ($1, $2, $3, $4, $5, $6, $7)
		on conflict (metric_id, post_id, evaluator_user_id) do update set
			subject_user_id = excluded.subject_user_id,
			value = excluded.value,
			note = excluded.note
		returning id::text
	`, metric.ID, groupID, post.ID, post.AuthorUserID, current.ID, input.Value, input.Note).Scan(&judgmentID)
	if err != nil {
		handleError(w, err)
		return
	}

	judgment, err := s.getMetricJudgment(r.Context(), groupID, judgmentID)
	if err != nil {
		handleError(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, judgment)
}

func (s *Server) handlePatchMetricJudgment(w http.ResponseWriter, r *http.Request) {
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

	judgment, err := s.getMetricJudgment(r.Context(), groupID, r.PathValue("judgment_id"))
	if err != nil {
		handleError(w, err)
		return
	}
	if judgment.EvaluatorUserID != current.ID && !canManageDailyFeeds(role) {
		handleError(w, forbidden("insufficient group permissions"))
		return
	}

	var req patchMetricJudgmentRequest
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid JSON request")
		return
	}
	patch, err := normalizePatchMetricJudgmentRequest(req)
	if err != nil {
		handleError(w, err)
		return
	}

	tag, err := s.db.Exec(r.Context(), `
		update group_daily_feed_metric_judgments
		set value = coalesce($3, value),
		    note = case when $4 then $5::text else note end
		where group_id = $1 and id = $2
	`, groupID, judgment.ID, patch.Value, patch.Note.Set, patch.Note.Value)
	if err != nil {
		handleError(w, err)
		return
	}
	if tag.RowsAffected() == 0 {
		handleError(w, errNotFound("metric judgment"))
		return
	}

	updated, err := s.getMetricJudgment(r.Context(), groupID, judgment.ID)
	if err != nil {
		handleError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, updated)
}

func (s *Server) handleDeleteMetricJudgment(w http.ResponseWriter, r *http.Request) {
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

	judgment, err := s.getMetricJudgment(r.Context(), groupID, r.PathValue("judgment_id"))
	if err != nil {
		handleError(w, err)
		return
	}
	if judgment.EvaluatorUserID != current.ID && !canManageDailyFeeds(role) {
		handleError(w, forbidden("insufficient group permissions"))
		return
	}

	tag, err := s.db.Exec(r.Context(), `
		delete from group_daily_feed_metric_judgments
		where group_id = $1 and id = $2
	`, groupID, judgment.ID)
	if err != nil {
		handleError(w, err)
		return
	}
	if tag.RowsAffected() == 0 {
		handleError(w, errNotFound("metric judgment"))
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) listGroupDailyFeedMetrics(ctx context.Context, groupID string, feedID string) ([]FeedMetric, error) {
	rows, err := s.db.Query(ctx, feedMetricSelectSQL()+`
		where group_id = $1 and feed_id = $2
		order by lower(display_name), id
	`, groupID, feedID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	metrics := []FeedMetric{}
	for rows.Next() {
		metric, err := scanFeedMetric(rows)
		if err != nil {
			return nil, err
		}
		metrics = append(metrics, metric)
	}
	return metrics, rows.Err()
}

func (s *Server) getGroupDailyFeedMetric(ctx context.Context, groupID string, feedID string, metricID string) (FeedMetric, error) {
	metric, err := scanFeedMetric(s.db.QueryRow(ctx, feedMetricSelectSQL()+`
		where group_id = $1 and feed_id = $2 and id = $3
	`, groupID, feedID, metricID))
	if errors.Is(err, pgx.ErrNoRows) {
		return FeedMetric{}, errNotFound("feed metric")
	}
	return metric, err
}

func feedMetricSelectSQL() string {
	return `
		select
			id::text,
			group_id::text,
			feed_id::text,
			system_key,
			judgment_prompt,
			aggregation,
			display_name,
			created_by_user_id::text,
			created_at,
			updated_at
		from group_daily_feed_metrics
	`
}

func scanFeedMetric(row pgx.Row) (FeedMetric, error) {
	var metric FeedMetric
	var judgmentPrompt sql.NullString
	var createdByUserID sql.NullString
	if err := row.Scan(
		&metric.ID,
		&metric.GroupID,
		&metric.FeedID,
		&metric.SystemKey,
		&judgmentPrompt,
		&metric.Aggregation,
		&metric.DisplayName,
		&createdByUserID,
		&metric.CreatedAt,
		&metric.UpdatedAt,
	); err != nil {
		return FeedMetric{}, err
	}
	metric.JudgmentPrompt = nullStringPtr(judgmentPrompt)
	metric.CreatedByUserID = nullStringPtr(createdByUserID)
	return metric, nil
}

func (s *Server) getMetricJudgment(ctx context.Context, groupID string, judgmentID string) (FeedMetricJudgment, error) {
	judgment, err := scanMetricJudgment(s.db.QueryRow(ctx, metricJudgmentSelectSQL()+`
		where group_id = $1 and id = $2
	`, groupID, judgmentID))
	if errors.Is(err, pgx.ErrNoRows) {
		return FeedMetricJudgment{}, errNotFound("metric judgment")
	}
	return judgment, err
}

func metricJudgmentSelectSQL() string {
	return `
		select
			id::text,
			metric_id::text,
			group_id::text,
			post_id::text,
			subject_user_id::text,
			evaluator_user_id::text,
			value::double precision,
			note,
			created_at,
			updated_at
		from group_daily_feed_metric_judgments
	`
}

func scanMetricJudgment(row pgx.Row) (FeedMetricJudgment, error) {
	var judgment FeedMetricJudgment
	var note sql.NullString
	if err := row.Scan(
		&judgment.ID,
		&judgment.MetricID,
		&judgment.GroupID,
		&judgment.PostID,
		&judgment.SubjectUserID,
		&judgment.EvaluatorUserID,
		&judgment.Value,
		&note,
		&judgment.CreatedAt,
		&judgment.UpdatedAt,
	); err != nil {
		return FeedMetricJudgment{}, err
	}
	judgment.Note = nullStringPtr(note)
	return judgment, nil
}

func normalizeCreateFeedMetricRequest(req createFeedMetricRequest) (normalizedFeedMetricInput, error) {
	systemKey := strings.TrimSpace(req.SystemKey)
	if systemKey == "" {
		return normalizedFeedMetricInput{}, badRequest("system_key is required")
	}
	if !validFeedMetricKey(systemKey) {
		return normalizedFeedMetricInput{}, badRequest("system_key is not supported")
	}

	aggregation := strings.TrimSpace(req.Aggregation)
	if aggregation == "" {
		aggregation = defaultAggregationForMetricKey(systemKey)
	}
	if !aggregationAllowedForMetricKey(systemKey, aggregation) {
		return normalizedFeedMetricInput{}, badRequest("aggregation is not allowed for this metric")
	}

	displayName := strings.TrimSpace(req.DisplayName)
	if displayName == "" {
		if definition, ok := systemMetricRegistry[systemKey]; ok {
			displayName = definition.DefaultDisplayName
		}
	}
	if displayName == "" {
		return normalizedFeedMetricInput{}, badRequest("display_name is required")
	}

	var judgmentPrompt *string
	if systemKey == feedMetricKeyJudged {
		judgmentPrompt = trimOptionalString(req.JudgmentPrompt)
		if judgmentPrompt == nil {
			return normalizedFeedMetricInput{}, badRequest("judgment_prompt is required for judged metrics")
		}
	} else if req.JudgmentPrompt != nil && strings.TrimSpace(*req.JudgmentPrompt) != "" {
		return normalizedFeedMetricInput{}, badRequest("system metrics do not support judgment_prompt")
	}

	return normalizedFeedMetricInput{
		SystemKey:      systemKey,
		JudgmentPrompt: judgmentPrompt,
		Aggregation:    aggregation,
		DisplayName:    displayName,
	}, nil
}

func normalizePatchFeedMetricRequest(metric FeedMetric, req patchFeedMetricRequest) (normalizedFeedMetricPatch, error) {
	if !req.JudgmentPrompt.Set && !req.Aggregation.Set && !req.DisplayName.Set {
		return normalizedFeedMetricPatch{}, badRequest("at least one field is required")
	}

	var patch normalizedFeedMetricPatch
	if req.DisplayName.Set {
		displayName := strings.TrimSpace(req.DisplayName.Value)
		if displayName == "" {
			return normalizedFeedMetricPatch{}, badRequest("display_name is required")
		}
		patch.DisplayName = &displayName
	}
	if req.Aggregation.Set {
		aggregation := strings.TrimSpace(req.Aggregation.Value)
		if !aggregationAllowedForMetricKey(metric.SystemKey, aggregation) {
			return normalizedFeedMetricPatch{}, badRequest("aggregation is not allowed for this metric")
		}
		patch.Aggregation = &aggregation
	}
	if req.JudgmentPrompt.Set {
		if metric.SystemKey != feedMetricKeyJudged {
			return normalizedFeedMetricPatch{}, badRequest("system metrics do not support judgment_prompt")
		}
		judgmentPrompt := strings.TrimSpace(req.JudgmentPrompt.Value)
		if judgmentPrompt == "" {
			return normalizedFeedMetricPatch{}, badRequest("judgment_prompt is required for judged metrics")
		}
		patch.JudgmentPromptSet = true
		patch.JudgmentPrompt = &judgmentPrompt
	}

	return patch, nil
}

func normalizeCreateMetricJudgmentRequest(req createMetricJudgmentRequest) (normalizedMetricJudgmentInput, error) {
	postID := strings.TrimSpace(req.PostID)
	if postID == "" {
		return normalizedMetricJudgmentInput{}, badRequest("post_id is required")
	}
	if err := validateMetricJudgmentValue(req.Value); err != nil {
		return normalizedMetricJudgmentInput{}, err
	}
	note, err := normalizeMetricJudgmentNote(req.Note)
	if err != nil {
		return normalizedMetricJudgmentInput{}, err
	}
	return normalizedMetricJudgmentInput{
		PostID: postID,
		Value:  req.Value,
		Note:   note,
	}, nil
}

func normalizePatchMetricJudgmentRequest(req patchMetricJudgmentRequest) (normalizedMetricJudgmentPatch, error) {
	if !req.Value.Set && !req.Note.Set {
		return normalizedMetricJudgmentPatch{}, badRequest("at least one field is required")
	}

	var patch normalizedMetricJudgmentPatch
	if req.Value.Set {
		if err := validateMetricJudgmentValue(req.Value.Value); err != nil {
			return normalizedMetricJudgmentPatch{}, err
		}
		value := req.Value.Value
		patch.Value = &value
	}
	if req.Note.Set {
		note, err := normalizeMetricJudgmentNote(req.Note.Value)
		if err != nil {
			return normalizedMetricJudgmentPatch{}, err
		}
		patch.Note.Set = true
		patch.Note.Value = note
	}
	return patch, nil
}

func normalizeMetricJudgmentNote(note *string) (*string, error) {
	if note == nil {
		return nil, nil
	}
	trimmed := strings.TrimSpace(*note)
	if trimmed == "" {
		return nil, badRequest("note cannot be empty")
	}
	return &trimmed, nil
}

func validateMetricJudgmentValue(value float64) error {
	if math.IsNaN(value) || math.IsInf(value, 0) || value < 0 {
		return badRequest("value must be a non-negative finite number")
	}
	return nil
}

func validFeedMetricKey(systemKey string) bool {
	if systemKey == feedMetricKeyJudged {
		return true
	}
	_, ok := systemMetricRegistry[systemKey]
	return ok
}

func defaultAggregationForMetricKey(systemKey string) string {
	if systemKey == feedMetricKeyJudged {
		return metricAggregationAverage
	}
	if definition, ok := systemMetricRegistry[systemKey]; ok {
		return definition.DefaultAggregation
	}
	return ""
}

func aggregationAllowedForMetricKey(systemKey string, aggregation string) bool {
	if systemKey == feedMetricKeyJudged {
		return slices.Contains(judgedMetricAllowedAggregations, aggregation)
	}
	definition, ok := systemMetricRegistry[systemKey]
	return ok && slices.Contains(definition.AllowedAggregations, aggregation)
}

func (s *Server) authorizeFeedMetricRead(ctx context.Context, userID string, groupID string, feedID string) (string, DailyFeed, error) {
	role, err := s.activeGroupRole(ctx, userID, groupID)
	if err != nil {
		return "", DailyFeed{}, err
	}
	feed, err := s.getGroupDailyFeed(ctx, groupID, feedID)
	if err != nil {
		return "", DailyFeed{}, err
	}
	if !feed.Enabled && !canManageDailyFeeds(role) {
		return "", DailyFeed{}, errNotFound("daily feed")
	}
	return role, feed, nil
}

func (s *Server) requireMetricManager(ctx context.Context, userID string, groupID string) error {
	return s.requireGroupRole(ctx, userID, groupID, "owner", "admin")
}

func (s *Server) canJudgeMetric(ctx context.Context, userID string, groupID string, metricID string, postID string) (GroupFeedPost, error) {
	post, err := s.getGroupFeedPost(ctx, groupID, postID)
	if err != nil {
		return GroupFeedPost{}, err
	}
	if post.DeletedAt != nil {
		return GroupFeedPost{}, errNotFound("feed post")
	}
	if post.AuthorUserID == userID {
		return GroupFeedPost{}, forbidden("self-judgment is not allowed")
	}

	var belongs bool
	err = s.db.QueryRow(ctx, `
		select exists(
			select 1
			from group_daily_feed_metrics m
			where m.group_id = $1
			  and m.id = $2
			  and m.feed_id = $3
		)
	`, groupID, metricID, post.FeedID).Scan(&belongs)
	if err != nil {
		return GroupFeedPost{}, err
	}
	if !belongs {
		return GroupFeedPost{}, badRequest("post does not belong to the metric feed")
	}
	return post, nil
}

func (s *Server) listActiveGroupMembers(ctx context.Context, groupID string) ([]PublicUser, error) {
	rows, err := s.db.Query(ctx, `
		select
			u.id::text,
			u.username,
			u.display_name,
			u.avatar_url
		from group_memberships gm
		join users u on u.id = gm.user_id
		where gm.group_id = $1 and gm.status = 'active'
		order by lower(u.display_name), u.id
	`, groupID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	members := []PublicUser{}
	for rows.Next() {
		var member PublicUser
		var avatarURL sql.NullString
		if err := rows.Scan(&member.ID, &member.Username, &member.DisplayName, &avatarURL); err != nil {
			return nil, err
		}
		member.AvatarURL = nullStringPtr(avatarURL)
		members = append(members, member)
	}
	return members, rows.Err()
}

func (s *Server) activeGroupMemberJoinTimes(ctx context.Context, groupID string) (map[string]*time.Time, error) {
	rows, err := s.db.Query(ctx, `
		select user_id::text, joined_at
		from group_memberships
		where group_id = $1 and status = 'active'
	`, groupID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	joinTimes := map[string]*time.Time{}
	for rows.Next() {
		var userID string
		var joinedAt sql.NullTime
		if err := rows.Scan(&userID, &joinedAt); err != nil {
			return nil, err
		}
		joinTimes[userID] = nullTimePtr(joinedAt)
	}
	return joinTimes, rows.Err()
}

func (s *Server) computeMetricSamples(ctx context.Context, input metricComputationInput) ([]metricSample, error) {
	if input.Metric.SystemKey == feedMetricKeyJudged {
		return s.computeJudgedMetricSamples(ctx, input)
	}
	definition, ok := systemMetricRegistry[input.Metric.SystemKey]
	if !ok {
		return nil, badRequest("system_key is not supported")
	}
	return definition.Compute(ctx, s, input)
}

func (s *Server) computeJudgedMetricSamples(ctx context.Context, input metricComputationInput) ([]metricSample, error) {
	rows, err := s.db.Query(ctx, `
		select
			j.subject_user_id::text,
			j.value::double precision,
			j.updated_at
		from group_daily_feed_metric_judgments j
		join group_feed_posts p on p.id = j.post_id and p.group_id = j.group_id
		join group_daily_feed_instances i on i.id = p.feed_instance_id and i.group_id = p.group_id
		where j.group_id = $1
		  and j.metric_id = $2
		  and i.feed_id = $3
		  and i.feed_date >= $4
		  and i.feed_date <= $5
		  and p.deleted_at is null
	`, input.GroupID, input.Metric.ID, input.Feed.ID, input.From, input.To)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	samples := []metricSample{}
	for rows.Next() {
		var sample metricSample
		if err := rows.Scan(&sample.UserID, &sample.Value, &sample.At); err != nil {
			return nil, err
		}
		samples = append(samples, sample)
	}
	return samples, rows.Err()
}

func computePostCountMetricSamples(ctx context.Context, s *Server, input metricComputationInput) ([]metricSample, error) {
	rows, err := s.db.Query(ctx, `
		select
			p.author_user_id::text,
			1::double precision,
			p.created_at
		from group_feed_posts p
		join group_daily_feed_instances i on i.id = p.feed_instance_id and i.group_id = p.group_id
		where p.group_id = $1
		  and i.feed_id = $2
		  and i.feed_date >= $3
		  and i.feed_date <= $4
		  and p.deleted_at is null
	`, input.GroupID, input.Feed.ID, input.From, input.To)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	samples := []metricSample{}
	for rows.Next() {
		var sample metricSample
		if err := rows.Scan(&sample.UserID, &sample.Value, &sample.At); err != nil {
			return nil, err
		}
		samples = append(samples, sample)
	}
	return samples, rows.Err()
}

func computeAveragePostLengthMetricSamples(ctx context.Context, s *Server, input metricComputationInput) ([]metricSample, error) {
	rows, err := s.db.Query(ctx, `
		select
			p.author_user_id::text,
			p.evidence_text,
			p.created_at
		from group_feed_posts p
		join group_daily_feed_instances i on i.id = p.feed_instance_id and i.group_id = p.group_id
		where p.group_id = $1
		  and i.feed_id = $2
		  and i.feed_date >= $3
		  and i.feed_date <= $4
		  and p.deleted_at is null
	`, input.GroupID, input.Feed.ID, input.From, input.To)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	samples := []metricSample{}
	for rows.Next() {
		var sample metricSample
		var evidenceText string
		if err := rows.Scan(&sample.UserID, &evidenceText, &sample.At); err != nil {
			return nil, err
		}
		sample.Value = float64(wordCount(evidenceText))
		samples = append(samples, sample)
	}
	return samples, rows.Err()
}

func computeMissedDaysMetricSamples(ctx context.Context, s *Server, input metricComputationInput) ([]metricSample, error) {
	windows, err := scheduledFeedDateWindows(input.Feed.Schedule, input.From, input.To)
	if err != nil {
		return nil, err
	}
	if len(windows) == 0 {
		return []metricSample{}, nil
	}

	members, err := s.listActiveGroupMembers(ctx, input.GroupID)
	if err != nil {
		return nil, err
	}
	joinTimes, err := s.activeGroupMemberJoinTimes(ctx, input.GroupID)
	if err != nil {
		return nil, err
	}
	posted, err := s.feedPostDateSet(ctx, input.GroupID, input.Feed.ID, input.From, input.To)
	if err != nil {
		return nil, err
	}

	samples := []metricSample{}
	for _, member := range members {
		for _, window := range scheduledFeedWindowsSinceJoin(windows, joinTimes[member.ID]) {
			date := window.Date
			key := member.ID + "\x00" + date.Format(dailyFeedDateLayout)
			if posted[key] {
				continue
			}
			samples = append(samples, metricSample{
				UserID: member.ID,
				Value:  1,
				At:     date,
			})
		}
	}
	return samples, nil
}

func computeCurrentStreakMetricSamples(ctx context.Context, s *Server, input metricComputationInput) ([]metricSample, error) {
	windows, err := scheduledFeedDateWindows(input.Feed.Schedule, input.From, input.To)
	if err != nil {
		return nil, err
	}
	if len(windows) == 0 {
		return []metricSample{}, nil
	}

	members, err := s.listActiveGroupMembers(ctx, input.GroupID)
	if err != nil {
		return nil, err
	}
	joinTimes, err := s.activeGroupMemberJoinTimes(ctx, input.GroupID)
	if err != nil {
		return nil, err
	}
	posted, err := s.feedTimelyPostDateSet(ctx, input.GroupID, input.Feed.ID, windows)
	if err != nil {
		return nil, err
	}

	now := input.Now
	if now.IsZero() {
		now = time.Now()
	}
	latestDate := windows[len(windows)-1].Date
	samples := make([]metricSample, 0, len(members))
	for _, member := range members {
		memberWindows := scheduledFeedWindowsSinceJoin(windows, joinTimes[member.ID])
		streak := currentStreakForMember(member.ID, memberWindows, posted, now)
		samples = append(samples, metricSample{
			UserID: member.ID,
			Value:  float64(streak),
			At:     latestDate,
		})
	}
	return samples, nil
}

func computeTypicalPostingWindowMetricSamples(ctx context.Context, s *Server, input metricComputationInput) ([]metricSample, error) {
	location, err := time.LoadLocation(input.Feed.Schedule.Timezone)
	if err != nil {
		return nil, badRequest("schedule timezone is invalid")
	}

	rows, err := s.db.Query(ctx, `
		select
			p.author_user_id::text,
			p.created_at
		from group_feed_posts p
		join group_daily_feed_instances i on i.id = p.feed_instance_id and i.group_id = p.group_id
		where p.group_id = $1
		  and i.feed_id = $2
		  and i.feed_date >= $3
		  and i.feed_date <= $4
		  and p.deleted_at is null
		order by p.author_user_id, p.created_at
	`, input.GroupID, input.Feed.ID, input.From, input.To)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	type postingWindow struct {
		minMinutes int
		maxMinutes int
		latest     time.Time
		seen       bool
	}
	windows := map[string]postingWindow{}
	for rows.Next() {
		var userID string
		var postedAt time.Time
		if err := rows.Scan(&userID, &postedAt); err != nil {
			return nil, err
		}
		local := postedAt.In(location)
		minutes := local.Hour()*60 + local.Minute()
		window := windows[userID]
		if !window.seen || minutes < window.minMinutes {
			window.minMinutes = minutes
		}
		if !window.seen || minutes > window.maxMinutes {
			window.maxMinutes = minutes
		}
		if !window.seen || postedAt.After(window.latest) {
			window.latest = postedAt
		}
		window.seen = true
		windows[userID] = window
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}

	samples := make([]metricSample, 0, len(windows))
	for userID, window := range windows {
		text := formatPostingWindow(window.minMinutes, window.maxMinutes)
		samples = append(samples, metricSample{
			UserID:    userID,
			TextValue: &text,
			At:        window.latest,
		})
	}
	return samples, nil
}

func feedLifetimeMetricLeaderboardRange(feed DailyFeed, now time.Time) (time.Time, time.Time, error) {
	timezone := feed.Schedule.Timezone
	if timezone == "" {
		timezone = "UTC"
	}
	location, err := time.LoadLocation(timezone)
	if err != nil {
		return time.Time{}, time.Time{}, badRequest("schedule timezone is invalid")
	}
	if now.IsZero() {
		now = time.Now()
	}

	start := feed.CreatedAt
	if start.IsZero() {
		start = feed.Schedule.StartsAt
	}
	if start.IsZero() {
		start = now
	}

	fromLocal := start.In(location)
	toLocal := now.In(location)
	from := time.Date(fromLocal.Year(), fromLocal.Month(), fromLocal.Day(), 0, 0, 0, 0, location)
	to := time.Date(toLocal.Year(), toLocal.Month(), toLocal.Day(), 0, 0, 0, 0, location)
	if to.Before(from) {
		to = from
	}
	return from, to, nil
}

func metricLeaderboardRange(feed DailyFeed, query url.Values, now time.Time) (time.Time, time.Time, error) {
	fromRaw := strings.TrimSpace(query.Get("from"))
	toRaw := strings.TrimSpace(query.Get("to"))
	if fromRaw == "" && toRaw == "" {
		return feedLifetimeMetricLeaderboardRange(feed, now)
	}
	if fromRaw == "" || toRaw == "" {
		return time.Time{}, time.Time{}, badRequest("from and to are required together")
	}

	from, err := time.Parse(dailyFeedDateLayout, fromRaw)
	if err != nil {
		return time.Time{}, time.Time{}, badRequest("from must use YYYY-MM-DD")
	}
	to, err := time.Parse(dailyFeedDateLayout, toRaw)
	if err != nil {
		return time.Time{}, time.Time{}, badRequest("to must use YYYY-MM-DD")
	}
	if to.Before(from) {
		return time.Time{}, time.Time{}, badRequest("from must be before or equal to to")
	}
	return from, to, nil
}

func (s *Server) feedPostDateSet(ctx context.Context, groupID string, feedID string, from time.Time, to time.Time) (map[string]bool, error) {
	rows, err := s.db.Query(ctx, `
		select distinct
			p.author_user_id::text,
			i.feed_date
		from group_feed_posts p
		join group_daily_feed_instances i on i.id = p.feed_instance_id and i.group_id = p.group_id
		where p.group_id = $1
		  and i.feed_id = $2
		  and i.feed_date >= $3
		  and i.feed_date <= $4
		  and p.deleted_at is null
	`, groupID, feedID, from, to)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	posted := map[string]bool{}
	for rows.Next() {
		var userID string
		var date time.Time
		if err := rows.Scan(&userID, &date); err != nil {
			return nil, err
		}
		posted[userID+"\x00"+date.Format(dailyFeedDateLayout)] = true
	}
	return posted, rows.Err()
}

func (s *Server) feedTimelyPostDateSet(ctx context.Context, groupID string, feedID string, windows []scheduledFeedDateWindow) (map[string]bool, error) {
	if len(windows) == 0 {
		return map[string]bool{}, nil
	}

	from := windows[0].Date
	to := windows[len(windows)-1].Date
	rows, err := s.db.Query(ctx, `
		select
			p.author_user_id::text,
			i.feed_date,
			p.created_at
		from group_feed_posts p
		join group_daily_feed_instances i on i.id = p.feed_instance_id and i.group_id = p.group_id
		where p.group_id = $1
		  and i.feed_id = $2
		  and i.feed_date >= $3
		  and i.feed_date <= $4
		  and p.deleted_at is null
	`, groupID, feedID, from, to)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	posts := []feedPostDateTimestamp{}
	for rows.Next() {
		var post feedPostDateTimestamp
		if err := rows.Scan(&post.UserID, &post.Date, &post.CreatedAt); err != nil {
			return nil, err
		}
		posts = append(posts, post)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return buildTimelyPostDateSet(windows, posts), nil
}

func buildTimelyPostDateSet(windows []scheduledFeedDateWindow, posts []feedPostDateTimestamp) map[string]bool {
	windowByKey := map[string]scheduledFeedDateWindow{}
	for _, window := range windows {
		windowByKey[window.Date.Format(dailyFeedDateLayout)] = window
	}

	posted := map[string]bool{}
	for _, post := range posts {
		dateKey := post.Date.Format(dailyFeedDateLayout)
		window, ok := windowByKey[dateKey]
		if !ok {
			continue
		}
		if post.CreatedAt.Before(window.StartsAt) || !post.CreatedAt.Before(window.EndsAt) {
			continue
		}
		posted[post.UserID+"\x00"+dateKey] = true
	}
	return posted
}

func scheduledFeedDates(schedule DailyFeedSchedule, from time.Time, to time.Time) ([]time.Time, error) {
	windows, err := scheduledFeedDateWindows(schedule, from, to)
	if err != nil {
		return nil, err
	}
	dates := make([]time.Time, 0, len(windows))
	for _, window := range windows {
		dates = append(dates, window.Date)
	}
	return dates, nil
}

func scheduledFeedDateWindows(schedule DailyFeedSchedule, from time.Time, to time.Time) ([]scheduledFeedDateWindow, error) {
	timezone := schedule.Timezone
	if timezone == "" {
		timezone = "UTC"
	}
	location, err := time.LoadLocation(timezone)
	if err != nil {
		return nil, badRequest("schedule timezone is invalid")
	}
	if schedule.IntervalSeconds <= 0 {
		return nil, badRequest("schedule interval_seconds must be positive")
	}

	fromDate := time.Date(from.Year(), from.Month(), from.Day(), 0, 0, 0, 0, location)
	toDate := time.Date(to.Year(), to.Month(), to.Day(), 0, 0, 0, 0, location)
	if fromDate.After(toDate) {
		return []scheduledFeedDateWindow{}, nil
	}

	start := schedule.StartsAt
	if start.IsZero() {
		start = defaultScheduleStartsAt(location)
	}
	boundary := start.In(location)
	interval := time.Duration(schedule.IntervalSeconds) * time.Second
	if boundary.Before(fromDate) {
		elapsed := fromDate.Sub(boundary)
		steps := int64(elapsed / interval)
		boundary = boundary.Add(time.Duration(steps) * interval)
		for boundary.Before(fromDate) {
			boundary = boundary.Add(interval)
		}
	}

	windowByKey := map[string]scheduledFeedDateWindow{}
	endExclusive := toDate.AddDate(0, 0, 1)
	for boundary.Before(endExclusive) {
		local := boundary.In(location)
		date := time.Date(local.Year(), local.Month(), local.Day(), 0, 0, 0, 0, location)
		if !date.Before(fromDate) && !date.After(toDate) {
			key := date.Format(dailyFeedDateLayout)
			window := scheduledFeedDateWindow{
				Date:     date,
				StartsAt: boundary,
				EndsAt:   boundary.Add(interval),
			}
			existing, ok := windowByKey[key]
			if !ok || window.EndsAt.After(existing.EndsAt) {
				windowByKey[key] = window
			}
		}
		boundary = boundary.Add(interval)
		if len(windowByKey) > 3660 {
			return nil, badRequest("leaderboard range is too large")
		}
	}

	windows := make([]scheduledFeedDateWindow, 0, len(windowByKey))
	for _, window := range windowByKey {
		windows = append(windows, window)
	}
	sort.Slice(windows, func(i, j int) bool {
		return windows[i].Date.Before(windows[j].Date)
	})
	return windows, nil
}

func scheduledFeedWindowsSinceJoin(windows []scheduledFeedDateWindow, joinedAt *time.Time) []scheduledFeedDateWindow {
	if joinedAt == nil {
		return windows
	}
	for index, window := range windows {
		if window.EndsAt.After(*joinedAt) {
			return windows[index:]
		}
	}
	return windows[len(windows):]
}

func currentStreakForMember(memberID string, windows []scheduledFeedDateWindow, posted map[string]bool, now time.Time) int {
	streak := 0
	for index := len(windows) - 1; index >= 0; index-- {
		window := windows[index]
		key := memberID + "\x00" + window.Date.Format(dailyFeedDateLayout)
		if posted[key] {
			streak++
			continue
		}
		if window.EndsAt.After(now) {
			continue
		}
		break
	}
	return streak
}

func wordCount(value string) int {
	return len(strings.Fields(value))
}

func formatPostingWindow(minMinutes int, maxMinutes int) string {
	if minMinutes == maxMinutes {
		return formatPostingWindowTime(minMinutes)
	}
	return formatPostingWindowTime(minMinutes) + "-" + formatPostingWindowTime(maxMinutes)
}

func formatPostingWindowTime(minutes int) string {
	hour := minutes / 60
	minute := minutes % 60
	return time.Date(2000, 1, 1, hour, minute, 0, 0, time.UTC).Format("15:04")
}

func buildMetricLeaderboardRows(metric FeedMetric, members []PublicUser, samples []metricSample) []MetricLeaderboardRow {
	samplesByUser := map[string][]metricSample{}
	for _, sample := range samples {
		samplesByUser[sample.UserID] = append(samplesByUser[sample.UserID], sample)
	}

	rows := make([]MetricLeaderboardRow, 0, len(members))
	for _, member := range members {
		aggregate := aggregateMetricSamples(metric, samplesByUser[member.ID])
		rows = append(rows, MetricLeaderboardRow{
			User:        member,
			Value:       aggregate.Value,
			RawValue:    aggregate.RawValue,
			SampleCount: aggregate.SampleCount,
		})
	}

	rankDirection := metricRankDirection(metric)
	if rankDirection == 0 {
		sort.SliceStable(rows, func(i, j int) bool {
			return leaderboardUserLess(rows[i], rows[j])
		})
		return rows
	}

	ranked := []MetricLeaderboardRow{}
	unranked := []MetricLeaderboardRow{}
	for _, row := range rows {
		if row.RawValue == nil {
			unranked = append(unranked, row)
			continue
		}
		ranked = append(ranked, row)
	}

	sort.SliceStable(ranked, func(i, j int) bool {
		left := *ranked[i].RawValue
		right := *ranked[j].RawValue
		if left != right {
			if rankDirection > 0 {
				return left > right
			}
			return left < right
		}
		return leaderboardUserLess(ranked[i], ranked[j])
	})
	sort.SliceStable(unranked, func(i, j int) bool {
		return leaderboardUserLess(unranked[i], unranked[j])
	})

	var previous *float64
	currentRank := 0
	for index := range ranked {
		raw := *ranked[index].RawValue
		if previous == nil || raw != *previous {
			currentRank = index + 1
			previous = &raw
		}
		rank := currentRank
		ranked[index].Rank = &rank
	}

	return append(ranked, unranked...)
}

func aggregateMetricSamples(metric FeedMetric, samples []metricSample) metricAggregate {
	if len(samples) == 0 {
		switch metric.Aggregation {
		case metricAggregationCount, metricAggregationSum:
			raw := 0.0
			return metricAggregate{
				Value:       formatMetricValue(metric, raw),
				RawValue:    &raw,
				SampleCount: 0,
			}
		}
		return metricAggregate{
			Value:       "-",
			SampleCount: 0,
		}
	}

	if metric.SystemKey == feedMetricKeyTypicalPostingWindow {
		latest := samples[0]
		for _, sample := range samples[1:] {
			if sample.At.After(latest.At) {
				latest = sample
			}
		}
		if latest.TextValue == nil || *latest.TextValue == "" {
			return metricAggregate{Value: "-", SampleCount: len(samples)}
		}
		return metricAggregate{
			Value:       *latest.TextValue,
			SampleCount: len(samples),
		}
	}

	var raw float64
	switch metric.Aggregation {
	case metricAggregationSum:
		for _, sample := range samples {
			raw += sample.Value
		}
	case metricAggregationAverage:
		for _, sample := range samples {
			raw += sample.Value
		}
		raw /= float64(len(samples))
	case metricAggregationLatest:
		latest := samples[0]
		for _, sample := range samples[1:] {
			if sample.At.After(latest.At) {
				latest = sample
			}
		}
		raw = latest.Value
	case metricAggregationCount:
		raw = float64(len(samples))
	case metricAggregationMax:
		raw = samples[0].Value
		for _, sample := range samples[1:] {
			if sample.Value > raw {
				raw = sample.Value
			}
		}
	case metricAggregationMin:
		raw = samples[0].Value
		for _, sample := range samples[1:] {
			if sample.Value < raw {
				raw = sample.Value
			}
		}
	default:
		return metricAggregate{
			Value:       "-",
			SampleCount: len(samples),
		}
	}

	return metricAggregate{
		Value:       formatMetricValue(metric, raw),
		RawValue:    &raw,
		SampleCount: len(samples),
	}
}

func formatMetricValue(metric FeedMetric, raw float64) any {
	if metric.Aggregation == metricAggregationCount {
		return int(math.Round(raw))
	}
	switch metric.SystemKey {
	case feedMetricKeyPostCount, feedMetricKeyMissedDays, feedMetricKeyCurrentStreak:
		return int(math.Round(raw))
	case feedMetricKeyAveragePostLengthWords:
		return roundMetricDecimal(raw)
	default:
		if math.Abs(raw-math.Round(raw)) < 0.0000001 {
			return int(math.Round(raw))
		}
		return roundMetricDecimal(raw)
	}
}

func roundMetricDecimal(value float64) float64 {
	return math.Round(value*10) / 10
}

func metricRankDirection(metric FeedMetric) int {
	if metric.SystemKey == feedMetricKeyTypicalPostingWindow {
		return 0
	}
	if metric.SystemKey == feedMetricKeyMissedDays {
		return -1
	}
	if metric.SystemKey == feedMetricKeyAveragePostLengthWords && metric.Aggregation == metricAggregationMin {
		return -1
	}
	if metric.SystemKey == feedMetricKeyJudged && metric.Aggregation == metricAggregationMin {
		return -1
	}
	if metric.SystemKey == feedMetricKeyJudged {
		return 1
	}
	definition, ok := systemMetricRegistry[metric.SystemKey]
	if !ok || !definition.Rankable {
		return 0
	}
	return 1
}

func leaderboardUserLess(left MetricLeaderboardRow, right MetricLeaderboardRow) bool {
	leftName := strings.ToLower(strings.TrimSpace(left.User.DisplayName))
	rightName := strings.ToLower(strings.TrimSpace(right.User.DisplayName))
	if leftName != rightName {
		return leftName < rightName
	}
	return left.User.ID < right.User.ID
}
