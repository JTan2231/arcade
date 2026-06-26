# Primitive Scenario Runtime

This document defines the e2e scenario runtime shape for Arcade.

The runtime is a generic interpreter for YAML-defined primitive operations. The
YAML is the scenario program. TypeScript owns execution mechanics only.
Playwright is the browser, HTTP, network, assertion, and artifact backend.

The runtime must not know Arcade product nouns such as account, group, feed,
catalog source, or post. Those concepts may appear only as data inside scenario
files: request paths, JSON payloads, accessible labels, visible text, and
captured variables.

## Goals

- Execute YAML scenarios as compositions of generic primitives.
- Keep setup, browser steps, network controls, and cleanup in the same primitive
  model.
- Run against the real Go server, embedded frontend assets, and disposable
  Postgres data.
- Manage server, browser, network, artifact, and database lifecycles.
- Leave no server process or temporary database running after execution.
- Make failure output point to the scenario file, phase, step index, original
  YAML snippet, trace, screenshot, and app logs.

## Non-Goals

- No scenario-specific TypeScript files.
- No product-specific fixture schema.
- No helper functions such as `createGroup`, `loginAs`, `createFeed`, or
  `createPost`.
- No imported frontend code or React component knowledge.
- No CSS selector based authoring as the normal path.
- No implicit business workflow hidden inside the runtime.

## Runtime Model

The runner owns the local application lifecycle unless a base URL is supplied.

```text
scenario.yaml
  -> parse and validate generic primitive document
  -> create disposable database
  -> build frontend assets
  -> start Go server with the disposable database URL
  -> wait for health
  -> create Playwright browser, context, page, and request clients
  -> execute before[] primitive steps
  -> execute steps[] primitive steps
  -> execute after[] primitive steps if present
  -> collect artifacts on failure
  -> close browser/context
  -> stop server
  -> drop disposable database
```

Lifecycle management is generic runner behavior. It is not an Arcade fixture
layer. The runner starts a process with configured environment variables,
waits for a health endpoint, and guarantees cleanup.

## Scenario Shape

Each scenario has named phases. Every phase is an ordered list of primitive
steps.

```yaml
name: scenario name

vars:
  email: owner@example.test
  password: password123

before:
  - request:
      method: POST
      path: /api/auth/signup
      json:
        display_name: Owner
        email: "{{email}}"
        password: "{{password}}"
        remember_me: false
      expectStatus: 200
      capture:
        owner_id: $.id

steps:
  - visit: /

  - within: Authentication
    fill:
      label: Email
      value: "{{email}}"

after:
  - request:
      method: POST
      path: /api/auth/logout
      client: browser
      expectStatus: 204
```

Supported top-level fields:

| Field | Required | Meaning |
| --- | --- | --- |
| `name` | yes | Human-readable scenario name. |
| `vars` | no | Static scenario variables available to interpolation. |
| `before` | no | Primitive setup steps. |
| `steps` | yes | Main scenario primitive steps. |
| `after` | no | Best-effort cleanup or verification steps. |

There is no special `setup` object. Setup is just primitive execution before the
main browser path.

## Step Contract

A step may contain generic metadata plus exactly one primitive operation.

Generic metadata:

| Field | Meaning |
| --- | --- |
| `id` | Optional step identifier for reporting. |
| `within` | Optional named landmark scope for browser locator primitives. |
| `timeout` | Optional step timeout override in milliseconds. |
| `acceptDialog` | Optional browser dialog acceptance attached to a click-like primitive. |

Primitive operation keys are mutually exclusive. If a step has zero or more than
one operation key, validation fails before any browser is launched.

Examples:

```yaml
- id: open_add_feed
  within: Feeds
  click:
    role: button
    name: Add feed
```

```yaml
- id: create_group
  request:
    method: POST
    path: /api/groups
    client: browser
    json:
      name: Morning Dojo
    expectStatus: 200
    capture:
      group_id: $.id
```

## Execution Context

The runtime maintains a context object during execution.

```text
baseURL
browser
context
page
request clients
variables
observed requests
network rules
artifact paths
current scenario/phase/step
```

Variables are populated from top-level `vars`, built-in tokens, and primitive
captures. Later steps may interpolate variables in strings.

```yaml
path: /api/groups/{{group_id}}/daily-feeds
```

Built-in values should be minimal and explicit:

| Token | Meaning |
| --- | --- |
| `{{today}}` | Local date as `YYYY-MM-DD`. |
| `{{yesterday}}` | Local date minus one day as `YYYY-MM-DD`. |
| `{{daysAgo:N}}` | Local date minus `N` days as `YYYY-MM-DD`. |

Unknown variables or tokens are validation/runtime errors with the scenario file
and step location.

## Primitive Set

The initial primitive set should be small and composable.

| Primitive | Backend | Purpose |
| --- | --- | --- |
| `request` | Playwright `APIRequestContext` | Make HTTP requests, assert status/body, capture values. |
| `visit` | Playwright `Page` | Navigate to an app path or URL. |
| `click` | Playwright locator | Click an accessible control. |
| `fill` | Playwright locator | Fill a labelled control. |
| `select` | Playwright locator | Select an option in a labelled select. |
| `check` | Playwright locator | Check a labelled checkbox. |
| `uncheck` | Playwright locator | Uncheck a labelled checkbox. |
| `wait` | Playwright page/locator | Wait for time, text, request, or load state. |
| `expectVisible` | Playwright assertion | Assert visible text or accessible element. |
| `expectHidden` | Playwright assertion | Assert hidden text or accessible element. |
| `expectEnabled` | Playwright assertion | Assert accessible control is enabled. |
| `expectDisabled` | Playwright assertion | Assert accessible control is disabled. |
| `expectValue` | Playwright assertion | Assert labelled control value. |
| `expectPressed` | Playwright assertion | Assert `aria-pressed` state. |
| `expectStatus` | Playwright assertion | Assert visible status text. |
| `expectAlert` | Playwright assertion | Assert visible alert text. |
| `holdRequest` | Playwright routing | Hold matching browser requests. |
| `releaseRequest` | Playwright routing | Release held browser requests. |
| `fulfillRequest` | Playwright routing | Fulfill matching browser requests. |
| `failRequest` | Playwright routing | Abort matching browser requests. |
| `expectRequest` | Playwright routing | Assert a browser request was observed. |

Adding a primitive means adding generic capability, not a product shortcut. A
new primitive should be useful for many products, not just one Arcade workflow.

## HTTP Requests

The `request` primitive is the generic way to encode setup and API-level
interactions.

```yaml
- request:
    id: create_source
    client: browser
    method: POST
    path: /api/groups/{{group_id}}/catalog-sources
    headers:
      X-Example: value
    json:
      name: Add Feed Source
      template: https://example.test/{slug}
      fields: []
      items:
        - title: Alpha Warmup
          data:
            slug: alpha-warmup
    expectStatus: 200
    capture:
      source_id: $.id
```

Supported request fields:

| Field | Meaning |
| --- | --- |
| `id` | Optional request identifier for reporting. |
| `client` | `isolated` or `browser`; default `isolated`. |
| `method` | HTTP method. |
| `path` | Path relative to `baseURL`, or absolute URL when explicitly allowed. |
| `headers` | String header map. |
| `json` | JSON request body. |
| `body` | Raw string request body. |
| `form` | Form fields. |
| `expectStatus` | Expected numeric response status. |
| `expectJson` | Optional partial JSON body expectation. |
| `capture` | Map of variable name to response selector. |

`client: browser` uses the Playwright browser context request client so cookies
set by the response become available to page navigation and browser actions.
This is how a scenario can log in through HTTP without the runtime knowing what
login means.

`client: isolated` uses a separate request context and does not affect browser
cookies.

Exactly one of `json`, `body`, or `form` may be present.

## Captures

Captures save response data into the runtime variable store.

```yaml
capture:
  group_id: $.id
  first_item_title: $.items[0].title
```

The selector language should be deliberately small:

- `$` for the full JSON response.
- `$.field` for object fields.
- `$.items[0]` for array indexes.
- Dot paths and array indexes may be composed.

If a selector does not match, the step fails. Silent missing captures make later
steps ambiguous.

Captured values must be scalar when interpolated into strings. Capturing objects
or arrays is allowed only for later structured comparison primitives.

## Browser Locators

Browser primitives operate through accessible user-facing surfaces.

Landmark scoping:

```yaml
- within: Add feed
  fill:
    label: Name
    value: Warmup Practice
```

The runtime resolves `within` by accessible landmark names:

- named `region` landmarks by default;
- named dialogs for modal surfaces;
- named `main` landmarks for app shells;
- status and alert roles for status-specific primitives.

Click targets use role and accessible name:

```yaml
click:
  role: button
  name: Create
  exact: true
```

Form targets use labels:

```yaml
fill:
  label: Email
  value: owner@example.test
```

Raw selectors are not part of the normal primitive set. If an escape hatch is
ever added, it must require a reason and remain visibly unsafe in YAML.

## Network Controls

Network primitives model browser environment behavior. They are generic and may
be used to test races, retries, stale responses, or frontend error handling.

```yaml
- holdRequest:
    id: sources
    method: GET
    path: /api/groups/*/catalog-sources
    times: 1

- within: Feeds
  click:
    role: button
    name: Add feed

- expectRequest:
    id: sources

- releaseRequest: sources
```

Request path matching may support `*` wildcards. Matching is against the browser
request path, not the full URL, unless an explicit full-URL matcher is added.

Network primitives should observe and control browser traffic only. They should
not become product-level workflow shortcuts.

## Example: Complex Scenario

This example creates data through generic HTTP requests, captures generated IDs,
drives the UI through accessible controls, and controls a browser request race.

```yaml
name: add feed loads sources, previews, validates, and creates

vars:
  email: add-feed-owner@example.test
  password: password123

before:
  - request:
      id: signup_owner
      method: POST
      path: /api/auth/signup
      json:
        display_name: Add Feed Owner
        email: "{{email}}"
        password: "{{password}}"
        remember_me: false
      expectStatus: 200
      capture:
        owner_id: $.id

  - request:
      id: login_owner
      client: browser
      method: POST
      path: /api/auth/login
      json:
        email: "{{email}}"
        password: "{{password}}"
        remember_me: false
      expectStatus: 200

  - request:
      id: create_group
      client: browser
      method: POST
      path: /api/groups
      json:
        name: Add Feed Dojo
      expectStatus: 200
      capture:
        group_id: $.id

  - request:
      id: create_source
      client: browser
      method: POST
      path: /api/groups/{{group_id}}/catalog-sources
      json:
        name: Add Feed Source
        template: https://example.test/{slug}
        fields: []
        items:
          - title: Alpha Warmup
            data:
              slug: alpha-warmup
          - title: Beta Warmup
            data:
              slug: beta-warmup
      expectStatus: 200
      capture:
        source_id: $.id

steps:
  - visit: /

  - holdRequest:
      id: sources
      method: GET
      path: /api/groups/*/catalog-sources
      times: 1

  - within: Feeds
    click:
      role: button
      name: Add feed

  - expectRequest:
      id: sources

  - within: Add feed
    expectDisabled:
      role: combobox
      name: Source

  - within: Add feed
    expectDisabled:
      role: button
      name: Create

  - releaseRequest: sources

  - within: Add feed
    expectEnabled:
      role: combobox
      name: Source

  - within: Add feed
    expectEnabled:
      role: button
      name: Create

  - within: Add feed
    click:
      role: button
      name: Preview

  - within: Add feed
    expectAlert:
      text: Name is required

  - within: Add feed
    fill:
      label: Name
      value: Warmup Practice

  - within: Add feed
    fill:
      label: Item count
      value: 1

  - within: Add feed
    click:
      role: button
      name: Preview

  - within: Preview
    expectVisible:
      text: Alpha Warmup

  - within: Add feed
    click:
      role: button
      name: Create

  - expectStatus:
      text: Feed created

  - within: Feeds
    expectPressed:
      role: button
      name: Warmup Practice
      pressed: true

  - within: Selected feed output
    expectVisible:
      text: Warmup Practice
```

The runtime does not know that the requests created a user, session, group, or
catalog source. It only executed requests, captured IDs, interpolated variables,
observed network traffic, and drove accessible browser controls.

## Validation Rules

Validation happens before execution where possible.

- Scenario files must be valid YAML objects.
- `name` and `steps` are required.
- `before`, `steps`, and `after` must be arrays when present.
- Each step must have exactly one primitive operation key.
- Primitive schemas reject unknown fields.
- Request bodies allow only one body mode: `json`, `body`, or `form`.
- Variable names in `vars` and `capture` must be valid identifiers.
- Duplicate capture names are allowed only when explicitly marked as overwrite.
- Locator primitives must use role/name or label contracts, not CSS selectors.

Runtime failures should include the scenario file, phase, step index, step ID
when present, original step YAML, and underlying Playwright or HTTP error.

## Implementation Boundaries

The TypeScript package should be organized around generic runtime concerns:

```text
test/
  scenarios/
    *.yaml
  src/
    cli.ts
    scenarioSchema.ts
    runtime.ts
    context.ts
    interpolation.ts
    jsonSelectors.ts
    primitives/
      request.ts
      browser.ts
      assertions.ts
      network.ts
    appServer.ts
    database.ts
    artifacts.ts
```

Files under `primitives/` implement generic primitive behavior only.

There should be no file whose job is to translate Arcade fixture nouns into API
calls. If a scenario needs data, it uses `request` primitives with explicit
paths and payloads.

## Acceptance Criteria

The primitive runtime design is satisfied when:

- Existing e2e scenarios can be expressed without product-specific setup
  objects.
- The TypeScript runtime contains no Arcade business nouns except in comments,
  test examples, or path strings used by generic fixtures.
- Adding a new scenario normally requires only a YAML file.
- Adding a TypeScript primitive requires a generic capability justification.
- Server and database cleanup still happens on success, failure, and interrupt.
- CI can validate scenario schema/type checks and run the browser suite through
  `ci.sh`.
