# Arcade

Arcade is a Go/Postgres app for practice workflows.
The Go server runs migrations on startup, exposes JSON APIs under `/api`, and
serves the built React frontend from `/`.

## Run

```sh
createdb arcade
(cd web/frontend && bun ci && bun run build)
go run ./cmd/arcade
```

Then open:

```txt
http://localhost:8080
```

## Configuration

```sh
ARCADE_ADDR=:8080
ARCADE_DATABASE_URL=postgres://localhost:5432/arcade?sslmode=disable
```

`PORT` is also accepted when `ARCADE_ADDR` is not set. `DATABASE_URL` is also
accepted when `ARCADE_DATABASE_URL` is not set.

## Deploy

The root `railpack.json` makes Railway's Railpack builder install Bun.
`railway.toml` selects the Railpack builder, builds the React frontend, compiles
`./cmd/arcade`, and pins the start command and healthcheck. Attach a Railway
Postgres database so `DATABASE_URL` is available.

To inspect production data without allowing accidental writes, use the read-only
Postgres wrapper with a production URL:

```sh
DATABASE_URL='postgres://...' scripts/prod-db-readonly.sh
```

The wrapper also accepts `psql` arguments, for example:

```sh
DATABASE_URL='postgres://...' scripts/prod-db-readonly.sh -c 'select now();'
```

To replace local group/feed/source data with production data, use the mirror
utility. It runs local migrations, truncates local app data, and copies the
production graph needed by groups, daily feeds, catalog sources/items, posts,
tags, metrics, friendships, and memberships. It does not copy production
sessions, and it sanitizes user email/password/friend-code fields by default:

```sh
ARCADE_PROD_DATABASE_URL='postgres://...' scripts/mirror-prod-to-local.sh
```

Pass `-dry-run` to inspect row counts first. Pass `-local-password` or set
`ARCADE_MIRROR_LOCAL_PASSWORD` to give every mirrored user a shared local
password.

## Frontend Development

Editable frontend source lives in `web/frontend`. Vite builds production assets
into `web/static`, which is embedded by the Go binary.

To run the API server and Vite dev server together:

```sh
./run.sh
```

Open the Vite URL printed by the script. It proxies `/api` to the Go backend.

Run the backend:

```sh
go run ./cmd/arcade
```

Run the React dev server:

```sh
cd web/frontend
bun run dev
```

The Vite dev server proxies `/api` to `http://localhost:8080`.

## Notes

- Postgres migrations live in `internal/migrations`.
- React source lives in `web/frontend`.
- Generated static assets live in `web/static` and are embedded into the Go binary.
- Sign up in the browser to create the first local account.
