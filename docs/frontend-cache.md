# Frontend Cache

Arcade's application cache is a small in-memory query cache in
`web/frontend/src/cache`. It sits between XState actors, React hooks, and the
API wrapper. Postgres remains the source of truth; cached frontend data is only
a short-lived copy of API responses.

## Scope

The cache is implemented by the `queryCache` singleton in
`web/frontend/src/cache/queryCache.ts`. Query definitions live in
`web/frontend/src/cache/queries.ts`.

The cache is:

- In-memory only. It is lost on page reload, browser process exit, or a new tab.
- Per JavaScript runtime. Entries are not shared across tabs or devices.
- API-response scoped. It does not cache static assets, compiled frontend
  output, package manager data, or Go build artifacts.
- Independent of browser HTTP caching. Arcade does not rely on HTTP cache
  headers for API freshness.
- Not a backend cache. There is no Redis, database materialized cache, or server
  process cache for these frontend queries.
- Not auth storage. Session state lives in the secure cookie and backend
  `user_sessions`; no frontend token is stored.

The cache is designed to reduce repeated reads, deduplicate concurrent requests,
and keep route transitions from issuing unnecessary network calls. It is not a
real-time synchronization layer. Other browser tabs, other users, and external
database changes are observed only after a fresh read, a manual invalidation, or
the next reload.

## Query Definitions

Each cached endpoint is described with `defineQuery`:

```ts
defineQuery({
  key: (...args) => ["user", uid, "resource"] as const,
  fetch: (...args, options) => apiCall(options),
  staleMs: QUERY_TTL_MS,
  expiresMs: QUERY_TTL_MS,
  dependsOn: (...args) => [["user", uid, "other-resource"]],
});
```

The fields mean:

- `key`: stable identity for the cached response. Keys are arrays of strings,
  numbers, booleans, or nulls and are serialized with `JSON.stringify`.
- `fetch`: the API read used when no fresh entry or in-flight request exists.
- `staleMs`: how long successful data can be returned without a network call.
- `expiresMs`: how long an idle settled entry can remain in memory.
- `dependsOn`: optional dependency keys used by `queryCache.touched()`.

All query definitions currently use `QUERY_TTL_MS = 5 * 60_000`, so successful
entries are fresh for five minutes and idle settled entries expire after five
minutes. Stale and expiry are separate concepts in the cache implementation, but
the current policy gives them the same duration.

## Key Namespaces

Authenticated data starts with `["user", uid, ...]`. Public signed-out-safe
data starts with `["anon", ...]`.

Keep this boundary strict:

- Include the authenticated user's id in every user-scoped key, even when the
  backend route does not take a user id. Membership, role, invite, and private
  group visibility can make responses user-specific.
- Use `["anon", "public", ...]` only for public route responses that are safe to
  show signed out.
- Include mode flags that change response shape in the key. For example,
  archived tag and evidence-format reads include `"active"` or `"all"`.
- Prefer broad, predictable resource segments such as `"group"`, `"feed"`,
  `"posts"`, and `"metrics"` so mutation invalidation can target a whole
  subtree.

## Read Behavior

`queryCache.read(definition, ...args, options?)` follows this sequence:

1. Build and serialize the query key.
2. Evict expired settled entries.
3. Return cached data immediately when the entry has data and `staleAt` is in
   the future.
4. Return the existing promise when a matching request is already in flight.
5. Otherwise start a new fetch, store its promise, and update the entry when it
   settles.

Concurrent reads for the same key share one promise. This is important for route
transitions and XState actor re-entry: several components can ask for the same
resource without multiplying network requests.

When a caller passes an `AbortSignal`, the cache intentionally does not forward
that signal to the API fetch. A cache-owned read should still warm the cache even
if the UI state that requested it is abandoned before the response arrives.
Callers that set React state after a read should still check their own aborted
signal before committing UI updates.

Failed reads are not served as cached data. The failed entry records the error
for bookkeeping, marks itself stale immediately, clears the in-flight promise,
and will retry on the next read until it eventually expires.

## Manual Writes

`queryCache.write(definition, data, ...args)` seeds or replaces one cache entry
with known data. Use it when a successful API response is exactly the same shape
as another cached query.

Current examples:

- Loading today's member feed output also writes the dated output entry for the
  returned date.
- Refreshing the current feed generation writes both `feedToday` and the dated
  `feedOutput`.
- Loading a public feed route writes the dated public feed entry for the
  returned date.

Do not use `write` as an optimistic update mechanism unless the UI and
invalidation rules are intentionally designed for that. Most mutations should
touch affected keys and let the next read fetch server-confirmed state.

## Invalidation APIs

The cache exposes two deletion APIs.

`queryCache.invalidate(prefix)` removes entries whose key starts with `prefix`.
It does not inspect dependencies. Use it for hard namespace clears, especially
auth transitions.

`queryCache.touched(prefix)` removes entries when either:

- the entry key intersects the touched prefix, or
- one of the entry's declared dependencies intersects the touched prefix.

Intersection is bidirectional prefix matching. Touching
`["user", uid, "group", groupID, "post-tags"]` removes both active and archived
post-tag reads, and it also removes feed-post reads that declared a dependency
on group post tags.

Prefer `touched` after successful mutations because it keeps derived cached
queries coherent without requiring every mutation to list every downstream
reader.

## Dependency Model

Dependencies are declared on reads whose response includes or depends on another
resource family. The current dependency relationships are:

| Query | Dependencies |
| --- | --- |
| `groupFeeds` | group evidence formats |
| `feedPosts` | group post tags, group evidence formats |
| `feedMetric` | feed metrics |
| `metricLeaderboard` | feed posts, feed metrics, metric judgments |
| `meDailyFeeds` | groups |

When adding dependencies, use the broadest prefix that represents the upstream
resource family. For example, `feedPosts` depends on the group post-tag prefix,
not on one specific archive mode, because post responses can display archived
tags attached to historical posts.

## Auth And Public Data

Auth transitions clear cache namespaces:

- Switching from one authenticated user to another invalidates the previous
  `["user", previousUserID]` namespace.
- Logout and unauthorized recovery invalidate the current user's namespace and
  the entire `["anon"]` namespace.

The anonymous namespace is cleared on auth exits because public route data can
be observed before, during, and after authenticated workspace routing. Clearing
it prevents a signed-out screen from reusing public data that may have been made
stale by authenticated mutations.

Mutations that affect public pages must touch public keys in addition to private
member keys. Group access, feed enablement, feed output refreshes, posts, post
tags, and evidence formats can all alter public route rendering.

## Current Query Catalog

| Query | Key shape | Notes |
| --- | --- | --- |
| `groups` | `["user", uid, "groups"]` | Authenticated group list. |
| `groupFeeds` | `["user", uid, "group", groupID, "feeds"]` | Depends on evidence formats. |
| `groupMembers` | `["user", uid, "group", groupID, "members"]` | Owner/admin workspace data. |
| `groupPostTags` | `["user", uid, "group", groupID, "post-tags", mode]` | `mode` is `"active"` or `"all"`. |
| `groupEvidenceFormats` | `["user", uid, "group", groupID, "evidence-formats", mode]` | `mode` is `"active"` or `"all"`. |
| `groupCatalogSources` | `["user", uid, "group", groupID, "catalog-sources"]` | Used by Add Feed. |
| `feedToday` | `["user", uid, "group", groupID, "feed", feedID, "today"]` | Current scheduled output. |
| `feedOutput` | `["user", uid, "group", groupID, "feed", feedID, "output", date]` | Historical or dated output. |
| `feedOutputSummaries` | `["user", uid, "group", groupID, "feed", feedID, "outputs", selectedDate]` | Date navigation summaries. |
| `feedPosts` | `["user", uid, "group", groupID, "feed", feedID, "posts", date]` | Depends on post tags and evidence formats. |
| `feedMetrics` | `["user", uid, "group", groupID, "feed", feedID, "metrics"]` | Feed metric list. |
| `feedMetric` | `["user", uid, "group", groupID, "feed", feedID, "metric", metricID]` | Depends on feed metrics. |
| `metricLeaderboard` | `["user", uid, "group", groupID, "feed", feedID, "metric", metricID, "leaderboard"]` | Depends on posts, metrics, and judgments. |
| `groupInviteLinks` | `["user", uid, "group", groupID, "invite-links"]` | Owner/admin invite-link manager. |
| `meDailyFeeds` | `["user", uid, "me", "daily-feeds"]` | Used for signed-in public route resolution. |
| `memberFeedPostRoute` | `["user", uid, "me", "feed-post-route", postID]` | Used for signed-in public post route resolution. |
| `publicGroup` | `["anon", "public", "group", slug]` | Signed-out-safe public group page. |
| `publicFeed` | `["anon", "public", "feed", feedID, date]` | `date` can be null for the default public feed route. |
| `publicFeedOutputSummaries` | `["anon", "public", "feed", feedID, "outputs", selectedDate]` | Public date navigation summaries. |
| `publicPost` | `["anon", "public", "post", postID]` | Signed-out-safe public post page. |

## Mutation Rules

Every mutation that can change a cached response must touch the affected cache
prefixes after the API call succeeds. Touch private data first, then public data
when public routes can observe the change.

Current mutation patterns:

- Groups: creation touches the authenticated group list. Access updates and
  deletion touch the group list, the group subtree, and public data.
- Group membership: member removal touches group members and invite links,
  because removing a link creator can make their links invalid. Accepting an
  invite link or self-joining an open group touches the joining user's group
  list and member-route feed lookup.
- Feeds: add, toggle, caption availability changes, schedule changes, format
  changes, and deletion touch group feeds, affected feed subtrees,
  `meDailyFeeds`, and affected public feed data.
- Feed refresh: touches today's output, the returned dated output, and public
  feed data, then writes the refreshed output into the matching member cache
  entries.
- Posts: create, update, and delete touch the dated private post list, the public
  post, and the dated public feed. Deletion also touches the signed-in
  `memberFeedPostRoute`.
- Post tags: create, update, archive, and unarchive touch the group post-tag
  prefix and public data. Feed-post reads invalidate through their post-tag
  dependency.
- Evidence formats: create, update, version changes, archive, and unarchive
  touch the group evidence-format prefix and public data. Feed and post reads
  invalidate through dependencies.
- Metrics: metric create, update, and delete touch the feed metrics prefix.
  Metric detail and leaderboard reads invalidate through dependencies.
- Judgments: judgment create, update, and delete touch the metric judgment
  prefix. Leaderboards invalidate through their judgment dependency.
- Invite links: create and revoke touch the selected group's invite-link
  prefix. Link redemption touches the joining user's authenticated group list.

If a mutation changes more than one visible surface, touch all of them. For
example, changing feed enablement affects the member feed list, member route
resolution through `meDailyFeeds`, and public feed routes.

## Adding A Cached Read

When adding a cached query:

1. Add a `defineQuery` entry in `queries.ts`.
2. Put it in the correct namespace: `["user", uid, ...]` for authenticated data
   or `["anon", ...]` for public data.
3. Include every argument that changes response data in the key.
4. Add `dependsOn` prefixes when the response embeds or derives from other
   cached resource families.
5. Route reads through `queryCache.read` from actors or hooks.
6. Add mutation `touched` calls for every write path that can affect the new
   query.
7. Use `write` only when an existing response exactly satisfies this new query.
8. Add scenario coverage when stale data would be user-visible.

## Debugging Stale Data

When a view shows stale data:

1. Find the read in `queries.ts` and note its full key.
2. Find the mutation that should have changed that data.
3. Confirm the mutation calls `queryCache.touched()` with a prefix that
   intersects the read key or one of its dependencies.
4. Check whether public and authenticated namespaces both need invalidation.
5. Check archive modes. Touching the shared `"post-tags"` or
   `"evidence-formats"` prefix invalidates both `"active"` and `"all"` entries.
6. Check whether the stale surface is actually a derived query such as
   `metricLeaderboard`, `feedPosts`, `groupInviteLinks`, or `meDailyFeeds`; if
   so, fix the dependency or touch the upstream dependency prefix.

The fastest local search paths are:

```sh
rg "defineQuery|dependsOn" web/frontend/src/cache
rg "queryCache\\.touched|queryCache\\.invalidate|queryCache\\.write" web/frontend/src
```

## Coverage

There are scenarios that protect related frontend race behavior, such as stale
group/feed/date switches and public-member route resolution. There is no
dedicated unit test suite for `queryCache` semantics today. Prefer adding a
scenario when a cache mistake would be visible to a user. Add focused cache unit
coverage if the cache implementation itself changes in a way that is hard to
observe through the UI.
