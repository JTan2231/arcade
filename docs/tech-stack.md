# Tech Stack

Arcade is a small Go/Postgres web application. The backend serves JSON APIs and the static frontend from the same binary.

## Backend

- Language: Go `1.25.0`, as declared in `go.mod`.
- HTTP server: Go standard library `net/http`.
- Routing: standard `http.ServeMux` method/path patterns, registered in `internal/app/server.go`.
- JSON: standard library `encoding/json`; request decoding rejects unknown fields through `Decoder.DisallowUnknownFields`.
- Auth: email/password form auth with bcrypt password hashes and secure
  cookie-backed sessions stored in Postgres.
- Logging: standard library `log` during startup and `log/slog` for request and error logs.
- Shutdown: `cmd/arcade/main.go` listens for `SIGINT` and `SIGTERM`, then performs graceful HTTP shutdown.

## Database

- Database: PostgreSQL.
- Driver/pool: `github.com/jackc/pgx/v5` and `pgxpool`.
- Migrations: embedded SQL files in `internal/migrations`, applied automatically at startup.
- Migration tracking: `schema_migrations` stores applied migration filenames.
- PostgreSQL extension: `pgcrypto` is enabled by the initial migration for `gen_random_uuid()`.

## Frontend

- Static app: plain HTML, CSS, and JavaScript in `web/static`.
- Asset delivery: `web/static.go` embeds the static directory with Go `embed.FS`.
- Runtime: the frontend calls `/api/*` with `fetch`; there is no npm package manager, bundler, transpiler, or frontend build step.
- State model: `web/static/app.js` uses a small in-memory `state` object and DOM rendering helpers.

## Configuration

Configuration is loaded from environment variables in `internal/app/config.go`.

| Variable | Default | Purpose |
| --- | --- | --- |
| `ARCADE_ADDR` | `:8080` | HTTP listen address. |
| `ARCADE_DATABASE_URL` | `postgres://localhost:5432/arcade?sslmode=disable` | Postgres connection URL. |
| `DATABASE_URL` | unset | Fallback database URL when `ARCADE_DATABASE_URL` is unset. |

## Runtime Dependencies

At runtime Arcade needs:

- A reachable PostgreSQL database.
- Network access only if future provider integrations are added; the current local build does not call external coding platforms.

## Current Boundaries

- External account verification and sync endpoints update local status fields only.
- Leaderboards are computed live from submissions. Snapshot tables exist for future materialization.
- Division recomputation returns metadata and does not materialize user/division assignments in the local build.
