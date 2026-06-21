# Arcade

Arcade is a Go/Postgres app for practice workflows.
The Go server runs migrations on startup, exposes JSON APIs under `/api`, and
serves a static HTML/CSS/JavaScript app from `/`.

## Run

```sh
createdb arcade
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

`DATABASE_URL` is also accepted when `ARCADE_DATABASE_URL` is not set.

## Notes

- Postgres migrations live in `internal/migrations`.
- Static assets live in `web/static` and are embedded into the Go binary.
- Sign up in the browser to create the first local account.
- Leaderboards are live derived views from submissions; snapshot tables exist
  for later materialization.
