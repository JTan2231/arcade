package app

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"net/http"
	"strconv"
	"strings"

	"github.com/jackc/pgx/v5"
)

type createCatalogSourceRequest struct {
	Name     string                     `json:"name"`
	Template string                     `json:"template"`
	Preset   string                     `json:"preset"`
	Items    []createCatalogItemRequest `json:"items"`
}

type createCatalogItemRequest struct {
	Title string         `json:"title"`
	Data  map[string]any `json:"data"`
}

var disallowedCatalogDataKeys = map[string]bool{
	"statement":     true,
	"prompt":        true,
	"body":          true,
	"content":       true,
	"sample_input":  true,
	"sample_output": true,
	"editorial":     true,
	"solution":      true,
}

func (s *Server) handleListGroupCatalogSources(w http.ResponseWriter, r *http.Request) {
	current, err := requireUser(r.Context())
	if err != nil {
		handleError(w, err)
		return
	}

	groupID := r.PathValue("group_id")
	if _, err := s.activeGroupRole(r.Context(), current.ID, groupID); err != nil {
		handleError(w, err)
		return
	}

	sources, err := s.listGroupCatalogSources(r.Context(), groupID)
	if err != nil {
		handleError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, sources)
}

func (s *Server) handleCreateGroupCatalogSource(w http.ResponseWriter, r *http.Request) {
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

	var req createCatalogSourceRequest
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid JSON request")
		return
	}

	preset := strings.ToLower(strings.TrimSpace(req.Preset))
	req.Name = strings.TrimSpace(req.Name)
	req.Template = strings.TrimSpace(req.Template)

	switch preset {
	case "":
	case "codeforces":
		if req.Name == "" {
			req.Name = "Codeforces Problems"
		}
		if req.Template == "" {
			req.Template = "https://codeforces.com/problemset/problem/{contest_id}/{index}"
		}
	default:
		writeError(w, http.StatusBadRequest, "preset must be codeforces")
		return
	}

	if req.Name == "" {
		writeError(w, http.StatusBadRequest, "name is required")
		return
	}
	if req.Template == "" {
		writeError(w, http.StatusBadRequest, "template is required")
		return
	}

	tx, err := s.db.Begin(r.Context())
	if err != nil {
		handleError(w, err)
		return
	}
	defer tx.Rollback(r.Context())

	var sourceID string
	err = tx.QueryRow(r.Context(), `
		insert into catalog_sources (
			group_id,
			name,
			template,
			created_by_user_id
		)
		values ($1, $2, $3, $4)
		returning id::text
	`, groupID, req.Name, req.Template, current.ID).Scan(&sourceID)
	if err != nil {
		handleError(w, err)
		return
	}

	if preset == "codeforces" {
		if err := importCodeforcesCatalogPreset(r.Context(), tx, sourceID); err != nil {
			handleError(w, err)
			return
		}
	}

	for _, item := range req.Items {
		title, data, err := normalizeCatalogItemInput(item)
		if err != nil {
			handleError(w, err)
			return
		}
		if err := insertCatalogItem(r.Context(), tx, sourceID, title, data); err != nil {
			handleError(w, err)
			return
		}
	}

	if err := tx.Commit(r.Context()); err != nil {
		handleError(w, err)
		return
	}

	source, err := s.getCatalogSource(r.Context(), groupID, sourceID)
	if err != nil {
		handleError(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, source)
}

func (s *Server) handleGetGroupCatalogSource(w http.ResponseWriter, r *http.Request) {
	current, err := requireUser(r.Context())
	if err != nil {
		handleError(w, err)
		return
	}

	groupID := r.PathValue("group_id")
	if _, err := s.activeGroupRole(r.Context(), current.ID, groupID); err != nil {
		handleError(w, err)
		return
	}

	source, err := s.getCatalogSource(r.Context(), groupID, r.PathValue("source_id"))
	if err != nil {
		handleError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, source)
}

func (s *Server) handleListGroupCatalogItems(w http.ResponseWriter, r *http.Request) {
	current, err := requireUser(r.Context())
	if err != nil {
		handleError(w, err)
		return
	}

	groupID := r.PathValue("group_id")
	if _, err := s.activeGroupRole(r.Context(), current.ID, groupID); err != nil {
		handleError(w, err)
		return
	}

	source, err := s.getCatalogSource(r.Context(), groupID, r.PathValue("source_id"))
	if err != nil {
		handleError(w, err)
		return
	}

	items, err := s.listCatalogItems(r.Context(), source)
	if err != nil {
		handleError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, items)
}

func (s *Server) handleCreateGroupCatalogItem(w http.ResponseWriter, r *http.Request) {
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

	source, err := s.getCatalogSource(r.Context(), groupID, r.PathValue("source_id"))
	if err != nil {
		handleError(w, err)
		return
	}

	var req createCatalogItemRequest
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid JSON request")
		return
	}
	title, data, err := normalizeCatalogItemInput(req)
	if err != nil {
		handleError(w, err)
		return
	}
	dataJSON, err := json.Marshal(data)
	if err != nil {
		handleError(w, err)
		return
	}

	item, err := scanCatalogItem(s.db.QueryRow(r.Context(), `
		insert into catalog_items (
			source_id,
			title,
			data
		)
		values ($1, $2, $3::jsonb)
		returning id::text, source_id::text, title, data, created_at, updated_at
	`, source.ID, title, string(dataJSON)), source.Template)
	if err != nil {
		handleError(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, item)
}

func (s *Server) listGroupCatalogSources(ctx context.Context, groupID string) ([]CatalogSource, error) {
	rows, err := s.db.Query(ctx, `
		select
			id::text,
			group_id::text,
			name,
			template,
			created_by_user_id::text,
			created_at,
			updated_at
		from catalog_sources
		where group_id = $1
		order by name
	`, groupID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	sources := []CatalogSource{}
	for rows.Next() {
		source, err := scanCatalogSource(rows)
		if err != nil {
			return nil, err
		}
		if err := s.hydrateCatalogSourceStats(ctx, &source); err != nil {
			return nil, err
		}
		sources = append(sources, source)
	}
	return sources, rows.Err()
}

func (s *Server) getCatalogSource(ctx context.Context, groupID string, sourceID string) (CatalogSource, error) {
	source, err := scanCatalogSource(s.db.QueryRow(ctx, `
		select
			id::text,
			group_id::text,
			name,
			template,
			created_by_user_id::text,
			created_at,
			updated_at
		from catalog_sources
		where group_id = $1 and id = $2
	`, groupID, sourceID))
	if errors.Is(err, pgx.ErrNoRows) {
		return CatalogSource{}, errNotFound("catalog source")
	}
	if err != nil {
		return CatalogSource{}, err
	}
	if err := s.hydrateCatalogSourceStats(ctx, &source); err != nil {
		return CatalogSource{}, err
	}
	return source, nil
}

func scanCatalogSource(row pgx.Row) (CatalogSource, error) {
	var source CatalogSource
	var createdByUserID sql.NullString
	if err := row.Scan(
		&source.ID,
		&source.GroupID,
		&source.Name,
		&source.Template,
		&createdByUserID,
		&source.CreatedAt,
		&source.UpdatedAt,
	); err != nil {
		return CatalogSource{}, err
	}
	source.CreatedByUserID = nullStringPtr(createdByUserID)
	source.TemplateFields = templateFields(source.Template)
	return source, nil
}

func (s *Server) hydrateCatalogSourceStats(ctx context.Context, source *CatalogSource) error {
	rows, err := s.db.Query(ctx, `
		select title, data
		from catalog_items
		where source_id = $1
	`, source.ID)
	if err != nil {
		return err
	}
	defer rows.Close()

	source.ItemCount = 0
	source.EligibleItemCount = 0
	for rows.Next() {
		var title string
		var dataJSON []byte
		if err := rows.Scan(&title, &dataJSON); err != nil {
			return err
		}
		data := map[string]any{}
		if err := json.Unmarshal(dataJSON, &data); err != nil {
			return fmt.Errorf("decode catalog item data: %w", err)
		}
		_, missing := renderCatalogTemplate(source.Template, title, data)
		source.ItemCount++
		if len(missing) == 0 {
			source.EligibleItemCount++
		}
	}
	return rows.Err()
}

func (s *Server) listCatalogItems(ctx context.Context, source CatalogSource) ([]CatalogItem, error) {
	rows, err := s.db.Query(ctx, `
		select
			id::text,
			source_id::text,
			title,
			data,
			created_at,
			updated_at
		from catalog_items
		where source_id = $1
		order by created_at, title
	`, source.ID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	items := []CatalogItem{}
	for rows.Next() {
		item, err := scanCatalogItem(rows, source.Template)
		if err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func scanCatalogItem(row pgx.Row, template string) (CatalogItem, error) {
	var item CatalogItem
	var dataJSON []byte
	if err := row.Scan(
		&item.ID,
		&item.SourceID,
		&item.Title,
		&dataJSON,
		&item.CreatedAt,
		&item.UpdatedAt,
	); err != nil {
		return CatalogItem{}, err
	}
	item.Data = map[string]any{}
	if err := json.Unmarshal(dataJSON, &item.Data); err != nil {
		return CatalogItem{}, fmt.Errorf("decode catalog item data: %w", err)
	}
	item.Rendered, item.MissingFields = renderCatalogTemplate(template, item.Title, item.Data)
	return item, nil
}

func insertCatalogItem(ctx context.Context, tx pgx.Tx, sourceID string, title string, data map[string]any) error {
	dataJSON, err := json.Marshal(data)
	if err != nil {
		return err
	}
	_, err = tx.Exec(ctx, `
		insert into catalog_items (
			source_id,
			title,
			data
		)
		values ($1, $2, $3::jsonb)
	`, sourceID, title, string(dataJSON))
	return err
}

func importCodeforcesCatalogPreset(ctx context.Context, tx pgx.Tx, sourceID string) error {
	_, err := tx.Exec(ctx, `
		insert into catalog_items (
			source_id,
			title,
			data
		)
		select
			$1,
			p.title,
			jsonb_strip_nulls(jsonb_build_object(
				'contest_id', p.contest_id,
				'index', p.problem_index,
				'rating', p.rating,
				'tags', to_jsonb(coalesce((
					select array_agg(distinct pt.tag order by pt.tag)
					from problem_tags pt
					where pt.problem_id = p.id
				), array[]::text[]))
			))
		from problems p
		join problem_sources ps on ps.id = p.source_id
		where ps.slug = 'codeforces'
		  and p.contest_id is not null
		  and p.problem_index is not null
		order by p.rating nulls last, p.title
	`, sourceID)
	return err
}

func normalizeCatalogItemInput(req createCatalogItemRequest) (string, map[string]any, error) {
	title := strings.TrimSpace(req.Title)
	if title == "" {
		return "", nil, badRequest("catalog item title is required")
	}

	data := map[string]any{}
	for key, value := range req.Data {
		cleanKey := strings.TrimSpace(key)
		if cleanKey == "" {
			continue
		}
		if disallowedCatalogDataKeys[cleanKey] {
			return "", nil, badRequest("catalog item data cannot include answer-bearing content")
		}
		data[cleanKey] = normalizeCatalogDataValue(cleanKey, value)
	}

	return title, data, nil
}

func normalizeCatalogDataValue(key string, value any) any {
	switch typed := value.(type) {
	case string:
		trimmed := strings.TrimSpace(typed)
		if key == "tags" {
			return cleanTags(splitCSV(trimmed))
		}
		return trimmed
	case []any:
		if key != "tags" {
			return typed
		}
		tags := make([]string, 0, len(typed))
		for _, item := range typed {
			tags = append(tags, fmt.Sprint(item))
		}
		return cleanTags(tags)
	default:
		return value
	}
}

func templateFields(template string) []string {
	fields := []string{}
	seen := map[string]bool{}
	for _, match := range templateFieldPattern.FindAllStringSubmatch(template, -1) {
		field := match[1]
		if seen[field] {
			continue
		}
		seen[field] = true
		fields = append(fields, field)
	}
	return fields
}

func renderCatalogTemplate(template string, title string, data map[string]any) (string, []string) {
	missing := []string{}
	missingSeen := map[string]bool{}
	rendered := templateFieldPattern.ReplaceAllStringFunc(template, func(match string) string {
		field := strings.TrimSuffix(strings.TrimPrefix(match, "{"), "}")
		var value any
		var ok bool
		if field == "title" {
			value = title
			ok = true
		} else {
			value, ok = data[field]
		}

		text, valueOK := catalogTemplateValueString(value)
		if !ok || !valueOK || strings.TrimSpace(text) == "" {
			if !missingSeen[field] {
				missingSeen[field] = true
				missing = append(missing, field)
			}
			return ""
		}
		return text
	})
	return rendered, missing
}

func catalogTemplateValueString(value any) (string, bool) {
	if value == nil {
		return "", false
	}
	switch typed := value.(type) {
	case string:
		return typed, true
	case float64:
		if typed == math.Trunc(typed) {
			return strconv.FormatInt(int64(typed), 10), true
		}
		return strconv.FormatFloat(typed, 'f', -1, 64), true
	case json.Number:
		return typed.String(), true
	default:
		return fmt.Sprint(typed), true
	}
}
