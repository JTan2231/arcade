package app

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"strconv"
	"strings"
	"unicode/utf8"

	"github.com/jackc/pgx/v5"
)

const (
	postCardMaterialModel = "arcade-pigment-v1"
	chalkboardSystemKey   = "chalkboard"
)

type postCardMaterialIntentRequest struct {
	Model               string `json:"model"`
	SurfaceHue          int    `json:"surface_hue"`
	SurfaceColorfulness int    `json:"surface_colorfulness"`
	AccentHue           *int   `json:"accent_hue"`
	AccentColorfulness  *int   `json:"accent_colorfulness"`
}

type createGroupPostCardPaletteRequest struct {
	Name           string                        `json:"name"`
	MaterialIntent postCardMaterialIntentRequest `json:"material_intent"`
}

type patchGroupPostCardPaletteRequest struct {
	ExpectedRevision int64                               `json:"expected_revision"`
	Name             optionalStringField                 `json:"name"`
	MaterialIntent   optionalPostCardMaterialIntentField `json:"material_intent"`
	Archived         optionalBoolField                   `json:"archived"`
}

type optionalPostCardMaterialIntentField struct {
	Set   bool
	Value postCardMaterialIntentRequest
}

func (field *optionalPostCardMaterialIntentField) UnmarshalJSON(data []byte) error {
	field.Set = true
	if strings.TrimSpace(string(data)) == "null" {
		return errors.New("field must be a material intent object")
	}
	return json.Unmarshal(data, &field.Value)
}

type normalizedPostCardPaletteInput struct {
	Name           string
	MaterialIntent PostCardMaterialIntent
}

type normalizedPostCardPalettePatch struct {
	ExpectedRevision int64
	Name             *string
	MaterialIntent   *PostCardMaterialIntent
	Archived         *bool
}

type postCardPaletteRowQuerier interface {
	QueryRow(context.Context, string, ...any) pgx.Row
}

func (s *Server) handleListGroupPostCardPalettes(w http.ResponseWriter, r *http.Request) {
	setPrivateNoStore(w)
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

	includeArchived := r.URL.Query().Get("include_archived") == "true"
	if includeArchived && !canManageDailyFeeds(role) {
		handleError(w, forbidden("insufficient group permissions"))
		return
	}

	palettes, err := s.listGroupPostCardPalettes(r.Context(), groupID, includeArchived)
	if err != nil {
		handleError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, palettes)
}

func (s *Server) handleCreateGroupPostCardPalette(w http.ResponseWriter, r *http.Request) {
	setPrivateNoStore(w)
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

	var req createGroupPostCardPaletteRequest
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid JSON request")
		return
	}
	input, err := normalizeCreateGroupPostCardPaletteRequest(req)
	if err != nil {
		handleError(w, err)
		return
	}

	var paletteID string
	err = s.db.QueryRow(r.Context(), `
		insert into group_post_card_palettes (
			group_id,
			name,
			material_model,
			surface_hue,
			surface_colorfulness,
			accent_hue,
			accent_colorfulness,
			created_by_user_id,
			updated_by_user_id
		)
		values ($1, $2, $3, $4, $5, $6, $7, $8, $8)
		returning id::text
	`,
		groupID,
		input.Name,
		input.MaterialIntent.Model,
		input.MaterialIntent.SurfaceHue,
		input.MaterialIntent.SurfaceColorfulness,
		input.MaterialIntent.AccentHue,
		input.MaterialIntent.AccentColorfulness,
		current.ID,
	).Scan(&paletteID)
	if err != nil {
		handlePostCardPaletteWriteError(w, err)
		return
	}

	palette, err := s.getGroupPostCardPalette(r.Context(), groupID, paletteID)
	if err != nil {
		handleError(w, err)
		return
	}
	setPostCardPaletteETag(w, palette.Revision)
	writeJSON(w, http.StatusCreated, palette)
}

func (s *Server) handleGetGroupPostCardPalette(w http.ResponseWriter, r *http.Request) {
	setPrivateNoStore(w)
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

	palette, err := s.getGroupPostCardPalette(r.Context(), groupID, r.PathValue("palette_id"))
	if err != nil {
		handleError(w, err)
		return
	}
	if palette.ArchivedAt != nil && !canManageDailyFeeds(role) {
		handleError(w, forbidden("insufficient group permissions"))
		return
	}
	setPostCardPaletteETag(w, palette.Revision)
	writeJSON(w, http.StatusOK, palette)
}

func (s *Server) handlePatchGroupPostCardPalette(w http.ResponseWriter, r *http.Request) {
	setPrivateNoStore(w)
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

	var req patchGroupPostCardPaletteRequest
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid JSON request")
		return
	}
	patch, err := normalizePatchGroupPostCardPaletteRequest(req)
	if err != nil {
		handleError(w, err)
		return
	}

	palette, err := s.patchGroupPostCardPalette(
		r.Context(),
		groupID,
		r.PathValue("palette_id"),
		current.ID,
		patch,
	)
	if err != nil {
		handlePostCardPaletteWriteError(w, err)
		return
	}
	setPostCardPaletteETag(w, palette.Revision)
	writeJSON(w, http.StatusOK, palette)
}

func (s *Server) handleDeleteGroupPostCardPalette(w http.ResponseWriter, r *http.Request) {
	setPrivateNoStore(w)
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

	expectedRevision, err := parsePostCardPaletteIfMatch(r.Header.Get("If-Match"))
	if err != nil {
		handleError(w, err)
		return
	}
	archived := true
	_, err = s.patchGroupPostCardPalette(r.Context(), groupID, r.PathValue("palette_id"), current.ID, normalizedPostCardPalettePatch{
		ExpectedRevision: expectedRevision,
		Archived:         &archived,
	})
	if err != nil {
		handlePostCardPaletteWriteError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func normalizeCreateGroupPostCardPaletteRequest(req createGroupPostCardPaletteRequest) (normalizedPostCardPaletteInput, error) {
	name, err := normalizePostCardPaletteName(req.Name)
	if err != nil {
		return normalizedPostCardPaletteInput{}, err
	}
	intent, err := normalizePostCardMaterialIntent(req.MaterialIntent)
	if err != nil {
		return normalizedPostCardPaletteInput{}, err
	}
	return normalizedPostCardPaletteInput{Name: name, MaterialIntent: intent}, nil
}

func normalizePatchGroupPostCardPaletteRequest(req patchGroupPostCardPaletteRequest) (normalizedPostCardPalettePatch, error) {
	if req.ExpectedRevision < 1 {
		return normalizedPostCardPalettePatch{}, badRequest("expected_revision must be a positive integer")
	}
	if !req.Name.Set && !req.MaterialIntent.Set && !req.Archived.Set {
		return normalizedPostCardPalettePatch{}, badRequest("at least one palette field is required")
	}

	patch := normalizedPostCardPalettePatch{ExpectedRevision: req.ExpectedRevision}
	if req.Name.Set {
		name, err := normalizePostCardPaletteName(req.Name.Value)
		if err != nil {
			return normalizedPostCardPalettePatch{}, err
		}
		patch.Name = &name
	}
	if req.MaterialIntent.Set {
		intent, err := normalizePostCardMaterialIntent(req.MaterialIntent.Value)
		if err != nil {
			return normalizedPostCardPalettePatch{}, err
		}
		patch.MaterialIntent = &intent
	}
	if req.Archived.Set {
		patch.Archived = &req.Archived.Value
	}
	return patch, nil
}

func normalizePostCardPaletteName(raw string) (string, error) {
	name := strings.TrimSpace(raw)
	if name == "" {
		return "", badRequest("palette name is required")
	}
	if utf8.RuneCountInString(name) > 48 {
		return "", badRequest("palette name must be 48 characters or fewer")
	}
	return name, nil
}

func normalizePostCardMaterialIntent(req postCardMaterialIntentRequest) (PostCardMaterialIntent, error) {
	if req.Model != postCardMaterialModel {
		return PostCardMaterialIntent{}, badRequest("material_intent.model must be arcade-pigment-v1")
	}
	if req.SurfaceHue < 0 || req.SurfaceHue > 359 {
		return PostCardMaterialIntent{}, badRequest("material_intent.surface_hue must be between 0 and 359")
	}
	if req.SurfaceColorfulness < 0 || req.SurfaceColorfulness > 100 {
		return PostCardMaterialIntent{}, badRequest("material_intent.surface_colorfulness must be between 0 and 100")
	}
	if (req.AccentHue == nil) != (req.AccentColorfulness == nil) {
		return PostCardMaterialIntent{}, badRequest("material_intent accent_hue and accent_colorfulness must be provided together")
	}
	if req.AccentHue != nil && (*req.AccentHue < 0 || *req.AccentHue > 359) {
		return PostCardMaterialIntent{}, badRequest("material_intent.accent_hue must be between 0 and 359")
	}
	if req.AccentColorfulness != nil && (*req.AccentColorfulness < 0 || *req.AccentColorfulness > 100) {
		return PostCardMaterialIntent{}, badRequest("material_intent.accent_colorfulness must be between 0 and 100")
	}
	return PostCardMaterialIntent{
		Model:               postCardMaterialModel,
		SurfaceHue:          req.SurfaceHue,
		SurfaceColorfulness: req.SurfaceColorfulness,
		AccentHue:           req.AccentHue,
		AccentColorfulness:  req.AccentColorfulness,
	}, nil
}

func (s *Server) listGroupPostCardPalettes(ctx context.Context, groupID string, includeArchived bool) ([]GroupPostCardPalette, error) {
	rows, err := s.db.Query(ctx, groupPostCardPaletteSelectSQL()+`
		where palette.group_id = $1
		  and ($2::boolean or palette.archived_at is null)
		order by (palette.archived_at is not null), (palette.system_key is null), lower(palette.name), palette.id
	`, groupID, includeArchived)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	palettes := []GroupPostCardPalette{}
	for rows.Next() {
		palette, err := scanGroupPostCardPalette(rows)
		if err != nil {
			return nil, err
		}
		palettes = append(palettes, palette)
	}
	return palettes, rows.Err()
}

func (s *Server) getGroupPostCardPalette(ctx context.Context, groupID string, paletteID string) (GroupPostCardPalette, error) {
	palette, err := scanGroupPostCardPalette(s.db.QueryRow(ctx, groupPostCardPaletteSelectSQL()+`
		where palette.group_id = $1 and palette.id = $2
	`, groupID, paletteID))
	if errors.Is(err, pgx.ErrNoRows) {
		return GroupPostCardPalette{}, errNotFound("post card palette")
	}
	return palette, err
}

func (s *Server) patchGroupPostCardPalette(
	ctx context.Context,
	groupID string,
	paletteID string,
	userID string,
	patch normalizedPostCardPalettePatch,
) (GroupPostCardPalette, error) {
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return GroupPostCardPalette{}, err
	}
	defer tx.Rollback(ctx)

	current, err := scanPostCardPaletteSummary(tx.QueryRow(ctx, postCardPaletteSummarySelectSQL("palette")+`
		from group_post_card_palettes palette
		where palette.group_id = $1 and palette.id = $2
		for update
	`, groupID, paletteID))
	if errors.Is(err, pgx.ErrNoRows) {
		return GroupPostCardPalette{}, errNotFound("post card palette")
	}
	if err != nil {
		return GroupPostCardPalette{}, err
	}
	if current.Revision != patch.ExpectedRevision {
		return GroupPostCardPalette{}, statusError{status: http.StatusConflict, message: "post card palette was updated; reload and try again"}
	}
	if current.SystemKey != nil {
		return GroupPostCardPalette{}, statusError{status: http.StatusConflict, message: "built-in post card palettes cannot be changed"}
	}

	nextName := current.Name
	if patch.Name != nil {
		nextName = *patch.Name
	}
	nextIntent := current.MaterialIntent
	if patch.MaterialIntent != nil {
		nextIntent = *patch.MaterialIntent
	}
	nextArchivedAtSet := current.ArchivedAt != nil
	if patch.Archived != nil {
		nextArchivedAtSet = *patch.Archived
	}

	activeReferences := 0
	if nextArchivedAtSet && current.ArchivedAt == nil {
		if err := tx.QueryRow(ctx, `
			select count(*)::integer
			from group_evidence_formats
			where group_id = $1
			  and content_card_palette_id = $2
			  and archived_at is null
		`, groupID, paletteID).Scan(&activeReferences); err != nil {
			return GroupPostCardPalette{}, err
		}
	}
	if err := validatePostCardPaletteArchive(current.ArchivedAt != nil, nextArchivedAtSet, activeReferences); err != nil {
		return GroupPostCardPalette{}, err
	}

	commandTag, err := tx.Exec(ctx, `
		update group_post_card_palettes
		set name = $3,
		    material_model = $4,
		    surface_hue = $5,
		    surface_colorfulness = $6,
		    accent_hue = $7,
		    accent_colorfulness = $8,
		    archived_at = case when $9 then coalesce(archived_at, now()) else null end,
		    revision = revision + 1,
		    updated_by_user_id = $10
		where group_id = $1
		  and id = $2
		  and revision = $11
	`,
		groupID,
		paletteID,
		nextName,
		nextIntent.Model,
		nextIntent.SurfaceHue,
		nextIntent.SurfaceColorfulness,
		nextIntent.AccentHue,
		nextIntent.AccentColorfulness,
		nextArchivedAtSet,
		userID,
		patch.ExpectedRevision,
	)
	if err != nil {
		return GroupPostCardPalette{}, err
	}
	if commandTag.RowsAffected() == 0 {
		return GroupPostCardPalette{}, statusError{status: http.StatusConflict, message: "post card palette was updated; reload and try again"}
	}
	if err := tx.Commit(ctx); err != nil {
		return GroupPostCardPalette{}, err
	}
	return s.getGroupPostCardPalette(ctx, groupID, paletteID)
}

func validatePostCardPaletteArchive(currentlyArchived bool, nextArchived bool, activeReferences int) error {
	if !currentlyArchived && nextArchived && activeReferences > 0 {
		return statusError{
			status:  http.StatusConflict,
			message: "post card palette is referenced by one or more active evidence formats",
		}
	}
	return nil
}

func createChalkboardPostCardPalette(ctx context.Context, tx pgx.Tx, groupID string, userID string) (string, error) {
	var paletteID string
	err := tx.QueryRow(ctx, `
		insert into group_post_card_palettes (
			group_id,
			system_key,
			name,
			material_model,
			surface_hue,
			surface_colorfulness,
			accent_hue,
			accent_colorfulness,
			created_by_user_id,
			updated_by_user_id
		)
		values ($1, 'chalkboard', 'Chalkboard', 'arcade-pigment-v1', 167, 95, 173, 74, $2, $2)
		returning id::text
	`, groupID, userID).Scan(&paletteID)
	return paletteID, err
}

func resolveActivePostCardPaletteID(
	ctx context.Context,
	querier postCardPaletteRowQuerier,
	groupID string,
	rawID string,
	useDefault bool,
) (string, error) {
	paletteID := strings.TrimSpace(rawID)
	query := `
		select id::text
		from group_post_card_palettes
		where group_id = $1
		  and archived_at is null
		  and id = $2
		for update
	`
	args := []any{groupID, paletteID}
	if paletteID == "" {
		if !useDefault {
			return "", badRequest("content_card_palette_id is required")
		}
		query = `
			select id::text
			from group_post_card_palettes
			where group_id = $1
			  and archived_at is null
			  and system_key = $2
			for update
		`
		args = []any{groupID, chalkboardSystemKey}
	} else if !uuidStringPattern.MatchString(paletteID) {
		return "", badRequest("content_card_palette_id must be a UUID string")
	}

	var resolved string
	err := querier.QueryRow(ctx, query, args...).Scan(&resolved)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", badRequest("content_card_palette_id must reference an active palette in this group")
	}
	return resolved, err
}

func groupPostCardPaletteSelectSQL() string {
	return postCardPaletteSummarySelectSQL("palette") + `,
		palette.group_id::text,
		coalesce(format_counts.active_format_count, 0),
		coalesce(format_counts.archived_format_count, 0),
		palette.created_by_user_id::text,
		palette.updated_by_user_id::text,
		palette.created_at,
		palette.updated_at
	from group_post_card_palettes palette
	left join lateral (
		select
			count(*) filter (where fmt.archived_at is null)::integer as active_format_count,
			count(*) filter (where fmt.archived_at is not null)::integer as archived_format_count
		from group_evidence_formats fmt
		where fmt.group_id = palette.group_id
		  and fmt.content_card_palette_id = palette.id
	) format_counts on true
	`
}

func postCardPaletteSummarySelectSQL(alias string) string {
	return `select ` + postCardPaletteSummarySelectColumns(alias)
}

func postCardPaletteSummarySelectColumns(alias string) string {
	return strings.Join([]string{
		alias + ".id::text",
		alias + ".system_key",
		alias + ".name",
		alias + ".material_model",
		alias + ".surface_hue",
		alias + ".surface_colorfulness",
		alias + ".accent_hue",
		alias + ".accent_colorfulness",
		alias + ".archived_at",
		alias + ".revision",
	}, ", ")
}

func scanPostCardPaletteSummary(row evidenceFormatScanner) (PostCardPaletteSummary, error) {
	var palette PostCardPaletteSummary
	if err := row.Scan(scanPostCardPaletteSummaryDest(&palette)...); err != nil {
		return PostCardPaletteSummary{}, err
	}
	return palette, nil
}

func scanPostCardPaletteSummaryDest(palette *PostCardPaletteSummary) []any {
	return []any{
		&palette.ID,
		newNullStringScanner(&palette.SystemKey),
		&palette.Name,
		&palette.MaterialIntent.Model,
		&palette.MaterialIntent.SurfaceHue,
		&palette.MaterialIntent.SurfaceColorfulness,
		newNullIntScanner(&palette.MaterialIntent.AccentHue),
		newNullIntScanner(&palette.MaterialIntent.AccentColorfulness),
		newNullTimeScanner(&palette.ArchivedAt),
		&palette.Revision,
	}
}

func scanGroupPostCardPalette(row evidenceFormatScanner) (GroupPostCardPalette, error) {
	var palette GroupPostCardPalette
	dest := scanPostCardPaletteSummaryDest(&palette.PostCardPaletteSummary)
	dest = append(dest,
		&palette.GroupID,
		&palette.ActiveFormatCount,
		&palette.ArchivedFormatCount,
		newNullStringScanner(&palette.CreatedByUserID),
		newNullStringScanner(&palette.UpdatedByUserID),
		&palette.CreatedAt,
		&palette.UpdatedAt,
	)
	if err := row.Scan(dest...); err != nil {
		return GroupPostCardPalette{}, err
	}
	return palette, nil
}

func handlePostCardPaletteWriteError(w http.ResponseWriter, err error) {
	switch {
	case isUniqueConstraint(err, "group_post_card_palettes_active_name_unique"):
		writeError(w, http.StatusConflict, "active post card palette name already exists")
	default:
		handleError(w, err)
	}
}

func setPrivateNoStore(w http.ResponseWriter) {
	w.Header().Set("Cache-Control", "private, no-store")
}

func setPostCardPaletteETag(w http.ResponseWriter, revision int64) {
	w.Header().Set("ETag", `"`+strconv.FormatInt(revision, 10)+`"`)
}

func parsePostCardPaletteIfMatch(raw string) (int64, error) {
	value := strings.TrimSpace(raw)
	if value == "" {
		return 0, statusError{status: http.StatusPreconditionRequired, message: "If-Match revision is required"}
	}
	value = strings.TrimPrefix(value, "W/")
	value = strings.Trim(value, `"`)
	revision, err := strconv.ParseInt(value, 10, 64)
	if err != nil || revision < 1 {
		return 0, badRequest("If-Match must contain a positive palette revision")
	}
	return revision, nil
}
