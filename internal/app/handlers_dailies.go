package app

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"math"
	"net/http"
	"strings"

	"github.com/jackc/pgx/v5"
)

type dailyScope struct {
	ScopeType  string
	ScopeID    *string
	GroupID    *string
	DivisionID *string
	UserID     *string
}

type generateDailyRequest struct {
	Source     string   `json:"source"`
	Tags       []string `json:"tags"`
	Count      int      `json:"count"`
	Difficulty struct {
		Mode         string `json:"mode"`
		Delta        *int   `json:"delta"`
		TargetRating *int   `json:"target_rating"`
		MinRating    *int   `json:"min_rating"`
		MaxRating    *int   `json:"max_rating"`
	} `json:"difficulty"`
	IncludeSolved *bool `json:"include_solved"`
}

func (s *Server) handleGetMeDaily(w http.ResponseWriter, r *http.Request) {
	scope := dailyScope{ScopeType: "user", ScopeID: &s.currentUser.ID, UserID: &s.currentUser.ID}
	daily, err := s.getDailyForScope(r.Context(), scope)
	if err != nil {
		handleError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, daily)
}

func (s *Server) handleGenerateMeDaily(w http.ResponseWriter, r *http.Request) {
	var req generateDailyRequest
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid JSON request")
		return
	}
	scope := dailyScope{ScopeType: "user", ScopeID: &s.currentUser.ID, UserID: &s.currentUser.ID}
	daily, err := s.generateDaily(r.Context(), scope, req)
	if err != nil {
		handleError(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, daily)
}

func (s *Server) handleListMeDailies(w http.ResponseWriter, r *http.Request) {
	dailies, err := s.listDailies(r.Context(), "ds.user_id = $1", s.currentUser.ID)
	if err != nil {
		handleError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, dailies)
}

func (s *Server) handleGetGroupDaily(w http.ResponseWriter, r *http.Request) {
	groupID := r.PathValue("group_id")
	scope := dailyScope{ScopeType: "group", ScopeID: &groupID, GroupID: &groupID}
	daily, err := s.getDailyForScope(r.Context(), scope)
	if err != nil {
		handleError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, daily)
}

func (s *Server) handleGenerateGroupDaily(w http.ResponseWriter, r *http.Request) {
	var req generateDailyRequest
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid JSON request")
		return
	}
	groupID := r.PathValue("group_id")
	if err := s.groupExists(r.Context(), groupID); err != nil {
		handleError(w, err)
		return
	}
	scope := dailyScope{ScopeType: "group", ScopeID: &groupID, GroupID: &groupID}
	daily, err := s.generateDaily(r.Context(), scope, req)
	if err != nil {
		handleError(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, daily)
}

func (s *Server) handleListGroupDailies(w http.ResponseWriter, r *http.Request) {
	dailies, err := s.listDailies(r.Context(), "ds.group_id = $1 and ds.division_id is null", r.PathValue("group_id"))
	if err != nil {
		handleError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, dailies)
}

func (s *Server) handleGetGroupDivisionDaily(w http.ResponseWriter, r *http.Request) {
	groupID := r.PathValue("group_id")
	divisionID := r.PathValue("division_id")
	scope := dailyScope{ScopeType: "group_division", ScopeID: &divisionID, GroupID: &groupID, DivisionID: &divisionID}
	daily, err := s.getDailyForScope(r.Context(), scope)
	if err != nil {
		handleError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, daily)
}

func (s *Server) handleGenerateGroupDivisionDaily(w http.ResponseWriter, r *http.Request) {
	var req generateDailyRequest
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid JSON request")
		return
	}
	groupID := r.PathValue("group_id")
	divisionID := r.PathValue("division_id")
	if _, err := s.getDivision(r.Context(), groupID, divisionID); err != nil {
		handleError(w, err)
		return
	}
	scope := dailyScope{ScopeType: "group_division", ScopeID: &divisionID, GroupID: &groupID, DivisionID: &divisionID}
	daily, err := s.generateDaily(r.Context(), scope, req)
	if err != nil {
		handleError(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, daily)
}

func (s *Server) handleGetDailySet(w http.ResponseWriter, r *http.Request) {
	daily, err := s.getDailySet(r.Context(), r.PathValue("daily_set_id"))
	if err != nil {
		handleError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, daily)
}

func (s *Server) getDailyForScope(ctx context.Context, scope dailyScope) (DailySet, error) {
	var id string
	err := s.db.QueryRow(ctx, `
		select id::text
		from daily_sets
		where scope_type = $1
		  and scope_id is not distinct from $2::uuid
		  and date = current_date
	`, scope.ScopeType, nullableString(scope.ScopeID)).Scan(&id)
	if errors.Is(err, pgx.ErrNoRows) {
		return DailySet{}, errNotFound("daily set")
	}
	if err != nil {
		return DailySet{}, err
	}
	return s.getDailySet(ctx, id)
}

func (s *Server) listDailies(ctx context.Context, predicate string, args ...any) ([]DailySet, error) {
	query := `
		select ds.id::text
		from daily_sets ds
		where ` + predicate + `
		order by ds.date desc, ds.created_at desc
		limit 30
	`
	rows, err := s.db.Query(ctx, query, args...)
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

	dailies := make([]DailySet, 0, len(ids))
	for _, id := range ids {
		daily, err := s.getDailySet(ctx, id)
		if err != nil {
			return nil, err
		}
		dailies = append(dailies, daily)
	}
	return dailies, nil
}

func (s *Server) generateDaily(ctx context.Context, scope dailyScope, req generateDailyRequest) (DailySet, error) {
	preference, _ := s.preferenceForSource(ctx, req.Source)
	if req.Source == "" {
		if preference.SourceSlug != nil {
			req.Source = *preference.SourceSlug
		} else {
			req.Source = "codeforces"
		}
	}
	sourceID, err := s.sourceIDBySlug(ctx, req.Source)
	if err != nil {
		return DailySet{}, err
	}

	count := req.Count
	if count == 0 {
		count = preference.DailyProblemCount
	}
	if count == 0 {
		count = 3
	}
	if count < 1 || count > 12 {
		return DailySet{}, badRequest("count must be between 1 and 12")
	}

	includeSolved := preference.IncludeSolved
	if req.IncludeSolved != nil {
		includeSolved = *req.IncludeSolved
	}

	delta := preference.TargetDifficultyDelta
	if delta == 0 {
		delta = 100
	}
	if req.Difficulty.Delta != nil {
		delta = *req.Difficulty.Delta
	}

	targetRating := 1200 + delta
	if req.Difficulty.TargetRating != nil {
		targetRating = *req.Difficulty.TargetRating
	}

	minRating := targetRating - 500
	maxRating := targetRating + 500
	if req.Difficulty.MinRating != nil {
		minRating = *req.Difficulty.MinRating
	}
	if req.Difficulty.MaxRating != nil {
		maxRating = *req.Difficulty.MaxRating
	}

	tags := cleanTags(req.Tags)
	if len(tags) == 0 {
		tags = preference.PreferredTags
	}
	blockedTags := preference.BlockedTags

	if scope.DivisionID != nil {
		if err := s.applyDivisionDefaults(ctx, *scope.DivisionID, &req.Source, &sourceID, &tags, &blockedTags, &count, &minRating, &maxRating); err != nil {
			return DailySet{}, err
		}
	}

	candidates, err := s.selectDailyProblems(ctx, dailySelection{
		sourceID:      sourceID,
		tags:          tags,
		blockedTags:   blockedTags,
		minRating:     minRating,
		maxRating:     maxRating,
		targetRating:  targetRating,
		count:         count,
		includeSolved: includeSolved,
	})
	if err != nil {
		return DailySet{}, err
	}
	if len(candidates) == 0 {
		return DailySet{}, badRequest("no problems matched the daily generation criteria")
	}

	title := fmt.Sprintf("%s Daily", strings.Title(strings.ReplaceAll(req.Source, "-", " ")))
	generationReason := fmt.Sprintf("source=%s target=%d range=%d-%d tags=%s", req.Source, targetRating, minRating, maxRating, strings.Join(tags, ","))

	tx, err := s.db.Begin(ctx)
	if err != nil {
		return DailySet{}, err
	}
	defer tx.Rollback(ctx)

	var dailySetID string
	err = tx.QueryRow(ctx, `
		insert into daily_sets (
			scope_type,
			scope_id,
			group_id,
			division_id,
			user_id,
			date,
			title,
			generation_reason,
			generator_version
		)
		values ($1, $2, $3, $4, $5, current_date, $6, $7, 'local-v1')
		on conflict (scope_type, scope_id, date) do update set
			group_id = excluded.group_id,
			division_id = excluded.division_id,
			user_id = excluded.user_id,
			title = excluded.title,
			generation_reason = excluded.generation_reason,
			generator_version = excluded.generator_version
		returning id::text
	`, scope.ScopeType, nullableString(scope.ScopeID), nullableString(scope.GroupID), nullableString(scope.DivisionID), nullableString(scope.UserID), title, generationReason).Scan(&dailySetID)
	if err != nil {
		return DailySet{}, err
	}

	if _, err := tx.Exec(ctx, `delete from daily_set_items where daily_set_id = $1`, dailySetID); err != nil {
		return DailySet{}, err
	}

	for index, problem := range candidates {
		position := index + 1
		role := dailyRole(position, len(candidates))
		points := dailyPoints(role)
		reason := recommendationReason(problem, role, targetRating)
		if _, err := tx.Exec(ctx, `
			insert into daily_set_items (daily_set_id, problem_id, position, role, points, recommendation_reason)
			values ($1, $2, $3, $4, $5, $6)
		`, dailySetID, problem.ID, position, role, points, reason); err != nil {
			return DailySet{}, err
		}
	}

	if err := tx.Commit(ctx); err != nil {
		return DailySet{}, err
	}

	return s.getDailySet(ctx, dailySetID)
}

func (s *Server) preferenceForSource(ctx context.Context, sourceSlug string) (Preference, error) {
	var sourcePredicate string
	args := []any{s.currentUser.ID}
	if sourceSlug == "" {
		sourcePredicate = "up.source_id is null"
	} else {
		sourcePredicate = "ps.slug = $2"
		args = append(args, sourceSlug)
	}

	preference, err := scanPreference(s.db.QueryRow(ctx, `
		select
			up.id::text,
			up.user_id::text,
			up.source_id::text,
			ps.slug,
			up.target_difficulty_delta,
			up.daily_problem_count,
			up.include_solved,
			coalesce(array(
				select upt.tag
				from user_preference_tags upt
				where upt.user_preference_id = up.id and upt.preference = 'preferred'
				order by upt.tag
			), '{}'),
			coalesce(array(
				select upt.tag
				from user_preference_tags upt
				where upt.user_preference_id = up.id and upt.preference = 'blocked'
				order by upt.tag
			), '{}'),
			up.created_at,
			up.updated_at
		from user_preferences up
		left join problem_sources ps on ps.id = up.source_id
		where up.user_id = $1 and `+sourcePredicate+`
		limit 1
	`, args...))
	if errors.Is(err, pgx.ErrNoRows) && sourceSlug != "" {
		return s.preferenceForSource(ctx, "")
	}
	if errors.Is(err, pgx.ErrNoRows) {
		return Preference{TargetDifficultyDelta: 100, DailyProblemCount: 3}, nil
	}
	return preference, err
}

func (s *Server) applyDivisionDefaults(ctx context.Context, divisionID string, sourceSlug *string, sourceID *string, tags *[]string, blockedTags *[]string, count *int, minRating *int, maxRating *int) error {
	rules, err := s.listDivisionRules(ctx, divisionID)
	if err != nil {
		return err
	}
	if len(rules) == 0 {
		return nil
	}
	rule := rules[0]
	if rule.SourceSlug != nil && *sourceSlug == "" {
		*sourceSlug = *rule.SourceSlug
		*sourceID = *rule.SourceID
	}
	if len(*tags) == 0 && len(rule.RequiredTags) > 0 {
		*tags = rule.RequiredTags
	}
	if len(rule.ExcludedTags) > 0 {
		*blockedTags = append(*blockedTags, rule.ExcludedTags...)
	}
	if *count == 0 && rule.ProblemCount != nil {
		*count = *rule.ProblemCount
	}
	if rule.MinProblemRating != nil {
		*minRating = *rule.MinProblemRating
	}
	if rule.MaxProblemRating != nil {
		*maxRating = *rule.MaxProblemRating
	}
	return nil
}

type dailySelection struct {
	sourceID      string
	tags          []string
	blockedTags   []string
	minRating     int
	maxRating     int
	targetRating  int
	count         int
	includeSolved bool
}

func (s *Server) selectDailyProblems(ctx context.Context, selection dailySelection) ([]Problem, error) {
	args := []any{
		selection.sourceID,
		selection.minRating,
		selection.maxRating,
		s.currentUser.ID,
		selection.tags,
		selection.blockedTags,
		selection.targetRating,
		selection.count,
		selection.includeSolved,
	}

	query := `
		select
			p.id::text,
			p.source_id::text,
			ps.slug,
			p.external_id,
			p.title,
			p.url,
			p.contest_id,
			p.problem_index,
			p.rating,
			p.difficulty_label,
			p.published_at,
			coalesce(array_agg(distinct pt.tag order by pt.tag) filter (where pt.tag is not null), '{}'),
			exists (
				select 1
				from submissions sm
				where sm.user_id = $4::uuid
				  and sm.problem_id = p.id
				  and sm.verdict in ('accepted', 'completed', 'manual_solve')
			),
			p.created_at,
			p.updated_at
		from problems p
		join problem_sources ps on ps.id = p.source_id
		left join problem_tags pt on pt.problem_id = p.id
		where p.source_id = $1
		  and (p.rating between $2 and $3 or p.rating is null)
		  and (
		  	cardinality($5::text[]) = 0
		  	or exists (
				select 1
				from problem_tags pt_required
				where pt_required.problem_id = p.id and pt_required.tag = any($5::text[])
		  	)
		  )
		  and (
		  	cardinality($6::text[]) = 0
		  	or not exists (
				select 1
				from problem_tags pt_blocked
				where pt_blocked.problem_id = p.id and pt_blocked.tag = any($6::text[])
		  	)
		  )
		  and (
		  	$9::boolean
		  	or not exists (
				select 1
				from submissions sm
				where sm.user_id = $4::uuid
				  and sm.problem_id = p.id
				  and sm.verdict in ('accepted', 'completed', 'manual_solve')
		  	)
		  )
		group by p.id, ps.slug
		order by abs(coalesce(p.rating, $7) - $7), p.rating nulls last, p.title
		limit $8
	`

	rows, err := s.db.Query(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	problems := []Problem{}
	for rows.Next() {
		problem, err := scanProblem(rows)
		if err != nil {
			return nil, err
		}
		problems = append(problems, problem)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	if len(problems) > 0 || len(selection.tags) == 0 {
		return problems, nil
	}

	selection.tags = nil
	return s.selectDailyProblems(ctx, selection)
}

func (s *Server) getDailySet(ctx context.Context, dailySetID string) (DailySet, error) {
	var daily DailySet
	var scopeID sql.NullString
	var groupID sql.NullString
	var divisionID sql.NullString
	var userID sql.NullString
	var title sql.NullString
	var generationReason sql.NullString
	var generatorVersion sql.NullString
	err := s.db.QueryRow(ctx, `
		select
			id::text,
			scope_type,
			scope_id::text,
			group_id::text,
			division_id::text,
			user_id::text,
			date::text,
			title,
			generation_reason,
			generator_version,
			created_at
		from daily_sets
		where id = $1
	`, dailySetID).Scan(
		&daily.ID,
		&daily.ScopeType,
		&scopeID,
		&groupID,
		&divisionID,
		&userID,
		&daily.Date,
		&title,
		&generationReason,
		&generatorVersion,
		&daily.CreatedAt,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return DailySet{}, errNotFound("daily set")
	}
	if err != nil {
		return DailySet{}, err
	}
	daily.ScopeID = nullStringPtr(scopeID)
	daily.GroupID = nullStringPtr(groupID)
	daily.DivisionID = nullStringPtr(divisionID)
	daily.UserID = nullStringPtr(userID)
	daily.Title = nullStringPtr(title)
	daily.GenerationReason = nullStringPtr(generationReason)
	daily.GeneratorVersion = nullStringPtr(generatorVersion)

	items, err := s.listDailyItems(ctx, daily.ID)
	if err != nil {
		return DailySet{}, err
	}
	daily.Items = items
	return daily, nil
}

func (s *Server) listDailyItems(ctx context.Context, dailySetID string) ([]DailyItem, error) {
	rows, err := s.db.Query(ctx, `
		select
			dsi.id::text,
			dsi.daily_set_id::text,
			dsi.position,
			dsi.role,
			dsi.points,
			dsi.recommendation_reason,
			dsi.created_at,
			p.id::text,
			p.source_id::text,
			ps.slug,
			p.external_id,
			p.title,
			p.url,
			p.contest_id,
			p.problem_index,
			p.rating,
			p.difficulty_label,
			p.published_at,
			coalesce(array_agg(distinct pt.tag order by pt.tag) filter (where pt.tag is not null), '{}'),
			exists (
				select 1
				from submissions sm
				where sm.user_id = $2::uuid
				  and sm.problem_id = p.id
				  and sm.verdict in ('accepted', 'completed', 'manual_solve')
			),
			p.created_at,
			p.updated_at
		from daily_set_items dsi
		join problems p on p.id = dsi.problem_id
		join problem_sources ps on ps.id = p.source_id
		left join problem_tags pt on pt.problem_id = p.id
		where dsi.daily_set_id = $1
		group by dsi.id, p.id, ps.slug
		order by dsi.position
	`, dailySetID, s.currentUser.ID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	items := []DailyItem{}
	for rows.Next() {
		var item DailyItem
		var recommendationReason sql.NullString
		if err := rows.Scan(
			&item.ID,
			&item.DailySetID,
			&item.Position,
			&item.Role,
			&item.Points,
			&recommendationReason,
			&item.CreatedAt,
			&item.Problem.ID,
			&item.Problem.SourceID,
			&item.Problem.SourceSlug,
			&item.Problem.ExternalID,
			&item.Problem.Title,
			&item.Problem.URL,
			&item.Problem.ContestID,
			&item.Problem.ProblemIndex,
			&item.Problem.Rating,
			&item.Problem.DifficultyLabel,
			&item.Problem.PublishedAt,
			&item.Problem.Tags,
			&item.Problem.SolvedByMe,
			&item.Problem.CreatedAt,
			&item.Problem.UpdatedAt,
		); err != nil {
			return nil, err
		}
		item.RecommendationReason = nullStringPtr(recommendationReason)
		items = append(items, item)
	}
	return items, rows.Err()
}

func cleanTags(tags []string) []string {
	cleaned := []string{}
	seen := map[string]bool{}
	for _, tag := range tags {
		tag = strings.TrimSpace(strings.ToLower(tag))
		if tag == "" || seen[tag] {
			continue
		}
		seen[tag] = true
		cleaned = append(cleaned, tag)
	}
	return cleaned
}

func dailyRole(position int, total int) string {
	if total == 1 {
		return "target"
	}
	if position == 1 {
		return "warmup"
	}
	if position == total {
		return "stretch"
	}
	return "target"
}

func dailyPoints(role string) int {
	switch role {
	case "warmup":
		return 1
	case "stretch":
		return 3
	default:
		return 2
	}
}

func recommendationReason(problem Problem, role string, targetRating int) string {
	if problem.Rating == nil {
		return fmt.Sprintf("%s pick without a source rating", role)
	}
	delta := int(math.Abs(float64(*problem.Rating - targetRating)))
	return fmt.Sprintf("%s pick, rating %d within %d of target", role, *problem.Rating, delta)
}

func nullableString(value *string) any {
	if value == nil || *value == "" {
		return nil
	}
	return *value
}
