# Testing

Arcade's browser and API scenario tests live under `test/`. The setup is a
small TypeScript harness that uses Playwright as a browser automation library,
but it does not run scenario files through Playwright's normal test-file
runner. YAML scenario files describe user-visible workflows, setup requests, and
managed-database setup SQL; `test/src/cli.ts` loads those files, starts the app
when needed, and executes each scenario through the custom runner.

## Directory Layout

```text
test
  package.json            Bun scripts and TypeScript test dependencies.
  playwright.config.ts    Playwright tool defaults for Chromium and artifacts.
  tsconfig.json           Strict no-emit TypeScript checking for the harness.
  scenarios/*.yaml        Declarative browser/API scenarios.
  src/cli.ts              Scenario CLI entrypoint.
  src/appServer.ts        Local app build, process, health, and shutdown.
  src/database.ts         Disposable Postgres database creation and cleanup.
  src/scenarioSchema.ts   YAML schema, validation, and typed scenario model.
  src/scenarioRunner.ts   Browser lifecycle, phase execution, and artifacts.
  src/actions.ts          Browser actions backed by accessible locators.
  src/assertions.ts       Browser assertions backed by Playwright expect.
  src/networkControls.ts  Request observation, holding, fulfilling, and failure.
  src/primitives/         Non-UI primitives such as direct API requests and setup SQL.
```

`test/artifacts/` and `test/node_modules/` are generated local state and are
ignored by Git.

## Execution Modes

The primary command is:

```sh
cd test
bun run e2e
```

`bun run scenario` is an alias for the same CLI. With no scenario arguments, the
CLI discovers all `test/scenarios/*.yaml` and `*.yml` files, sorts them by
filename, and runs them serially. Individual scenarios can be passed as
arguments:

```sh
cd test
bun run e2e scenarios/auth.signup.yaml
```

By default the CLI owns the whole local environment. It builds the frontend,
creates a disposable database, starts `go run ./cmd/arcade` on a free
loopback port, waits for `/api/health`, runs all selected scenarios, and stops
the child process in a `finally` block. Server stdout and stderr are appended to
`test/artifacts/app-server.log`.

Use `--base-url` to run against an already-started server:

```sh
cd test
bun run e2e --base-url http://127.0.0.1:8080 scenarios/auth.signup.yaml
```

In this mode the harness does not build the frontend, create a disposable
database, start the app, or stop any server. The caller owns server lifecycle and
database isolation.

Other CLI options are:

- `--project NAME`: browser project, currently `chromium`, `firefox`, or
  `webkit`; default is `chromium`.
- `--artifacts-dir DIR`: failure artifact directory relative to the repo root;
  default is `test/artifacts`.

## App And Database Lifecycle

`src/appServer.ts` is the production-style local app launcher used when
`--base-url` is omitted.

1. It runs `bun run build` in `web/frontend` so Go embeds current frontend
   assets from `web/static`.
2. It asks `src/database.ts` for a disposable Postgres database. The base
   connection URL comes from `ARCADE_TEST_DATABASE_URL`, then
   `ARCADE_DATABASE_URL`, then
   `postgres://localhost:5432/arcade?sslmode=disable`.
3. It allocates an unused `127.0.0.1` port and starts `go run ./cmd/arcade` with
   `ARCADE_ADDR`, `ARCADE_DATABASE_URL`, and a default
   `ARCADE_CATALOG_IMPORT_TOKEN` of `arcade-test-token`.
4. It polls `/api/health` for up to 60 seconds before yielding the base URL to
   the runner.
5. Cleanup sends `SIGTERM` to the child process group, escalates to `SIGKILL`
   after 5 seconds if needed, closes the log stream, terminates remaining
   database sessions, and drops the disposable database.

The database helper creates databases through `psql` against the `postgres`
administrative database. This keeps scenario runs isolated without requiring
the app to know about test-only reset endpoints.

## Scenario Model

A scenario file is a strict YAML document with this shape:

```yaml
name: signup through the authentication panel

vars:
  email: ada@example.test

before:
  - request:
      method: POST
      path: /api/auth/signup
      json:
        display_name: Ada Lovelace
        email: "{{email}}"
        password: password123
      expectStatus: 201

steps:
  - visit: /

  - within: Authentication
    click:
      role: tab
      name: Signup

after:
  - request:
      method: POST
      path: /api/auth/logout
      expectStatus: 204
```

`name` and non-empty `steps` are required. `vars`, `before`, and `after` are
optional. Every step must contain exactly one primitive operation. The schema is
implemented with Zod in `src/scenarioSchema.ts`, which means malformed YAML,
unknown keys, duplicate captures, invalid roles, and mixed request bodies fail
before any browser work begins.

The runner executes phases in this order:

1. `before`: setup, usually direct API requests.
2. `steps`: the workflow under test.
3. `after`: cleanup or final API calls.

`after` still runs if `before` or `steps` fails. The first failure remains the
reported failure so cleanup errors do not hide the original problem.

## Variables And Interpolation

Scenario variables are stored in a runtime map. Initial values come from
`vars`, and request captures can add more values. Strings can interpolate
scalar values with `{{name}}`.

Built-in date tokens are:

- `{{today}}`
- `{{yesterday}}`
- `{{daysAgo:N}}`

Interpolation is applied to paths, labels, role names, text assertions, request
headers, request bodies, SQL statements, and JSON-like data. Captures can store
objects and arrays, but only scalar captured values can be interpolated into
later steps.

## Browser Primitives

UI primitives prefer accessible locators so tests exercise the same names and
roles users depend on:

- `visit`: navigate to a path.
- `click`: click one visible element by role and accessible name.
- `fill`: fill a visible control by label.
- `select`: select an option by label or value from a labeled control.
- `check` and `uncheck`: update labeled checkboxes.
- `wait`: wait by milliseconds, text visibility, or both.
- `expectVisible` and `expectHidden`: assert text or role targets.
- `expectPressed`: assert `aria-pressed`.
- `expectDisabled` and `expectEnabled`: assert control state for role targets.
- `expectValue`: assert the value of a labeled control.
- `expectStatus`: assert text in the page's `role="status"` region.
- `expectAlert`: assert a visible `role="alert"` containing text.

Most UI steps can include `within` to scope lookup to a named region, dialog,
main landmark, `status`, or `alert`. Role targets default to exact accessible
name matching; text targets default to substring matching.

`acceptDialog` can be attached to a `click` step to accept an expected browser
dialog and optionally match its message.

## Request Primitive

The `request` primitive uses Playwright's API request context. By default it
uses an isolated client with no browser cookies. Set `client: browser` when the
request should share the active browser context, for example to log in before a
browser workflow.

Supported request fields include:

- `method` and `path`.
- `headers`.
- one of `json`, `body`, or `form`.
- `expectStatus`.
- `expectJson` for partial JSON matching. Arrays match by prefix, and objects
  match only the specified keys.
- `capture` to store response values for later interpolation.

Captures use the small JSON selector syntax in `src/jsonSelectors.ts`: `$`,
`.field`, and `[index]`. Capture names must be valid identifiers, and replacing
an existing variable requires `overwrite: true`.

## SQL Primitive

The `sql` primitive runs an interpolated SQL statement through `psql` against
the disposable database owned by the harness. It is intended for setup state
that the public API cannot express. It is unavailable when scenarios run with
`--base-url`, because the caller owns the database in that mode.

## Network Controls

`src/networkControls.ts` lets scenarios make frontend race and failure cases
deterministic:

- `holdRequest`: pause matching browser network requests by method/path and
  optional `id`.
- `releaseRequest`: continue a previously held request.
- `fulfillRequest`: return a synthetic response.
- `failRequest`: abort a matching request.
- `expectRequest`: wait until a matching request has been observed.

Path matching supports `*` wildcards. `holdRequest` can set `times` so only the
first N matching requests are held. Observed requests keep the rule `id`, which
lets a later `expectRequest` or `releaseRequest` refer to a named request even
when the path is broad.

These controls only intercept browser page traffic. Direct `request` primitives
use API request contexts and do not pass through the page route handler.

## Failure Artifacts

For each scenario, the runner creates an artifact directory from the scenario
name and browser project:

```text
test/artifacts/<scenario-name>/<project>/
```

On failure it writes a full-page screenshot and Playwright trace named for the
failed phase and step. The CLI error report includes the scenario name, file,
browser project, total step count, failed phase, one-based step number, optional
step id, YAML snippet for the failed step, trace path, screenshot path, and app
log path when the harness started the app.

Tracing starts before scenario phases and is retained only when the scenario
fails.

## CI Integration

The root `ci.sh` has two testing-related targets:

- `./ci.sh scenarios`: installs `test` dependencies with `bun ci`, checks
  Prettier formatting, and runs `tsc --noEmit`.
- `./ci.sh e2e` or `./ci.sh test`: runs the scenario checks first, then runs
  `cd test && bun run e2e`.

The default `./ci.sh` target also runs frontend and backend validation before
scenario checks and E2E, then regenerates generated docs.

Local `ci.sh` invocations run in an isolated temporary worktree by default. The
outer script snapshots `HEAD` plus the current tracked and untracked non-ignored
working tree contents, checks out that snapshot as a detached worktree, and then
runs the checks there with `ARCADE_CI_IN_WORKTREE=1`. This keeps dependency
installs, frontend builds, scenario artifacts, and other generated files from
mutating or conflicting with the active checkout, including while `./run.sh` is
running. Set `ARCADE_CI_IN_WORKTREE=1` explicitly only when you need to run the
checks directly in the current checkout for debugging.

E2E requires `go`, `bun`, `psql`, a reachable Postgres server, and installed
Playwright browser binaries for the chosen project.

## Adding Coverage

Prefer adding YAML scenarios when the behavior can be expressed with the
existing primitives. Use API requests in `before` for setup that is not the
subject of the test, and use browser steps for the user workflow being verified.
Keep assertions tied to accessible roles, labels, status regions, and alerts so
the scenarios stay aligned with the UI contract.

Add or extend TypeScript primitives only when several scenarios need a behavior
that cannot be expressed cleanly in YAML. New primitives should be added in four
places: the Zod schema, the `operationKeys` list, the dispatcher in
`scenarioRunner.ts`, and the module that implements the action or assertion.
Run `./ci.sh scenarios` after changing the harness, and `./ci.sh e2e` when the
change affects runtime behavior.
