# XState Migration Spec

This document describes a high-level implementation plan for moving Arcade's
frontend workflow state to XState. The goal is not to change product behavior.
The goal is to make the relationship between possible frontend states and
backend endpoint calls explicit and reviewable.

## Goals

- Make every backend endpoint call originate from a named machine state or
  invoked actor.
- Replace ad hoc combinations of React booleans, nullable data, effects, and
  request id refs with explicit state transitions.
- Preserve the current API contract, UI shape, same-origin cookie auth, and
  backend behavior.
- Keep presentational React components mostly unaware of XState.
- Support request cancellation or stale-result suppression when users switch
  groups, feeds, or dates quickly.

## Non-Goals

- Do not change Go handlers, routes, migrations, or database schema.
- Do not introduce frontend token storage. The existing cookie-backed session
  model remains unchanged.
- Do not hand-edit generated assets under `web/static`.
- Do not model every form keystroke globally. Local form state can stay local
  unless the form has meaningful async workflow states.
- Do not add XState to backend code.

## Current Frontend State Shape

The current documented frontend boundary is:

- `web/frontend/src/App.tsx` owns session bootstrap, auth transitions, group
  selection, feed loading, feed output loading, feed posts, mutations, and
  toast messages.
- `web/frontend/src/api.ts` owns same-origin JSON requests to `/api/*`.
- `web/frontend/src/components` contains mostly presentational views.

The current app already behaves like a state machine, but the machine is
implicit:

- `authStatus` models `checking`, `anonymous`, and `authenticated`.
- `groupsLoading`, `groupFeedsLoading`, `feedOutputLoading`,
  `feedPostsLoading`, `feedPostSubmitting`, and error strings model request
  lifecycles.
- `groupRequestId` and `feedOutputRequestId` suppress stale async results.
- Event handlers in `App.tsx` both update UI state and call backend endpoints.

The migration should make these states explicit and move endpoint calls out of
React event handlers.

## Target File Shape

Expected touched files:

```text
web/frontend/package.json
web/frontend/bun.lock
  Add xstate and @xstate/react.

web/frontend/src/api.ts
  Keep endpoint wrappers, but allow AbortSignal to pass through fetch.

web/frontend/src/machines/appMachine.ts
  New top-level machine for session, auth, groups, selected dashboard data,
  feed output, feed posts, mutations, and toast notifications.

web/frontend/src/machines/addFeedMachine.ts
  Optional child machine for the Add Feed dialog once the app machine is in
  place. This can also be deferred.

web/frontend/src/App.tsx
  Replace useState/useEffect orchestration with useMachine/useActor. Derive
  component props from machine snapshots and send events from callbacks.

web/frontend/src/components/*.tsx
  Prefer minimal changes. Components should keep receiving props and callbacks.
  They should not import api.ts directly.

docs/architecture.md
docs/tech-stack.md
  Update after implementation to document the new state model.
```

Generated files under `web/static` are changed only by the normal frontend
build.

## Machine Boundary

Use one top-level `appMachine` first. Split into child machines only when the
state boundary is clear.

Recommended first-pass boundary:

```text
appMachine
  checkingSession
  signedOut
    idle
    loggingIn
    signingUp
  signedIn
    groups/dashboard workflow
    mutation workflow
    toast workflow
```

The implementation can use nested states, parallel states, or spawned child
actors. The important invariant is that API calls live in actors invoked by
states, not directly in components.

A practical split after the first pass:

```text
appMachine
  Owns session, auth, top-level unauthorized handling, and shared context.

dashboardMachine
  Owns groups, selected group, feeds, selected feed/date, output, and posts.

addFeedMachine
  Owns catalog source loading, draft validation, preview, and create states.

toastMachine
  Optional. Owns timed toast visibility.
```

Do not start with too many actors. The current app is small enough that one
machine plus a possible Add Feed child machine is the lowest-risk migration.

## Context

The machine context should hold server data and user selections:

```ts
type AppContext = {
  user: User | null;
  authError: string;

  groups: Group[];
  selectedGroupId: string | null;
  groupError: string;

  feeds: DailyFeed[];
  selectedFeedId: string | null;
  selectedFeedDate: string;
  feedsError: string;

  output: DailyFeedOutput | null;
  outputError: string;

  posts: GroupFeedPost[];
  postsError: string;

  toastMessage: string | null;
};
```

Keep derived values out of context:

- `selectedGroup`
- `selectedFeed`
- `canManageGroup`
- `currentUserId`
- loading booleans that are directly represented by the active state

These should be selectors over the machine snapshot.

## Event Shape

Events should describe user intent or backend completion, not implementation
details:

```ts
type AppEvent =
  | { type: "LOGIN_SUBMITTED"; payload: LoginRequest }
  | { type: "SIGNUP_SUBMITTED"; payload: SignupRequest }
  | { type: "LOGOUT_REQUESTED" }
  | { type: "GROUPS_REFRESH_REQUESTED"; preferredGroupId?: string | null }
  | { type: "GROUP_CREATE_SUBMITTED"; name: string }
  | { type: "GROUP_SELECTED"; groupId: string }
  | { type: "FEED_SELECTED"; feedId: string }
  | { type: "FEED_DATE_CHANGED"; date: string }
  | { type: "FEED_ENABLED_TOGGLED"; feedId: string }
  | { type: "FEED_CREATE_COMPLETED"; feed: DailyFeed }
  | { type: "POST_CREATE_SUBMITTED"; evidenceText: string; caption: string }
  | { type: "POST_UPDATE_SUBMITTED"; postId: string; evidenceText: string; caption: string }
  | { type: "POST_DELETE_SUBMITTED"; postId: string }
  | { type: "TOAST_DISMISSED" }
  | { type: "AUTH_ERROR_CLEARED" };
```

XState's internal `onDone` and `onError` events from invoked actors can be used
inside the machine. Components should generally send only user-intent events.

## Endpoint Invocation Map

Every row below should correspond to an invoked actor or a clearly named
mutation state.

| Machine state | Entry trigger | Endpoint | Success transition | Error transition |
| --- | --- | --- | --- | --- |
| `checkingSession` | App starts | `GET /api/auth/session` | `signedIn.loadingGroups` with `user` | `signedOut.idle` |
| `signedOut.loggingIn` | `LOGIN_SUBMITTED` | `POST /api/auth/login` | `signedIn.loadingGroups` with `user` | `signedOut.idle` with `authError` |
| `signedOut.signingUp` | `SIGNUP_SUBMITTED` | `POST /api/auth/signup` | `signedIn.loadingGroups` with `user` | `signedOut.idle` with `authError` |
| `signedIn.loggingOut` | `LOGOUT_REQUESTED` | `POST /api/auth/logout` | `signedOut.idle`, auth context cleared | `signedOut.idle`, auth context cleared |
| `signedIn.loadingGroups` | Auth success or refresh | `GET /api/groups` | `signedIn.groupReady` or `signedIn.noGroup` | toast error, or `signedOut.idle` on 401 |
| `signedIn.creatingGroup` | `GROUP_CREATE_SUBMITTED` | `POST /api/groups` | `signedIn.loadingGroups` with preferred group id | toast error, or `signedOut.idle` on 401 |
| `signedIn.loadingFeeds` | `GROUP_SELECTED` or group load | `GET /api/groups/:groupId/daily-feeds` | `feedSelected.loadingTodayOutput` or `noFeed` | `groupReady.feedsError`, or `signedOut.idle` on 401 |
| `feedSelected.loadingTodayOutput` | First feed selection or `FEED_SELECTED` | `GET /api/groups/:groupId/daily-feeds/:feedId/today` | `feedSelected.loadingPosts` with output date | `feedSelected.outputError`, or `signedOut.idle` on 401 |
| `feedSelected.loadingDatedOutput` | `FEED_DATE_CHANGED` | `GET /api/groups/:groupId/daily-feeds/:feedId/outputs/:date` | `feedSelected.loadingPosts` with output date | `feedSelected.outputError`, or `signedOut.idle` on 401 |
| `feedSelected.loadingPosts` | Output load succeeds | `GET /api/groups/:groupId/daily-feeds/:feedId/outputs/:date/posts` | `feedSelected.ready` with posts | `feedSelected.ready` with `postsError`, or `signedOut.idle` on 401 |
| `signedIn.togglingFeed` | `FEED_ENABLED_TOGGLED` | `PATCH /api/groups/:groupId/daily-feeds/:feedId` | update feed in context, toast | toast error, or `signedOut.idle` on 401 |
| `addFeed.loadingSources` | Add Feed opens | `GET /api/groups/:groupId/catalog-sources` | `addFeed.editing` with sources | form error, or `signedOut.idle` on 401 |
| `addFeed.previewing` | Preview submitted | `POST /api/groups/:groupId/daily-feeds/preview` | `addFeed.editing` with preview | form error, or `signedOut.idle` on 401 |
| `addFeed.creating` | Create submitted | `POST /api/groups/:groupId/daily-feeds` | close dialog, select new feed, load today output | form error, or `signedOut.idle` on 401 |
| `feedSelected.creatingPost` | `POST_CREATE_SUBMITTED` | `POST /api/groups/:groupId/daily-feeds/:feedId/outputs/:date/posts` | prepend/replace post, toast | toast error, or `signedOut.idle` on 401 |
| `feedSelected.updatingPost` | `POST_UPDATE_SUBMITTED` | `PATCH /api/groups/:groupId/feed-posts/:postId` | update post, toast | toast error, or `signedOut.idle` on 401 |
| `feedSelected.deletingPost` | `POST_DELETE_SUBMITTED` | `DELETE /api/groups/:groupId/feed-posts/:postId` | remove post, toast | toast error, or `signedOut.idle` on 401 |

This table is the review contract for the migration. If a new direct call to
`api.ts` appears outside a machine actor, the implementation has drifted from
the goal.

## Dashboard Flow

Group selection should be a single event:

```text
GROUP_SELECTED
  assign selectedGroupId
  clear feeds/output/posts/errors for the previous group
  enter loadingFeeds
  call listGroupDailyFeeds(selectedGroupId)
  choose first feed if present
  enter loadingTodayOutput for that feed
  call getGroupDailyFeedToday(groupId, feedId)
  enter loadingPosts using output.date
  call listGroupFeedPosts(groupId, feedId, output.date)
  enter ready
```

Feed selection should similarly be a single event:

```text
FEED_SELECTED
  assign selectedFeedId
  assign selectedFeedDate = todayDateValue()
  clear output/posts/errors
  enter loadingTodayOutput
```

Date changes should not mutate unrelated state:

```text
FEED_DATE_CHANGED
  assign selectedFeedDate
  clear output/posts/errors
  enter loadingDatedOutput
```

## Unauthorized Handling

Any endpoint returning 401 should transition to signed out state from anywhere
inside authenticated workflows.

Required side effects:

- Clear `user`.
- Clear groups, selected group, feeds, selected feed/date, output, and posts.
- Clear in-flight authenticated workflow state.
- Clear auth error unless the active state is an auth submission state.
- Preserve or show a toast only if the product wants visible session-expired
  feedback. The current app silently returns to the auth view for unauthorized
  errors.

This behavior should be centralized in the machine, not repeated inside each
actor callback.

## Request Cancellation and Stale Results

The current app suppresses stale responses with `groupRequestId` and
`feedOutputRequestId`. The XState version should prefer state-scoped invoked
actors.

Implementation options:

1. Update `api.ts` and each endpoint wrapper to accept an optional
   `AbortSignal`, pass it to `fetch`, and use XState promise actor signals.
2. If the first migration wants a smaller diff, rely on actors being stopped
   when their invoking state exits. This prevents stale assignment but does not
   abort the browser request.

Preferred final state is option 1.

Example API wrapper shape:

```ts
type APIOptions = RequestInit & {
  signal?: AbortSignal;
};

async function api<T>(path: string, options: APIOptions = {}): Promise<T> {
  return fetch(path, {
    credentials: "same-origin",
    signal: options.signal,
    // existing headers and options
  });
}
```

## Add Feed Dialog

The Add Feed dialog is the one local component where a child machine may be
worthwhile.

Keep local React state for:

- `kind`
- `name`
- `description`
- `enabled`
- `sourceId`
- `itemCount`
- `startsAt`
- `timezone`
- `intervalSeconds`
- draft filters

Move async workflow states to `addFeedMachine`:

```text
loadingSources
editing
previewing
creating
failed
```

The dialog can still build and validate `CreateDailyFeedRequest` locally. The
machine should own only the remote calls and remote-result states unless the
form grows enough to justify moving the whole draft into context.

## Component Integration

`App.tsx` should become an adapter:

- Run the machine with `useMachine`.
- Derive presentational props from the snapshot.
- Pass callbacks that send events.
- Avoid direct imports from `api.ts`.

Example callback direction:

```ts
<GroupsPanel
  groups={groups}
  selectedGroupId={selectedGroupId}
  loading={snapshot.matches({ signedIn: "loadingGroups" })}
  creating={snapshot.matches({ signedIn: "creatingGroup" })}
  onCreateGroup={(name) => send({ type: "GROUP_CREATE_SUBMITTED", name })}
  onSelectGroup={(groupId) => send({ type: "GROUP_SELECTED", groupId })}
/>
```

The components do not need to know they are backed by XState.

## Validation

For implementation changes, use the repo CI entrypoint:

```sh
./ci.sh
```

During development, narrower checks are acceptable:

```sh
./ci.sh frontend
./ci.sh scenarios
```

The former manual QA checklist is now encoded as YAML scenarios under
`test/scenarios/`. See `docs/testing.md` for the scenario model and harness
lifecycle.

Run the browser scenarios with:

```sh
./ci.sh e2e
```

While iterating, individual scenarios can be run through the harness:

```sh
cd test
bun run e2e scenarios/stale.feed-switch-output.yaml
```

Scenario coverage for this migration:

| Coverage | Scenario |
| --- | --- |
| Fresh anonymous load | `auth.anonymous.yaml` |
| Fresh authenticated load | `auth.authenticated.yaml` |
| Login, signup, and logout | `auth.login-logout.yaml`, `auth.signup.yaml` |
| Unauthorized response from an authenticated endpoint | `auth.unauthorized.yaml` |
| Group creation and preferred selection | `groups.create.yaml` |
| Group switching while feed requests are in flight | `stale.group-switch.yaml` |
| Feed switching while output requests are in flight | `stale.feed-switch-output.yaml` |
| Feed switching while post requests are in flight | `stale.feed-switch-posts.yaml` |
| Date switching while output requests are in flight | `stale.date-switch-output.yaml` |
| Date switching while post requests are in flight | `stale.date-switch-posts.yaml` |
| Feed enable/disable | `feeds.enable-disable.yaml` |
| Add Feed source loading, preview, create, and error paths | `feeds.add-feed.yaml`, `feeds.add-feed-error.yaml` |
| Feed post create, update, delete | `feeds.posts.yaml` |

If the XState migration changes one of these workflows, update or add scenarios
with the implementation change rather than restoring a manual QA checklist.

Do not leave development servers running after debugging.

## Acceptance Criteria

- `App.tsx` no longer owns endpoint-calling effects directly.
- Presentational components do not import `api.ts`.
- The endpoint invocation map above is implemented by machine states or invoked
  actors.
- 401 handling is centralized.
- Stale feed/group/date responses cannot overwrite newer selections.
- Existing visible behavior is preserved.
- `./ci.sh` passes after code changes.
