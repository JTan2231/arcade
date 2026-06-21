package app

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"net/http"
	"strconv"
	"strings"

	"github.com/jackc/pgx/v5"
)

func (s *Server) handleListSources(w http.ResponseWriter, r *http.Request) {
	rows, err := s.db.Query(r.Context(), `
		select id::text, slug, name, base_url, supports_submissions, supports_problem_ratings, supports_tags, created_at, updated_at
		from problem_sources
		order by slug
	`)
	if err != nil {
		handleError(w, err)
		return
	}
	defer rows.Close()

	sources := []Source{}
	for rows.Next() {
		source, err := scanSource(rows)
		if err != nil {
			handleError(w, err)
			return
		}
		sources = append(sources, source)
	}
	if err := rows.Err(); err != nil {
		handleError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, sources)
}

func (s *Server) handleGetSource(w http.ResponseWriter, r *http.Request) {
	source, err := scanSource(s.db.QueryRow(r.Context(), `
		select id::text, slug, name, base_url, supports_submissions, supports_problem_ratings, supports_tags, created_at, updated_at
		from problem_sources
		where slug = $1
	`, r.PathValue("source_slug")))
	if errors.Is(err, pgx.ErrNoRows) {
		writeError(w, http.StatusNotFound, "source not found")
		return
	}
	if err != nil {
		handleError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, source)
}

func (s *Server) handleListProblems(w http.ResponseWriter, r *http.Request) {
	source := r.URL.Query().Get("source")
	if pathSource := r.PathValue("source_slug"); pathSource != "" {
		source = pathSource
	}

	tagValues := r.URL.Query()["tag"]
	tags := []string{}
	for _, value := range tagValues {
		tags = append(tags, splitCSV(value)...)
	}

	filters := problemFilters{
		source:       source,
		tags:         tags,
		contestID:    r.URL.Query().Get("contest_id"),
		solvedByMe:   r.URL.Query().Get("solved_by_me") == "true",
		unsolvedByMe: r.URL.Query().Get("unsolved_by_me") == "true",
		limit:        200,
	}

	var err error
	filters.minRating, err = parseOptionalInt(r.URL.Query().Get("min_rating"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "min_rating must be an integer")
		return
	}
	filters.maxRating, err = parseOptionalInt(r.URL.Query().Get("max_rating"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "max_rating must be an integer")
		return
	}
	if raw := r.URL.Query().Get("limit"); raw != "" {
		limit, err := strconv.Atoi(raw)
		if err != nil || limit < 1 || limit > 500 {
			writeError(w, http.StatusBadRequest, "limit must be between 1 and 500")
			return
		}
		filters.limit = limit
	}

	problems, err := s.listProblems(r.Context(), filters)
	if err != nil {
		handleError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, problems)
}

func (s *Server) handleGetProblem(w http.ResponseWriter, r *http.Request) {
	problem, err := s.getProblem(r.Context(), "p.id = $1", r.PathValue("problem_id"))
	if err != nil {
		handleError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, problem)
}

func (s *Server) handleGetProblemByExternalID(w http.ResponseWriter, r *http.Request) {
	externalID := strings.TrimPrefix(r.PathValue("external_id"), "/")
	problem, err := s.getProblem(r.Context(), "ps.slug = $1 and p.external_id = $2", r.PathValue("source_slug"), externalID)
	if err != nil {
		handleError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, problem)
}

type problemFilters struct {
	source       string
	tags         []string
	minRating    *int
	maxRating    *int
	contestID    string
	solvedByMe   bool
	unsolvedByMe bool
	limit        int
}

func (s *Server) listProblems(ctx context.Context, filters problemFilters) ([]Problem, error) {
	where := []string{"1 = 1"}
	args := []any{}
	addArg := func(value any) string {
		args = append(args, value)
		return fmt.Sprintf("$%d", len(args))
	}

	solvedSQL := fmt.Sprintf(`
		exists (
			select 1
			from submissions sm
			where sm.user_id = %s::uuid
			  and sm.problem_id = p.id
			  and sm.verdict in ('accepted', 'completed', 'manual_solve')
		)
	`, addArg(s.currentUser.ID))

	if filters.source != "" {
		where = append(where, "ps.slug = "+addArg(filters.source))
	}
	if len(filters.tags) > 0 {
		where = append(where, fmt.Sprintf(`
			exists (
				select 1
				from problem_tags pt_filter
				where pt_filter.problem_id = p.id
				  and pt_filter.tag = any(%s::text[])
			)
		`, addArg(filters.tags)))
	}
	if filters.minRating != nil {
		where = append(where, "p.rating >= "+addArg(*filters.minRating))
	}
	if filters.maxRating != nil {
		where = append(where, "p.rating <= "+addArg(*filters.maxRating))
	}
	if filters.contestID != "" {
		where = append(where, "p.contest_id = "+addArg(filters.contestID))
	}
	if filters.solvedByMe {
		where = append(where, solvedSQL)
	}
	if filters.unsolvedByMe {
		where = append(where, "not "+solvedSQL)
	}

	limitPlaceholder := addArg(filters.limit)
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
			` + solvedSQL + `,
			p.created_at,
			p.updated_at
		from problems p
		join problem_sources ps on ps.id = p.source_id
		left join problem_tags pt on pt.problem_id = p.id
		where ` + strings.Join(where, " and ") + `
		group by p.id, ps.slug
		order by p.rating nulls last, p.title
		limit ` + limitPlaceholder

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
	return problems, rows.Err()
}

func (s *Server) getProblem(ctx context.Context, predicate string, args ...any) (Problem, error) {
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
				where sm.user_id = $` + strconv.Itoa(len(args)+1) + `::uuid
				  and sm.problem_id = p.id
				  and sm.verdict in ('accepted', 'completed', 'manual_solve')
			),
			p.created_at,
			p.updated_at
		from problems p
		join problem_sources ps on ps.id = p.source_id
		left join problem_tags pt on pt.problem_id = p.id
		where ` + predicate + `
		group by p.id, ps.slug
	`
	args = append(args, s.currentUser.ID)
	problem, err := scanProblem(s.db.QueryRow(ctx, query, args...))
	if errors.Is(err, pgx.ErrNoRows) {
		return Problem{}, errNotFound("problem")
	}
	return problem, err
}

func scanSource(row pgx.Row) (Source, error) {
	var source Source
	if err := row.Scan(
		&source.ID,
		&source.Slug,
		&source.Name,
		&source.BaseURL,
		&source.SupportsSubmissions,
		&source.SupportsProblemRatings,
		&source.SupportsTags,
		&source.CreatedAt,
		&source.UpdatedAt,
	); err != nil {
		return Source{}, err
	}
	return source, nil
}

func scanProblem(row pgx.Row) (Problem, error) {
	var problem Problem
	var contestID sql.NullString
	var problemIndex sql.NullString
	var rating sql.NullInt64
	var difficultyLabel sql.NullString
	var publishedAt sql.NullTime
	if err := row.Scan(
		&problem.ID,
		&problem.SourceID,
		&problem.SourceSlug,
		&problem.ExternalID,
		&problem.Title,
		&problem.URL,
		&contestID,
		&problemIndex,
		&rating,
		&difficultyLabel,
		&publishedAt,
		&problem.Tags,
		&problem.SolvedByMe,
		&problem.CreatedAt,
		&problem.UpdatedAt,
	); err != nil {
		return Problem{}, err
	}
	problem.ContestID = nullStringPtr(contestID)
	problem.ProblemIndex = nullStringPtr(problemIndex)
	problem.Rating = nullIntPtr(rating)
	problem.DifficultyLabel = nullStringPtr(difficultyLabel)
	problem.PublishedAt = nullTimePtr(publishedAt)
	return problem, nil
}
