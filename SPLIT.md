# State Machine Split

This document describes a cleaner frontend state-machine shape for Arcade.
The goal is to keep the useful guarantees of explicit workflow states while
moving independent workflows into independent actors with smaller contexts.

## Problem

The current top-level machine owns too many unrelated concerns:

- session bootstrap, login, signup, and logout;
- group loading and group selection;
- feed loading, feed selection, date selection, output loading, and post
  loading;
- feed toggling;
- post create, update, and delete mutations;
- Add Feed dialog source loading, preview, creation, and dialog errors;
- toast message storage.

Those concerns currently share one context and one signed-in state namespace.
That makes the machine large and pushes workflow-specific temporary values into
global context, such as pending group names, pending feed toggles, pending Add
Feed payloads, and pending post mutations.

The better boundary is workflow ownership, not endpoint ownership.

## Target Shape

Use a thin root machine and invoked workflow actors:

```text
appMachine
  checkingSession
  signedOut
    idle
    loggingIn
    signingUp
  signedIn
    invokes dashboardMachine
  loggingOut

dashboardMachine
  loadingGroups
  noGroup
  groupSelected
    loadingFeeds
    noFeed
    feedSelected
      loadingTodayOutput
      loadingDatedOutput
      loadingPosts
      ready
      creatingPost
      updatingPost
      deletingPost
    togglingFeed
    addFeed
      invokes addFeedMachine while open

addFeedMachine
  loadingSources
  editing
  previewing
  creating
```

The root remains the app-level entry point. The dashboard is a child actor
started only after authentication succeeds. The Add Feed flow is a child actor
of the dashboard, because it depends on the selected group and returns a new
feed to the dashboard.

## Root Machine

`appMachine` owns app lifecycle and identity.

It should own:

- session bootstrap;
- signed-out vs signed-in routing;
- login;
- signup;
- logout;
- current user;
- centralized unauthorized handling;
- global toast display and dismissal, if toast stays machine-owned.

It should not own:

- selected group;
- feed list;
- selected feed;
- selected feed date;
- output;
- posts;
- Add Feed source list, preview, or errors;
- post mutation state.

Conceptually:

```ts
type AppContext = {
  user: User | null;
  authError: string;
  toastMessage: string | null;
};
```

The signed-in state invokes the dashboard actor:

```ts
signedIn: {
  invoke: {
    id: "dashboard",
    src: dashboardMachine,
    input: ({ context }) => ({
      user: context.user,
    }),
  },
  on: {
    LOGOUT_REQUESTED: {
      target: "loggingOut",
    },
    UNAUTHORIZED: {
      target: "signedOut",
      actions: "clearAuthenticatedData",
    },
    TOAST_REQUESTED: {
      actions: "showToast",
    },
  },
}
```

When `appMachine` leaves `signedIn`, the dashboard actor is stopped. That gives
the dashboard a natural lifecycle: dashboard state exists only while the user is
authenticated.

## Dashboard Machine

`dashboardMachine` owns the authenticated workspace.

It should own:

- groups;
- selected group;
- group refresh and group creation;
- feeds for the selected group;
- selected feed;
- selected feed date;
- current feed output;
- posts for the selected output;
- feed toggling;
- post create, update, and delete workflows;
- Add Feed actor lifecycle.

Conceptually:

```ts
type DashboardContext = {
  groups: Group[];
  selectedGroupId: string | null;
  preferredGroupId: string | null;

  feeds: DailyFeed[];
  selectedFeedId: string | null;
  selectedFeedDate: string;
  feedsError: string;

  output: DailyFeedOutput | null;
  outputError: string;

  posts: GroupFeedPost[];
  postsError: string;

  pendingGroupName: string;
  pendingToggleFeedId: string | null;
  postMutation: PostMutation | null;
};
```

The dashboard receives user-intent events from the UI:

```ts
type DashboardEvent =
  | { type: "GROUPS_REFRESH_REQUESTED"; preferredGroupId?: string | null }
  | { type: "GROUP_CREATE_SUBMITTED"; name: string }
  | { type: "GROUP_SELECTED"; groupId: string }
  | { type: "FEED_SELECTED"; feedId: string }
  | { type: "FEED_DATE_CHANGED"; date: string }
  | { type: "FEED_ENABLED_TOGGLED"; feedId: string }
  | { type: "POST_CREATE_SUBMITTED"; payload: PostPayload }
  | { type: "POST_UPDATE_SUBMITTED"; postId: string; payload: PostPayload }
  | { type: "POST_DELETE_SUBMITTED"; postId: string }
  | { type: "ADD_FEED_OPENED" }
  | { type: "ADD_FEED_CLOSED" };
```

The dashboard emits app-level events upward:

```ts
type DashboardOutputEvent =
  | { type: "UNAUTHORIZED" }
  | { type: "TOAST_REQUESTED"; message: string };
```

All group/feed/output/post endpoint calls should live in dashboard states or
actors invoked by dashboard states.

## Add Feed Machine

`addFeedMachine` owns the Add Feed dialog remote workflow.

It should own:

- source loading;
- source loading errors;
- preview request;
- preview result;
- create request;
- create errors;
- the pending payload needed by preview/create states.

Conceptually:

```ts
type AddFeedContext = {
  groupId: string;
  sources: CatalogSource[];
  preview: DailyFeedPreview | null;
  error: string;
  pendingPayload: CreateDailyFeedRequest | null;
};
```

It receives dialog-intent events:

```ts
type AddFeedEvent =
  | { type: "DRAFT_CHANGED" }
  | { type: "PREVIEW_SUBMITTED"; payload: CreateDailyFeedRequest }
  | { type: "CREATE_SUBMITTED"; payload: CreateDailyFeedRequest }
  | { type: "CLOSED" };
```

It emits workflow results upward:

```ts
type AddFeedOutputEvent =
  | { type: "FEED_CREATED"; feed: DailyFeed }
  | { type: "UNAUTHORIZED" }
  | { type: "TOAST_REQUESTED"; message: string };
```

The Add Feed draft fields can stay local to the dialog component unless they
need statechart behavior. The machine should own remote lifecycle state, not
every keystroke.

## Toast Boundary

Toast can be handled two ways.

The small option is to keep toast in `appMachine`:

- child workflows emit `TOAST_REQUESTED`;
- root stores `toastMessage`;
- root handles timed dismissal.

A separate `toastMachine` is only worthwhile if toast behavior grows beyond
"show one message and dismiss it after a delay".

Dashboard and Add Feed should not own toast timing. They can request a message;
the app shell decides display and lifetime.

## Event Routing

The UI should route events to the actor that owns the workflow.

Auth events go to `appMachine`:

```text
LOGIN_SUBMITTED
SIGNUP_SUBMITTED
LOGOUT_REQUESTED
AUTH_ERROR_CLEARED
TOAST_DISMISSED
```

Workspace events go to `dashboardMachine`:

```text
GROUP_SELECTED
FEED_SELECTED
FEED_DATE_CHANGED
FEED_ENABLED_TOGGLED
POST_CREATE_SUBMITTED
POST_UPDATE_SUBMITTED
POST_DELETE_SUBMITTED
ADD_FEED_OPENED
```

Dialog remote-workflow events go to `addFeedMachine` while it is active:

```text
DRAFT_CHANGED
PREVIEW_SUBMITTED
CREATE_SUBMITTED
CLOSED
```

`App.tsx` can still be the React adapter, but it should stop deriving every
loading flag from the root state value. It should either:

- use the dashboard actor snapshot directly; or
- use small selector helpers that turn snapshots into component props.

## API Boundary

API wrappers are not a state-machine boundary.

Endpoint wrappers should remain plain services:

```text
getSession
login
signup
logout
listGroups
listGroupDailyFeeds
getGroupDailyFeedToday
getGroupDailyFeedOutput
listGroupFeedPosts
updateGroupDailyFeed
listGroupCatalogSources
previewGroupDailyFeed
createGroupDailyFeed
createGroupFeedPost
updateGroupFeedPost
deleteGroupFeedPost
```

Machines compose those services into workflows. Avoid one machine per endpoint;
that would spread workflow logic across too many tiny actors without creating a
clear product boundary.

## Unauthorized Handling

Any authenticated workflow actor can encounter a 401.

The local machine that catches the error should translate it to a single
app-level event:

```text
UNAUTHORIZED
```

The root handles that event by:

- stopping signed-in child actors by leaving `signedIn`;
- clearing the current user;
- clearing authenticated app state;
- returning to signed-out idle state.

This keeps auth recovery centralized while allowing dashboard and Add Feed to
own their own endpoint calls.

## Data Flow

Group and feed data should flow downward by actor lifecycle, not by duplicated
root context.

```text
appMachine
  user
    -> dashboardMachine input

dashboardMachine
  selectedGroupId
    -> addFeedMachine input

addFeedMachine
  created feed
    -> dashboardMachine FEED_CREATED handling

dashboardMachine
  toast or unauthorized request
    -> appMachine
```

The root does not need to copy dashboard context. If the UI needs dashboard
data, it should read the dashboard actor snapshot.

## Practical Invariants

- Each machine owns its own context shape.
- Child workflow state does not leak into root context.
- API calls originate from invoked states or actor services.
- Leaving a workflow state stops its invoked requests.
- Leaving `signedIn` stops the dashboard actor.
- Closing Add Feed stops the Add Feed actor.
- 401 handling is centralized at the app shell.
- UI events are sent to the machine that owns the corresponding workflow.
- Presentational components stay unaware of machine internals.

## Resulting File Shape

Expected frontend source shape:

```text
web/frontend/src/machines/appMachine.ts
  Root auth/session/app-shell machine.

web/frontend/src/machines/dashboardMachine.ts
  Groups, feeds, output, posts, and dashboard mutations.

web/frontend/src/machines/addFeedMachine.ts
  Add Feed dialog remote workflow.

web/frontend/src/machines/events.ts
  Optional shared event/output event types if imports become noisy.

web/frontend/src/machines/selectors.ts
  Optional snapshot-to-view-model helpers for App.tsx.
```

The split is successful when reading each machine answers one product question:

- `appMachine`: who is using the app, and are they signed in?
- `dashboardMachine`: what workspace data is selected and loaded?
- `addFeedMachine`: what is the Add Feed dialog currently doing remotely?
