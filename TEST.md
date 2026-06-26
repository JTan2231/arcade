# Scenario Test Harness Design

This document proposes a generic Playwright scenario harness for Arcade. The
harness is a separate TypeScript package from the React frontend and treats the
application as a browser-rendered product, not as imported frontend code.

## Goals

- Execute scenario files that describe a path through the UI.
- Keep scenario steps generic: click, fill, select, check, expect, and wait.
- Scope every UI action through stable landmarks instead of brittle selectors.
- Avoid domain-specific verbs such as `selectGroup` or `createPost` in scenario
  files.
- Run against the real Go server, embedded frontend assets, and disposable
  Postgres data.
- Leave no development servers or test databases running after execution.

## Non-Goals

- Do not import React components, frontend helpers, or frontend build internals.
- Do not expose CSS selectors as the normal scenario authoring interface.
- Do not make Playwright assertions depend on React component names.
- Do not replace Go unit tests or API handler tests.
- Do not encode product business actions as harness actions.

## Package Shape

The test harness should live outside `web/frontend`:

```text
test/
  package.json
  tsconfig.json
  playwright.config.ts
  scenarios/
    auth.signup.yaml
    groups.create.yaml
    feeds.posts.yaml
    stale.group-switch.yaml
  src/
    cli.ts
    scenarioSchema.ts
    scenarioRunner.ts
    landmarks.ts
    actions.ts
    assertions.ts
    appServer.ts
    database.ts
    networkControls.ts
    fixtures.ts
```

The package can use Bun as its script runner for consistency with the existing
frontend toolchain, but it should have its own `package.json` and lockfile. It
should not import files from `web/frontend/src`.

Expected dependencies:

```text
@playwright/test
typescript
tsx
zod
yaml
```

`zod` validates scenario files before execution. `yaml` keeps scenario files
readable for review. `tsx` can run the TypeScript CLI without a compile step.

## Runtime Model

The harness owns the local app lifecycle for each run:

1. Create a disposable Postgres database.
2. Ensure frontend assets are built into `web/static`.
3. Start `go run ./cmd/arcade` with:
   - `ARCADE_ADDR=127.0.0.1:<free-port>`
   - `ARCADE_DATABASE_URL=<disposable-db-url>`
   - `ARCADE_CATALOG_IMPORT_TOKEN=<test-token>`
4. Wait for `GET /api/health`.
5. Execute requested scenario files with Playwright.
6. Stop the Go process.
7. Drop the disposable database.

Playwright `webServer` can manage the Go process, but a custom global setup is
likely cleaner because the harness also needs database creation and cleanup.

The root validation entrypoint should remain `./ci.sh`. If this suite is added
to CI, `ci.sh` should get an explicit target:

```sh
./ci.sh test
```

or a narrower name:

```sh
./ci.sh e2e
```

## Scenario Philosophy

Scenario files should describe browser operations in product-visible terms. They
should not describe implementation details.

Good:

```yaml
steps:
  - within: Authentication
    click:
      role: button
      name: Signup

  - within: Authentication
    fill:
      label: Email
      value: ada@example.test

  - within: Groups
    click:
      role: button
      name: Morning Dojo
```

Avoid:

```yaml
steps:
  - selectGroup:
      name: Morning Dojo

  - click:
      selector: ".groups-panel .row:nth-child(2)"
```

The first avoided example hides app behavior in a domain-specific harness verb.
The second ties the scenario to DOM shape instead of UI meaning.

## Landmark Contract

A landmark is a stable named area of the rendered UI. The scenario runner finds
the landmark first, then performs actions inside it.

The current frontend already has several usable landmarks:

| Name | Current DOM source | Status |
| --- | --- | --- |
| `Feeds` | `section[aria-label="Feeds"]` | Ready |
| `Selected feed output` | `section[aria-label="Selected feed output"]` | Ready |
| `Add feed` | `role="dialog"` labelled by `Add feed` | Ready |
| `Filters` | `section[aria-label="Filters"]` | Ready |
| `Preview` | `section[aria-label="Preview"]` | Ready |
| `Posts` | `section[aria-label="Posts"]` | Ready |
| `status` | `role="status"` toast | Ready |
| `alert` | `role="alert"` error containers | Ready |

The current frontend should add a few landmarks before this harness becomes
pleasant to use:

```tsx
<section className="panel auth-panel" aria-label="Authentication">

<section className="panel groups-panel" aria-labelledby="groups-title">
  <h2 id="groups-title">Groups</h2>
</section>

<main className="layout group-layout" aria-label="Arcade workspace">
```

The harness should resolve landmarks by accessible role first:

```ts
function findLandmark(page: Page, name: string): Locator {
  return page.getByRole("region", { name });
}
```

Special cases are allowed for non-region landmarks:

```ts
if (name === "Add feed") {
  return page.getByRole("dialog", { name: "Add feed" });
}
```

The scenario format should use the same names users and reviewers see in the
interface.

## Action Vocabulary

The first version should keep the action vocabulary small.

### `visit`

Navigate to an app path.

```yaml
- visit: /
```

### `within`

Scope one action or assertion to a landmark.

```yaml
- within: Groups
  click:
    role: button
    name: Create group
```

### `click`

Click an accessible control by role and name.

```yaml
- within: Feeds
  click:
    role: button
    name: Daily Thread
```

Supported fields:

```yaml
role: button | link | tab | checkbox | combobox | textbox
name: string
exact: boolean # optional, default true
```

### `fill`

Fill a labelled control.

```yaml
- within: Authentication
  fill:
    label: Password
    value: password123
```

### `select`

Select an option in a labelled native select.

```yaml
- within: Selected feed output
  select:
    label: Date
    option: Today
```

The harness can support either `option` or `value`:

```yaml
select:
  label: Repeat
  value: "86400"
```

### `check` and `uncheck`

Set a labelled checkbox to a specific state.

```yaml
- within: Add feed
  uncheck:
    label: Active
```

### `expectVisible`

Assert visible text or an accessible element.

```yaml
- within: Posts
  expectVisible:
    text: Solved warmup set
```

or:

```yaml
- within: Feeds
  expectVisible:
    role: button
    name: Daily Thread
```

### `expectHidden`

Assert text or an accessible element is not visible.

```yaml
- within: Posts
  expectHidden:
    text: No posts yet.
```

### `expectPressed`

Assert a toggle-like button with `aria-pressed`.

```yaml
- within: Groups
  expectPressed:
    role: button
    name: Morning Dojo
    pressed: true
```

### `expectStatus`

Assert toast/status text.

```yaml
- expectStatus:
    text: Group created
```

This maps to `page.getByRole("status")`.

### `expectAlert`

Assert form or request error text.

```yaml
- expectAlert:
    text: email already exists
```

This maps to `page.getByRole("alert")`.

### `acceptDialog`

Accept a browser confirmation opened by the next action.

```yaml
- acceptDialog:
    message: Delete this post?
  within: Posts
  click:
    role: button
    name: Delete
```

This is needed for post deletion because the current UI uses
`window.confirm()`.

## Full Example Scenario

```yaml
name: signup, create group, post to daily thread

steps:
  - visit: /

  - within: Authentication
    click:
      role: button
      name: Signup

  - within: Authentication
    fill:
      label: Display name
      value: Ada Lovelace

  - within: Authentication
    fill:
      label: Email
      value: ada@example.test

  - within: Authentication
    fill:
      label: Password
      value: password123

  - within: Authentication
    click:
      role: button
      name: Create account

  - expectStatus:
      text: Account created

  - within: Groups
    fill:
      label: Name
      value: Morning Dojo

  - within: Groups
    click:
      role: button
      name: Create group

  - within: Groups
    expectPressed:
      role: button
      name: Morning Dojo
      pressed: true

  - within: Feeds
    click:
      role: button
      name: Daily Thread

  - within: Selected feed output
    expectVisible:
      text: Daily Thread

  - within: Posts
    click:
      role: button
      name: Post

  - within: Posts
    fill:
      label: Evidence
      value: Solved the warmup set.

  - within: Posts
    fill:
      label: Caption
      value: Felt clean today.

  - within: Posts
    click:
      role: button
      name: Submit

  - expectStatus:
      text: Post submitted

  - within: Posts
    expectVisible:
      text: Solved the warmup set.
```

## Setup Data

Scenario `steps` should stay a UI path. Data setup should be explicit and
separate.

```yaml
name: create practice feed from seeded catalog

setup:
  accounts:
    - id: owner
      displayName: Owner User
      email: owner@example.test
      password: password123
  loginAs: owner
  groups:
    - id: group
      name: Morning Dojo
      owner: owner
  catalogSources:
    - group: group
      name: Practice Problems
      template: "Practice {name}"
      fields:
        - key: rating
          label: Rating
          value_type: number
      items:
        - title: Watermelon
          data:
            name: Watermelon
            rating: 800

steps:
  - visit: /
  - within: Feeds
    click:
      role: button
      name: Add feed
```

The setup layer may call app APIs or insert directly into the disposable
database. UI steps should not know how setup was performed.

Direct SQL is faster and more deterministic, but API setup exercises more of the
running application. The initial harness should prefer API setup when endpoints
exist and use SQL only for records that cannot be created through public APIs.

## Network Controls

Some scenarios need controlled request timing, especially stale response tests.
These should still use generic browser/network concepts, not domain verbs.

```yaml
steps:
  - holdRequest:
      id: old-feeds
      method: GET
      path: "/api/groups/*/daily-feeds"

  - within: Groups
    click:
      role: button
      name: Group A

  - within: Groups
    click:
      role: button
      name: Group B

  - releaseRequest:
      id: old-feeds

  - within: Groups
    expectPressed:
      role: button
      name: Group B
      pressed: true
```

The network controller should support:

- `holdRequest`: delay matching requests.
- `releaseRequest`: allow a held request to continue.
- `fulfillRequest`: respond with inline JSON.
- `failRequest`: abort matching requests.
- `expectRequest`: assert that a request was observed.

These controls belong in the scenario harness because they model browser
environment behavior, not product-level actions.

## Locator Rules

The runner should implement strict locator rules:

1. Every scoped action starts from a named landmark.
2. Every click targets a role and accessible name.
3. Every fill/select/check targets a label.
4. Raw CSS selectors are rejected unless an escape hatch is explicitly enabled.
5. Ambiguous locators fail the scenario.
6. Scenario validation errors should point to the exact file and step index.

The escape hatch, if needed, should be noisy:

```yaml
- unsafeSelector:
    reason: "Third-party widget has no accessible role."
    selector: "[data-testid='temporary-widget']"
    click: true
```

Arcade should aim not to need this.

## Current Frontend Gaps

The current UI is close, but these changes would make the harness much more
stable:

- Add an `Authentication` region around the auth panel.
- Add a `Groups` region around the groups panel.
- Consider a named `Arcade workspace` main landmark after login.
- Consider making group/feed row accessible names exact and stable when metadata
  such as `Disabled` is displayed.
- Consider adding accessible labels to evidence expand/collapse controls.

Use `data-testid` only when accessible names cannot represent the intent. A
generic landmark harness should primarily prove that the UI is usable through
the same accessibility surface a user relies on.

## Reporting

Each scenario should produce:

- scenario name
- browser/project name
- step count
- failed step index
- original YAML snippet for the failed step
- Playwright trace path
- screenshot path on failure
- app server logs for the run

Playwright trace collection should be enabled on first retry or failure.

