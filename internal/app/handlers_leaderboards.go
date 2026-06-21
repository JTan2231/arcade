package app

import (
	"context"
	"database/sql"
	"net/http"

	"github.com/jackc/pgx/v5"
)

func (s *Server) handleGlobalLeaderboard(w http.ResponseWriter, r *http.Request) {
	if _, err := requireUser(r.Context()); err != nil {
		handleError(w, err)
		return
	}
	rows, err := s.globalLeaderboard(r.Context())
	if err != nil {
		handleError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, rows)
}

func (s *Server) handleGroupLeaderboard(w http.ResponseWriter, r *http.Request) {
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
	rows, err := s.groupLeaderboard(r.Context(), groupID)
	if err != nil {
		handleError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, rows)
}

func (s *Server) handleDivisionLeaderboard(w http.ResponseWriter, r *http.Request) {
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
	rows, err := s.groupLeaderboard(r.Context(), groupID)
	if err != nil {
		handleError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, rows)
}

func (s *Server) handleDailySetLeaderboard(w http.ResponseWriter, r *http.Request) {
	current, err := requireUser(r.Context())
	if err != nil {
		handleError(w, err)
		return
	}
	dailySetID := r.PathValue("daily_set_id")
	if err := s.authorizeDailySet(r.Context(), current.ID, dailySetID); err != nil {
		handleError(w, err)
		return
	}
	rows, err := s.dailySetLeaderboard(r.Context(), dailySetID)
	if err != nil {
		handleError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, rows)
}

func (s *Server) globalLeaderboard(ctx context.Context) ([]LeaderboardRow, error) {
	rows, err := s.db.Query(ctx, `
		with eligible_users as (
			select id, display_name
			from users
		),
		accepted as (
			select s.user_id, s.problem_id, min(s.submitted_at) as first_solved_at
			from submissions s
			where s.verdict in ('accepted', 'completed', 'manual_solve')
			group by s.user_id, s.problem_id
		),
		rollup as (
			select
				eu.id::text as user_id,
				eu.display_name,
				coalesce(count(a.problem_id), 0)::numeric as points,
				coalesce(count(a.problem_id), 0)::integer as solves,
				max(a.first_solved_at) as last_solved_at
			from eligible_users eu
			left join accepted a on a.user_id = eu.id
			group by eu.id, eu.display_name
		)
		select
			row_number() over (order by points desc, solves desc, last_solved_at asc nulls last, display_name) as rank,
			user_id,
			display_name,
			points,
			solves,
			last_solved_at,
			null::integer as streak_count
		from rollup
		where solves > 0
		order by rank
		limit 100
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanLeaderboardRows(rows)
}

func (s *Server) groupLeaderboard(ctx context.Context, groupID string) ([]LeaderboardRow, error) {
	rows, err := s.db.Query(ctx, `
		with eligible_users as (
			select u.id, u.display_name
			from group_memberships gm
			join users u on u.id = gm.user_id
			where gm.group_id = $1 and gm.status = 'active'
		),
		accepted as (
			select s.user_id, s.problem_id, min(s.submitted_at) as first_solved_at
			from submissions s
			join eligible_users eu on eu.id = s.user_id
			where s.verdict in ('accepted', 'completed', 'manual_solve')
			group by s.user_id, s.problem_id
		),
		rollup as (
			select
				eu.id::text as user_id,
				eu.display_name,
				coalesce(count(a.problem_id), 0)::numeric as points,
				coalesce(count(a.problem_id), 0)::integer as solves,
				max(a.first_solved_at) as last_solved_at
			from eligible_users eu
			left join accepted a on a.user_id = eu.id
			group by eu.id, eu.display_name
		)
		select
			row_number() over (order by points desc, solves desc, last_solved_at asc nulls last, display_name) as rank,
			user_id,
			display_name,
			points,
			solves,
			last_solved_at,
			null::integer as streak_count
		from rollup
		order by rank
	`, groupID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanLeaderboardRows(rows)
}

func (s *Server) dailySetLeaderboard(ctx context.Context, dailySetID string) ([]LeaderboardRow, error) {
	current, err := requireUser(ctx)
	if err != nil {
		return nil, err
	}
	rows, err := s.db.Query(ctx, `
		with eligible_users as (
			select distinct u.id, u.display_name
			from users u
			where u.id = $2
			union
			select distinct u.id, u.display_name
			from submissions s
			join users u on u.id = s.user_id
			where s.daily_set_id = $1
		),
		accepted as (
			select s.user_id, s.problem_id, min(s.submitted_at) as first_solved_at
			from submissions s
			where s.daily_set_id = $1
			  and s.verdict in ('accepted', 'completed', 'manual_solve')
			group by s.user_id, s.problem_id
		),
		rollup as (
			select
				eu.id::text as user_id,
				eu.display_name,
				coalesce(sum(coalesce(dsi.points, 1)) filter (where a.problem_id is not null), 0)::numeric as points,
				coalesce(count(a.problem_id), 0)::integer as solves,
				max(a.first_solved_at) as last_solved_at
			from eligible_users eu
			left join accepted a on a.user_id = eu.id
			left join daily_set_items dsi on dsi.daily_set_id = $1 and dsi.problem_id = a.problem_id
			group by eu.id, eu.display_name
		)
		select
			row_number() over (order by points desc, solves desc, last_solved_at asc nulls last, display_name) as rank,
			user_id,
			display_name,
			points,
			solves,
			last_solved_at,
			null::integer as streak_count
		from rollup
		order by rank
	`, dailySetID, current.ID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanLeaderboardRows(rows)
}

func scanLeaderboardRows(rows pgx.Rows) ([]LeaderboardRow, error) {
	leaderboard := []LeaderboardRow{}
	for rows.Next() {
		var row LeaderboardRow
		var lastSolvedAt sql.NullTime
		var streakCount sql.NullInt64
		if err := rows.Scan(
			&row.Rank,
			&row.UserID,
			&row.DisplayName,
			&row.Points,
			&row.Solves,
			&lastSolvedAt,
			&streakCount,
		); err != nil {
			return nil, err
		}
		row.LastSolvedAt = nullTimePtr(lastSolvedAt)
		row.StreakCount = nullIntPtr(streakCount)
		leaderboard = append(leaderboard, row)
	}
	return leaderboard, rows.Err()
}
