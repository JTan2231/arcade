package app

import (
	"context"
	"errors"
	"fmt"
	"io/fs"
	"log/slog"
	"net/http"
	"regexp"
	"strings"
	"time"

	"arcade/web"

	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
)

type Server struct {
	db     *pgxpool.Pool
	static http.Handler
}

func NewServer(_ context.Context, db *pgxpool.Pool, _ Config) (*Server, error) {
	staticFS, err := fs.Sub(web.Static, "static")
	if err != nil {
		return nil, fmt.Errorf("load static files: %w", err)
	}

	return &Server{
		db:     db,
		static: http.FileServer(http.FS(staticFS)),
	}, nil
}

func (s *Server) Routes() http.Handler {
	mux := http.NewServeMux()

	mux.HandleFunc("GET /api/health", s.handleHealth)
	mux.HandleFunc("POST /api/auth/signup", s.handleSignup)
	mux.HandleFunc("POST /api/auth/login", s.handleLogin)
	mux.HandleFunc("POST /api/auth/logout", s.handleLogout)
	mux.HandleFunc("GET /api/auth/session", s.handleAuthSession)

	mux.HandleFunc("GET /api/me", s.handleGetMe)
	mux.HandleFunc("PATCH /api/me", s.handlePatchMe)

	mux.HandleFunc("GET /api/groups", s.handleListGroups)
	mux.HandleFunc("POST /api/groups", s.handleCreateGroup)
	mux.HandleFunc("GET /api/groups/{group_id}", s.handleGetGroup)
	mux.HandleFunc("PATCH /api/groups/{group_id}", s.handlePatchGroup)
	mux.HandleFunc("DELETE /api/groups/{group_id}", s.handleDeleteGroup)
	mux.HandleFunc("GET /api/groups/{group_id}/members", s.handleListGroupMembers)
	mux.HandleFunc("POST /api/groups/{group_id}/members", s.handleAddGroupMember)
	mux.HandleFunc("PATCH /api/groups/{group_id}/members/{user_id}", s.handlePatchGroupMember)
	mux.HandleFunc("DELETE /api/groups/{group_id}/members/{user_id}", s.handleDeleteGroupMember)
	mux.HandleFunc("GET /api/groups/{group_id}/catalog-sources", s.handleListGroupCatalogSources)
	mux.HandleFunc("POST /api/groups/{group_id}/catalog-sources", s.handleCreateGroupCatalogSource)
	mux.HandleFunc("GET /api/groups/{group_id}/catalog-sources/{source_id}", s.handleGetGroupCatalogSource)
	mux.HandleFunc("GET /api/groups/{group_id}/catalog-sources/{source_id}/items", s.handleListGroupCatalogItems)
	mux.HandleFunc("POST /api/groups/{group_id}/catalog-sources/{source_id}/items", s.handleCreateGroupCatalogItem)

	mux.HandleFunc("GET /api/groups/{group_id}/divisions", s.handleListDivisions)
	mux.HandleFunc("POST /api/groups/{group_id}/divisions", s.handleCreateDivision)
	mux.HandleFunc("GET /api/groups/{group_id}/divisions/{division_id}", s.handleGetDivision)
	mux.HandleFunc("PATCH /api/groups/{group_id}/divisions/{division_id}", s.handlePatchDivision)
	mux.HandleFunc("DELETE /api/groups/{group_id}/divisions/{division_id}", s.handleDeleteDivision)
	mux.HandleFunc("GET /api/groups/{group_id}/divisions/{division_id}/members", s.handleListDivisionMembers)
	mux.HandleFunc("POST /api/groups/{group_id}/divisions/{division_id}/recompute", s.handleRecomputeDivision)

	mux.HandleFunc("GET /api/me/daily-feeds", s.handleListMeDailyFeeds)
	mux.HandleFunc("GET /api/me/daily-feed-outputs", s.handleListMeDailyFeedOutputs)
	mux.HandleFunc("GET /api/groups/{group_id}/daily-feeds", s.handleListGroupDailyFeeds)
	mux.HandleFunc("POST /api/groups/{group_id}/daily-feeds", s.handleCreateGroupDailyFeed)
	mux.HandleFunc("POST /api/groups/{group_id}/daily-feeds/preview", s.handlePreviewGroupDailyFeed)
	mux.HandleFunc("GET /api/groups/{group_id}/daily-feeds/{feed_id}", s.handleGetGroupDailyFeed)
	mux.HandleFunc("PATCH /api/groups/{group_id}/daily-feeds/{feed_id}", s.handlePatchGroupDailyFeed)
	mux.HandleFunc("DELETE /api/groups/{group_id}/daily-feeds/{feed_id}", s.handleDeleteGroupDailyFeed)
	mux.HandleFunc("GET /api/groups/{group_id}/daily-feeds/{feed_id}/today", s.handleGetGroupDailyFeedToday)
	mux.HandleFunc("GET /api/groups/{group_id}/daily-feeds/{feed_id}/outputs/{date}", s.handleGetGroupDailyFeedOutput)
	mux.HandleFunc("GET /api/groups/{group_id}/daily-feeds/{feed_id}/outputs/{date}/posts", s.handleListGroupFeedPosts)
	mux.HandleFunc("POST /api/groups/{group_id}/daily-feeds/{feed_id}/outputs/{date}/posts", s.handleCreateGroupFeedPost)
	mux.HandleFunc("GET /api/groups/{group_id}/feed-posts/{post_id}", s.handleGetGroupFeedPost)
	mux.HandleFunc("PATCH /api/groups/{group_id}/feed-posts/{post_id}", s.handlePatchGroupFeedPost)
	mux.HandleFunc("DELETE /api/groups/{group_id}/feed-posts/{post_id}", s.handleDeleteGroupFeedPost)

	mux.Handle("GET /", s.static)

	return s.withRequestLog(s.withAuth(mux))
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

func errNotFound(entity string) error {
	return statusError{status: http.StatusNotFound, message: entity + " not found"}
}

func unauthorized(message string) error {
	return statusError{status: http.StatusUnauthorized, message: message}
}

func forbidden(message string) error {
	return statusError{status: http.StatusForbidden, message: message}
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

func isUniqueConstraint(err error, constraint string) bool {
	var pgErr *pgconn.PgError
	if !errors.As(err, &pgErr) || pgErr.Code != "23505" {
		return false
	}
	return constraint == "" || pgErr.ConstraintName == constraint
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
