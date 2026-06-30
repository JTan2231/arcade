package main

import (
	"bufio"
	"context"
	"errors"
	"flag"
	"fmt"
	"io"
	"net"
	"net/url"
	"os"
	"os/signal"
	"sort"
	"strings"
	"syscall"
	"time"

	"arcade/internal/migrations"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"golang.org/x/crypto/bcrypt"
)

const (
	defaultLocalDatabaseURL = "postgres://localhost:5432/arcade?sslmode=disable"
	disabledPasswordHash    = "disabled"
)

type mirrorOptions struct {
	prodURL             string
	localURL            string
	dryRun              bool
	yes                 bool
	allowNonlocalTarget bool
	preserveUserAuth    bool
	localPassword       string
	statementTimeout    time.Duration
}

type mirrorTable struct {
	name      string
	columns   []string
	selectSQL func(mirrorOptions) string
}

var mirrorTables = []mirrorTable{
	{
		name: "users",
		columns: []string{
			"id",
			"username",
			"display_name",
			"avatar_url",
			"created_at",
			"updated_at",
			"email",
			"password_hash",
			"friend_code",
		},
		selectSQL: userSelectSQL,
	},
	{
		name: "user_friendships",
		columns: []string{
			"id",
			"requester_user_id",
			"addressee_user_id",
			"user_low_id",
			"user_high_id",
			"status",
			"requested_at",
			"responded_at",
			"accepted_at",
			"created_at",
			"updated_at",
		},
	},
	{
		name: "groups",
		columns: []string{
			"id",
			"name",
			"slug",
			"description",
			"visibility",
			"created_by_user_id",
			"created_at",
			"updated_at",
		},
	},
	{
		name: "group_memberships",
		columns: []string{
			"id",
			"group_id",
			"user_id",
			"role",
			"status",
			"joined_at",
			"created_at",
			"updated_at",
			"invited_by_user_id",
			"invited_at",
		},
	},
	{
		name: "divisions",
		columns: []string{
			"id",
			"group_id",
			"name",
			"slug",
			"description",
			"created_by_user_id",
			"created_at",
			"updated_at",
		},
	},
	{
		name: "division_rules",
		columns: []string{
			"id",
			"division_id",
			"min_user_rating",
			"max_user_rating",
			"created_at",
			"updated_at",
		},
	},
	{
		name: "catalog_sources",
		columns: []string{
			"id",
			"group_id",
			"name",
			"template",
			"created_by_user_id",
			"created_at",
			"updated_at",
			"slug",
			"scope",
		},
	},
	{
		name: "catalog_source_fields",
		columns: []string{
			"id",
			"source_id",
			"key",
			"label",
			"value_type",
			"is_array",
			"display_order",
			"created_at",
			"updated_at",
		},
	},
	{
		name: "catalog_items",
		columns: []string{
			"id",
			"source_id",
			"data",
			"created_at",
			"updated_at",
			"external_id",
		},
	},
	{
		name: "group_daily_feeds",
		columns: []string{
			"id",
			"group_id",
			"name",
			"slug",
			"description",
			"enabled",
			"audience",
			"schedule",
			"rules_schema_version",
			"rules",
			"created_by_user_id",
			"created_at",
			"updated_at",
			"kind",
			"source_id",
			"item_count",
			"schedule_starts_at",
			"schedule_timezone",
			"schedule_interval_seconds",
		},
	},
	{
		name: "feed_rule_filters",
		columns: []string{
			"id",
			"feed_id",
			"source_id",
			"field_id",
			"position",
			"op",
			"text_values",
			"number_values",
			"created_at",
			"updated_at",
		},
	},
	{
		name: "group_daily_feed_instances",
		columns: []string{
			"id",
			"group_id",
			"feed_id",
			"feed_date",
			"created_at",
		},
	},
	{
		name: "group_feed_posts",
		columns: []string{
			"id",
			"group_id",
			"feed_instance_id",
			"author_user_id",
			"evidence_kind",
			"evidence_text",
			"caption",
			"deleted_at",
			"created_at",
			"updated_at",
		},
	},
	{
		name: "group_post_tags",
		columns: []string{
			"id",
			"group_id",
			"name",
			"display_order",
			"archived_at",
			"created_by_user_id",
			"updated_by_user_id",
			"created_at",
			"updated_at",
		},
	},
	{
		name: "group_feed_post_tags",
		columns: []string{
			"group_id",
			"post_id",
			"tag_id",
			"created_at",
		},
	},
	{
		name: "group_daily_feed_metrics",
		columns: []string{
			"id",
			"group_id",
			"feed_id",
			"system_key",
			"judgment_prompt",
			"aggregation",
			"display_name",
			"created_by_user_id",
			"created_at",
			"updated_at",
		},
	},
	{
		name: "group_daily_feed_metric_judgments",
		columns: []string{
			"id",
			"metric_id",
			"group_id",
			"post_id",
			"subject_user_id",
			"evaluator_user_id",
			"value",
			"note",
			"created_at",
			"updated_at",
		},
	},
}

func main() {
	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	if err := run(ctx, os.Args[1:], os.Stdin, os.Stdout, os.Stderr); err != nil {
		fmt.Fprintf(os.Stderr, "mirror-prod-db: %v\n", err)
		os.Exit(1)
	}
}

func run(ctx context.Context, args []string, stdin io.Reader, stdout io.Writer, stderr io.Writer) error {
	opts, err := parseOptions(args, stderr)
	if err != nil {
		if errors.Is(err, flag.ErrHelp) {
			return nil
		}
		return err
	}

	if err := validateOptions(opts); err != nil {
		return err
	}

	if opts.localPassword != "" {
		passwordHash, err := bcrypt.GenerateFromPassword([]byte(opts.localPassword), bcrypt.DefaultCost)
		if err != nil {
			return fmt.Errorf("hash local password: %w", err)
		}
		opts.localPassword = string(passwordHash)
	}

	fmt.Fprintf(stdout, "Production source: %s\n", redactedDatabaseURL(opts.prodURL))
	fmt.Fprintf(stdout, "Local target:      %s\n", redactedDatabaseURL(opts.localURL))
	if opts.preserveUserAuth {
		fmt.Fprintln(stdout, "User auth fields:  preserving production email/password/friend_code")
	} else if opts.localPassword != "" {
		fmt.Fprintln(stdout, "User auth fields:  sanitized emails/friend codes with a shared local password")
	} else {
		fmt.Fprintln(stdout, "User auth fields:  sanitized emails/friend codes with disabled passwords")
	}

	prodConn, err := connectProduction(ctx, opts.prodURL, opts.statementTimeout)
	if err != nil {
		return err
	}
	defer prodConn.Close(context.Background())

	counts, err := countProductionRows(ctx, prodConn)
	if err != nil {
		return err
	}
	printCounts(stdout, counts)

	if opts.dryRun {
		fmt.Fprintln(stdout, "Dry run only; local database was not changed.")
		return nil
	}

	localDB, err := pgxpool.New(ctx, opts.localURL)
	if err != nil {
		return fmt.Errorf("configure local database: %w", err)
	}
	defer localDB.Close()
	if err := localDB.Ping(ctx); err != nil {
		return fmt.Errorf("connect local database: %w", err)
	}
	if err := migrations.Run(ctx, localDB); err != nil {
		return fmt.Errorf("run local migrations: %w", err)
	}
	if err := checkMigrationCompatibility(ctx, prodConn, localDB, stderr); err != nil {
		return err
	}

	if !opts.yes {
		if err := confirm(stdin, stdout); err != nil {
			return err
		}
	}

	copied, err := mirrorData(ctx, prodConn, localDB, opts, stdout)
	if err != nil {
		return err
	}

	fmt.Fprintf(stdout, "Mirrored %d rows into local database.\n", copied)
	return nil
}

func parseOptions(args []string, output io.Writer) (mirrorOptions, error) {
	opts := mirrorOptions{
		prodURL:          firstNonEmpty(os.Getenv("ARCADE_PROD_DATABASE_URL"), os.Getenv("PROD_DATABASE_URL"), os.Getenv("DATABASE_URL")),
		localURL:         firstNonEmpty(os.Getenv("ARCADE_LOCAL_DATABASE_URL"), os.Getenv("ARCADE_DATABASE_URL"), defaultLocalDatabaseURL),
		localPassword:    os.Getenv("ARCADE_MIRROR_LOCAL_PASSWORD"),
		statementTimeout: 5 * time.Minute,
	}

	flags := flag.NewFlagSet("mirror-prod-db", flag.ContinueOnError)
	flags.SetOutput(output)
	flags.StringVar(&opts.prodURL, "prod-url", opts.prodURL, "production Postgres URL; defaults to ARCADE_PROD_DATABASE_URL, PROD_DATABASE_URL, then DATABASE_URL")
	flags.StringVar(&opts.localURL, "local-url", opts.localURL, "local Postgres URL; defaults to ARCADE_LOCAL_DATABASE_URL, ARCADE_DATABASE_URL, then localhost arcade")
	flags.BoolVar(&opts.dryRun, "dry-run", false, "show the production row counts without changing the local database")
	flags.BoolVar(&opts.yes, "yes", false, "skip the destructive confirmation prompt")
	flags.BoolVar(&opts.allowNonlocalTarget, "allow-nonlocal-target", false, "allow truncating a target database whose host is not local")
	flags.BoolVar(&opts.preserveUserAuth, "preserve-user-auth", false, "copy production user email, password_hash, and friend_code instead of sanitizing them")
	flags.StringVar(&opts.localPassword, "local-password", opts.localPassword, "shared password for mirrored users; ARCADE_MIRROR_LOCAL_PASSWORD avoids putting it in shell history")
	flags.DurationVar(&opts.statementTimeout, "statement-timeout", opts.statementTimeout, "statement timeout for production read queries; use 0 to disable")

	if err := flags.Parse(args); err != nil {
		return mirrorOptions{}, err
	}
	if flags.NArg() != 0 {
		return mirrorOptions{}, fmt.Errorf("unexpected arguments: %s", strings.Join(flags.Args(), " "))
	}
	return opts, nil
}

func validateOptions(opts mirrorOptions) error {
	if strings.TrimSpace(opts.prodURL) == "" {
		return errors.New("set -prod-url, ARCADE_PROD_DATABASE_URL, PROD_DATABASE_URL, or DATABASE_URL")
	}
	if strings.TrimSpace(opts.localURL) == "" {
		return errors.New("local database URL is required")
	}
	if strings.TrimSpace(opts.prodURL) == strings.TrimSpace(opts.localURL) {
		return errors.New("production and local database URLs are identical")
	}
	if opts.preserveUserAuth && opts.localPassword != "" {
		return errors.New("-preserve-user-auth and -local-password cannot be used together")
	}
	if !opts.allowNonlocalTarget && !isLocalPostgresTarget(opts.localURL) {
		return fmt.Errorf("refusing to truncate non-local target %s; pass -allow-nonlocal-target to override", redactedDatabaseURL(opts.localURL))
	}
	if opts.statementTimeout < 0 {
		return errors.New("-statement-timeout cannot be negative")
	}
	return nil
}

func connectProduction(ctx context.Context, databaseURL string, statementTimeout time.Duration) (*pgx.Conn, error) {
	config, err := pgx.ParseConfig(databaseURL)
	if err != nil {
		return nil, fmt.Errorf("parse production database URL: %w", err)
	}
	if config.RuntimeParams == nil {
		config.RuntimeParams = make(map[string]string)
	}
	config.RuntimeParams["default_transaction_read_only"] = "on"
	config.RuntimeParams["statement_timeout"] = fmt.Sprintf("%d", statementTimeout.Milliseconds())
	config.RuntimeParams["idle_in_transaction_session_timeout"] = fmt.Sprintf("%d", (5 * time.Minute).Milliseconds())

	conn, err := pgx.ConnectConfig(ctx, config)
	if err != nil {
		return nil, fmt.Errorf("connect production database: %w", err)
	}
	if _, err := conn.Exec(ctx, `set default_transaction_read_only = on`); err != nil {
		conn.Close(context.Background())
		return nil, fmt.Errorf("enable production read-only mode: %w", err)
	}
	return conn, nil
}

func countProductionRows(ctx context.Context, prod *pgx.Conn) (map[string]int64, error) {
	counts := make(map[string]int64, len(mirrorTables))
	for _, table := range mirrorTables {
		var count int64
		if err := prod.QueryRow(ctx, fmt.Sprintf("select count(*) from %s", quoteIdent(table.name))).Scan(&count); err != nil {
			return nil, fmt.Errorf("count production %s: %w", table.name, err)
		}
		counts[table.name] = count
	}
	return counts, nil
}

func printCounts(output io.Writer, counts map[string]int64) {
	fmt.Fprintln(output, "Rows to mirror:")
	for _, table := range mirrorTables {
		fmt.Fprintf(output, "  %-36s %d\n", table.name, counts[table.name])
	}
}

func checkMigrationCompatibility(ctx context.Context, prod *pgx.Conn, local *pgxpool.Pool, stderr io.Writer) error {
	prodVersions, err := migrationVersions(ctx, prod)
	if err != nil {
		return fmt.Errorf("read production schema migrations: %w", err)
	}
	localVersions, err := migrationVersions(ctx, local)
	if err != nil {
		return fmt.Errorf("read local schema migrations: %w", err)
	}

	if missing := missingVersions(prodVersions, localVersions); len(missing) > 0 {
		return fmt.Errorf("local database is missing production migrations: %s", strings.Join(missing, ", "))
	}
	if extra := missingVersions(localVersions, prodVersions); len(extra) > 0 {
		fmt.Fprintf(stderr, "warning: local schema has migrations not present in production: %s\n", strings.Join(extra, ", "))
	}
	return nil
}

type queryer interface {
	Query(ctx context.Context, sql string, args ...any) (pgx.Rows, error)
}

func migrationVersions(ctx context.Context, db queryer) ([]string, error) {
	rows, err := db.Query(ctx, `select version from schema_migrations order by version`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var versions []string
	for rows.Next() {
		var version string
		if err := rows.Scan(&version); err != nil {
			return nil, err
		}
		versions = append(versions, version)
	}
	return versions, rows.Err()
}

func missingVersions(required []string, actual []string) []string {
	present := make(map[string]bool, len(actual))
	for _, version := range actual {
		present[version] = true
	}

	var missing []string
	for _, version := range required {
		if !present[version] {
			missing = append(missing, version)
		}
	}
	sort.Strings(missing)
	return missing
}

func confirm(input io.Reader, output io.Writer) error {
	fmt.Fprintln(output)
	fmt.Fprintln(output, "This will truncate the mirrored tables in the local database, including local users, groups, feeds, posts, sources, and sessions.")
	fmt.Fprint(output, "Type mirror to continue: ")

	scanner := bufio.NewScanner(input)
	if !scanner.Scan() {
		if err := scanner.Err(); err != nil {
			return fmt.Errorf("read confirmation: %w", err)
		}
		return errors.New("confirmation required")
	}
	if strings.TrimSpace(scanner.Text()) != "mirror" {
		return errors.New("aborted")
	}
	return nil
}

func mirrorData(ctx context.Context, prod *pgx.Conn, local *pgxpool.Pool, opts mirrorOptions, stdout io.Writer) (int64, error) {
	tx, err := local.Begin(ctx)
	if err != nil {
		return 0, fmt.Errorf("begin local mirror transaction: %w", err)
	}
	defer tx.Rollback(ctx)

	if _, err := tx.Exec(ctx, truncateSQL()); err != nil {
		return 0, fmt.Errorf("truncate local mirrored tables: %w", err)
	}

	var total int64
	for _, table := range mirrorTables {
		count, err := copyTable(ctx, prod, tx, table, opts)
		if err != nil {
			return 0, err
		}
		total += count
		fmt.Fprintf(stdout, "Copied %-36s %d\n", table.name, count)
	}

	if err := tx.Commit(ctx); err != nil {
		return 0, fmt.Errorf("commit local mirror transaction: %w", err)
	}
	return total, nil
}

func copyTable(ctx context.Context, prod *pgx.Conn, tx pgx.Tx, table mirrorTable, opts mirrorOptions) (int64, error) {
	query := table.selectQuery(opts)
	rows, err := prod.Query(ctx, query)
	if err != nil {
		return 0, fmt.Errorf("query production %s: %w", table.name, err)
	}
	defer rows.Close()

	count, err := tx.CopyFrom(ctx, pgx.Identifier{table.name}, table.columns, &rowsCopySource{rows: rows})
	if err != nil {
		return count, fmt.Errorf("copy local %s: %w", table.name, err)
	}
	return count, nil
}

type rowsCopySource struct {
	rows   pgx.Rows
	values []any
	err    error
}

func (s *rowsCopySource) Next() bool {
	if !s.rows.Next() {
		return false
	}
	s.values, s.err = s.rows.Values()
	return s.err == nil
}

func (s *rowsCopySource) Values() ([]any, error) {
	return s.values, s.err
}

func (s *rowsCopySource) Err() error {
	if s.err != nil {
		return s.err
	}
	return s.rows.Err()
}

func (t mirrorTable) selectQuery(opts mirrorOptions) string {
	if t.selectSQL != nil {
		return t.selectSQL(opts)
	}

	columns := make([]string, 0, len(t.columns))
	for _, column := range t.columns {
		columns = append(columns, quoteIdent(column))
	}
	return fmt.Sprintf("select %s from %s", strings.Join(columns, ", "), quoteIdent(t.name))
}

func userSelectSQL(opts mirrorOptions) string {
	email := "('prod-user-' || replace(id::text, '-', '') || '@local.arcade.invalid')::text"
	passwordHash := quoteLiteral(disabledPasswordHash)
	friendCode := "('ARCD' || upper(replace(id::text, '-', '')))::text"

	if opts.preserveUserAuth {
		email = "email"
		passwordHash = "password_hash"
		friendCode = "friend_code"
	} else if opts.localPassword != "" {
		passwordHash = quoteLiteral(opts.localPassword)
	}

	return fmt.Sprintf(
		`select id, username, display_name, avatar_url, created_at, updated_at, %s as email, %s as password_hash, %s as friend_code from users`,
		email,
		passwordHash,
		friendCode,
	)
}

func truncateSQL() string {
	tables := append([]string{"user_sessions"}, tableNames(mirrorTables)...)
	quoted := make([]string, 0, len(tables))
	for _, table := range tables {
		quoted = append(quoted, quoteIdent(table))
	}
	return "truncate table " + strings.Join(quoted, ", ") + " restart identity cascade"
}

func tableNames(tables []mirrorTable) []string {
	names := make([]string, 0, len(tables))
	for _, table := range tables {
		names = append(names, table.name)
	}
	return names
}

func quoteIdent(identifier string) string {
	return `"` + strings.ReplaceAll(identifier, `"`, `""`) + `"`
}

func quoteLiteral(value string) string {
	return `'` + strings.ReplaceAll(value, `'`, `''`) + `'`
}

func isLocalPostgresTarget(databaseURL string) bool {
	parsed, err := url.Parse(databaseURL)
	if err != nil {
		return false
	}
	if parsed.Scheme != "postgres" && parsed.Scheme != "postgresql" {
		return false
	}

	host := parsed.Hostname()
	if host == "" {
		return true
	}

	lowerHost := strings.ToLower(host)
	if lowerHost == "localhost" || strings.HasSuffix(lowerHost, ".localhost") {
		return true
	}

	ip := net.ParseIP(host)
	return ip != nil && ip.IsLoopback()
}

func redactedDatabaseURL(databaseURL string) string {
	parsed, err := url.Parse(databaseURL)
	if err != nil {
		return databaseURL
	}
	return parsed.Redacted()
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if value != "" {
			return value
		}
	}
	return ""
}
