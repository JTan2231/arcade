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
- Friends: friend-code rotation, friend requests, accepted friends, and
  friend-gated group invite helpers.
- Catalog: group-owned catalog sources and items.
- Catalog imports: admin-only normalized JSONL uploads through a shared bearer
  token.
- Groups: groups and group memberships.
- Divisions: group-scoped divisions and optional user-rating rules.
- Dailies: group-owned daily feed definitions and deterministic feed outputs.
- Public reads: signed-out-safe group, feed, and post pages backed by
  `/api/public/...` routes and visibility checks.
- Evidence formats: group-owned post text validation formats, immutable
  versions, and feed assignment.
- Post tags: group-owned feed post tag definitions and post tag attachments.
- Feed metrics: feed-owned score definitions, judged score writes, and
  computed leaderboards.

## Domain Model

The main persisted entities are:

- `users`: local users with email/password credentials.
- `user_friendships`: friend requests and accepted mutual friendships.
- `user_sessions`: hashed session tokens for secure cookie-backed login.
- `catalog_sources` and `catalog_items`: group-owned or global source templates
  and rows for group daily feeds.
- `groups` and `group_memberships`: social scopes and roles.
- `divisions` and `division_rules`: group-scoped division metadata.
- `group_daily_feeds`: durable group-owned daily feed definitions.
- `group_evidence_formats` and `group_evidence_format_versions`: group-owned
  post evidence validation formats and immutable constraint versions.
- `group_daily_feed_instances` and `group_feed_posts`: durable member posts
  attached to one feed on one date.
- `group_post_tags` and `group_feed_post_tags`: group-managed post metadata
  definitions and durable tag attachments.
- `group_daily_feed_metrics` and `group_daily_feed_metric_judgments`:
  feed-owned system or judged score definitions and persisted human judgments.

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
  catalog item set. When an owner or admin refreshes the current output, the
  refreshed feed/date stores a generation seed in
  `group_daily_feed_generations`, and that seed becomes part of the deterministic
  selection key for that feed/date only.
- Feed cadence changes insert schedule-version history. The current schedule
  starts at the moment of the change, while historical output lookups resolve
  the schedule version active for the requested date.
- Catalog outputs render from source templates. HTTPS renders become links;
  other renders become text prompts. Outputs are not persisted.
- Global catalog sources are available to every group for catalog daily feeds,
  while group-owned sources remain mutable through that group's admin catalog
  APIs.
- Member posts are stored separately from generated output. The first post for a
  feed/date lazily creates a `group_daily_feed_instances` row, and each active
  member can own at most one post on that instance. New posts validate
  normalized `evidence_text` against the feed's assigned evidence format active
  version, and existing posts keep the exact version used at submission time.
  Feed post read responses are hydrated with attached group post tags ordered by name,
  including archived tags that remain attached to historical posts.
- Owners and admins can reroll the current catalog output with
  `POST /api/groups/{group_id}/daily-feeds/{feed_id}/today/refresh`. Refreshes
  are rejected for daily thread feeds and for feed dates that already have
  non-deleted member posts.
- Group visibility controls public reads for the group, its enabled feeds, and
  non-deleted posts. Authenticated active members continue reading private group
  content through member routes, while public routes return 404 for private
  groups.
- Group post tags are a group-managed vocabulary. Owners and admins create,
  rename, archive, and unarchive tag definitions under
  `/api/groups/{group_id}/post-tags`; post authors can attach active tags to
  their own existing posts, and owners/admins can attach active tags to any
  existing post in the group. Arcade creates no default tags.

The generator uses feed configuration and catalog item data only.

## Feed Metrics

Feed metric management and leaderboard generation live in
`internal/app/handlers_feed_metrics.go`.

Metric routes sit under a selected group daily feed:

- `/api/groups/{group_id}/daily-feeds/{feed_id}/metrics`
- `/api/groups/{group_id}/daily-feeds/{feed_id}/metrics/{metric_id}`
- `/api/groups/{group_id}/daily-feeds/{feed_id}/metrics/{metric_id}/leaderboard`
- `/api/groups/{group_id}/daily-feeds/{feed_id}/metrics/{metric_id}/judgments`
- `/api/groups/{group_id}/metric-judgments/{judgment_id}`

Owners and admins create, update, and delete metric definitions. Active group
members can read metrics and leaderboards for feeds they can see. Owners and
admins can judge other members' non-deleted posts for judged metrics; the
backend rejects self-judgment and posts outside the metric feed.

System metrics are implemented through a curated Go registry instead of
user-authored formulas. The registry owns allowed aggregations, default
display names, rankability, ranking direction, and computation functions for
`post_count`, `average_post_length_words`, `missed_days`, `current_streak`, and
`typical_posting_window`. Leaderboards compute across the feed's lifetime, from
the feed creation date through the current date in the feed schedule timezone.
Current streak counts consecutive scheduled outputs where the member posted
while that output was the latest output, so retroactive posts to older outputs do
not repair or extend a streak.
Judged metric values are persisted separately and aggregated from
`group_daily_feed_metric_judgments`.

## Frontend Shape

The browser app source lives in `web/frontend`:

- `src/App.tsx` adapts the top-level XState machine snapshot to React
  components, subscribes to invoked workflow actors, and sends user-intent
  events to the actor that owns each workflow.
- `src/machines/appMachine.ts` owns session bootstrap, auth transitions,
  logout, current user state, unauthorized recovery, and toast messages.
- `src/machines/dashboardMachine.ts` owns authenticated workspace state:
  groups, group selection, feed loading/selection, output and post loading,
  group post tag loading/mutations, feed toggling, post mutations, feed metric
  loading/selection, leaderboard loading, metric mutations, and judged score
  saves.
- `src/machines/addFeedMachine.ts` owns the Add Feed dialog remote workflow:
  source loading, preview, creation, and dialog-scoped errors.
- `src/api.ts` wraps same-origin JSON requests to `/api/*` and preserves the
  backend `{ "error": "message" }` error contract. Endpoint calls originate
  from invoked machine actors.
- `src/cache` defines the in-memory frontend query cache, cached API query
  definitions, and invalidation helpers. See `docs/frontend-cache.md` for the
  cache contract.
- `src/components` contains the auth, group list, dashboard, and toast views.
- The workspace includes a friends panel for friend-code sharing, request
  management, accepted friends, and pending group invite responses. The
  selected group dashboard exposes friend-gated invite candidates for active
  members.
- The selected feed dashboard includes a metric and leaderboard section. Judged
  metrics show prompt-driven score controls on post cards for group owners and
  admins.
- `src/styles.css` defines the responsive grid and component styles.

Vite builds generated HTML, CSS, and JavaScript into `web/static`, which remains
the Go embed target. Do not hand-edit generated files in `web/static`; change
the React source and run `cd web/frontend && bun run build`.

The main group surface loads `/api/groups/{group_id}/daily-feeds`,
`/api/groups/{group_id}/post-tags`, and
`/api/groups/{group_id}/daily-feeds/{feed_id}/today` or
`/api/groups/{group_id}/daily-feeds/{feed_id}/outputs/{date}`. Owners and
admins request archived tag definitions for the tag manager and can toggle feed
enabled state through
`PATCH /api/groups/{group_id}/daily-feeds/{feed_id}`. Feed settings also patch
the current schedule when owners or admins change cadence. The same surface
exposes an owner/admin-only Add feed flow backed by group catalog sources,
source field metadata, `POST /api/groups/{group_id}/daily-feeds/preview`, and
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
