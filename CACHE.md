# Cache Design

Status: proposal.

This document describes the frontend cache model Arcade should use for
read-heavy dashboard, profile, social, and public-route data. The cache is a
client-side query response cache. It is not an entity store, and it is not a
replacement for XState workflow state.

## Goals

- Reuse read responses when users revisit groups, feeds, dates, profile views,
  and public routes.
- Dedupe identical in-flight reads.
- Make prefetching adjacent reads possible without adding a separate data path.
- Keep auth and membership boundaries explicit.
- Make invalidation local to the resource that changed, rather than forcing
  every mutation to know every derived query that might be stale.
- Keep `src/api.ts` as the raw same-origin JSON transport layer.
- Keep XState machines as the owners of workflow and visible UI state.

## Non-Goals

- Do not normalize all objects into entity tables in the frontend.
- Do not cache writes.
- Do not rely on backend freshness headers for initial correctness.
- Do not replace the dashboard or Add Feed machines with a React query layer.
- Do not introduce a separate tag system for invalidation.

## Placement

The cache should sit between XState actors/hooks and `api.ts`.

```text
dashboardMachine/addFeedMachine/useSocialGraph/public hooks
  -> query registry functions
  -> query cache
  -> api.ts
  -> fetch('/api/...')
```

`api.ts` should continue to expose uncached endpoint calls and preserve the
backend error contract. Machines and hooks should move from direct API calls to
registry-backed cached reads over time.

## Core Model

Cache entries are keyed by hierarchical tuple keys. Scope is part of the key.
There is no separate `CacheScope` field and no tag layer.

```ts
type QueryKeyPart = string | number | boolean | null;
type QueryKey = readonly QueryKeyPart[];
```

Key segments should be primitive values only. Avoid object segments so
serialization, equality, and prefix matching stay deterministic.

Example keys:

```ts
["user", uid, "groups"]
["user", uid, "group", gid, "feeds"]
["user", uid, "group", gid, "members"]
["user", uid, "group", gid, "post-tags", includeArchived ? "all" : "active"]
["user", uid, "group", gid, "evidence-formats", includeArchived ? "all" : "active"]
["user", uid, "group", gid, "catalog-sources"]
["user", uid, "group", gid, "feed", fid, "output", date]
["user", uid, "group", gid, "feed", fid, "today"]
["user", uid, "group", gid, "feed", fid, "posts", date]
["user", uid, "group", gid, "feed", fid, "metrics"]
["user", uid, "group", gid, "feed", fid, "metric", mid, "leaderboard"]
["user", uid, "social", "friend-requests"]
["user", uid, "social", "friends"]
["user", uid, "social", "group-invites"]
["user", uid, "group", gid, "invite-candidates"]
["user", uid, "me", "daily-feeds"]
["user", uid, "me", "feed-post-route", postId]
["anon", "public", "group", slug]
["anon", "public", "feed", feedId, date]
["anon", "public", "post", postId]
```

The first segment is the auth scope:

- `["user", uid, ...]` for signed-in dashboard, member-route, and social reads.
- `["anon", ...]` for signed-out-safe public reads.

Clearing auth state is prefix eviction:

```ts
cache.invalidate(["user", uid]);
cache.invalidate(["anon"]);
```

On logout or session replacement, evict the previous `["user", uid]` prefix. On
global unauthorized recovery, evict the current user prefix before returning the
app to signed-out state.

## Cache Entry

Each entry stores a whole query response and the metadata needed for freshness,
dedupe, and race control.

```ts
type CacheEntry<T> = {
  key: QueryKey;
  data?: T;
  promise?: Promise<T>;
  fetchedAt: number;
  staleAt: number;
  expiresAt: number;
  generation: number;
  dependencies: QueryKey[];
  error?: unknown;
};
```

`data` is the last successful response. `promise` is the in-flight request for
the exact key. If another caller requests the same fresh or loading key, it
reuses the entry instead of starting a duplicate request.

`dependencies` contains the dependency prefixes produced by the query registry
for this specific entry. This is not a separate tag system; dependencies are the
same hierarchical key tuples used everywhere else, and they are declared once on
the query definition.

`generation` prevents stale responses from repopulating an entry after an
invalidation. Every invalidation increments a generation counter for matching
entries or removes the entries outright. A fetch result may write into the cache
only if it still matches the entry generation it started with.

`staleAt` controls read freshness. `expiresAt` controls memory eviction. A stale
entry can be ignored for normal reads while still remaining available for later
stale-while-revalidate behavior if the app chooses to add subscriber updates.

## Read Semantics

Start with a conservative read-through policy:

1. If a fresh successful entry exists, return `data`.
2. If an entry has a matching in-flight `promise`, return that promise.
3. Otherwise call the registry fetcher, store the promise, and write the result
   on success.

The initial machine actor contract should remain promise-based. That means a
read should resolve to one value and the machine should update context from the
actor result exactly as it does today. Background revalidation can be added
later only if there is a deliberate notification path back into the machines.

## Prefix Invalidation

Invalidation is prefix based. A key `a` matches a prefix `p` when every segment
in `p` equals the corresponding segment in `a`.

```ts
isPrefix(["user", uid, "group", gid], ["user", uid, "group", gid, "feeds"]) === true
```

Examples:

```ts
cache.invalidate(["user", uid, "group", gid, "feed", fid, "posts"]);
```

Invalidates all dated post lists for that feed.

```ts
cache.invalidate(["user", uid, "group", gid, "feed", fid]);
```

Invalidates outputs, posts, metrics, and leaderboards for that feed.

```ts
cache.invalidate(["user", uid, "group", gid]);
```

Invalidates every cached member view of that group.

Prefix invalidation handles ownership and containment. It does not handle
cross-cutting dependencies by itself. Those dependencies belong in the query
registry.

## Query Registry

All cached reads should be declared in one query registry. The registry is the
source of truth for:

- Query key construction.
- The API fetcher.
- Freshness policy.
- Dependency declarations.
- Optional prefetch priority or cache size policy.

Sketch:

```ts
const queries = defineRegistry({
  feedPosts: {
    key: (uid: string, gid: string, fid: string, date: string) =>
      ["user", uid, "group", gid, "feed", fid, "posts", date] as const,
    fetch: (_uid, gid, fid, date, options) =>
      api.listGroupFeedPosts(gid, fid, date, options),
    staleMs: 15_000,
    expiresMs: 5 * 60_000,
    dependsOn: (uid, gid) => [
      ["user", uid, "group", gid, "post-tags"],
    ],
  },

  metricLeaderboard: {
    key: (uid: string, gid: string, fid: string, mid: string) =>
      ["user", uid, "group", gid, "feed", fid, "metric", mid, "leaderboard"] as const,
    fetch: (_uid, gid, fid, mid, options) =>
      api.getMetricLeaderboard(gid, fid, mid, options),
    staleMs: 15_000,
    expiresMs: 5 * 60_000,
    dependsOn: (uid, gid, fid) => [
      ["user", uid, "group", gid, "feed", fid, "posts"],
      ["user", uid, "group", gid, "feed", fid, "metrics"],
    ],
  },
});
```

The public API should infer result types from fetchers:

```ts
const posts = await cache.read(queries.feedPosts, uid, gid, fid, date);
```

`posts` should be inferred as `GroupFeedPost[]` from the registry fetcher. Avoid
maintaining a separate handwritten `QueryKey` union for every query.

## Dependency Invalidation

Mutations should declare the resource prefix they touched, not the list of
queries that need invalidation.

```ts
cache.touched(["user", uid, "group", gid, "feed", fid, "posts", date]);
```

The cache should invalidate:

1. Entries whose own key intersects the touched prefix.
2. Entries whose registry dependencies intersect the touched prefix.

Intersection is prefix-aware:

```ts
function intersects(a: QueryKey, b: QueryKey): boolean {
  return isPrefix(a, b) || isPrefix(b, a);
}
```

This means a leaderboard query that declares a dependency on
`["user", uid, "group", gid, "feed", fid, "posts"]` is invalidated when a
mutation touches `["user", uid, "group", gid, "feed", fid, "posts", date]`.

The benefit is that adding a new derived query does not require editing every
post mutation. The new query carries its own dependency declaration.

## Query Families

### Authenticated Workspace

```ts
groups:
  ["user", uid, "groups"]

groupFeeds:
  ["user", uid, "group", gid, "feeds"]

groupMembers:
  ["user", uid, "group", gid, "members"]

groupPostTags:
  ["user", uid, "group", gid, "post-tags", mode]

groupEvidenceFormats:
  ["user", uid, "group", gid, "evidence-formats", mode]
```

`mode` should be `"active"` or `"all"` rather than an object param.

`groupFeeds` depends on evidence format assignments indirectly because feed
responses include an assigned evidence format. Feed format changes should touch
the feed prefix and the evidence format prefix.

### Feed Output

```ts
feedToday:
  ["user", uid, "group", gid, "feed", fid, "today"]

feedOutput:
  ["user", uid, "group", gid, "feed", fid, "output", date]
```

`today` is not the canonical durable output key. The backend returns a concrete
`output.date`; cached read code should write the returned output under
`feedOutput(uid, gid, fid, output.date)` and may keep a short-lived `today`
alias. Around cadence or timezone changes, invalidating
`["user", uid, "group", gid, "feed", fid, "today"]` is not enough; also touch
the feed prefix or output prefix according to the mutation.

### Posts

```ts
feedPosts:
  ["user", uid, "group", gid, "feed", fid, "posts", date]
```

Post responses include hydrated tags and evidence format details, so this query
can depend on:

```ts
["user", uid, "group", gid, "post-tags"]
["user", uid, "group", gid, "evidence-formats"]
```

Use targeted cache writes after post mutations when the machine already has the
updated post. For example, a successful post update may patch the current
`feedPosts` entry for the selected date. It should still call `touched(...)` so
derived queries like leaderboards are invalidated.

### Metrics And Leaderboards

```ts
feedMetrics:
  ["user", uid, "group", gid, "feed", fid, "metrics"]

metricLeaderboard:
  ["user", uid, "group", gid, "feed", fid, "metric", mid, "leaderboard"]

metricJudgments:
  ["user", uid, "group", gid, "feed", fid, "metric", mid, "judgments"]
```

Leaderboards depend on feed posts and metric definitions:

```ts
["user", uid, "group", gid, "feed", fid, "posts"]
["user", uid, "group", gid, "feed", fid, "metrics"]
["user", uid, "group", gid, "feed", fid, "metric", mid, "judgments"]
```

There does not need to be a cached judgment list for the judgment resource
prefix to be useful. Judgment mutations can touch the judgment prefix, and
leaderboard entries that declare a dependency on that prefix will be invalidated.

### Add Feed

```ts
groupCatalogSources:
  ["user", uid, "group", gid, "catalog-sources"]

groupEvidenceFormats:
  ["user", uid, "group", gid, "evidence-formats", "active"]
```

The Add Feed dialog should read these through the same registry used by the
dashboard. Feed preview responses should not be cached initially because they
are request-body-specific and dialog-scoped.

### Social And Profile

```ts
friendRequests:
  ["user", uid, "social", "friend-requests"]

friends:
  ["user", uid, "social", "friends"]

groupInvites:
  ["user", uid, "social", "group-invites"]

inviteCandidates:
  ["user", uid, "group", gid, "invite-candidates"]
```

Invite candidates depend on friends, group invites, and group membership:

```ts
["user", uid, "social", "friends"]
["user", uid, "social", "group-invites"]
["user", uid, "group", gid, "members"]
```

Social mutations should touch the social prefix and, when a selected group is
known, the invite-candidates prefix for that group.

### Public Routes

```ts
publicGroup:
  ["anon", "public", "group", slug]

publicFeed:
  ["anon", "public", "feed", feedId, date]

publicPost:
  ["anon", "public", "post", postId]
```

Signed-in member-route resolution should not reuse anonymous public data for the
member dashboard. Once a public route resolves to an active membership, the
dashboard should read through `["user", uid, ...]` keys.

Public entries can be cached independently, but signed-in mutations that change
visibility, feed definitions, posts, or post tags should invalidate relevant
`["anon", "public", ...]` prefixes too. This prevents the current browser
session from showing stale public previews after a write.

## Mutation Touch Points

Mutation actors should call `cache.touched(...)` after successful writes. They
should touch the resource that changed, not derived readers.

Examples:

```ts
createGroup:
  touched(["user", uid, "groups"])

updateGroupVisibility:
  touched(["user", uid, "group", gid])
  touched(["anon", "public"])

deleteGroup:
  touched(["user", uid, "groups"])
  touched(["user", uid, "group", gid])
```

```ts
toggleFeed:
  touched(["user", uid, "group", gid, "feeds"])
  touched(["user", uid, "group", gid, "feed", fid])
  touched(["anon", "public", "feed", fid])

changeFeedSchedule:
  touched(["user", uid, "group", gid, "feed", fid])
  touched(["anon", "public", "feed", fid])

refreshFeedGeneration:
  touched(["user", uid, "group", gid, "feed", fid, "today"])
  touched(["user", uid, "group", gid, "feed", fid, "output", date])
  touched(["anon", "public", "feed", fid])
```

```ts
createPost/updatePost/deletePost:
  touched(["user", uid, "group", gid, "feed", fid, "posts", date])
  touched(["anon", "public", "post", postId])
  touched(["anon", "public", "feed", fid, date])
```

```ts
createPostTag/updatePostTag/deletePostTag:
  touched(["user", uid, "group", gid, "post-tags"])
  touched(["anon", "public"])
```

```ts
createMetric/updateMetric/deleteMetric:
  touched(["user", uid, "group", gid, "feed", fid, "metrics"])

createJudgment/updateJudgment/deleteJudgment:
  touched(["user", uid, "group", gid, "feed", fid, "metric", mid, "judgments"])
```

```ts
createFriendRequest/acceptFriendRequest/declineFriendRequest/cancelFriendRequest/deleteFriend:
  touched(["user", uid, "social"])

createGroupInvite/cancelGroupInvite:
  touched(["user", uid, "group", gid, "invite-candidates"])
  touched(["user", uid, "social", "group-invites"])

acceptGroupInvite:
  touched(["user", uid, "groups"])
  touched(["user", uid, "social", "group-invites"])
```

Some mutation responses can also update known entries optimistically or
authoritatively. For example, post create/update/delete can patch the selected
date's `feedPosts` entry immediately. This is separate from invalidation:
patching improves the current surface, while `touched(...)` keeps other cached
or derived reads honest.

## Prefetch

Prefetch should use the exact same registry and cache entries as normal reads.
There should be no prefetch-only storage.

```ts
cache.prefetch(queries.feedOutput, uid, gid, fid, adjacentDate);
cache.prefetch(queries.feedPosts, uid, gid, fid, adjacentDate);
cache.prefetch(queries.feedMetrics, uid, gid, fid);
```

Prefetch should be best effort:

- It should dedupe against normal reads.
- It should not show toasts.
- It should ignore non-unauthorized errors.
- It should be abortable when the user changes neighborhoods.
- It should respect the same auth scope as normal reads.

Good first candidates:

- Selected feed's current output and posts.
- Adjacent dates for the selected feed.
- Metrics and selected leaderboard for the selected feed.
- Add Feed dialog source and evidence format data when the user can manage the
  group.
- Social/profile reads when the profile surface is opened.
- Public feed output summaries and selected public feed data.

## Freshness Policy

Use TTL as a fallback, not as the primary correctness mechanism. Correctness
comes from mutation touch points and dependency invalidation.

Suggested starting values:

```text
groups:              30s stale, 5m expire
group feeds:         30s stale, 5m expire
members:             30s stale, 5m expire
post tags:           60s stale, 10m expire
evidence formats:    60s stale, 10m expire
catalog sources:     60s stale, 10m expire
feed output by date: 2m stale, 15m expire
today alias:         15s stale, 1m expire
posts by date:       15s stale, 5m expire
metrics:             30s stale, 5m expire
leaderboard:         15s stale, 5m expire
social reads:        15s stale, 5m expire
public reads:        60s stale, 10m expire
```

These values should be tuned after observing real navigation patterns and data
volume.

## Error Handling

The cache should preserve the current API error behavior:

- `401` is still handled by the owning machine or hook and should trigger
  unauthorized recovery.
- Non-unauthorized query failures should not poison the cache indefinitely.
- Failed entries may keep a short error state only to dedupe simultaneous
  failures or support diagnostics.
- Prefetch failures should usually be silent unless they are unauthorized.

Do not cache authorization failures as successful empty data.

## Testing

Unit tests should cover:

- Key serialization and prefix matching.
- In-flight dedupe.
- Stale and expired reads.
- Prefix invalidation.
- Dependency invalidation through the registry.
- Race protection after invalidation while a fetch is still in flight.
- User-scope eviction.

Scenario or integration tests should cover:

- Revisiting a selected feed/date reuses cached output and posts.
- Post mutation invalidates or updates posts and refreshes affected
  leaderboards.
- Tag mutation invalidates hydrated post views.
- Logout prevents reuse of the prior user's cached dashboard/social data.
- Signed-in member routes do not reuse anonymous public cache entries.

Use `ci.sh` for code changes that implement this design.
