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
	Name     string                            `json:"name"`
	Template string                            `json:"template"`
	Preset   string                            `json:"preset"`
	Fields   []createCatalogSourceFieldRequest `json:"fields"`
	Items    []createCatalogItemRequest        `json:"items"`
}

type createCatalogItemRequest struct {
	Title string         `json:"title"`
	Data  map[string]any `json:"data"`
}

type createCatalogSourceFieldRequest struct {
	Key          string `json:"key"`
	Label        string `json:"label"`
	ValueType    string `json:"value_type"`
	IsArray      bool   `json:"is_array"`
	DisplayOrder int    `json:"display_order"`
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
		if err := insertCodeforcesCatalogSourceFields(r.Context(), tx, sourceID); err != nil {
			handleError(w, err)
			return
		}
	}

	for _, field := range req.Fields {
		normalized, err := normalizeCatalogSourceFieldInput(field)
		if err != nil {
			handleError(w, err)
			return
		}
		if err := insertCatalogSourceField(r.Context(), tx, sourceID, normalized); err != nil {
			handleError(w, err)
			return
		}
	}

	for _, item := range req.Items {
		data, err := normalizeCatalogItemInput(item)
		if err != nil {
			handleError(w, err)
			return
		}
		if err := insertCatalogItem(r.Context(), tx, sourceID, data); err != nil {
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
	data, err := normalizeCatalogItemInput(req)
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
			data
		)
		values ($1, $2::jsonb)
		returning id::text, source_id::text, data, created_at, updated_at
	`, source.ID, string(dataJSON)), source.Template)
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
		fields, err := s.listCatalogSourceFields(ctx, source.ID)
		if err != nil {
			return nil, err
		}
		source.Fields = fields
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
	fields, err := s.listCatalogSourceFields(ctx, source.ID)
	if err != nil {
		return CatalogSource{}, err
	}
	source.Fields = fields
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
		select data
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
		var dataJSON []byte
		if err := rows.Scan(&dataJSON); err != nil {
			return err
		}
		data := map[string]any{}
		if err := json.Unmarshal(dataJSON, &data); err != nil {
			return fmt.Errorf("decode catalog item data: %w", err)
		}
		_, missing := renderCatalogTemplate(source.Template, data)
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
			data,
			created_at,
			updated_at
		from catalog_items
		where source_id = $1
		order by created_at, id
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
	item.Title = catalogItemDisplayName(item.Data)
	item.Rendered, item.MissingFields = renderCatalogTemplate(template, item.Data)
	return item, nil
}

func insertCatalogItem(ctx context.Context, tx pgx.Tx, sourceID string, data map[string]any) error {
	dataJSON, err := json.Marshal(data)
	if err != nil {
		return err
	}
	_, err = tx.Exec(ctx, `
		insert into catalog_items (
			source_id,
			data
		)
		values ($1, $2::jsonb)
	`, sourceID, string(dataJSON))
	return err
}

type codeforcesPresetItem struct {
	Name      string
	ContestID string
	Index     string
	Rating    int
	Tags      []string
}

var codeforcesCatalogPresetItems = []codeforcesPresetItem{
	{Name: "Watermelon", ContestID: "4", Index: "A", Rating: 800, Tags: []string{"math", "greedy"}},
	{Name: "Way Too Long Words", ContestID: "71", Index: "A", Rating: 800, Tags: []string{"strings"}},
	{Name: "Team", ContestID: "231", Index: "A", Rating: 800, Tags: []string{"greedy"}},
	{Name: "Next Round", ContestID: "158", Index: "A", Rating: 800, Tags: []string{"implementation"}},
	{Name: "Domino Piling", ContestID: "50", Index: "A", Rating: 800, Tags: []string{"math"}},
	{Name: "Beautiful Matrix", ContestID: "263", Index: "A", Rating: 800, Tags: []string{"implementation"}},
	{Name: "Bit++", ContestID: "282", Index: "A", Rating: 800, Tags: []string{"implementation"}},
	{Name: "Helpful Maths", ContestID: "339", Index: "A", Rating: 800, Tags: []string{"strings", "sortings"}},
	{Name: "Wrong Subtraction", ContestID: "977", Index: "A", Rating: 800, Tags: []string{"math"}},
	{Name: "Anton and Danik", ContestID: "734", Index: "A", Rating: 800, Tags: []string{"implementation"}},
	{Name: "I Wanna Be the Guy", ContestID: "469", Index: "A", Rating: 800, Tags: []string{"implementation"}},
	{Name: "Raising Bacteria", ContestID: "579", Index: "A", Rating: 1000, Tags: []string{"bitmasks", "math"}},
	{Name: "Woodcutters", ContestID: "545", Index: "C", Rating: 1500, Tags: []string{"dp", "greedy"}},
	{Name: "Boredom", ContestID: "455", Index: "A", Rating: 1500, Tags: []string{"dp"}},
	{Name: "Kefa and Park", ContestID: "580", Index: "C", Rating: 1500, Tags: []string{"graphs", "dfs"}},
	{Name: "Number of Ways", ContestID: "466", Index: "C", Rating: 1700, Tags: []string{"dp", "two pointers"}},
	{Name: "Given Length and Sum of Digits...", ContestID: "489", Index: "C", Rating: 1400, Tags: []string{"greedy", "math"}},
	{Name: "Quiz", ContestID: "337", Index: "C", Rating: 1700, Tags: []string{"math", "binary search"}},
	{Name: "Compress Words", ContestID: "1200", Index: "E", Rating: 1900, Tags: []string{"strings", "hashing"}},
	{Name: "Greg and Graph", ContestID: "295", Index: "B", Rating: 1800, Tags: []string{"graphs", "shortest paths"}},
}

func importCodeforcesCatalogPreset(ctx context.Context, tx pgx.Tx, sourceID string) error {
	for _, item := range codeforcesCatalogPresetItems {
		data := map[string]any{
			"name":       item.Name,
			"contest_id": item.ContestID,
			"index":      item.Index,
			"rating":     item.Rating,
			"tags":       item.Tags,
		}
		if err := insertCatalogItem(ctx, tx, sourceID, data); err != nil {
			return err
		}
	}
	return nil
}

func insertCodeforcesCatalogSourceFields(ctx context.Context, tx pgx.Tx, sourceID string) error {
	fields := []normalizedCatalogSourceField{
		{Key: "rating", Label: "Rating", ValueType: "number", DisplayOrder: 10},
		{Key: "tags", Label: "Tags", ValueType: "string", IsArray: true, DisplayOrder: 20},
	}
	for _, field := range fields {
		if err := insertCatalogSourceField(ctx, tx, sourceID, field); err != nil {
			return err
		}
	}
	return nil
}

func normalizeCatalogItemInput(req createCatalogItemRequest) (map[string]any, error) {
	data := map[string]any{}
	for key, value := range req.Data {
		cleanKey := strings.TrimSpace(key)
		if cleanKey == "" {
			continue
		}
		if disallowedCatalogDataKeys[cleanKey] {
			return nil, badRequest("catalog item data cannot include answer-bearing content")
		}
		data[cleanKey] = normalizeCatalogDataValue(cleanKey, value)
	}

	if title := strings.TrimSpace(req.Title); title != "" {
		if _, exists := data["name"]; !exists {
			data["name"] = title
		}
	}

	return data, nil
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

func renderCatalogTemplate(template string, data map[string]any) (string, []string) {
	missing := []string{}
	missingSeen := map[string]bool{}
	rendered := templateFieldPattern.ReplaceAllStringFunc(template, func(match string) string {
		field := strings.TrimSuffix(strings.TrimPrefix(match, "{"), "}")
		value, ok := data[field]

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

type normalizedCatalogSourceField struct {
	Key          string
	Label        string
	ValueType    string
	IsArray      bool
	DisplayOrder int
}

func normalizeCatalogSourceFieldInput(req createCatalogSourceFieldRequest) (normalizedCatalogSourceField, error) {
	field := normalizedCatalogSourceField{
		Key:          strings.TrimSpace(req.Key),
		Label:        strings.TrimSpace(req.Label),
		ValueType:    strings.ToLower(strings.TrimSpace(req.ValueType)),
		IsArray:      req.IsArray,
		DisplayOrder: req.DisplayOrder,
	}
	if field.Key == "" {
		return normalizedCatalogSourceField{}, badRequest("field key is required")
	}
	if field.Label == "" {
		field.Label = field.Key
	}
	switch field.ValueType {
	case "string", "number":
	default:
		return normalizedCatalogSourceField{}, badRequest("field value_type must be string or number")
	}
	return field, nil
}

func insertCatalogSourceField(ctx context.Context, tx pgx.Tx, sourceID string, field normalizedCatalogSourceField) error {
	_, err := tx.Exec(ctx, `
		insert into catalog_source_fields (
			source_id,
			key,
			label,
			value_type,
			is_array,
			display_order
		)
		values ($1, $2, $3, $4, $5, $6)
		on conflict (source_id, key) do update set
			label = excluded.label,
			value_type = excluded.value_type,
			is_array = excluded.is_array,
			display_order = excluded.display_order
	`, sourceID, field.Key, field.Label, field.ValueType, field.IsArray, field.DisplayOrder)
	return err
}

func (s *Server) listCatalogSourceFields(ctx context.Context, sourceID string) ([]CatalogSourceField, error) {
	rows, err := s.db.Query(ctx, `
		select
			id::text,
			source_id::text,
			key,
			label,
			value_type,
			is_array,
			display_order,
			created_at,
			updated_at
		from catalog_source_fields
		where source_id = $1
		order by display_order, label, key
	`, sourceID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	fields := []CatalogSourceField{}
	for rows.Next() {
		var field CatalogSourceField
		if err := rows.Scan(
			&field.ID,
			&field.SourceID,
			&field.Key,
			&field.Label,
			&field.ValueType,
			&field.IsArray,
			&field.DisplayOrder,
			&field.CreatedAt,
			&field.UpdatedAt,
		); err != nil {
			return nil, err
		}
		fields = append(fields, field)
	}
	return fields, rows.Err()
}

func catalogItemDisplayName(data map[string]any) string {
	for _, key := range []string{"name", "title", "label"} {
		if value, ok := data[key]; ok {
			if text, ok := catalogTemplateValueString(value); ok && strings.TrimSpace(text) != "" {
				return text
			}
		}
	}
	return "Untitled"
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
