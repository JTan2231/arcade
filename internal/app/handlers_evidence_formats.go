package app

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"net/http"
	"regexp"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/jackc/pgx/v5"
)

const defaultEvidenceFormatSlug = "plain-text"

var evidenceFormatSlugPattern = regexp.MustCompile(`^[a-z0-9][a-z0-9-]*[a-z0-9]$`)

type createEvidenceFormatRequest struct {
	Slug            string  `json:"slug"`
	Name            string  `json:"name"`
	Description     *string `json:"description"`
	MinChars        *int    `json:"min_chars"`
	MaxChars        *int    `json:"max_chars"`
	MinLines        *int    `json:"min_lines"`
	MaxLines        *int    `json:"max_lines"`
	ExactLines      *int    `json:"exact_lines"`
	LineMinChars    *int    `json:"line_min_chars"`
	LineMaxChars    *int    `json:"line_max_chars"`
	AllowBlankLines *bool   `json:"allow_blank_lines"`
}

type patchEvidenceFormatRequest struct {
	Name        optionalStringField         `json:"name"`
	Description optionalNullableStringField `json:"description"`
	Archived    optionalBoolField           `json:"archived"`
}

type createEvidenceFormatVersionRequest struct {
	MinChars        *int  `json:"min_chars"`
	MaxChars        *int  `json:"max_chars"`
	MinLines        *int  `json:"min_lines"`
	MaxLines        *int  `json:"max_lines"`
	ExactLines      *int  `json:"exact_lines"`
	LineMinChars    *int  `json:"line_min_chars"`
	LineMaxChars    *int  `json:"line_max_chars"`
	AllowBlankLines *bool `json:"allow_blank_lines"`
}

type normalizedEvidenceFormatInput struct {
	Slug        string
	Name        string
	Description *string
	Constraints normalizedEvidenceFormatConstraints
}

type normalizedEvidenceFormatPatch struct {
	Name           *string
	DescriptionSet bool
	Description    *string
	Archived       *bool
}

type normalizedEvidenceFormatConstraints struct {
	MinChars        int
	MaxChars        *int
	MinLines        *int
	MaxLines        *int
	ExactLines      *int
	LineMinChars    *int
	LineMaxChars    *int
	AllowBlankLines bool
}

type evidenceFormatScanner interface {
	Scan(dest ...any) error
}

func (s *Server) handleListGroupEvidenceFormats(w http.ResponseWriter, r *http.Request) {
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

	formats, err := s.listGroupEvidenceFormats(r.Context(), groupID, includeArchived)
	if err != nil {
		handleError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, formats)
}

func (s *Server) handleCreateGroupEvidenceFormat(w http.ResponseWriter, r *http.Request) {
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

	var req createEvidenceFormatRequest
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid JSON request")
		return
	}
	input, err := normalizeCreateEvidenceFormatRequest(req)
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

	var formatID string
	err = tx.QueryRow(r.Context(), `
		insert into group_evidence_formats (
			group_id,
			slug,
			name,
			description,
			created_by_user_id,
			updated_by_user_id
		)
		values ($1, $2, $3, $4, $5, $5)
		returning id::text
	`, groupID, input.Slug, input.Name, input.Description, current.ID).Scan(&formatID)
	if err != nil {
		handleEvidenceFormatWriteError(w, err)
		return
	}

	if _, err := tx.Exec(r.Context(), `
		insert into group_evidence_format_versions (
			group_id,
			format_id,
			version_number,
			min_chars,
			max_chars,
			min_lines,
			max_lines,
			exact_lines,
			line_min_chars,
			line_max_chars,
			allow_blank_lines,
			created_by_user_id
		)
		values ($1, $2, 1, $3, $4, $5, $6, $7, $8, $9, $10, $11)
	`,
		groupID,
		formatID,
		input.Constraints.MinChars,
		input.Constraints.MaxChars,
		input.Constraints.MinLines,
		input.Constraints.MaxLines,
		input.Constraints.ExactLines,
		input.Constraints.LineMinChars,
		input.Constraints.LineMaxChars,
		input.Constraints.AllowBlankLines,
		current.ID,
	); err != nil {
		handleError(w, err)
		return
	}

	if err := tx.Commit(r.Context()); err != nil {
		handleError(w, err)
		return
	}

	format, err := s.getGroupEvidenceFormat(r.Context(), groupID, formatID)
	if err != nil {
		handleError(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, format)
}

func (s *Server) handleGetGroupEvidenceFormat(w http.ResponseWriter, r *http.Request) {
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

	format, err := s.getGroupEvidenceFormat(r.Context(), groupID, r.PathValue("format_id"))
	if err != nil {
		handleError(w, err)
		return
	}
	if format.ArchivedAt != nil && !canManageDailyFeeds(role) {
		handleError(w, forbidden("insufficient group permissions"))
		return
	}
	writeJSON(w, http.StatusOK, format)
}

func (s *Server) handlePatchGroupEvidenceFormat(w http.ResponseWriter, r *http.Request) {
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

	var req patchEvidenceFormatRequest
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid JSON request")
		return
	}
	patch, err := normalizePatchEvidenceFormatRequest(req)
	if err != nil {
		handleError(w, err)
		return
	}

	formatID := r.PathValue("format_id")
	if patch.Archived != nil && *patch.Archived {
		if err := s.ensureEvidenceFormatNotAssigned(r.Context(), groupID, formatID); err != nil {
			handleError(w, err)
			return
		}
	}

	tag, err := s.db.Exec(r.Context(), `
		update group_evidence_formats
		set name = coalesce($3, name),
		    description = case when $4 then $5::text else description end,
		    archived_at = case
		        when $6 then case when $7 then coalesce(archived_at, now()) else null end
		        else archived_at
		    end,
		    updated_by_user_id = $8
		where group_id = $1 and id = $2
	`, groupID, formatID, patch.Name, patch.DescriptionSet, patch.Description, patch.Archived != nil, patch.Archived != nil && *patch.Archived, current.ID)
	if err != nil {
		handleEvidenceFormatWriteError(w, err)
		return
	}
	if tag.RowsAffected() == 0 {
		handleError(w, errNotFound("evidence format"))
		return
	}

	format, err := s.getGroupEvidenceFormat(r.Context(), groupID, formatID)
	if err != nil {
		handleError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, format)
}

func (s *Server) handleCreateGroupEvidenceFormatVersion(w http.ResponseWriter, r *http.Request) {
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

	var req createEvidenceFormatVersionRequest
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid JSON request")
		return
	}
	constraints, err := normalizeEvidenceFormatConstraints(evidenceFormatConstraintsRequest(req))
	if err != nil {
		handleError(w, err)
		return
	}

	formatID := r.PathValue("format_id")
	format, err := s.getGroupEvidenceFormat(r.Context(), groupID, formatID)
	if err != nil {
		handleError(w, err)
		return
	}
	if format.ArchivedAt != nil {
		handleError(w, badRequest("archived formats cannot receive new versions"))
		return
	}

	var versionID string
	err = s.db.QueryRow(r.Context(), `
		insert into group_evidence_format_versions (
			group_id,
			format_id,
			version_number,
			min_chars,
			max_chars,
			min_lines,
			max_lines,
			exact_lines,
			line_min_chars,
			line_max_chars,
			allow_blank_lines,
			created_by_user_id
		)
		select
			$1,
			$2,
			coalesce(max(version_number), 0) + 1,
			$3,
			$4,
			$5,
			$6,
			$7,
			$8,
			$9,
			$10,
			$11
		from group_evidence_format_versions
		where group_id = $1 and format_id = $2
		returning id::text
	`,
		groupID,
		formatID,
		constraints.MinChars,
		constraints.MaxChars,
		constraints.MinLines,
		constraints.MaxLines,
		constraints.ExactLines,
		constraints.LineMinChars,
		constraints.LineMaxChars,
		constraints.AllowBlankLines,
		current.ID,
	).Scan(&versionID)
	if err != nil {
		handleError(w, err)
		return
	}

	format, err = s.getGroupEvidenceFormat(r.Context(), groupID, formatID)
	if err != nil {
		handleError(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, format)
}

func (s *Server) handleDeleteGroupEvidenceFormat(w http.ResponseWriter, r *http.Request) {
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

	formatID := r.PathValue("format_id")
	if err := s.ensureEvidenceFormatNotAssigned(r.Context(), groupID, formatID); err != nil {
		handleError(w, err)
		return
	}

	tag, err := s.db.Exec(r.Context(), `
		update group_evidence_formats
		set archived_at = coalesce(archived_at, now()),
		    updated_by_user_id = $3
		where group_id = $1 and id = $2
	`, groupID, formatID, current.ID)
	if err != nil {
		handleError(w, err)
		return
	}
	if tag.RowsAffected() == 0 {
		handleError(w, errNotFound("evidence format"))
		return
	}

	w.WriteHeader(http.StatusNoContent)
}

func handleEvidenceFormatWriteError(w http.ResponseWriter, err error) {
	switch {
	case isUniqueConstraint(err, "group_evidence_formats_group_id_slug_key"):
		writeError(w, http.StatusConflict, "evidence format slug already exists")
	case isUniqueConstraint(err, "group_evidence_formats_group_name_unique"):
		writeError(w, http.StatusConflict, "evidence format name already exists")
	default:
		handleError(w, err)
	}
}

func normalizeCreateEvidenceFormatRequest(req createEvidenceFormatRequest) (normalizedEvidenceFormatInput, error) {
	slug := strings.TrimSpace(req.Slug)
	if !evidenceFormatSlugPattern.MatchString(slug) {
		return normalizedEvidenceFormatInput{}, badRequest("slug must use lowercase letters, numbers, and hyphens")
	}
	name, err := normalizeEvidenceFormatName(req.Name)
	if err != nil {
		return normalizedEvidenceFormatInput{}, err
	}
	constraints, err := normalizeEvidenceFormatConstraints(evidenceFormatConstraintsRequest{
		MinChars:        req.MinChars,
		MaxChars:        req.MaxChars,
		MinLines:        req.MinLines,
		MaxLines:        req.MaxLines,
		ExactLines:      req.ExactLines,
		LineMinChars:    req.LineMinChars,
		LineMaxChars:    req.LineMaxChars,
		AllowBlankLines: req.AllowBlankLines,
	})
	if err != nil {
		return normalizedEvidenceFormatInput{}, err
	}
	return normalizedEvidenceFormatInput{
		Slug:        slug,
		Name:        name,
		Description: trimOptionalString(req.Description),
		Constraints: constraints,
	}, nil
}

func normalizePatchEvidenceFormatRequest(req patchEvidenceFormatRequest) (normalizedEvidenceFormatPatch, error) {
	if !req.Name.Set && !req.Description.Set && !req.Archived.Set {
		return normalizedEvidenceFormatPatch{}, badRequest("at least one field is required")
	}

	var patch normalizedEvidenceFormatPatch
	if req.Name.Set {
		name, err := normalizeEvidenceFormatName(req.Name.Value)
		if err != nil {
			return normalizedEvidenceFormatPatch{}, err
		}
		patch.Name = &name
	}
	if req.Description.Set {
		patch.DescriptionSet = true
		patch.Description = trimOptionalString(req.Description.Value)
	}
	if req.Archived.Set {
		patch.Archived = &req.Archived.Value
	}
	return patch, nil
}

func normalizeEvidenceFormatName(name string) (string, error) {
	trimmed := strings.TrimSpace(name)
	if trimmed == "" {
		return "", badRequest("name is required")
	}
	return trimmed, nil
}

type evidenceFormatConstraintsRequest createEvidenceFormatVersionRequest

func normalizeEvidenceFormatConstraints(req evidenceFormatConstraintsRequest) (normalizedEvidenceFormatConstraints, error) {
	minChars := 1
	if req.MinChars != nil {
		minChars = *req.MinChars
	}
	if minChars < 1 {
		return normalizedEvidenceFormatConstraints{}, badRequest("min_chars must be at least 1")
	}
	if req.MaxChars != nil && *req.MaxChars < minChars {
		return normalizedEvidenceFormatConstraints{}, badRequest("max_chars must be greater than or equal to min_chars")
	}
	if req.MinLines != nil && *req.MinLines < 1 {
		return normalizedEvidenceFormatConstraints{}, badRequest("min_lines must be at least 1")
	}
	if req.MaxLines != nil && *req.MaxLines < 1 {
		return normalizedEvidenceFormatConstraints{}, badRequest("max_lines must be at least 1")
	}
	if req.ExactLines != nil && *req.ExactLines < 1 {
		return normalizedEvidenceFormatConstraints{}, badRequest("exact_lines must be at least 1")
	}
	if req.MinLines != nil && req.MaxLines != nil && *req.MaxLines < *req.MinLines {
		return normalizedEvidenceFormatConstraints{}, badRequest("max_lines must be greater than or equal to min_lines")
	}
	if req.ExactLines != nil && (req.MinLines != nil || req.MaxLines != nil) {
		return normalizedEvidenceFormatConstraints{}, badRequest("exact_lines cannot be combined with min_lines or max_lines")
	}
	if req.LineMinChars != nil && *req.LineMinChars < 1 {
		return normalizedEvidenceFormatConstraints{}, badRequest("line_min_chars must be at least 1")
	}
	if req.LineMaxChars != nil && *req.LineMaxChars < 1 {
		return normalizedEvidenceFormatConstraints{}, badRequest("line_max_chars must be at least 1")
	}
	if req.LineMinChars != nil && req.LineMaxChars != nil && *req.LineMaxChars < *req.LineMinChars {
		return normalizedEvidenceFormatConstraints{}, badRequest("line_max_chars must be greater than or equal to line_min_chars")
	}

	allowBlankLines := true
	if req.AllowBlankLines != nil {
		allowBlankLines = *req.AllowBlankLines
	}

	return normalizedEvidenceFormatConstraints{
		MinChars:        minChars,
		MaxChars:        req.MaxChars,
		MinLines:        req.MinLines,
		MaxLines:        req.MaxLines,
		ExactLines:      req.ExactLines,
		LineMinChars:    req.LineMinChars,
		LineMaxChars:    req.LineMaxChars,
		AllowBlankLines: allowBlankLines,
	}, nil
}

func normalizeEvidenceText(input string) string {
	normalized := strings.ReplaceAll(input, "\r\n", "\n")
	normalized = strings.ReplaceAll(normalized, "\r", "\n")
	return strings.TrimSpace(normalized)
}

func validateEvidenceText(text string, version EvidenceFormatVersion) error {
	charCount := utf8.RuneCountInString(text)
	if charCount < version.MinChars {
		if version.MinChars == 1 {
			return badRequest("evidence_text is required")
		}
		return badRequest(fmt.Sprintf("evidence_text must be at least %d characters", version.MinChars))
	}
	if version.MaxChars != nil && charCount > *version.MaxChars {
		return badRequest(fmt.Sprintf("evidence_text must be at most %d characters", *version.MaxChars))
	}

	lines := strings.Split(text, "\n")
	lineCount := len(lines)
	if version.ExactLines != nil && lineCount != *version.ExactLines {
		return badRequest(fmt.Sprintf("evidence_text must be exactly %d lines", *version.ExactLines))
	}
	if version.MinLines != nil && lineCount < *version.MinLines {
		return badRequest(fmt.Sprintf("evidence_text must be at least %d lines", *version.MinLines))
	}
	if version.MaxLines != nil && lineCount > *version.MaxLines {
		return badRequest(fmt.Sprintf("evidence_text must be at most %d lines", *version.MaxLines))
	}

	for _, line := range lines {
		trimmed := strings.TrimSpace(line)
		if trimmed == "" {
			if !version.AllowBlankLines {
				return badRequest("evidence_text cannot contain blank lines")
			}
			continue
		}
		lineChars := utf8.RuneCountInString(trimmed)
		if version.LineMinChars != nil && lineChars < *version.LineMinChars {
			return badRequest(fmt.Sprintf("evidence_text lines must be at least %d characters", *version.LineMinChars))
		}
		if version.LineMaxChars != nil && lineChars > *version.LineMaxChars {
			return badRequest(fmt.Sprintf("evidence_text lines must be at most %d characters", *version.LineMaxChars))
		}
	}
	return nil
}

func (s *Server) listGroupEvidenceFormats(ctx context.Context, groupID string, includeArchived bool) ([]EvidenceFormat, error) {
	rows, err := s.db.Query(ctx, evidenceFormatSelectSQL()+`
		where fmt.group_id = $1
		  and ($2::boolean or fmt.archived_at is null)
		order by (fmt.archived_at is not null), lower(fmt.name), fmt.id
	`, groupID, includeArchived)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	formats := []EvidenceFormat{}
	for rows.Next() {
		format, err := scanEvidenceFormat(rows)
		if err != nil {
			return nil, err
		}
		formats = append(formats, format)
	}
	return formats, rows.Err()
}

func (s *Server) getGroupEvidenceFormat(ctx context.Context, groupID string, formatID string) (EvidenceFormat, error) {
	format, err := scanEvidenceFormat(s.db.QueryRow(ctx, evidenceFormatSelectSQL()+`
		where fmt.group_id = $1 and fmt.id = $2
	`, groupID, formatID))
	if errors.Is(err, pgx.ErrNoRows) {
		return EvidenceFormat{}, errNotFound("evidence format")
	}
	return format, err
}

func (s *Server) ensureEvidenceFormatNotAssigned(ctx context.Context, groupID string, formatID string) error {
	var assignedCount int
	err := s.db.QueryRow(ctx, `
		select count(*)::integer
		from group_daily_feeds
		where group_id = $1 and evidence_format_id = $2
	`, groupID, formatID).Scan(&assignedCount)
	if err != nil {
		return err
	}
	if assignedCount > 0 {
		return statusError{status: http.StatusConflict, message: "evidence format is assigned to one or more daily feeds"}
	}
	return nil
}

func (s *Server) resolveActiveEvidenceFormatID(ctx context.Context, groupID string, rawID string, useDefault bool) (string, error) {
	if s.db == nil {
		return "", nil
	}

	formatID := strings.TrimSpace(rawID)
	query := `
		select id::text
		from group_evidence_formats
		where group_id = $1
		  and archived_at is null
		  and id = $2
	`
	args := []any{groupID, formatID}
	if formatID == "" {
		if !useDefault {
			return "", badRequest("evidence_format_id is required")
		}
		query = `
			select id::text
			from group_evidence_formats
			where group_id = $1
			  and archived_at is null
			  and slug = $2
		`
		args = []any{groupID, defaultEvidenceFormatSlug}
	} else if !uuidStringPattern.MatchString(formatID) {
		return "", badRequest("evidence_format_id must be a UUID string")
	}

	var resolved string
	err := s.db.QueryRow(ctx, query, args...).Scan(&resolved)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", badRequest("evidence_format_id must reference an active format in this group")
	}
	return resolved, err
}

func (s *Server) activeEvidenceFormatVersionForFeed(ctx context.Context, groupID string, feedID string) (EvidenceFormatVersion, error) {
	version, err := scanEvidenceFormatVersion(s.db.QueryRow(ctx, `
		select `+evidenceFormatVersionSelectColumns("v")+`
		from group_daily_feeds f
		join group_evidence_formats fmt
		  on fmt.id = f.evidence_format_id
		 and fmt.group_id = f.group_id
		 and fmt.archived_at is null
		join lateral (
			select *
			from group_evidence_format_versions
			where format_id = f.evidence_format_id
			  and group_id = f.group_id
			order by version_number desc
			limit 1
		) v on true
		where f.id = $1
		  and f.group_id = $2
	`, feedID, groupID))
	if errors.Is(err, pgx.ErrNoRows) {
		return EvidenceFormatVersion{}, badRequest("daily feed evidence format is unavailable")
	}
	return version, err
}

func createPlainTextEvidenceFormat(ctx context.Context, tx pgx.Tx, groupID string, userID string) (string, error) {
	var formatID string
	if err := tx.QueryRow(ctx, `
		insert into group_evidence_formats (
			group_id,
			slug,
			name,
			description,
			created_by_user_id,
			updated_by_user_id
		)
		values ($1, $2, 'Plain text', null, $3, $3)
		returning id::text
	`, groupID, defaultEvidenceFormatSlug, userID).Scan(&formatID); err != nil {
		return "", err
	}

	_, err := tx.Exec(ctx, `
		insert into group_evidence_format_versions (
			group_id,
			format_id,
			version_number,
			min_chars,
			max_chars,
			min_lines,
			max_lines,
			exact_lines,
			line_min_chars,
			line_max_chars,
			allow_blank_lines,
			created_by_user_id
		)
		values ($1, $2, 1, 1, null, null, null, null, null, null, true, $3)
	`, groupID, formatID, userID)
	if err != nil {
		return "", err
	}
	return formatID, nil
}

func evidenceFormatSelectSQL() string {
	return `
		select
			fmt.id::text,
			fmt.group_id::text,
			fmt.slug,
			fmt.name,
			fmt.description,
			fmt.archived_at,
			fmt.created_by_user_id::text,
			fmt.updated_by_user_id::text,
			fmt.created_at,
			fmt.updated_at,
			coalesce(feed_counts.assigned_feed_count, 0),
			` + evidenceFormatVersionSelectColumns("v") + `
		from group_evidence_formats fmt
		join lateral (
			select *
			from group_evidence_format_versions
			where format_id = fmt.id
			  and group_id = fmt.group_id
			order by version_number desc
			limit 1
		) v on true
		left join lateral (
			select count(*)::integer as assigned_feed_count
			from group_daily_feeds f
			where f.group_id = fmt.group_id
			  and f.evidence_format_id = fmt.id
		) feed_counts on true
	`
}

func evidenceFormatVersionSelectColumns(alias string) string {
	return strings.Join([]string{
		alias + ".id::text",
		alias + ".group_id::text",
		alias + ".format_id::text",
		alias + ".version_number",
		alias + ".min_chars",
		alias + ".max_chars",
		alias + ".min_lines",
		alias + ".max_lines",
		alias + ".exact_lines",
		alias + ".line_min_chars",
		alias + ".line_max_chars",
		alias + ".allow_blank_lines",
		alias + ".created_by_user_id::text",
		alias + ".created_at",
	}, ", ")
}

func scanEvidenceFormat(row evidenceFormatScanner) (EvidenceFormat, error) {
	var format EvidenceFormat
	if err := row.Scan(scanEvidenceFormatDest(&format)...); err != nil {
		return EvidenceFormat{}, err
	}
	return format, nil
}

func scanEvidenceFormatDest(format *EvidenceFormat) []any {
	dest := []any{
		&format.ID,
		&format.GroupID,
		&format.Slug,
		&format.Name,
		newNullStringScanner(&format.Description),
		newNullTimeScanner(&format.ArchivedAt),
		newNullStringScanner(&format.CreatedByUserID),
		newNullStringScanner(&format.UpdatedByUserID),
		&format.CreatedAt,
		&format.UpdatedAt,
		&format.AssignedFeedCount,
	}
	return append(dest, scanEvidenceFormatVersionDest(&format.ActiveVersion)...)
}

func scanEvidenceFormatVersion(row evidenceFormatScanner) (EvidenceFormatVersion, error) {
	var version EvidenceFormatVersion
	if err := row.Scan(scanEvidenceFormatVersionDest(&version)...); err != nil {
		return EvidenceFormatVersion{}, err
	}
	finalizeEvidenceFormatVersion(&version)
	return version, nil
}

func scanEvidenceFormatVersionDest(version *EvidenceFormatVersion) []any {
	return []any{
		&version.ID,
		&version.GroupID,
		&version.FormatID,
		&version.VersionNumber,
		&version.MinChars,
		newNullIntScanner(&version.MaxChars),
		newNullIntScanner(&version.MinLines),
		newNullIntScanner(&version.MaxLines),
		newNullIntScanner(&version.ExactLines),
		newNullIntScanner(&version.LineMinChars),
		newNullIntScanner(&version.LineMaxChars),
		&version.AllowBlankLines,
		newNullStringScanner(&version.CreatedByUserID),
		&version.CreatedAt,
	}
}

func finalizeEvidenceFormatVersion(*EvidenceFormatVersion) {}

type nullIntScanner struct {
	target **int
}

func newNullIntScanner(target **int) *nullIntScanner {
	return &nullIntScanner{target: target}
}

func (scanner *nullIntScanner) Scan(value any) error {
	var nullable sql.NullInt64
	if err := nullable.Scan(value); err != nil {
		return err
	}
	*scanner.target = nullIntPtr(nullable)
	return nil
}

type nullStringScanner struct {
	target **string
}

func newNullStringScanner(target **string) *nullStringScanner {
	return &nullStringScanner{target: target}
}

func (scanner *nullStringScanner) Scan(value any) error {
	var nullable sql.NullString
	if err := nullable.Scan(value); err != nil {
		return err
	}
	*scanner.target = nullStringPtr(nullable)
	return nil
}

type nullTimeScanner struct {
	target **time.Time
}

func newNullTimeScanner(target **time.Time) *nullTimeScanner {
	return &nullTimeScanner{target: target}
}

func (scanner *nullTimeScanner) Scan(value any) error {
	var nullable sql.NullTime
	if err := nullable.Scan(value); err != nil {
		return err
	}
	*scanner.target = nullTimePtr(nullable)
	return nil
}
