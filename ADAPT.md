# Frontend Adapter Refactor Plan

## Purpose

Refactor the authenticated frontend adapter layer in place without changing
user-visible behavior.

The scenario tests under `test/scenarios/*.yaml` are the behavioral invariants
for this work. They should not be rewritten for the refactor. If a scenario
fails, assume the refactor changed behavior until proven otherwise.

This plan does not describe a migration path. It describes the target shape and
the order for changing the current frontend in place.

## Current Problem

`web/frontend/src/App.tsx` is doing too many adapter jobs at once:

- app session state, auth transitions, logout, and toast display;
- URL parsing, browser history writes, and public/member route reconciliation;
- top-level XState child actor subscription;
- dashboard machine state flattening into booleans and pending IDs;
- social graph loading and mutations for friends, requests, and group invites;
- every prop mapping for groups, feed output, posts, metrics, add-feed, and
  group settings.

The issue is not simply that the file is long. The deeper issue is that one
adapter is treating independent workspace features as one view model. This makes
unrelated state appear coupled because it is flattened in the same component.

For example, the leaderboard depends on selected group, selected feed, selected
metric, metric loading state, and leaderboard loading state. It does not care
about the current feed generation date, add-feed draft state, post composer
state, or refresh-generation pending state. Today those concerns sit next to
each other because `App.tsx` adapts the entire workspace at once.

## Target Model

Use shared selection plus independent feature adapters.

```text
AppShell
  auth/session
  route mode
  toast
  logout

WorkspaceShell
  selected group/feed identity
  URL synchronization
  layout

Feature adapters
  GroupsNavAdapter
  FeedOutputAdapter
  PostsAdapter
  MetricsAdapter
  GroupSettingsAdapter
  FriendsAdapter
  PublicRouteAdapter

Presentational components
  GroupsPanel
  GroupDashboard sections or smaller extracted views
  GroupSettingsDialog
  FriendsPanel
  PublicPage
```

The important boundary is:

- selection is shared;
- feature data, feature loading, feature errors, and feature mutations stay
  local to the feature adapter that needs them.

This can initially be achieved while keeping the existing `dashboardMachine`.
The first refactor should move adaptation closer to feature boundaries before
splitting machine ownership.

## Non-Goals

- Do not change the YAML scenario workflows.
- Do not change route URLs.
- Do not change accessible names, roles, or landmark structure except where
  a failing accessibility issue is explicitly being fixed.
- Do not redesign the UI.
- Do not replace XState.
- Do not start by grouping all props into one large `workspaceProps` object.
  That would shorten `App.tsx` while preserving the same coupling.

## Behavior Invariants

The existing YAML scenarios should continue to pass unchanged. They cover the
public contracts this refactor must preserve:

- auth and session behavior;
- group creation, selection, settings, and stale request handling;
- feed add, enable/disable, format changes, refresh generation, and routing;
- post creation, editing, deletion, tags, and date/feed switching;
- metrics and leaderboard behavior;
- friends and group invites;
- public group/feed/post URLs and member route races;
- unauthorized recovery.

The scenarios are especially useful because they use accessible locators. If
an adapter extraction changes a label, role, disabled state, status text, or
route timing, the test suite should catch it.

## Refactor Principles

Keep ownership visible.

An adapter should make it obvious which actor owns the state and which event is
sent for a user intent. Avoid helper functions that hide event ownership behind
generic command names.

Keep selectors narrow.

Each feature adapter should subscribe to the smallest snapshot/context slice it
needs. For the current machine this can be plain derived values. If selector
duplication becomes noisy, introduce small selector helpers.

Keep side effects near the concern.

Route synchronization belongs near routing and selection. Clipboard behavior
belongs near the public-link actions. Social graph fetching belongs in a social
adapter or hook, not in the root app shell.

Keep presentational components presentational.

Components like `GroupsPanel`, `FriendsPanel`, and `GroupSettingsDialog` can
continue to receive props and own local form drafts. They should not learn about
the global machine unless a deliberate container/presenter split is made for
that feature.

Prefer extraction before state-model changes.

Move React adapter boundaries first. Split XState actors only after the adapter
extraction shows that machine-level coupling remains a real source of friction.

## Proposed File Shape

The exact names can change, but the boundaries should remain similar.

```text
web/frontend/src/App.tsx
  Minimal shell:
  - boot appMachine
  - choose public/authenticated/signed-out rendering
  - render header and toast

web/frontend/src/routes.ts
  - readAppRoute
  - userProfilePath
  - groupPath
  - feedPath
  - postPath
  - publicRouteCacheKey

web/frontend/src/machines/stateMatches.ts
  - matchesTopState
  - matchesChildState
  - matchesGrandchildState

web/frontend/src/workspace/WorkspaceShell.tsx
  - authenticated workspace layout
  - selected group/feed derivation
  - route synchronization for member/public workspace routes

web/frontend/src/workspace/GroupsNavAdapter.tsx
  - GroupsPanel props and events
  - group/feed navigation URL writes
  - public feed-link copy action

web/frontend/src/workspace/FeedOutputAdapter.tsx
  - selected feed/date/output props
  - feed date changes
  - output loading/error state

web/frontend/src/workspace/PostsAdapter.tsx
  - posts, post tags, post mutations
  - public post-link copy action
  - judged metric controls only if still rendered on post cards

web/frontend/src/workspace/MetricsAdapter.tsx
  - metrics list
  - selected metric
  - leaderboard
  - metric selection and judgment events

web/frontend/src/workspace/GroupSettingsAdapter.tsx
  - settings dialog open/close
  - tags, evidence formats, members, visibility, settings metrics
  - invite candidate actions

web/frontend/src/social/useSocialGraph.ts
  - friend requests, friends, group invites
  - invite candidates
  - social mutations
  - unauthorized and toast callbacks
```

## Step-by-Step Plan

### 1. Extract Pure Route Helpers

Move route parsing and path builders out of `App.tsx`.

Expected result:

- `App.tsx` imports route helpers.
- No JSX changes.
- No behavior changes.

Validation:

- `./ci.sh frontend`
- public URL scenarios in the full scenario suite remain unchanged.

### 2. Extract State Match Helpers

Move the generic XState value match helpers out of `App.tsx`.

Expected result:

- matching logic remains byte-for-byte equivalent or covered by focused tests;
- `App.tsx` no longer owns reusable state-value utilities.

Validation:

- `./ci.sh frontend`

### 3. Extract Social Graph State

Move friends, friend requests, group invites, invite candidates, and related
mutations into `useSocialGraph`.

Inputs:

- `signedIn`
- `showingProfile`
- `selectedGroup`
- current user
- unauthorized callback
- toast callback
- group refresh callback for accepted invites

Outputs:

- the props currently passed to `FriendsPanel`;
- invite candidate props currently passed to `GroupSettingsDialog`;
- handlers for social and invite mutations.

Expected result:

- `App.tsx` no longer imports social API calls directly;
- `FriendsPanel` props remain unchanged;
- group settings invite behavior remains unchanged.

Validation:

- `./ci.sh frontend`
- `test/scenarios/friends.group-invite.yaml`

### 4. Extract Workspace Shell

Create `WorkspaceShell` for the authenticated workspace layout.

Responsibilities:

- receive `dashboardRef`, `dashboardSnapshot`, `addFeedSnapshot`, current user,
  route, and navigation helpers;
- derive selected group/feed identity;
- coordinate public/member route reconciliation;
- render profile versus workspace layout.

Expected result:

- `App.tsx` keeps auth, signed-out, checking-session, public-page fallback,
  header, logout, and toast;
- workspace-specific effects leave `App.tsx`;
- scenario behavior remains unchanged.

Validation:

- `./ci.sh frontend`
- stale route scenarios:
  - `test/scenarios/stale.group-switch.yaml`
  - `test/scenarios/stale.feed-switch-output.yaml`
  - `test/scenarios/stale.feed-switch-posts.yaml`
  - `test/scenarios/stale.date-switch-output.yaml`
  - `test/scenarios/stale.date-switch-posts.yaml`
  - `test/scenarios/public.member-feed-route-race.yaml`

### 5. Extract Groups Navigation Adapter

Create `GroupsNavAdapter` around `GroupsPanel`.

Responsibilities:

- adapt groups, feeds, evidence formats, loading/error state, pending feed IDs;
- send group/feed events to `dashboardRef`;
- write URLs for group/feed selection;
- copy public feed links.

Expected result:

- no groups/feed-list prop wall in `WorkspaceShell`;
- `GroupsPanel` remains presentational.

Validation:

- `./ci.sh frontend`
- `test/scenarios/groups.create.yaml`
- `test/scenarios/feeds.enable-disable.yaml`
- `test/scenarios/feeds.refresh-generation.yaml`

### 6. Split GroupDashboard Usage By Feature

`GroupDashboard` currently renders feed output, metrics, posts, and add-feed
dialog content. There are two acceptable approaches:

1. Keep `GroupDashboard` as the presentational component temporarily, but build
   its props inside a `GroupDashboardAdapter`.
2. Extract smaller presentational sections first, then add feature adapters for
   each section.

Prefer option 2 if the section boundaries are already clear in JSX. Prefer
option 1 if the first extraction would otherwise mix markup changes with
adapter changes.

The intended final feature split is:

- `FeedOutputAdapter`
- `PostsAdapter`
- `MetricsAdapter`
- `AddFeedAdapter`

Expected result:

- leaderboard adaptation is not colocated with feed output generation state;
- post mutation state is not colocated with add-feed source loading;
- add-feed actor events stay inside add-feed adaptation.

Validation:

- `./ci.sh frontend`
- `test/scenarios/feeds.posts.yaml`
- `test/scenarios/feeds.post-tags.yaml`
- `test/scenarios/feeds.post-tags-composer.yaml`
- `test/scenarios/feeds.add-feed.yaml`
- `test/scenarios/feeds.add-feed-error.yaml`
- `test/scenarios/metrics.leaderboard.yaml`

### 7. Extract Group Settings Adapter

Create `GroupSettingsAdapter` around `GroupSettingsDialog`.

Responsibilities:

- decide whether the dialog is open;
- derive tag, evidence format, member, visibility, and metric mutation pending
  IDs;
- pass invite candidate state from `useSocialGraph`;
- send settings events to `dashboardRef`.

Expected result:

- `WorkspaceShell` does not know the full settings prop contract;
- all settings workflow ownership remains explicit.

Validation:

- `./ci.sh frontend`
- `test/scenarios/groups.settings.yaml`
- `test/scenarios/metrics.leaderboard.yaml`
- `test/scenarios/friends.group-invite.yaml`


## Validation Policy

For any code change, run `./ci.sh` as required by the repo instructions.

For smaller intermediate steps, `./ci.sh frontend` is useful during development,
but the final state of this refactor should pass full `./ci.sh`.

For behavior validation, run the YAML scenario suite unchanged:

```sh
cd test
bun run e2e
```

Use targeted scenarios during intermediate work, then the full suite before
considering the refactor complete.

Use `./locator.ts` when markup is moved or split, especially for affected
regions such as Groups, Selected feed output, Posts, Metric settings, Settings,
Friends, and public pages. The expected result is that accessible regions and
labels remain stable unless a deliberate accessibility fix is made.

## Completion Criteria

- `App.tsx` only owns app-shell concerns.
- Workspace route synchronization is isolated from auth and social concerns.
- Friends/social graph logic is outside `App.tsx`.
- Each major workspace feature has its own adapter boundary.
- Presentational components still receive explicit props.
- Existing YAML scenarios pass unchanged.
- Full `./ci.sh` passes.
