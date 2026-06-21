package app

import (
	"context"
	"database/sql"
	"errors"
	"net/http"
	"time"

	"github.com/jackc/pgx/v5"
)

func (s *Server) handleManualSubmission(w http.ResponseWriter, r *http.Request) {
	var req struct {
		ProblemID   string     `json:"problem_id"`
		Verdict     string     `json:"verdict"`
		SubmittedAt *time.Time `json:"submitted_at"`
		SessionID   *string    `json:"session_id"`
		DailySetID  *string    `json:"daily_set_id"`
		Language    *string    `json:"language"`
		RuntimeMS   *int       `json:"runtime_ms"`
		MemoryBytes *int       `json:"memory_bytes"`
	}
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid JSON request")
		return
	}
	if req.ProblemID == "" {
		writeError(w, http.StatusBadRequest, "problem_id is required")
		return
	}
	if req.Verdict == "" {
		req.Verdict = "manual_solve"
	}
	submittedAt := time.Now().UTC()
	if req.SubmittedAt != nil {
		submittedAt = *req.SubmittedAt
	}

	var sourceID string
	if err := s.db.QueryRow(r.Context(), `select source_id::text from problems where id = $1`, req.ProblemID).Scan(&sourceID); errors.Is(err, pgx.ErrNoRows) {
		writeError(w, http.StatusNotFound, "problem not found")
		return
	} else if err != nil {
		handleError(w, err)
		return
	}

	if req.SessionID != nil && req.DailySetID == nil {
		var dailySetID sql.NullString
		if err := s.db.QueryRow(r.Context(), `select daily_set_id::text from virtual_sessions where id = $1`, *req.SessionID).Scan(&dailySetID); err == nil {
			req.DailySetID = nullStringPtr(dailySetID)
		}
	}

	var submissionID string
	err := s.db.QueryRow(r.Context(), `
		insert into submissions (
			user_id,
			problem_id,
			source_id,
			session_id,
			daily_set_id,
			verdict,
			language,
			submitted_at,
			runtime_ms,
			memory_bytes
		)
		values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
		returning id::text
	`, s.currentUser.ID, req.ProblemID, sourceID, req.SessionID, req.DailySetID, req.Verdict, req.Language, submittedAt, nullableInt(req.RuntimeMS), nullableInt(req.MemoryBytes)).Scan(&submissionID)
	if err != nil {
		handleError(w, err)
		return
	}

	submission, err := s.getSubmission(r.Context(), submissionID)
	if err != nil {
		handleError(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, submission)
}

func (s *Server) handleMeSubmissions(w http.ResponseWriter, r *http.Request) {
	submissions, err := s.listSubmissions(r.Context(), "s.user_id = $1", s.currentUser.ID)
	if err != nil {
		handleError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, submissions)
}

func (s *Server) handleMeSolves(w http.ResponseWriter, r *http.Request) {
	submissions, err := s.listSubmissions(r.Context(), "s.user_id = $1 and s.verdict in ('accepted', 'completed', 'manual_solve')", s.currentUser.ID)
	if err != nil {
		handleError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, submissions)
}

func (s *Server) handleSessionSubmissions(w http.ResponseWriter, r *http.Request) {
	submissions, err := s.listSubmissions(r.Context(), "s.session_id = $1", r.PathValue("session_id"))
	if err != nil {
		handleError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, submissions)
}

func (s *Server) handleSessionSolves(w http.ResponseWriter, r *http.Request) {
	submissions, err := s.listSubmissions(r.Context(), "s.session_id = $1 and s.verdict in ('accepted', 'completed', 'manual_solve')", r.PathValue("session_id"))
	if err != nil {
		handleError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, submissions)
}

func (s *Server) handleSyncSourceSubmissions(w http.ResponseWriter, r *http.Request) {
	sourceID, err := s.sourceIDBySlug(r.Context(), r.PathValue("source_slug"))
	if err != nil {
		handleError(w, err)
		return
	}
	_, err = s.db.Exec(r.Context(), `
		update external_accounts
		set sync_status = 'synced',
		    last_synced_at = now()
		where user_id = $1 and source_id = $2
	`, s.currentUser.ID, sourceID)
	if err != nil {
		handleError(w, err)
		return
	}
	writeJSON(w, http.StatusAccepted, map[string]any{
		"source": r.PathValue("source_slug"),
		"status": "synced",
		"note":   "external provider import is not connected in the local build",
	})
}

func (s *Server) getSubmission(ctx context.Context, submissionID string) (Submission, error) {
	submission, err := scanSubmission(s.db.QueryRow(ctx, submissionSelect()+` where s.id = $1`, submissionID))
	if errors.Is(err, pgx.ErrNoRows) {
		return Submission{}, errNotFound("submission")
	}
	return submission, err
}

func (s *Server) listSubmissions(ctx context.Context, predicate string, args ...any) ([]Submission, error) {
	rows, err := s.db.Query(ctx, submissionSelect()+`
		where `+predicate+`
		order by s.submitted_at desc
		limit 200
	`, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	submissions := []Submission{}
	for rows.Next() {
		submission, err := scanSubmission(rows)
		if err != nil {
			return nil, err
		}
		submissions = append(submissions, submission)
	}
	return submissions, rows.Err()
}

func submissionSelect() string {
	return `
		select
			s.id::text,
			s.user_id::text,
			u.display_name,
			s.problem_id::text,
			p.title,
			s.source_id::text,
			ps.slug,
			s.external_submission_id,
			s.external_account_id::text,
			s.session_id::text,
			s.daily_set_id::text,
			s.verdict,
			s.language,
			s.submitted_at,
			s.runtime_ms,
			s.memory_bytes,
			s.created_at
		from submissions s
		join users u on u.id = s.user_id
		join problems p on p.id = s.problem_id
		join problem_sources ps on ps.id = s.source_id
	`
}

func scanSubmission(row pgx.Row) (Submission, error) {
	var submission Submission
	var externalSubmissionID sql.NullString
	var externalAccountID sql.NullString
	var sessionID sql.NullString
	var dailySetID sql.NullString
	var language sql.NullString
	var runtimeMS sql.NullInt64
	var memoryBytes sql.NullInt64
	if err := row.Scan(
		&submission.ID,
		&submission.UserID,
		&submission.DisplayName,
		&submission.ProblemID,
		&submission.ProblemTitle,
		&submission.SourceID,
		&submission.SourceSlug,
		&externalSubmissionID,
		&externalAccountID,
		&sessionID,
		&dailySetID,
		&submission.Verdict,
		&language,
		&submission.SubmittedAt,
		&runtimeMS,
		&memoryBytes,
		&submission.CreatedAt,
	); err != nil {
		return Submission{}, err
	}
	submission.ExternalSubmissionID = nullStringPtr(externalSubmissionID)
	submission.ExternalAccountID = nullStringPtr(externalAccountID)
	submission.SessionID = nullStringPtr(sessionID)
	submission.DailySetID = nullStringPtr(dailySetID)
	submission.Language = nullStringPtr(language)
	submission.RuntimeMS = nullIntPtr(runtimeMS)
	submission.MemoryBytes = nullIntPtr(memoryBytes)
	return submission, nil
}
