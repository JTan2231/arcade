package app

import (
	"context"
	"database/sql"
	"errors"
	"net/http"
	"time"

	"github.com/jackc/pgx/v5"
)

func (s *Server) handleListGroupSessions(w http.ResponseWriter, r *http.Request) {
	groupID := r.PathValue("group_id")
	rows, err := s.db.Query(r.Context(), sessionSelect()+`
		where vs.group_id = $1
		order by vs.created_at desc
	`, groupID)
	if err != nil {
		handleError(w, err)
		return
	}
	defer rows.Close()

	sessions := []Session{}
	for rows.Next() {
		session, err := scanSession(rows)
		if err != nil {
			handleError(w, err)
			return
		}
		sessions = append(sessions, session)
	}
	if err := rows.Err(); err != nil {
		handleError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, sessions)
}

func (s *Server) handleCreateGroupSession(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Title             string     `json:"title"`
		Mode              string     `json:"mode"`
		Source            *string    `json:"source"`
		DailySetID        *string    `json:"daily_set_id"`
		ExternalContestID *string    `json:"external_contest_id"`
		StartsAt          *time.Time `json:"starts_at"`
		DurationMinutes   *int       `json:"duration_minutes"`
		ScoringRule       *string    `json:"scoring_rule"`
	}
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid JSON request")
		return
	}
	if req.Title == "" {
		req.Title = "Practice Session"
	}
	if req.Mode == "" {
		req.Mode = "practice_set"
	}

	groupID := r.PathValue("group_id")
	if err := s.groupExists(r.Context(), groupID); err != nil {
		handleError(w, err)
		return
	}

	var sourceID any
	if req.Source != nil && *req.Source != "" {
		id, err := s.sourceIDBySlug(r.Context(), *req.Source)
		if err != nil {
			handleError(w, err)
			return
		}
		sourceID = id
	}

	ruleSlug := "contest_standard"
	if req.ScoringRule != nil && *req.ScoringRule != "" {
		ruleSlug = *req.ScoringRule
	}
	ruleID, err := s.scoringRuleIDBySlug(r.Context(), ruleSlug)
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

	var sessionID string
	if err := tx.QueryRow(r.Context(), `
		insert into virtual_sessions (
			group_id,
			host_user_id,
			source_id,
			daily_set_id,
			external_contest_id,
			title,
			mode,
			status,
			starts_at,
			duration_minutes,
			scoring_rule_id
		)
		values ($1, $2, $3, $4, $5, $6, $7, 'scheduled', $8, $9, $10)
		returning id::text
	`, groupID, s.currentUser.ID, sourceID, req.DailySetID, req.ExternalContestID, req.Title, req.Mode, req.StartsAt, nullableInt(req.DurationMinutes), ruleID).Scan(&sessionID); err != nil {
		handleError(w, err)
		return
	}

	if _, err := tx.Exec(r.Context(), `
		insert into session_participants (session_id, user_id, status, joined_at)
		values ($1, $2, 'joined', now())
	`, sessionID, s.currentUser.ID); err != nil {
		handleError(w, err)
		return
	}

	if err := tx.Commit(r.Context()); err != nil {
		handleError(w, err)
		return
	}

	session, err := s.getSession(r.Context(), sessionID)
	if err != nil {
		handleError(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, session)
}

func (s *Server) handleGetSession(w http.ResponseWriter, r *http.Request) {
	session, err := s.getSession(r.Context(), r.PathValue("session_id"))
	if err != nil {
		handleError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, session)
}

func (s *Server) handlePatchSession(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Title           *string    `json:"title"`
		Status          *string    `json:"status"`
		StartsAt        *time.Time `json:"starts_at"`
		DurationMinutes *int       `json:"duration_minutes"`
	}
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid JSON request")
		return
	}

	tag, err := s.db.Exec(r.Context(), `
		update virtual_sessions
		set title = coalesce($2, title),
		    status = coalesce($3, status),
		    starts_at = coalesce($4, starts_at),
		    duration_minutes = coalesce($5, duration_minutes)
		where id = $1
	`, r.PathValue("session_id"), req.Title, req.Status, req.StartsAt, nullableInt(req.DurationMinutes))
	if err != nil {
		handleError(w, err)
		return
	}
	if tag.RowsAffected() == 0 {
		writeError(w, http.StatusNotFound, "session not found")
		return
	}

	session, err := s.getSession(r.Context(), r.PathValue("session_id"))
	if err != nil {
		handleError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, session)
}

func (s *Server) handleJoinSession(w http.ResponseWriter, r *http.Request) {
	sessionID := r.PathValue("session_id")
	if _, err := s.getSession(r.Context(), sessionID); err != nil {
		handleError(w, err)
		return
	}
	if _, err := s.db.Exec(r.Context(), `
		insert into session_participants (session_id, user_id, status, joined_at)
		values ($1, $2, 'joined', now())
		on conflict (session_id, user_id) do update set
			status = 'joined',
			joined_at = coalesce(session_participants.joined_at, now())
	`, sessionID, s.currentUser.ID); err != nil {
		handleError(w, err)
		return
	}
	participants, err := s.listSessionParticipants(r.Context(), sessionID)
	if err != nil {
		handleError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, participants)
}

func (s *Server) handleLeaveSession(w http.ResponseWriter, r *http.Request) {
	if _, err := s.db.Exec(r.Context(), `
		update session_participants
		set status = 'abandoned',
		    finished_at = coalesce(finished_at, now())
		where session_id = $1 and user_id = $2
	`, r.PathValue("session_id"), s.currentUser.ID); err != nil {
		handleError(w, err)
		return
	}
	participants, err := s.listSessionParticipants(r.Context(), r.PathValue("session_id"))
	if err != nil {
		handleError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, participants)
}

func (s *Server) handleStartSession(w http.ResponseWriter, r *http.Request) {
	sessionID := r.PathValue("session_id")
	tx, err := s.db.Begin(r.Context())
	if err != nil {
		handleError(w, err)
		return
	}
	defer tx.Rollback(r.Context())

	tag, err := tx.Exec(r.Context(), `
		update virtual_sessions
		set status = 'live',
		    starts_at = coalesce(starts_at, now())
		where id = $1
	`, sessionID)
	if err != nil {
		handleError(w, err)
		return
	}
	if tag.RowsAffected() == 0 {
		writeError(w, http.StatusNotFound, "session not found")
		return
	}

	if _, err := tx.Exec(r.Context(), `
		insert into session_participants (session_id, user_id, status, joined_at, started_at)
		values ($1, $2, 'active', now(), now())
		on conflict (session_id, user_id) do update set
			status = 'active',
			started_at = coalesce(session_participants.started_at, now())
	`, sessionID, s.currentUser.ID); err != nil {
		handleError(w, err)
		return
	}

	if err := tx.Commit(r.Context()); err != nil {
		handleError(w, err)
		return
	}
	session, err := s.getSession(r.Context(), sessionID)
	if err != nil {
		handleError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, session)
}

func (s *Server) handleFinishSession(w http.ResponseWriter, r *http.Request) {
	sessionID := r.PathValue("session_id")
	tx, err := s.db.Begin(r.Context())
	if err != nil {
		handleError(w, err)
		return
	}
	defer tx.Rollback(r.Context())

	tag, err := tx.Exec(r.Context(), `
		update virtual_sessions
		set status = 'finished'
		where id = $1
	`, sessionID)
	if err != nil {
		handleError(w, err)
		return
	}
	if tag.RowsAffected() == 0 {
		writeError(w, http.StatusNotFound, "session not found")
		return
	}

	if _, err := tx.Exec(r.Context(), `
		update session_participants
		set status = case when status = 'abandoned' then status else 'finished' end,
		    finished_at = coalesce(finished_at, now())
		where session_id = $1
	`, sessionID); err != nil {
		handleError(w, err)
		return
	}

	if err := tx.Commit(r.Context()); err != nil {
		handleError(w, err)
		return
	}
	session, err := s.getSession(r.Context(), sessionID)
	if err != nil {
		handleError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, session)
}

func (s *Server) handleCancelSession(w http.ResponseWriter, r *http.Request) {
	tag, err := s.db.Exec(r.Context(), `
		update virtual_sessions
		set status = 'cancelled'
		where id = $1
	`, r.PathValue("session_id"))
	if err != nil {
		handleError(w, err)
		return
	}
	if tag.RowsAffected() == 0 {
		writeError(w, http.StatusNotFound, "session not found")
		return
	}
	session, err := s.getSession(r.Context(), r.PathValue("session_id"))
	if err != nil {
		handleError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, session)
}

func (s *Server) handleListSessionParticipants(w http.ResponseWriter, r *http.Request) {
	participants, err := s.listSessionParticipants(r.Context(), r.PathValue("session_id"))
	if err != nil {
		handleError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, participants)
}

func (s *Server) handleListSessionProblems(w http.ResponseWriter, r *http.Request) {
	session, err := s.getSession(r.Context(), r.PathValue("session_id"))
	if err != nil {
		handleError(w, err)
		return
	}
	if session.DailySetID != nil {
		daily, err := s.getDailySet(r.Context(), *session.DailySetID)
		if err != nil {
			handleError(w, err)
			return
		}
		problems := make([]Problem, 0, len(daily.Items))
		for _, item := range daily.Items {
			problems = append(problems, item.Problem)
		}
		writeJSON(w, http.StatusOK, problems)
		return
	}
	if session.SourceSlug != nil && session.ExternalContestID != nil {
		problems, err := s.listProblems(r.Context(), problemFilters{
			source:    *session.SourceSlug,
			contestID: *session.ExternalContestID,
			limit:     200,
		})
		if err != nil {
			handleError(w, err)
			return
		}
		writeJSON(w, http.StatusOK, problems)
		return
	}
	writeJSON(w, http.StatusOK, []Problem{})
}

func (s *Server) getSession(ctx context.Context, sessionID string) (Session, error) {
	session, err := scanSession(s.db.QueryRow(ctx, sessionSelect()+` where vs.id = $1`, sessionID))
	if errors.Is(err, pgx.ErrNoRows) {
		return Session{}, errNotFound("session")
	}
	return session, err
}

func sessionSelect() string {
	return `
		select
			vs.id::text,
			vs.group_id::text,
			vs.host_user_id::text,
			host.display_name,
			vs.source_id::text,
			ps.slug,
			vs.daily_set_id::text,
			vs.external_contest_id,
			vs.title,
			vs.mode,
			vs.status,
			vs.starts_at,
			vs.duration_minutes,
			vs.scoring_rule_id::text,
			sr.slug,
			vs.created_at,
			vs.updated_at
		from virtual_sessions vs
		join users host on host.id = vs.host_user_id
		left join problem_sources ps on ps.id = vs.source_id
		left join scoring_rules sr on sr.id = vs.scoring_rule_id
	`
}

func scanSession(row pgx.Row) (Session, error) {
	var session Session
	var groupID sql.NullString
	var sourceID sql.NullString
	var sourceSlug sql.NullString
	var dailySetID sql.NullString
	var externalContestID sql.NullString
	var startsAt sql.NullTime
	var durationMinutes sql.NullInt64
	var scoringRuleID sql.NullString
	var scoringRuleSlug sql.NullString
	if err := row.Scan(
		&session.ID,
		&groupID,
		&session.HostUserID,
		&session.HostDisplayName,
		&sourceID,
		&sourceSlug,
		&dailySetID,
		&externalContestID,
		&session.Title,
		&session.Mode,
		&session.Status,
		&startsAt,
		&durationMinutes,
		&scoringRuleID,
		&scoringRuleSlug,
		&session.CreatedAt,
		&session.UpdatedAt,
	); err != nil {
		return Session{}, err
	}
	session.GroupID = nullStringPtr(groupID)
	session.SourceID = nullStringPtr(sourceID)
	session.SourceSlug = nullStringPtr(sourceSlug)
	session.DailySetID = nullStringPtr(dailySetID)
	session.ExternalContestID = nullStringPtr(externalContestID)
	session.StartsAt = nullTimePtr(startsAt)
	session.DurationMinutes = nullIntPtr(durationMinutes)
	session.ScoringRuleID = nullStringPtr(scoringRuleID)
	session.ScoringRuleSlug = nullStringPtr(scoringRuleSlug)
	return session, nil
}

func (s *Server) listSessionParticipants(ctx context.Context, sessionID string) ([]SessionParticipant, error) {
	rows, err := s.db.Query(ctx, `
		select
			sp.session_id::text,
			sp.user_id::text,
			u.username,
			u.display_name,
			sp.status,
			sp.joined_at,
			sp.started_at,
			sp.finished_at
		from session_participants sp
		join users u on u.id = sp.user_id
		where sp.session_id = $1
		order by sp.joined_at, u.display_name
	`, sessionID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	participants := []SessionParticipant{}
	for rows.Next() {
		var participant SessionParticipant
		var startedAt sql.NullTime
		var finishedAt sql.NullTime
		if err := rows.Scan(
			&participant.SessionID,
			&participant.UserID,
			&participant.Username,
			&participant.DisplayName,
			&participant.Status,
			&participant.JoinedAt,
			&startedAt,
			&finishedAt,
		); err != nil {
			return nil, err
		}
		participant.StartedAt = nullTimePtr(startedAt)
		participant.FinishedAt = nullTimePtr(finishedAt)
		participants = append(participants, participant)
	}
	return participants, rows.Err()
}

func nullableInt(value *int) any {
	if value == nil {
		return nil
	}
	return *value
}
