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
  static/                Generated Vite build output embedded by Go.
  frontend/              React, TypeScript, Vite, and Bun frontend source.
```

## Startup Flow

1. `cmd/arcade/main.go` creates a signal-aware root context.
2. `app.LoadConfig()` reads environment configuration and defaults.
3. `pgxpool.New()` creates the Postgres connection pool and `Ping()` verifies connectivity.
4. `migrations.Run()` applies embedded SQL migrations in filename order.
5. `app.NewServer()` builds the embedded static file handler from the latest frontend build and registers routes.
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
- Identity: `/api/me` profile lookup and updates.
- Catalog: group-owned catalog sources and items.
- Groups: groups and group memberships.
- Divisions: group-scoped divisions and optional user-rating rules.
- Dailies: group-owned daily feed definitions and deterministic feed outputs.

## Domain Model

The main persisted entities are:

- `users`: local users with email/password credentials.
- `user_sessions`: hashed session tokens for secure cookie-backed login.
- `catalog_sources` and `catalog_items`: group-owned source templates and rows
  for group daily feeds.
- `groups` and `group_memberships`: social scopes and roles.
- `divisions` and `division_rules`: group-scoped division metadata.
- `group_daily_feeds`: durable group-owned daily feed definitions.
- `group_daily_feed_instances` and `group_feed_posts`: durable member posts
  attached to one feed on one date.

## Daily Feeds

Daily feed management and output generation live in
`internal/app/handlers_daily_feeds.go`.

The current daily feed model follows these rules:

- Groups are the delivery and permission boundary.
- Owners and admins manage `group_daily_feeds`.
- Active members read enabled feeds in their groups; owners and admins can also
  inspect disabled feeds.
- Feed kinds are `catalog_daily` and `daily_thread`.
- New groups receive one enabled `daily_thread` feed by default. There can be
  only one daily thread per group; it can be deleted and created again later.
- Catalog daily outputs are computed on demand from `catalog_sources`,
  `catalog_source_fields`, `catalog_items`, `group_daily_feeds`, and
  `feed_rule_filters`.
- Catalog selection is deterministic by feed, date, source, filters, and
  catalog item set.
- Catalog outputs render from source templates. HTTPS renders become links;
  other renders become text prompts. Outputs are not persisted.
- Member posts are stored separately from generated output. The first post for a
  feed/date lazily creates a `group_daily_feed_instances` row, and each active
  member can own at most one post on that instance.

The generator uses feed configuration and catalog item data only.

## Frontend Shape

The browser app source lives in `web/frontend`:

- `src/App.tsx` owns session bootstrap, top-level state, auth transitions,
  group selection, feed loading, and toast messages.
- `src/api.ts` wraps same-origin JSON requests to `/api/*` and preserves the
  backend `{ "error": "message" }` error contract.
- `src/components` contains the auth, group list, dashboard, and toast views.
- `src/styles.css` defines the responsive grid and component styles.

Vite builds generated HTML, CSS, and JavaScript into `web/static`, which remains
the Go embed target. Do not hand-edit generated files in `web/static`; change
the React source and run `cd web/frontend && bun run build`.

The main group surface loads `/api/groups/{group_id}/daily-feeds` and
`/api/groups/{group_id}/daily-feeds/{feed_id}/today` or
`/api/groups/{group_id}/daily-feeds/{feed_id}/outputs/{date}`. Owners and
admins can toggle feed enabled state through
`PATCH /api/groups/{group_id}/daily-feeds/{feed_id}`. The same surface exposes
an owner/admin-only Add feed flow backed by group catalog sources, source field
metadata, `POST /api/groups/{group_id}/daily-feeds/preview`, and
`POST /api/groups/{group_id}/daily-feeds`.

Because assets are embedded, a production-style local run should build the
frontend before starting Go:

```sh
(cd web/frontend && bun ci && bun run build)
go run ./cmd/arcade
```

## Local-Build Limitations

The architecture intentionally leaves a few extension points for future work:

- Division membership materialization is not connected.
