# Architecture

Arcade is organized as one deployable Go binary with an embedded static frontend.

## Package Layout

```text
cmd/arcade
  main.go                 Process entrypoint and server lifecycle.

internal/app
  config.go              Environment configuration.
  server.go              Server construction, route registration, shared helpers.
  json.go                JSON response/request helpers and nullable conversions.
  types.go               API response models.
  handlers_*.go          Resource handlers and query orchestration.

internal/migrations
  migrations.go          Embedded SQL migration runner.
  *.sql                  Ordered Postgres migrations and seed data.

web
  static.go              Embedded static filesystem.
  static/                Browser app: HTML, CSS, JavaScript.
```

## Startup Flow

1. `cmd/arcade/main.go` creates a signal-aware root context.
2. `app.LoadConfig()` reads environment configuration and defaults.
3. `pgxpool.New()` creates the Postgres connection pool and `Ping()` verifies connectivity.
4. `migrations.Run()` applies embedded SQL migrations in filename order.
5. `app.NewServer()` ensures the development user exists and builds the embedded static file handler.
6. `http.Server` serves `server.Routes()` and shuts down gracefully on `SIGINT` or `SIGTERM`.

## Request Flow

```text
Browser
  -> embedded static assets from /
  -> fetch('/api/...') JSON requests
  -> net/http ServeMux
  -> internal/app handler
  -> pgxpool query or transaction
  -> JSON response or structured error
```

Routes are grouped by resource in `Server.Routes()`:

- Identity: `/api/me`, preferences, and external accounts.
- Catalog: sources and problems.
- Groups: groups and group memberships.
- Divisions: group-scoped divisions and division rules.
- Dailies: daily generation, daily history, daily set lookup, and daily leaderboards.
- Submissions: manual solves and local sync markers.
- Leaderboards: global, group, division, and daily-set views.

## Domain Model

The main persisted entities are:

- `users`: local users. The current build operates as one configured development user.
- `problem_sources`: coding platforms such as Codeforces, AtCoder, and Advent of Code.
- `problems` and `problem_tags`: catalog entries, ratings, URLs, and tags.
- `external_accounts`: a user's platform handles and local sync metadata.
- `user_preferences` and `user_preference_tags`: daily generation defaults.
- `groups` and `group_memberships`: social scopes and roles.
- `divisions`, `division_rules`, and `division_rule_tags`: group-scoped daily selection constraints.
- `daily_sets` and `daily_set_items`: generated practice sets and their ordered problems.
- `submissions`: accepted/manual solves and other verdicts.
- `leaderboard_snapshots` and `leaderboard_snapshot_rows`: reserved for future materialized leaderboards.

## Daily Generation

Daily generation lives in `internal/app/handlers_dailies.go`.

The generator combines request inputs, user preferences, and optional division defaults to choose problems:

- Source defaults to the matching preference source or `codeforces`.
- Count defaults to preference `daily_problem_count`, then `3`.
- Difficulty defaults to target rating `1200 + target_difficulty_delta`, with a 500-point range around the target.
- Tags default to preferred tags; blocked tags are excluded.
- Solved problems are excluded unless the preference or request allows them.

Problem candidates are ordered by distance from the target rating. If tag filtering produces no candidates, the selection retries without required tags. Generated sets are upserted by `(scope_type, scope_id, date)` and replace their items for that day.

## Leaderboards

Leaderboards are live SQL rollups over `submissions`.

- Accepted verdicts are `accepted`, `completed`, and `manual_solve`.
- Global leaderboards include users with at least one solve.
- Group leaderboards include active group members.
- Daily leaderboards score solves using `daily_set_items.points`.
- Division leaderboards currently reuse group leaderboard logic after verifying the division exists.

## Frontend Shape

The browser app in `web/static` is a single static page:

- `index.html` defines the main panels for identity, dailies, groups, leaderboards, problems, and accounts.
- `app.js` owns data loading, event handlers, API calls, and DOM rendering.
- `styles.css` defines the responsive grid and component styles.

Because assets are embedded, changes under `web/static` are compiled into the Go binary. During local development, `go run ./cmd/arcade` serves the latest files from a fresh build.

## Local-Build Limitations

The architecture intentionally leaves a few extension points for future work:

- There is no auth/session layer yet.
- External provider imports are stubs that update local metadata but do not fetch remote submissions.
- Division membership materialization is not connected.
- Leaderboard snapshot tables are present, but live queries are used today.
