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
5. `app.NewServer()` builds the embedded static file handler and registers routes.
6. `http.Server` serves `server.Routes()` and shuts down gracefully on `SIGINT` or `SIGTERM`.

## Request Flow

```text
Browser
  -> embedded static assets from /
  -> fetch('/api/...') JSON requests
  -> auth middleware loads session user for protected /api routes
  -> net/http ServeMux
  -> internal/app handler
  -> pgxpool query or transaction
  -> JSON response or structured error
```

Routes are grouped by resource in `Server.Routes()`:

- Auth: signup, login, logout, and session bootstrap.
- Identity: `/api/me`, preferences, and external accounts.
- Catalog: sources and problems.
- Groups: groups and group memberships.
- Divisions: group-scoped divisions and division rules.
- Dailies: group-owned daily feed definitions and deterministic feed outputs,
  plus legacy daily set lookup and daily-set leaderboards.
- Submissions: manual solves and local sync markers.
- Leaderboards: global, group, division, and daily-set views.

## Domain Model

The main persisted entities are:

- `users`: local users with email/password credentials.
- `user_sessions`: hashed session tokens for secure cookie-backed login.
- `problem_sources`: coding platforms such as Codeforces, AtCoder, and Advent of Code.
- `problems` and `problem_tags`: catalog entries, ratings, URLs, and tags.
- `catalog_sources` and `catalog_items`: group-owned source templates and rows
  for group daily feeds.
- `external_accounts`: a user's platform handles and local sync metadata.
- `user_preferences` and `user_preference_tags`: daily generation defaults.
- `groups` and `group_memberships`: social scopes and roles.
- `divisions`, `division_rules`, and `division_rule_tags`: group-scoped daily selection constraints.
- `group_daily_feeds`: durable group-owned daily feed definitions.
- `daily_sets` and `daily_set_items`: legacy generated practice sets and their ordered problems.
- `submissions`: accepted/manual solves and other verdicts.
- `leaderboard_snapshots` and `leaderboard_snapshot_rows`: reserved for future materialized leaderboards.

## Daily Feeds

Daily feed management and output generation live in
`internal/app/handlers_daily_feeds.go`.

The current daily feed model follows these rules:

- Groups are the delivery and permission boundary.
- Owners and admins manage `group_daily_feeds`.
- Active members read only enabled feeds whose audience they match.
- Feed kinds are `catalog_daily` and `daily_thread`.
- New groups receive one enabled `daily_thread` feed by default. There can be
  only one daily thread per group; it can be deleted and created again later.
- Catalog daily outputs are computed on demand from feed rules, `catalog_items`,
  and `catalog_sources`.
- Catalog selection is deterministic by feed, date, block, and catalog item.
- Catalog outputs render from source templates. HTTPS renders become links;
  other renders become text prompts. Outputs are not persisted.

The generator does not use the requesting user's preferences or solved history.

Legacy daily-set generation remains in `internal/app/handlers_dailies.go` for
older `/api/me/daily`, `/api/*/dailies/generate`, and daily-set lookup routes.

## Leaderboards

Leaderboards are live SQL rollups over `submissions`.

- Accepted verdicts are `accepted`, `completed`, and `manual_solve`.
- Global leaderboards include users with at least one solve.
- Group leaderboards include active group members.
- Legacy daily-set leaderboards score solves using `daily_set_items.points`.
- Division leaderboards currently reuse group leaderboard logic after verifying the division exists.

## Frontend Shape

The browser app in `web/static` is a single static page:

- `index.html` defines the auth forms and main panels for group setup,
  leaderboards, problems, and accounts.
- `app.js` owns data loading, event handlers, API calls, and DOM rendering.
- `styles.css` defines the responsive grid and component styles.

The main group surface loads `/api/groups/{group_id}/catalog-sources`,
`/api/groups/{group_id}/daily-feeds`, and `/api/me/daily-feed-outputs`.
Creating a catalog daily feed guides owners/admins through source creation or
preset import, previews `/api/groups/{group_id}/daily-feeds/preview`, then
posts the enabled feed definition to `/api/groups/{group_id}/daily-feeds`.

Because assets are embedded, changes under `web/static` are compiled into the Go binary. During local development, `go run ./cmd/arcade` serves the latest files from a fresh build.

## Local-Build Limitations

The architecture intentionally leaves a few extension points for future work:

- External provider imports are stubs that update local metadata but do not fetch remote submissions.
- Division membership materialization is not connected.
- Leaderboard snapshot tables are present, but live queries are used today.
