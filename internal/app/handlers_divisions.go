package app

import (
	"context"
	"database/sql"
	"errors"
	"net/http"

	"github.com/jackc/pgx/v5"
)

func (s *Server) handleListDivisions(w http.ResponseWriter, r *http.Request) {
	current, err := requireUser(r.Context())
	if err != nil {
		handleError(w, err)
		return
	}
	groupID := r.PathValue("group_id")
	if err := s.canViewGroup(r.Context(), current.ID, groupID); err != nil {
		handleError(w, err)
		return
	}
	divisions, err := s.listDivisions(r.Context(), groupID)
	if err != nil {
		handleError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, divisions)
}

func (s *Server) handleCreateDivision(w http.ResponseWriter, r *http.Request) {
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

	var req struct {
		Name        string  `json:"name"`
		Slug        string  `json:"slug"`
		Description *string `json:"description"`
		Rules       []struct {
			Source           *string  `json:"source"`
			MinUserRating    *int     `json:"min_user_rating"`
			MaxUserRating    *int     `json:"max_user_rating"`
			MinProblemRating *int     `json:"min_problem_rating"`
			MaxProblemRating *int     `json:"max_problem_rating"`
			ProblemCount     *int     `json:"problem_count"`
			RequiredTags     []string `json:"required_tags"`
			ExcludedTags     []string `json:"excluded_tags"`
		} `json:"rules"`
	}
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid JSON request")
		return
	}
	if req.Name == "" {
		writeError(w, http.StatusBadRequest, "name is required")
		return
	}
	if req.Slug == "" {
		req.Slug = slugify(req.Name)
	} else {
		req.Slug = slugify(req.Slug)
	}

	tx, err := s.db.Begin(r.Context())
	if err != nil {
		handleError(w, err)
		return
	}
	defer tx.Rollback(r.Context())

	var divisionID string
	if err := tx.QueryRow(r.Context(), `
		insert into divisions (group_id, name, slug, description, created_by_user_id)
		values ($1, $2, $3, $4, $5)
		returning id::text
	`, groupID, req.Name, req.Slug, req.Description, current.ID).Scan(&divisionID); err != nil {
		handleError(w, err)
		return
	}

	for _, rule := range req.Rules {
		var sourceID any
		if rule.Source != nil && *rule.Source != "" {
			id, err := s.sourceIDBySlug(r.Context(), *rule.Source)
			if err != nil {
				handleError(w, err)
				return
			}
			sourceID = id
		}

		var ruleID string
		if err := tx.QueryRow(r.Context(), `
			insert into division_rules (
				division_id,
				source_id,
				min_user_rating,
				max_user_rating,
				min_problem_rating,
				max_problem_rating,
				problem_count
			)
			values ($1, $2, $3, $4, $5, $6, $7)
			returning id::text
		`, divisionID, sourceID, rule.MinUserRating, rule.MaxUserRating, rule.MinProblemRating, rule.MaxProblemRating, rule.ProblemCount).Scan(&ruleID); err != nil {
			handleError(w, err)
			return
		}

		for _, tag := range rule.RequiredTags {
			if _, err := tx.Exec(r.Context(), `
				insert into division_rule_tags (division_rule_id, tag, constraint_type)
				values ($1, $2, 'required')
				on conflict do nothing
			`, ruleID, tag); err != nil {
				handleError(w, err)
				return
			}
		}
		for _, tag := range rule.ExcludedTags {
			if _, err := tx.Exec(r.Context(), `
				insert into division_rule_tags (division_rule_id, tag, constraint_type)
				values ($1, $2, 'excluded')
				on conflict do nothing
			`, ruleID, tag); err != nil {
				handleError(w, err)
				return
			}
		}
	}

	if err := tx.Commit(r.Context()); err != nil {
		handleError(w, err)
		return
	}

	division, err := s.getDivision(r.Context(), groupID, divisionID)
	if err != nil {
		handleError(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, division)
}

func (s *Server) handleGetDivision(w http.ResponseWriter, r *http.Request) {
	current, err := requireUser(r.Context())
	if err != nil {
		handleError(w, err)
		return
	}
	groupID := r.PathValue("group_id")
	if err := s.canViewGroup(r.Context(), current.ID, groupID); err != nil {
		handleError(w, err)
		return
	}
	division, err := s.getDivision(r.Context(), groupID, r.PathValue("division_id"))
	if err != nil {
		handleError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, division)
}

func (s *Server) handlePatchDivision(w http.ResponseWriter, r *http.Request) {
	current, err := requireUser(r.Context())
	if err != nil {
		handleError(w, err)
		return
	}
	groupID := r.PathValue("group_id")
	divisionID := r.PathValue("division_id")
	if err := s.requireGroupRole(r.Context(), current.ID, groupID, "owner", "admin"); err != nil {
		handleError(w, err)
		return
	}

	var req struct {
		Name        *string `json:"name"`
		Slug        *string `json:"slug"`
		Description *string `json:"description"`
	}
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid JSON request")
		return
	}

	var slug any
	if req.Slug != nil {
		slug = slugify(*req.Slug)
	}

	tag, err := s.db.Exec(r.Context(), `
		update divisions
		set name = coalesce($3, name),
		    slug = coalesce($4, slug),
		    description = coalesce($5, description)
		where group_id = $1 and id = $2
	`, groupID, divisionID, req.Name, slug, req.Description)
	if err != nil {
		handleError(w, err)
		return
	}
	if tag.RowsAffected() == 0 {
		writeError(w, http.StatusNotFound, "division not found")
		return
	}

	division, err := s.getDivision(r.Context(), groupID, divisionID)
	if err != nil {
		handleError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, division)
}

func (s *Server) handleDeleteDivision(w http.ResponseWriter, r *http.Request) {
	current, err := requireUser(r.Context())
	if err != nil {
		handleError(w, err)
		return
	}
	groupID := r.PathValue("group_id")
	divisionID := r.PathValue("division_id")
	if err := s.requireGroupRole(r.Context(), current.ID, groupID, "owner", "admin"); err != nil {
		handleError(w, err)
		return
	}

	tag, err := s.db.Exec(r.Context(), `
		delete from divisions
		where group_id = $1 and id = $2
	`, groupID, divisionID)
	if err != nil {
		handleError(w, err)
		return
	}
	if tag.RowsAffected() == 0 {
		writeError(w, http.StatusNotFound, "division not found")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) handleListDivisionMembers(w http.ResponseWriter, r *http.Request) {
	current, err := requireUser(r.Context())
	if err != nil {
		handleError(w, err)
		return
	}
	groupID := r.PathValue("group_id")
	if err := s.canViewGroup(r.Context(), current.ID, groupID); err != nil {
		handleError(w, err)
		return
	}
	if _, err := s.getDivision(r.Context(), groupID, r.PathValue("division_id")); err != nil {
		handleError(w, err)
		return
	}
	members, err := s.listGroupMembers(r.Context(), groupID)
	if err != nil {
		handleError(w, err)
		return
	}
	active := []GroupMember{}
	for _, member := range members {
		if member.Status == "active" {
			active = append(active, member)
		}
	}
	writeJSON(w, http.StatusOK, active)
}

func (s *Server) handleRecomputeDivision(w http.ResponseWriter, r *http.Request) {
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
	division, err := s.getDivision(r.Context(), groupID, r.PathValue("division_id"))
	if err != nil {
		handleError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"division":     division,
		"materialized": false,
		"reason":       "user_divisions materialization is not connected in the local build",
	})
}

func (s *Server) listDivisions(ctx context.Context, groupID string) ([]Division, error) {
	rows, err := s.db.Query(ctx, `
		select
			id::text,
			group_id::text,
			name,
			slug,
			description,
			created_by_user_id::text,
			created_at,
			updated_at
		from divisions
		where group_id = $1
		order by name
	`, groupID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	divisions := []Division{}
	for rows.Next() {
		division, err := scanDivision(rows)
		if err != nil {
			return nil, err
		}
		division.Rules, err = s.listDivisionRules(ctx, division.ID)
		if err != nil {
			return nil, err
		}
		divisions = append(divisions, division)
	}
	return divisions, rows.Err()
}

func (s *Server) getDivision(ctx context.Context, groupID string, divisionID string) (Division, error) {
	division, err := scanDivision(s.db.QueryRow(ctx, `
		select
			id::text,
			group_id::text,
			name,
			slug,
			description,
			created_by_user_id::text,
			created_at,
			updated_at
		from divisions
		where group_id = $1 and id = $2
	`, groupID, divisionID))
	if errors.Is(err, pgx.ErrNoRows) {
		return Division{}, errNotFound("division")
	}
	if err != nil {
		return Division{}, err
	}
	division.Rules, err = s.listDivisionRules(ctx, division.ID)
	return division, err
}

func scanDivision(row pgx.Row) (Division, error) {
	var division Division
	var groupID sql.NullString
	var description sql.NullString
	var createdByUserID sql.NullString
	if err := row.Scan(
		&division.ID,
		&groupID,
		&division.Name,
		&division.Slug,
		&description,
		&createdByUserID,
		&division.CreatedAt,
		&division.UpdatedAt,
	); err != nil {
		return Division{}, err
	}
	division.GroupID = nullStringPtr(groupID)
	division.Description = nullStringPtr(description)
	division.CreatedByUserID = nullStringPtr(createdByUserID)
	return division, nil
}

func (s *Server) listDivisionRules(ctx context.Context, divisionID string) ([]DivisionRule, error) {
	rows, err := s.db.Query(ctx, `
		select
			dr.id::text,
			dr.division_id::text,
			dr.source_id::text,
			ps.slug,
			dr.min_user_rating,
			dr.max_user_rating,
			dr.min_problem_rating,
			dr.max_problem_rating,
			dr.problem_count,
			coalesce(array(
				select drt.tag
				from division_rule_tags drt
				where drt.division_rule_id = dr.id and drt.constraint_type = 'required'
				order by drt.tag
			), '{}'),
			coalesce(array(
				select drt.tag
				from division_rule_tags drt
				where drt.division_rule_id = dr.id and drt.constraint_type = 'excluded'
				order by drt.tag
			), '{}'),
			dr.created_at,
			dr.updated_at
		from division_rules dr
		left join problem_sources ps on ps.id = dr.source_id
		where dr.division_id = $1
		order by dr.created_at
	`, divisionID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	rules := []DivisionRule{}
	for rows.Next() {
		rule, err := scanDivisionRule(rows)
		if err != nil {
			return nil, err
		}
		rules = append(rules, rule)
	}
	return rules, rows.Err()
}

func scanDivisionRule(row pgx.Row) (DivisionRule, error) {
	var rule DivisionRule
	var sourceID sql.NullString
	var sourceSlug sql.NullString
	var minUserRating sql.NullInt64
	var maxUserRating sql.NullInt64
	var minProblemRating sql.NullInt64
	var maxProblemRating sql.NullInt64
	var problemCount sql.NullInt64
	if err := row.Scan(
		&rule.ID,
		&rule.DivisionID,
		&sourceID,
		&sourceSlug,
		&minUserRating,
		&maxUserRating,
		&minProblemRating,
		&maxProblemRating,
		&problemCount,
		&rule.RequiredTags,
		&rule.ExcludedTags,
		&rule.CreatedAt,
		&rule.UpdatedAt,
	); err != nil {
		return DivisionRule{}, err
	}
	rule.SourceID = nullStringPtr(sourceID)
	rule.SourceSlug = nullStringPtr(sourceSlug)
	rule.MinUserRating = nullIntPtr(minUserRating)
	rule.MaxUserRating = nullIntPtr(maxUserRating)
	rule.MinProblemRating = nullIntPtr(minProblemRating)
	rule.MaxProblemRating = nullIntPtr(maxProblemRating)
	rule.ProblemCount = nullIntPtr(problemCount)
	return rule, nil
}
