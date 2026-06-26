package catalogimport

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"regexp"
	"sort"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

const (
	Schema              = "arcade.catalog_import.v1"
	MaxJSONLLineBytes   = 10 << 20
	defaultLineCapacity = 64 << 10
)

var (
	slugPattern          = regexp.MustCompile(`^[a-z0-9][a-z0-9-]*[a-z0-9]$`)
	templateFieldPattern = regexp.MustCompile(`\{([A-Za-z0-9_]+)\}`)
	uuidPattern          = regexp.MustCompile(`^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$`)
	forbiddenDataKeys    = map[string]bool{
		"statement":     true,
		"prompt":        true,
		"body":          true,
		"content":       true,
		"sample_input":  true,
		"sample_output": true,
		"editorial":     true,
		"solution":      true,
	}
)

type Options struct {
	DryRun       bool
	GroupID      string
	OwnerUserID  *string
	AllowGlobal  bool
	MaxLineBytes int
}

type File struct {
	Manifest Manifest
	Fields   []CatalogField
	Items    []CatalogItem
}

type Manifest struct {
	Line          int
	GeneratedAt   time.Time
	CatalogSource CatalogSource
	Provider      map[string]any
}

type CatalogSource struct {
	Slug     string
	Name     string
	Scope    string
	Template string
}

type CatalogField struct {
	Line              int
	CatalogSourceSlug string
	Key               string
	Label             string
	ValueType         string
	IsArray           bool
	DisplayOrder      int
}

type CatalogItem struct {
	Line              int
	CatalogSourceSlug string
	ExternalID        string
	Data              map[string]any
}

type Result struct {
	DryRun   bool            `json:"dry_run"`
	Status   string          `json:"status"`
	Counts   Counts          `json:"counts"`
	Warnings []ImportMessage `json:"warnings"`
	Errors   []ImportMessage `json:"errors"`
}

type Counts struct {
	Lines           int `json:"lines"`
	SourcesSeen     int `json:"sources_seen"`
	SourcesInserted int `json:"sources_inserted"`
	SourcesUpdated  int `json:"sources_updated"`
	FieldsSeen      int `json:"fields_seen"`
	FieldsUpserted  int `json:"fields_upserted"`
	ItemsSeen       int `json:"items_seen"`
	ItemsInserted   int `json:"items_inserted"`
	ItemsUpdated    int `json:"items_updated"`
	ItemsSkipped    int `json:"items_skipped"`
}

type ImportMessage struct {
	Line    int    `json:"line,omitempty"`
	Code    string `json:"code"`
	Message string `json:"message"`
}

type ValidationError struct {
	Result Result
}

func (e ValidationError) Error() string {
	return "catalog import validation failed"
}

func ImportJSONL(ctx context.Context, db *pgxpool.Pool, r io.Reader, opts Options) (Result, error) {
	file, result, err := ParseJSONL(r, opts)
	if err != nil {
		return result, err
	}
	result.DryRun = opts.DryRun
	if len(result.Errors) > 0 {
		result.Status = "failed"
		return result, ValidationError{Result: result}
	}
	if opts.DryRun {
		result.Status = "completed"
		return result, nil
	}

	tx, err := db.Begin(ctx)
	if err != nil {
		return result, err
	}
	defer tx.Rollback(ctx)

	if err := importFile(ctx, tx, file, opts, &result.Counts); err != nil {
		return result, err
	}
	if err := tx.Commit(ctx); err != nil {
		return result, err
	}

	result.Status = "completed"
	return result, nil
}

func ParseJSONL(r io.Reader, opts Options) (File, Result, error) {
	maxLineBytes := opts.MaxLineBytes
	if maxLineBytes <= 0 {
		maxLineBytes = MaxJSONLLineBytes
	}

	var file File
	result := Result{
		DryRun:   opts.DryRun,
		Status:   "completed",
		Warnings: []ImportMessage{},
		Errors:   []ImportMessage{},
	}

	scanner := bufio.NewScanner(r)
	scanner.Buffer(make([]byte, defaultLineCapacity), maxLineBytes)

	seenNonEmpty := false
	manifestSeen := false
	lineNumber := 0
	firstNonEmptyLine := 0
	for scanner.Scan() {
		lineNumber++
		raw := bytes.TrimSpace(scanner.Bytes())
		if len(raw) == 0 {
			continue
		}
		result.Counts.Lines++
		if !seenNonEmpty {
			seenNonEmpty = true
			firstNonEmptyLine = lineNumber
		}

		header, ok := decodeHeader(raw, lineNumber, &result)
		if !ok {
			if lineNumber == firstNonEmptyLine {
				addError(&result, lineNumber, "first_line_not_manifest", "first non-empty line must be a manifest")
			}
			continue
		}
		if header.Schema != Schema {
			addError(&result, lineNumber, "unknown_schema", "schema must be "+Schema)
			continue
		}
		if lineNumber == firstNonEmptyLine && header.Kind != "manifest" {
			addError(&result, lineNumber, "first_line_not_manifest", "first non-empty line must be a manifest")
		}

		switch header.Kind {
		case "manifest":
			if manifestSeen {
				addError(&result, lineNumber, "duplicate_manifest", "only one manifest is allowed")
				continue
			}
			manifestSeen = true
			manifest, ok := decodeManifest(raw, lineNumber, &result)
			if ok {
				file.Manifest = manifest
				result.Counts.SourcesSeen = 1
			}
		case "catalog_field":
			field, ok := decodeCatalogField(raw, lineNumber, &result)
			if ok {
				file.Fields = append(file.Fields, field)
				result.Counts.FieldsSeen++
			}
		case "catalog_item":
			item, ok := decodeCatalogItem(raw, lineNumber, &result)
			if ok {
				file.Items = append(file.Items, item)
				result.Counts.ItemsSeen++
			}
		default:
			addError(&result, lineNumber, "unknown_kind", "unknown catalog import kind")
		}
	}
	if err := scanner.Err(); err != nil {
		if strings.Contains(err.Error(), "token too long") {
			addError(&result, lineNumber+1, "line_too_large", fmt.Sprintf("line exceeds %d bytes", maxLineBytes))
			result.Status = "failed"
			return file, result, nil
		}
		return file, result, err
	}

	if !seenNonEmpty {
		addError(&result, 0, "empty_file", "file must contain a manifest")
	}
	if !manifestSeen {
		addError(&result, 0, "missing_manifest", "file must contain one manifest")
	}

	validateFile(&file, opts, &result)
	if len(result.Errors) > 0 {
		result.Status = "failed"
	}
	return file, result, nil
}

func ValidUUID(value string) bool {
	return uuidPattern.MatchString(strings.TrimSpace(value))
}

func TemplateFields(template string) []string {
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

type lineHeader struct {
	Schema string `json:"schema"`
	Kind   string `json:"kind"`
}

type manifestLine struct {
	Schema        string            `json:"schema"`
	Kind          string            `json:"kind"`
	GeneratedAt   string            `json:"generated_at"`
	CatalogSource catalogSourceLine `json:"catalog_source"`
	Provider      map[string]any    `json:"provider"`
}

type catalogSourceLine struct {
	Slug     string `json:"slug"`
	Name     string `json:"name"`
	Scope    string `json:"scope"`
	Template string `json:"template"`
}

type catalogFieldLine struct {
	Schema            string `json:"schema"`
	Kind              string `json:"kind"`
	CatalogSourceSlug string `json:"catalog_source_slug"`
	Key               string `json:"key"`
	Label             string `json:"label"`
	ValueType         string `json:"value_type"`
	IsArray           *bool  `json:"is_array"`
	DisplayOrder      *int   `json:"display_order"`
}

type catalogItemLine struct {
	Schema            string          `json:"schema"`
	Kind              string          `json:"kind"`
	CatalogSourceSlug string          `json:"catalog_source_slug"`
	ExternalID        string          `json:"external_id"`
	Data              json.RawMessage `json:"data"`
}

func decodeHeader(raw []byte, line int, result *Result) (lineHeader, bool) {
	var header lineHeader
	if err := decodeJSON(raw, &header); err != nil {
		addError(result, line, "invalid_json", "line is not valid JSON")
		return lineHeader{}, false
	}
	return header, true
}

func decodeManifest(raw []byte, line int, result *Result) (Manifest, bool) {
	var input manifestLine
	if err := decodeJSON(raw, &input); err != nil {
		addError(result, line, "invalid_json", "manifest is not valid JSON")
		return Manifest{}, false
	}

	generatedAt, err := time.Parse(time.RFC3339, strings.TrimSpace(input.GeneratedAt))
	if err != nil {
		addError(result, line, "invalid_generated_at", "generated_at must be an RFC3339 timestamp")
	}

	return Manifest{
		Line:        line,
		GeneratedAt: generatedAt,
		CatalogSource: CatalogSource{
			Slug:     strings.TrimSpace(input.CatalogSource.Slug),
			Name:     strings.TrimSpace(input.CatalogSource.Name),
			Scope:    strings.TrimSpace(input.CatalogSource.Scope),
			Template: strings.TrimSpace(input.CatalogSource.Template),
		},
		Provider: input.Provider,
	}, true
}

func decodeCatalogField(raw []byte, line int, result *Result) (CatalogField, bool) {
	var input catalogFieldLine
	if err := decodeJSON(raw, &input); err != nil {
		addError(result, line, "invalid_json", "catalog_field is not valid JSON")
		return CatalogField{}, false
	}
	if input.IsArray == nil {
		addError(result, line, "missing_is_array", "catalog field is_array is required")
	}
	if input.DisplayOrder == nil {
		addError(result, line, "missing_display_order", "catalog field display_order is required")
	}

	field := CatalogField{
		Line:              line,
		CatalogSourceSlug: strings.TrimSpace(input.CatalogSourceSlug),
		Key:               strings.TrimSpace(input.Key),
		Label:             strings.TrimSpace(input.Label),
		ValueType:         strings.ToLower(strings.TrimSpace(input.ValueType)),
	}
	if input.IsArray != nil {
		field.IsArray = *input.IsArray
	}
	if input.DisplayOrder != nil {
		field.DisplayOrder = *input.DisplayOrder
	}
	return field, true
}

func decodeCatalogItem(raw []byte, line int, result *Result) (CatalogItem, bool) {
	var input catalogItemLine
	if err := decodeJSON(raw, &input); err != nil {
		addError(result, line, "invalid_json", "catalog_item is not valid JSON")
		return CatalogItem{}, false
	}
	if len(bytes.TrimSpace(input.Data)) == 0 {
		addError(result, line, "missing_data", "catalog item data is required")
		return CatalogItem{
			Line:              line,
			CatalogSourceSlug: strings.TrimSpace(input.CatalogSourceSlug),
			ExternalID:        strings.TrimSpace(input.ExternalID),
			Data:              map[string]any{},
		}, true
	}

	var data map[string]any
	if err := decodeJSON(input.Data, &data); err != nil || data == nil {
		addError(result, line, "data_not_object", "catalog item data must be a JSON object")
		data = map[string]any{}
	}

	return CatalogItem{
		Line:              line,
		CatalogSourceSlug: strings.TrimSpace(input.CatalogSourceSlug),
		ExternalID:        strings.TrimSpace(input.ExternalID),
		Data:              data,
	}, true
}

func validateFile(file *File, opts Options, result *Result) {
	if file.Manifest.Line == 0 {
		return
	}

	source := file.Manifest.CatalogSource
	if source.Slug == "" {
		addError(result, file.Manifest.Line, "missing_catalog_source_slug", "catalog_source.slug is required")
	} else if !slugPattern.MatchString(source.Slug) {
		addError(result, file.Manifest.Line, "invalid_catalog_source_slug", "catalog_source.slug is malformed")
	}
	if source.Name == "" {
		addError(result, file.Manifest.Line, "missing_catalog_source_name", "catalog_source.name is required")
	}
	switch source.Scope {
	case "global":
		if !opts.AllowGlobal {
			addError(result, file.Manifest.Line, "unauthorized_global_import", "global catalog imports require admin authorization")
		}
	case "group":
		if strings.TrimSpace(opts.GroupID) == "" {
			addError(result, file.Manifest.Line, "missing_group_id", "group-scoped imports require a target group")
		}
	default:
		addError(result, file.Manifest.Line, "invalid_catalog_source_scope", "catalog_source.scope must be global or group")
	}
	if source.Template == "" {
		addError(result, file.Manifest.Line, "missing_catalog_source_template", "catalog_source.template is required")
	}

	requiredTemplateFields := TemplateFields(source.Template)
	validateFields(file.Fields, source.Slug, result)
	validateItems(file.Items, source.Slug, requiredTemplateFields, file.Fields, result)
}

func validateFields(fields []CatalogField, sourceSlug string, result *Result) {
	seen := map[string]int{}
	for _, field := range fields {
		if field.CatalogSourceSlug == "" {
			addError(result, field.Line, "missing_catalog_source_slug", "catalog field catalog_source_slug is required")
		} else if sourceSlug != "" && field.CatalogSourceSlug != sourceSlug {
			addError(result, field.Line, "catalog_source_slug_mismatch", "catalog field references a different catalog source slug")
		}
		if field.Key == "" {
			addError(result, field.Line, "missing_field_key", "catalog field key is required")
		}
		if field.Label == "" {
			addError(result, field.Line, "missing_field_label", "catalog field label is required")
		}
		switch field.ValueType {
		case "string", "number":
		default:
			addError(result, field.Line, "invalid_field_value_type", "catalog field value_type must be string or number")
		}
		if firstLine, ok := seen[field.Key]; ok && field.Key != "" {
			addError(result, field.Line, "duplicate_field_key", fmt.Sprintf("catalog field key duplicates line %d", firstLine))
		} else if field.Key != "" {
			seen[field.Key] = field.Line
		}
	}
}

func validateItems(items []CatalogItem, sourceSlug string, requiredTemplateFields []string, fields []CatalogField, result *Result) {
	fieldsByKey := map[string]CatalogField{}
	for _, field := range fields {
		if field.Key != "" {
			fieldsByKey[field.Key] = field
		}
	}

	seenExternalIDs := map[string]int{}
	for index := range items {
		item := &items[index]
		if item.CatalogSourceSlug == "" {
			addError(result, item.Line, "missing_catalog_source_slug", "catalog item catalog_source_slug is required")
		} else if sourceSlug != "" && item.CatalogSourceSlug != sourceSlug {
			addError(result, item.Line, "catalog_source_slug_mismatch", "catalog item references a different catalog source slug")
		}
		if item.ExternalID == "" {
			addError(result, item.Line, "missing_external_id", "catalog item external_id is required")
		} else if firstLine, ok := seenExternalIDs[item.ExternalID]; ok {
			addError(result, item.Line, "duplicate_external_id", fmt.Sprintf("catalog item external_id duplicates line %d", firstLine))
		} else {
			seenExternalIDs[item.ExternalID] = item.Line
		}

		for key := range item.Data {
			if forbiddenDataKeys[strings.ToLower(strings.TrimSpace(key))] {
				addError(result, item.Line, "forbidden_data_key", "catalog item data cannot include answer-bearing content")
			}
		}
		for _, field := range requiredTemplateFields {
			value, ok := item.Data[field]
			if !ok || !templateValuePresent(value) {
				addError(result, item.Line, "missing_template_field", "catalog item data is missing required template field "+field)
			}
		}
		for key, field := range fieldsByKey {
			value, ok := item.Data[key]
			if !ok || value == nil {
				continue
			}
			if !valueMatchesField(field, value) {
				addError(result, item.Line, "field_type_mismatch", "catalog item data field "+key+" does not match declared field type")
			}
		}
		if _, ok := item.Data["external_id"]; !ok && item.ExternalID != "" {
			item.Data["external_id"] = item.ExternalID
		}
	}
}

func valueMatchesField(field CatalogField, value any) bool {
	if field.IsArray {
		values, ok := value.([]any)
		if !ok {
			return false
		}
		for _, item := range values {
			if !scalarValueMatchesType(field.ValueType, item) {
				return false
			}
		}
		return true
	}
	return scalarValueMatchesType(field.ValueType, value)
}

func scalarValueMatchesType(valueType string, value any) bool {
	switch valueType {
	case "number":
		number, ok := value.(json.Number)
		if !ok {
			return false
		}
		_, err := number.Float64()
		return err == nil
	case "string":
		_, ok := value.(string)
		return ok
	default:
		return false
	}
}

func templateValuePresent(value any) bool {
	switch typed := value.(type) {
	case nil:
		return false
	case string:
		return strings.TrimSpace(typed) != ""
	case json.Number:
		return typed.String() != ""
	default:
		return true
	}
}

func importFile(ctx context.Context, tx pgx.Tx, file File, opts Options, counts *Counts) error {
	sourceID, inserted, err := upsertSource(ctx, tx, file.Manifest.CatalogSource, opts)
	if err != nil {
		return err
	}
	if inserted {
		counts.SourcesInserted++
	} else {
		counts.SourcesUpdated++
	}

	existingFieldKeys, err := existingKeys(ctx, tx, `
		select key
		from catalog_source_fields
		where source_id = $1
	`, sourceID)
	if err != nil {
		return err
	}
	for _, field := range file.Fields {
		if _, err := tx.Exec(ctx, `
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
		`, sourceID, field.Key, field.Label, field.ValueType, field.IsArray, field.DisplayOrder); err != nil {
			return err
		}
		existingFieldKeys[field.Key] = true
		counts.FieldsUpserted++
	}

	existingItemExternalIDs, err := existingKeys(ctx, tx, `
		select external_id
		from catalog_items
		where source_id = $1
		  and external_id is not null
	`, sourceID)
	if err != nil {
		return err
	}
	for _, item := range file.Items {
		dataJSON, err := json.Marshal(item.Data)
		if err != nil {
			return fmt.Errorf("encode catalog item data: %w", err)
		}
		if _, err := tx.Exec(ctx, `
			insert into catalog_items (
				source_id,
				external_id,
				data
			)
			values ($1, $2, $3::jsonb)
			on conflict (source_id, external_id) where external_id is not null do update set
				data = excluded.data
		`, sourceID, item.ExternalID, string(dataJSON)); err != nil {
			return err
		}
		if existingItemExternalIDs[item.ExternalID] {
			counts.ItemsUpdated++
		} else {
			counts.ItemsInserted++
		}
		existingItemExternalIDs[item.ExternalID] = true
	}
	return nil
}

func upsertSource(ctx context.Context, tx pgx.Tx, source CatalogSource, opts Options) (string, bool, error) {
	var sourceID string
	var err error
	if source.Scope == "global" {
		err = tx.QueryRow(ctx, `
			select id::text
			from catalog_sources
			where scope = 'global'
			  and slug = $1
		`, source.Slug).Scan(&sourceID)
	} else {
		err = tx.QueryRow(ctx, `
			select id::text
			from catalog_sources
			where scope = 'group'
			  and group_id = $1
			  and slug = $2
		`, strings.TrimSpace(opts.GroupID), source.Slug).Scan(&sourceID)
	}
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return "", false, err
	}
	if err == nil {
		_, err := tx.Exec(ctx, `
			update catalog_sources
			set name = $2,
			    template = $3
			where id = $1
		`, sourceID, source.Name, source.Template)
		return sourceID, false, err
	}

	var groupID any
	if source.Scope == "group" {
		groupID = strings.TrimSpace(opts.GroupID)
	}
	var ownerUserID any
	if opts.OwnerUserID != nil && strings.TrimSpace(*opts.OwnerUserID) != "" {
		ownerUserID = strings.TrimSpace(*opts.OwnerUserID)
	}
	err = tx.QueryRow(ctx, `
		insert into catalog_sources (
			group_id,
			slug,
			scope,
			name,
			template,
			created_by_user_id
		)
		values ($1, $2, $3, $4, $5, $6)
		returning id::text
	`, groupID, source.Slug, source.Scope, source.Name, source.Template, ownerUserID).Scan(&sourceID)
	return sourceID, true, err
}

func existingKeys(ctx context.Context, tx pgx.Tx, query string, args ...any) (map[string]bool, error) {
	rows, err := tx.Query(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	keys := map[string]bool{}
	for rows.Next() {
		var key string
		if err := rows.Scan(&key); err != nil {
			return nil, err
		}
		keys[key] = true
	}
	return keys, rows.Err()
}

func decodeJSON(raw []byte, value any) error {
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.UseNumber()
	if err := decoder.Decode(value); err != nil {
		return err
	}
	if decoder.Decode(&struct{}{}) != io.EOF {
		return errors.New("line must contain a single JSON object")
	}
	return nil
}

func addError(result *Result, line int, code string, message string) {
	result.Errors = append(result.Errors, ImportMessage{
		Line:    line,
		Code:    code,
		Message: message,
	})
}

func SortMessages(messages []ImportMessage) {
	sort.SliceStable(messages, func(i, j int) bool {
		if messages[i].Line != messages[j].Line {
			return messages[i].Line < messages[j].Line
		}
		return messages[i].Code < messages[j].Code
	})
}
