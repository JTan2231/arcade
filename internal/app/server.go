package app

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"io/fs"
	"log/slog"
	"net/http"
	"regexp"
	"strings"
	"time"

	"arcade/web"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
)

type Server struct {
	db          *pgxpool.Pool
	config      Config
	currentUser User
	static      http.Handler
}

func NewServer(ctx context.Context, db *pgxpool.Pool, config Config) (*Server, error) {
	user, err := ensureDevUser(ctx, db, config)
	if err != nil {
		return nil, err
	}

	staticFS, err := fs.Sub(web.Static, "static")
	if err != nil {
		return nil, fmt.Errorf("load static files: %w", err)
	}

	return &Server{
		db:          db,
		config:      config,
		currentUser: user,
		static:      http.FileServer(http.FS(staticFS)),
	}, nil
}

func (s *Server) Routes() http.Handler {
	mux := http.NewServeMux()

	mux.HandleFunc("GET /api/health", s.handleHealth)

	mux.HandleFunc("GET /api/me", s.handleGetMe)
	mux.HandleFunc("PATCH /api/me", s.handlePatchMe)
	mux.HandleFunc("GET /api/me/preferences", s.handleGetPreferences)
	mux.HandleFunc("PATCH /api/me/preferences", s.handlePatchPreferences)
	mux.HandleFunc("GET /api/me/external-accounts", s.handleListExternalAccounts)
	mux.HandleFunc("POST /api/me/external-accounts", s.handleCreateExternalAccount)
	mux.HandleFunc("GET /api/me/external-accounts/{account_id}", s.handleGetExternalAccount)
	mux.HandleFunc("DELETE /api/me/external-accounts/{account_id}", s.handleDeleteExternalAccount)
	mux.HandleFunc("POST /api/me/external-accounts/{account_id}/verify", s.handleVerifyExternalAccount)
	mux.HandleFunc("POST /api/me/external-accounts/{account_id}/sync", s.handleSyncExternalAccount)

	mux.HandleFunc("GET /api/sources", s.handleListSources)
	mux.HandleFunc("GET /api/sources/{source_slug}", s.handleGetSource)
	mux.HandleFunc("GET /api/problems", s.handleListProblems)
	mux.HandleFunc("GET /api/problems/{problem_id}", s.handleGetProblem)
	mux.HandleFunc("GET /api/sources/{source_slug}/problems", s.handleListProblems)
	mux.HandleFunc("GET /api/sources/{source_slug}/problems/{external_id...}", s.handleGetProblemByExternalID)

	mux.HandleFunc("GET /api/groups", s.handleListGroups)
	mux.HandleFunc("POST /api/groups", s.handleCreateGroup)
	mux.HandleFunc("GET /api/groups/{group_id}", s.handleGetGroup)
	mux.HandleFunc("PATCH /api/groups/{group_id}", s.handlePatchGroup)
	mux.HandleFunc("DELETE /api/groups/{group_id}", s.handleDeleteGroup)
	mux.HandleFunc("GET /api/groups/{group_id}/members", s.handleListGroupMembers)
	mux.HandleFunc("POST /api/groups/{group_id}/members", s.handleAddGroupMember)
	mux.HandleFunc("PATCH /api/groups/{group_id}/members/{user_id}", s.handlePatchGroupMember)
	mux.HandleFunc("DELETE /api/groups/{group_id}/members/{user_id}", s.handleDeleteGroupMember)

	mux.HandleFunc("GET /api/groups/{group_id}/divisions", s.handleListDivisions)
	mux.HandleFunc("POST /api/groups/{group_id}/divisions", s.handleCreateDivision)
	mux.HandleFunc("GET /api/groups/{group_id}/divisions/{division_id}", s.handleGetDivision)
	mux.HandleFunc("PATCH /api/groups/{group_id}/divisions/{division_id}", s.handlePatchDivision)
	mux.HandleFunc("DELETE /api/groups/{group_id}/divisions/{division_id}", s.handleDeleteDivision)
	mux.HandleFunc("GET /api/groups/{group_id}/divisions/{division_id}/members", s.handleListDivisionMembers)
	mux.HandleFunc("POST /api/groups/{group_id}/divisions/{division_id}/recompute", s.handleRecomputeDivision)

	mux.HandleFunc("GET /api/me/daily", s.handleGetMeDaily)
	mux.HandleFunc("POST /api/me/dailies/generate", s.handleGenerateMeDaily)
	mux.HandleFunc("GET /api/me/dailies", s.handleListMeDailies)
	mux.HandleFunc("GET /api/groups/{group_id}/daily", s.handleGetGroupDaily)
	mux.HandleFunc("POST /api/groups/{group_id}/dailies/generate", s.handleGenerateGroupDaily)
	mux.HandleFunc("GET /api/groups/{group_id}/dailies", s.handleListGroupDailies)
	mux.HandleFunc("GET /api/groups/{group_id}/divisions/{division_id}/daily", s.handleGetGroupDivisionDaily)
	mux.HandleFunc("POST /api/groups/{group_id}/divisions/{division_id}/dailies/generate", s.handleGenerateGroupDivisionDaily)
	mux.HandleFunc("GET /api/daily-sets/{daily_set_id}", s.handleGetDailySet)
	mux.HandleFunc("POST /api/daily-sets/{daily_set_id}/start-session", s.handleStartDailySession)
	mux.HandleFunc("GET /api/daily-sets/{daily_set_id}/leaderboard", s.handleDailySetLeaderboard)

	mux.HandleFunc("GET /api/groups/{group_id}/sessions", s.handleListGroupSessions)
	mux.HandleFunc("POST /api/groups/{group_id}/sessions", s.handleCreateGroupSession)
	mux.HandleFunc("GET /api/sessions/{session_id}", s.handleGetSession)
	mux.HandleFunc("PATCH /api/sessions/{session_id}", s.handlePatchSession)
	mux.HandleFunc("POST /api/sessions/{session_id}/join", s.handleJoinSession)
	mux.HandleFunc("POST /api/sessions/{session_id}/leave", s.handleLeaveSession)
	mux.HandleFunc("POST /api/sessions/{session_id}/start", s.handleStartSession)
	mux.HandleFunc("POST /api/sessions/{session_id}/finish", s.handleFinishSession)
	mux.HandleFunc("POST /api/sessions/{session_id}/cancel", s.handleCancelSession)
	mux.HandleFunc("GET /api/sessions/{session_id}/participants", s.handleListSessionParticipants)
	mux.HandleFunc("GET /api/sessions/{session_id}/problems", s.handleListSessionProblems)
	mux.HandleFunc("GET /api/sessions/{session_id}/leaderboard", s.handleSessionLeaderboard)
	mux.HandleFunc("GET /api/sessions/{session_id}/submissions", s.handleSessionSubmissions)
	mux.HandleFunc("GET /api/sessions/{session_id}/solves", s.handleSessionSolves)

	mux.HandleFunc("GET /api/me/submissions", s.handleMeSubmissions)
	mux.HandleFunc("GET /api/me/solves", s.handleMeSolves)
	mux.HandleFunc("POST /api/submissions/manual", s.handleManualSubmission)
	mux.HandleFunc("POST /api/sources/{source_slug}/sync/submissions", s.handleSyncSourceSubmissions)

	mux.HandleFunc("GET /api/leaderboards", s.handleGlobalLeaderboard)
	mux.HandleFunc("GET /api/groups/{group_id}/leaderboard", s.handleGroupLeaderboard)
	mux.HandleFunc("GET /api/groups/{group_id}/divisions/{division_id}/leaderboard", s.handleDivisionLeaderboard)

	mux.Handle("GET /", s.static)

	return s.withRequestLog(mux)
}

func (s *Server) withRequestLog(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		next.ServeHTTP(w, r)
		slog.Debug("request", "method", r.Method, "path", r.URL.Path, "duration", time.Since(start))
	})
}

func (s *Server) handleHealth(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 2*time.Second)
	defer cancel()

	if err := s.db.Ping(ctx); err != nil {
		writeError(w, http.StatusServiceUnavailable, "database unavailable")
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"ok":        true,
		"timestamp": time.Now().UTC(),
	})
}

func ensureDevUser(ctx context.Context, db *pgxpool.Pool, config Config) (User, error) {
	var user User
	var avatarURL sql.NullString
	err := db.QueryRow(ctx, `
		insert into users (username, display_name)
		values ($1, $2)
		on conflict (username) do update set display_name = excluded.display_name
		returning id::text, username, display_name, avatar_url, created_at, updated_at
	`, config.DevUsername, config.DevDisplayName).Scan(
		&user.ID,
		&user.Username,
		&user.DisplayName,
		&avatarURL,
		&user.CreatedAt,
		&user.UpdatedAt,
	)
	if err != nil {
		return User{}, fmt.Errorf("ensure development user: %w", err)
	}
	user.AvatarURL = nullStringPtr(avatarURL)
	return user, nil
}

func (s *Server) sourceIDBySlug(ctx context.Context, slug string) (string, error) {
	var id string
	if err := s.db.QueryRow(ctx, `select id::text from problem_sources where slug = $1`, slug).Scan(&id); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return "", errNotFound("source")
		}
		return "", err
	}
	return id, nil
}

func (s *Server) scoringRuleIDBySlug(ctx context.Context, slug string) (string, error) {
	var id string
	if err := s.db.QueryRow(ctx, `select id::text from scoring_rules where slug = $1`, slug).Scan(&id); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return "", errNotFound("scoring rule")
		}
		return "", err
	}
	return id, nil
}

func (s *Server) groupExists(ctx context.Context, groupID string) error {
	var exists bool
	if err := s.db.QueryRow(ctx, `select exists(select 1 from groups where id = $1)`, groupID).Scan(&exists); err != nil {
		return err
	}
	if !exists {
		return errNotFound("group")
	}
	return nil
}

func (s *Server) canAccessGroup(ctx context.Context, groupID string) error {
	var exists bool
	err := s.db.QueryRow(ctx, `
		select exists(
			select 1
			from groups g
			left join group_memberships gm on gm.group_id = g.id and gm.user_id = $2 and gm.status in ('active', 'invited')
			where g.id = $1 and (g.visibility = 'public' or gm.id is not null)
		)
	`, groupID, s.currentUser.ID).Scan(&exists)
	if err != nil {
		return err
	}
	if !exists {
		return errNotFound("group")
	}
	return nil
}

func errNotFound(entity string) error {
	return statusError{status: http.StatusNotFound, message: entity + " not found"}
}

type statusError struct {
	status  int
	message string
}

func (e statusError) Error() string {
	return e.message
}

func handleError(w http.ResponseWriter, err error) {
	var status statusError
	if errors.As(err, &status) {
		writeError(w, status.status, status.message)
		return
	}

	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) {
		slog.Error("database error", "code", pgErr.Code, "message", pgErr.Message, "detail", pgErr.Detail, "where", pgErr.Where)
		switch pgErr.Code {
		case "23505":
			writeError(w, http.StatusConflict, "record already exists")
		case "23503":
			writeError(w, http.StatusBadRequest, "referenced record does not exist")
		case "23514":
			writeError(w, http.StatusBadRequest, "value violates a model constraint")
		default:
			writeError(w, http.StatusInternalServerError, "database error")
		}
		return
	}

	slog.Error("request error", "error", err)
	writeError(w, http.StatusInternalServerError, "internal server error")
}

func badRequest(message string) error {
	return statusError{status: http.StatusBadRequest, message: message}
}

func slugify(value string) string {
	value = strings.ToLower(strings.TrimSpace(value))
	re := regexp.MustCompile(`[^a-z0-9]+`)
	value = re.ReplaceAllString(value, "-")
	value = strings.Trim(value, "-")
	if value == "" {
		return "untitled"
	}
	return value
}
