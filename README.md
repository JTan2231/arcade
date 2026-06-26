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

## Frontend Development

Editable frontend source lives in `web/frontend`. Vite builds production assets
into `web/static`, which is embedded by the Go binary.

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
