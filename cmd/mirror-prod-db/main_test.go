package main

import (
	"strings"
	"testing"
)

func TestIsLocalPostgresTarget(t *testing.T) {
	tests := []struct {
		name        string
		databaseURL string
		want        bool
	}{
		{
			name:        "localhost",
			databaseURL: "postgres://localhost:5432/arcade?sslmode=disable",
			want:        true,
		},
		{
			name:        "loopback ipv4",
			databaseURL: "postgres://127.0.0.1:5432/arcade?sslmode=disable",
			want:        true,
		},
		{
			name:        "loopback ipv6",
			databaseURL: "postgres://[::1]:5432/arcade?sslmode=disable",
			want:        true,
		},
		{
			name:        "unix socket",
			databaseURL: "postgres:///arcade?host=/var/run/postgresql",
			want:        true,
		},
		{
			name:        "remote",
			databaseURL: "postgres://db.example.com:5432/arcade?sslmode=require",
			want:        false,
		},
		{
			name:        "not a postgres URL",
			databaseURL: "https://localhost/arcade",
			want:        false,
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if got := isLocalPostgresTarget(test.databaseURL); got != test.want {
				t.Fatalf("isLocalPostgresTarget() = %v, want %v", got, test.want)
			}
		})
	}
}

func TestValidateOptionsRejectsUnsafeTargetByDefault(t *testing.T) {
	err := validateOptions(mirrorOptions{
		prodURL:  "postgres://prod.example.com/arcade",
		localURL: "postgres://db.example.com/arcade",
	})
	if err == nil {
		t.Fatal("validateOptions succeeded for a non-local target")
	}
	if !strings.Contains(err.Error(), "refusing to truncate non-local target") {
		t.Fatalf("validateOptions error = %q", err)
	}
}

func TestValidateOptionsAllowsExplicitNonlocalTarget(t *testing.T) {
	err := validateOptions(mirrorOptions{
		prodURL:             "postgres://prod.example.com/arcade",
		localURL:            "postgres://db.example.com/arcade",
		allowNonlocalTarget: true,
	})
	if err != nil {
		t.Fatalf("validateOptions() = %v", err)
	}
}

func TestValidateOptionsRejectsUserAuthConflict(t *testing.T) {
	err := validateOptions(mirrorOptions{
		prodURL:          "postgres://prod.example.com/arcade",
		localURL:         "postgres://localhost/arcade",
		preserveUserAuth: true,
		localPassword:    "password123",
	})
	if err == nil {
		t.Fatal("validateOptions succeeded with conflicting user auth options")
	}
}

func TestUserSelectSQLSanitizesAuthByDefault(t *testing.T) {
	query := userSelectSQL(mirrorOptions{})

	for _, want := range []string{
		"local.arcade.invalid",
		"'disabled'",
	} {
		if !strings.Contains(query, want) {
			t.Fatalf("default user select missing %q in %s", want, query)
		}
	}
}

func TestUserSelectSQLCanSetSharedLocalPassword(t *testing.T) {
	query := userSelectSQL(mirrorOptions{localPassword: "bcrypt'quote"})

	if strings.Contains(query, "bcrypt") {
		t.Fatalf("shared password hash leaked into production query %s", query)
	}
	if !strings.Contains(query, "'disabled' as password_hash") {
		t.Fatalf("shared password query should use placeholder disabled hash in %s", query)
	}
}

func TestUserSelectSQLIncludesThemePreference(t *testing.T) {
	query := userSelectSQL(mirrorOptions{})
	if !strings.Contains(query, "theme_preference") {
		t.Fatalf("user select missing theme_preference in %s", query)
	}
}

func TestCopyValueOverrideSetsSharedLocalPassword(t *testing.T) {
	values := []any{"id", "username", "display", nil, "created", "updated", "email", "disabled"}
	override := copyValueOverride(mirrorTable{name: "users"}, mirrorOptions{localPassword: "hashed-local-password"})
	if override == nil {
		t.Fatal("copyValueOverride returned nil")
	}

	override(values)

	if values[7] != "hashed-local-password" {
		t.Fatalf("password hash value = %v", values[7])
	}
	if values[6] != "email" {
		t.Fatalf("override changed neighboring values: %#v", values)
	}
}

func TestGroupDailyFeedsMirrorColumnsMatchCurrentSchema(t *testing.T) {
	var columns []string
	for _, table := range mirrorTables {
		if table.name == "group_daily_feeds" {
			columns = table.columns
			break
		}
	}
	if columns == nil {
		t.Fatal("group_daily_feeds is not mirrored")
	}

	want := []string{
		"id",
		"group_id",
		"name",
		"slug",
		"description",
		"enabled",
		"captions_enabled",
		"created_by_user_id",
		"created_at",
		"updated_at",
		"kind",
		"source_id",
		"item_count",
		"schedule_starts_at",
		"schedule_timezone",
		"schedule_interval_seconds",
		"evidence_format_id",
	}
	if strings.Join(columns, ",") != strings.Join(want, ",") {
		t.Fatalf("group_daily_feeds columns = %#v, want %#v", columns, want)
	}
}

func TestGroupsMirrorColumnsIncludeJoinPolicy(t *testing.T) {
	var columns []string
	for _, table := range mirrorTables {
		if table.name == "groups" {
			columns = table.columns
			break
		}
	}
	if columns == nil {
		t.Fatal("groups is not mirrored")
	}

	want := []string{
		"id",
		"name",
		"slug",
		"description",
		"visibility",
		"join_policy",
		"created_by_user_id",
		"created_at",
		"updated_at",
	}
	if strings.Join(columns, ",") != strings.Join(want, ",") {
		t.Fatalf("groups columns = %#v, want %#v", columns, want)
	}
}

func TestPostAppearanceMirrorTablesMatchCurrentSchema(t *testing.T) {
	paletteTableIndex := mirrorTableIndex("group_post_card_palettes")
	formatTableIndex := mirrorTableIndex("group_evidence_formats")
	if paletteTableIndex < 0 || formatTableIndex < 0 {
		t.Fatalf("post appearance mirror tables missing: palettes=%d formats=%d", paletteTableIndex, formatTableIndex)
	}
	if paletteTableIndex >= formatTableIndex {
		t.Fatalf("group_post_card_palettes must be mirrored before group_evidence_formats")
	}

	paletteColumns := mirrorTableColumns("group_post_card_palettes")
	wantPalettes := []string{
		"id",
		"group_id",
		"system_key",
		"name",
		"material_model",
		"surface_hue",
		"surface_colorfulness",
		"accent_hue",
		"accent_colorfulness",
		"archived_at",
		"revision",
		"created_by_user_id",
		"updated_by_user_id",
		"created_at",
		"updated_at",
	}
	if strings.Join(paletteColumns, ",") != strings.Join(wantPalettes, ",") {
		t.Fatalf("group_post_card_palettes columns = %#v, want %#v", paletteColumns, wantPalettes)
	}

	formatColumns := mirrorTableColumns("group_evidence_formats")
	if !containsString(formatColumns, "content_typeface") || !containsString(formatColumns, "content_card_palette_id") {
		t.Fatalf("group_evidence_formats appearance columns missing from %#v", formatColumns)
	}
}

func mirrorTableIndex(name string) int {
	for index, table := range mirrorTables {
		if table.name == name {
			return index
		}
	}
	return -1
}

func mirrorTableColumns(name string) []string {
	for _, table := range mirrorTables {
		if table.name == name {
			return table.columns
		}
	}
	return nil
}

func containsString(values []string, want string) bool {
	for _, value := range values {
		if value == want {
			return true
		}
	}
	return false
}

func TestUserSelectSQLCanPreserveProductionAuth(t *testing.T) {
	query := userSelectSQL(mirrorOptions{preserveUserAuth: true})

	for _, want := range []string{
		"email as email",
		"password_hash as password_hash",
	} {
		if !strings.Contains(query, want) {
			t.Fatalf("preserved user select missing %q in %s", want, query)
		}
	}
	if strings.Contains(query, "local.arcade.invalid") {
		t.Fatalf("preserved user select still sanitizes email in %s", query)
	}
}

func TestMissingVersions(t *testing.T) {
	missing := missingVersions(
		[]string{"001_init.sql", "002_next.sql", "003_latest.sql"},
		[]string{"001_init.sql", "003_latest.sql"},
	)
	if got := strings.Join(missing, ","); got != "002_next.sql" {
		t.Fatalf("missingVersions() = %q", got)
	}
}

func TestValidateMirrorSchemaRejectsMissingConfiguredProductionColumn(t *testing.T) {
	tables := []mirrorTable{{name: "group_daily_feeds", columns: []string{"id", "audience"}}}
	prodSchema := testDatabaseSchema("group_daily_feeds", "id")
	localSchema := testDatabaseSchema("group_daily_feeds", "id", "audience")

	err := validateMirrorSchema(tables, prodSchema, localSchema)
	if err == nil {
		t.Fatal("validateMirrorSchema succeeded with missing production column")
	}
	if !strings.Contains(err.Error(), "configured columns missing in production: audience") {
		t.Fatalf("validateMirrorSchema error = %q", err)
	}
}

func TestValidateMirrorSchemaRejectsMissingConfiguredLocalColumn(t *testing.T) {
	tables := []mirrorTable{{name: "group_daily_feeds", columns: []string{"id", "audience"}}}
	prodSchema := testDatabaseSchema("group_daily_feeds", "id", "audience")
	localSchema := testDatabaseSchema("group_daily_feeds", "id")

	err := validateMirrorSchema(tables, prodSchema, localSchema)
	if err == nil {
		t.Fatal("validateMirrorSchema succeeded with missing local column")
	}
	if !strings.Contains(err.Error(), "configured columns missing in local target: audience") {
		t.Fatalf("validateMirrorSchema error = %q", err)
	}
}

func TestValidateMirrorSchemaRejectsSharedUnmirroredColumn(t *testing.T) {
	tables := []mirrorTable{{name: "group_daily_feeds", columns: []string{"id"}}}
	prodSchema := testDatabaseSchema("group_daily_feeds", "id", "new_shared_column")
	localSchema := testDatabaseSchema("group_daily_feeds", "id", "new_shared_column")
	localSchema["group_daily_feeds"]["new_shared_column"] = databaseColumn{nullable: true}

	err := validateMirrorSchema(tables, prodSchema, localSchema)
	if err == nil {
		t.Fatal("validateMirrorSchema succeeded with unmirrored shared column")
	}
	if !strings.Contains(err.Error(), "columns exist in both schemas but are not configured for mirroring: new_shared_column") {
		t.Fatalf("validateMirrorSchema error = %q", err)
	}
}

func TestValidateMirrorSchemaRejectsUnmirroredRequiredLocalColumn(t *testing.T) {
	tables := []mirrorTable{{name: "group_daily_feeds", columns: []string{"id"}}}
	prodSchema := testDatabaseSchema("group_daily_feeds", "id")
	localSchema := testDatabaseSchema("group_daily_feeds", "id", "new_required_column")

	err := validateMirrorSchema(tables, prodSchema, localSchema)
	if err == nil {
		t.Fatal("validateMirrorSchema succeeded with unmirrored required local column")
	}
	if !strings.Contains(err.Error(), "local columns are required but not mirrored: new_required_column") {
		t.Fatalf("validateMirrorSchema error = %q", err)
	}
}

func TestValidateMirrorSchemaAllowsDefaultableLocalOnlyColumns(t *testing.T) {
	tables := []mirrorTable{{name: "group_daily_feeds", columns: []string{"id"}}}
	prodSchema := testDatabaseSchema("group_daily_feeds", "id")
	localSchema := testDatabaseSchema("group_daily_feeds", "id")
	localSchema["group_daily_feeds"]["new_nullable_column"] = databaseColumn{nullable: true}
	localSchema["group_daily_feeds"]["new_defaulted_column"] = databaseColumn{hasDefault: true}
	localSchema["group_daily_feeds"]["new_identity_column"] = databaseColumn{identity: true}
	localSchema["group_daily_feeds"]["new_generated_column"] = databaseColumn{generated: true}

	if err := validateMirrorSchema(tables, prodSchema, localSchema); err != nil {
		t.Fatalf("validateMirrorSchema() = %v", err)
	}
}

func testDatabaseSchema(table string, columns ...string) databaseSchema {
	schema := databaseSchema{
		table: make(tableSchema, len(columns)),
	}
	for _, column := range columns {
		schema[table][column] = databaseColumn{}
	}
	return schema
}
