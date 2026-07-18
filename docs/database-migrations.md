# Database Migrations

Arcade migrations are plain SQL files embedded into the Go binary from
`internal/migrations`. They run automatically during server startup before HTTP
routes are built.

## Runtime Behavior

Startup follows this path:

1. `cmd/arcade/main.go` loads configuration and opens a Postgres connection
   pool.
2. `migrations.Run(ctx, db)` creates `schema_migrations` if it does not exist.
3. The runner reads embedded `*.sql` files from `internal/migrations`, sorts
   filenames lexicographically, and checks each filename against
   `schema_migrations.version`.
4. Each unapplied file is executed inside its own transaction.
5. After the SQL succeeds, the runner inserts the filename into
   `schema_migrations` and commits the transaction.
6. If any step fails, that migration transaction is rolled back and startup
   exits with an error.

The migration bookkeeping table is:

```sql
create table if not exists schema_migrations (
    version text primary key,
    applied_at timestamptz not null default now()
);
```

The `version` value is the full migration filename, for example
`001_init.sql`.

## Adding A Migration

1. Add a new SQL file under `internal/migrations` using the next zero-padded
   prefix: `004_short_description.sql`, `005_short_description.sql`, and so on.
2. Keep the change forward-only. Do not edit an already-applied migration for a
   shared or persistent database.
3. Put all required schema changes, constraint updates, data backfills, and seed
   adjustments in the new file.
4. Update [the data model doc](data-model.md) when the schema or important
   relationships change.
5. Test both paths:
   - an empty database, which proves the full migration chain still builds the
     schema from scratch;
   - an existing database at the previous version, which proves the new file can
     upgrade real data.

For local testing, point the app at a disposable database and start it:

```sh
createdb arcade_migration_test
ARCADE_DATABASE_URL=postgres://localhost:5432/arcade_migration_test?sslmode=disable go run ./cmd/arcade
```

After startup, verify the applied versions:

```sql
select version, applied_at
from schema_migrations
order by version;
```

`go test ./...` is still useful because it verifies the migration package
compiles and embeds the SQL files, but it does not by itself execute the SQL
against Postgres.

## Authoring Expectations

- Use lexicographic order intentionally. Keep numeric prefixes zero-padded and
  never insert a new migration between filenames that may already be deployed.
- Remember every file runs inside a transaction. Avoid Postgres commands that
  are not allowed in a transaction, such as `create index concurrently`.
- Prefer additive changes for populated tables: add nullable columns or defaults,
  backfill existing rows, then add `not null`, foreign keys, or stricter checks.
- Use `check` constraints for enum-like text values to match the existing
  schema. When changing allowed values, drop and recreate the named constraint in
  the migration.
- Add `updated_at` and the shared `set_updated_at()` trigger for new mutable
  tables that need last-modified timestamps.
- Choose foreign-key actions deliberately. Use `on delete cascade` for owned
  child records and `on delete set null` when history should survive parent
  deletion.
- Use `on conflict` for seed/reference data that should be present on fresh
  databases without duplicating rows.
- Keep data-destructive changes explicit and narrow. If rows must be deleted or
  rewritten, document the reason in SQL comments near the statement.

## Post Appearance Migration

`023_post_appearance.sql` illustrates the populated-table sequence used for
post appearance data:

1. Existing users receive `theme_preference = 'dark'`, preserving the
   pre-migration presentation, and the column default is then changed to
   `system` for newly created users.
2. `group_post_card_palettes` is created and one locked Chalkboard row is seeded
   for every existing group.
3. Evidence-format appearance columns are added, existing formats are backfilled
   to their group's Chalkboard palette, and only then is the palette reference
   made non-null with its group-scoped composite foreign key.
4. The evidence-format `updated_at` trigger is disabled only around the migration
   backfill so an operational schema upgrade does not make every existing format
   appear user-edited. The migration transaction restores the trigger before it
   commits.

New-group creation performs the same dependency order in one transaction:
create the group, create its Chalkboard palette, create the default `plain-text`
format referencing that palette, then create the default daily feed. Production
database mirroring likewise copies palettes before evidence formats so the
foreign key remains satisfiable.

## Operations

There is no separate migration command today; deploying a new binary runs any
new embedded migrations on startup.

Only one process should perform a schema upgrade at a time. The current runner
does not take an advisory lock, so concurrent first-starts of a newly deployed
version can race while checking and applying the same filename. In production,
start one instance first or run an equivalent one-shot startup before scaling
out additional instances.

Back up persistent databases before migrations that rewrite data, drop columns,
or tighten constraints. Rollback is also forward-only: restore from backup, or
ship a corrective migration with a higher version number. There are no down
migration files.

If a migration fails during normal transactional SQL, the filename is not
recorded in `schema_migrations` and the transaction is rolled back. Fix the SQL
and rerun it only if that migration has not been applied anywhere persistent. If
the bad migration was already applied in a shared environment, leave it in place
and add a new corrective migration.
