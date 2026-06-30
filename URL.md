# Public URL And Visibility Proposal

## Goal

Arcade should support public links for groups, feeds, and specific feed posts.
Anyone with the link should be able to view published content without signing
in, while ordinary app workflows remain member-scoped and authenticated.

The visibility model should be simple:

- Groups have `public` or `private` visibility.
- Feeds have `public` or `private` visibility.
- Posts have `public` or `private` visibility.
- Existing `invite_only` groups become `public`.

This intentionally removes `invite_only` as a group visibility value. Invites
still exist as membership workflow state, but "invite-only" should no longer be
a visibility mode.

## Current State

The existing schema already has `groups.visibility`, constrained to
`public`, `invite_only`, or `private`.

Current behavior:

- `invite_only` is the default when creating a group without an explicit
  visibility.
- Public groups are discoverable to authenticated users through the group list.
- Private groups are visible only to active members.
- Invite-only groups are visible to active members and invited users.
- Feed and post routes still require active group membership.
- Almost every `/api/...` route is behind session auth, except a small
  allowlist such as health, signup, login, session, logout, and catalog import.
- Feed-level `audience` existed historically but was dropped from the current
  schema.

The important consequence is that `groups.visibility = 'public'` currently
means "the group shell is visible", not "all feeds and posts are public".

## Product Model

### Group Visibility

Group visibility controls group discoverability and the group-level public
page.

`public`:

- The group can have a public page at `/g/{group_slug}`.
- The group can appear in public or authenticated discovery surfaces.
- Public feed links and public post links may expose this group as parent
  context.
- Membership is still separate. Being able to view a group shell does not grant
  posting, feed management, member management, or private feed access.

`private`:

- The group has no public group page.
- The group does not appear in discovery surfaces for non-members.
- Active members still use the normal authenticated app.
- Explicit public feed or post links can still work if that content is marked
  public. This keeps "share a specific thing" independent from "publish the
  entire group page".

The last point is deliberate. A private group should mean "not browseable as a
group", not "impossible to publish a single post". Public content links will
show minimal parent group context, so users should understand that publishing a
post reveals the group name, feed name, author, date, and post content.

### Feed Visibility

Feed visibility controls whether a feed output page can be viewed without auth.

`public`:

- Anyone can view the feed's public output pages.
- Public feed pages list only public posts.
- Feed output should render enough generated content to be useful, but should
  not expose raw catalog internals.

`private`:

- The feed is readable only through existing authenticated member routes.
- Public feed URLs return 404.
- Public posts inside the feed may still be viewable by their own post URLs.

Feed enabled state remains separate. If a feed is disabled, public feed URLs
should return 404 even if `visibility = 'public'`. Re-enabling the feed should
make the public URL work again if visibility is still public.

### Post Visibility

Post visibility controls whether a specific authored post can be viewed without
auth.

`public`:

- Anyone can view the post URL.
- The public response includes the post content, caption, tags, author public
  profile, feed name, group name, and feed date.

`private`:

- The post is readable only through existing authenticated member routes.
- Public post URLs return 404.

Deleted posts should always return 404 from public routes.

## Invite-Only Migration

Replace the group visibility enum with only `public` and `private`.

Migration behavior:

1. Update all existing groups:

   ```sql
   update groups
   set visibility = 'public'
   where visibility = 'invite_only';
   ```

2. Replace the check constraint so only `public` and `private` are valid.
3. Update backend validation so `invite_only` is rejected.
4. Update frontend types so group visibility is `"public" | "private"`.
5. Update group creation defaults from `invite_only` to `public`.

Pending invites remain valid. An invite is a membership row with
`status = 'invited'`; it is not a visibility mode. A user can still accept an
invite to become an active member.

After this change, group list logic can become:

```sql
where g.visibility = 'public'
   or gm.status = 'active'
```

Group invite APIs should continue to return invite details for invited users
even if the group is private.

## Data Model Changes

### `groups`

Change valid visibility values:

```text
public
private
```

No new column is needed.

### `group_daily_feeds`

Add feed-level visibility and a default for new posts:

```sql
alter table group_daily_feeds
  add column visibility text not null default 'private',
  add column default_post_visibility text not null default 'private',
  add constraint group_daily_feeds_visibility_check
    check (visibility in ('public', 'private')),
  add constraint group_daily_feeds_default_post_visibility_check
    check (default_post_visibility in ('public', 'private'));
```

Existing feeds should backfill to `private`.

`default_post_visibility` affects only future post creation. Changing it should
not retroactively publish or hide existing posts.

### `group_feed_posts`

Add post-level visibility:

```sql
alter table group_feed_posts
  add column visibility text not null default 'private',
  add constraint group_feed_posts_visibility_check
    check (visibility in ('public', 'private'));
```

Existing posts should backfill to `private`.

When creating a post, default `group_feed_posts.visibility` from the parent
feed's `default_post_visibility`, unless the request explicitly supplies
`visibility`.

### Indexes

Add partial indexes for public reads:

```sql
create index group_daily_feeds_public_lookup_idx
  on group_daily_feeds (id)
  where visibility = 'public' and enabled;

create index group_feed_posts_public_lookup_idx
  on group_feed_posts (id)
  where visibility = 'public' and deleted_at is null;

create index group_feed_posts_public_instance_idx
  on group_feed_posts (feed_instance_id, created_at desc)
  where visibility = 'public' and deleted_at is null;
```

The existing unique group slug and feed `(group_id, slug)` constraints remain
useful for display and canonical paths.

## URL Design

Use stable IDs for direct share URLs. Slugs are nicer, but group and feed slugs
are mutable today, and public links should not break just because a name
changes.

Recommended user-facing routes:

```text
/g/{group_slug}
/f/{feed_id}
/f/{feed_id}/{YYYY-MM-DD}
/p/{post_id}
```

Behavior:

- `/g/{group_slug}` renders a public group page only when the group is public.
- `/f/{feed_id}` renders today's public feed output.
- `/f/{feed_id}/{YYYY-MM-DD}` renders a dated public feed output.
- `/p/{post_id}` renders a public post.

The feed and post URLs intentionally use IDs for stability. The rendered page
can show the group name, feed name, and date, and can include canonical links to
the current public group URL when available.

Optional later upgrade:

```text
/g/{group_slug}/f/{feed_slug}/{YYYY-MM-DD}
```

That prettier route should be treated as a canonical/display route, not the
only durable share URL, unless slugs become immutable or redirect history is
added.

## API Design

Keep existing authenticated API routes as the private/member interface.

Add public read-only routes that bypass required session auth:

```text
GET /api/public/groups/{group_slug}
GET /api/public/feeds/{feed_id}
GET /api/public/feeds/{feed_id}/outputs/{date}
GET /api/public/posts/{post_id}
```

Public API routes should be added to the auth allowlist. They should not rely on
`requireUser`.

### Authenticated Write APIs

Update existing write APIs:

```text
PATCH /api/groups/{group_id}
PATCH /api/groups/{group_id}/daily-feeds/{feed_id}
POST  /api/groups/{group_id}/daily-feeds/{feed_id}/outputs/{date}/posts
PATCH /api/groups/{group_id}/feed-posts/{post_id}
```

Payload additions:

```json
{
  "visibility": "public"
}
```

Feed patch also accepts:

```json
{
  "default_post_visibility": "public"
}
```

Validation:

- Group visibility accepts only `public` and `private`.
- Feed visibility accepts only `public` and `private`.
- Feed default post visibility accepts only `public` and `private`.
- Post visibility accepts only `public` and `private`.

### Permissions

Group visibility:

- Owners and admins can change group visibility.

Feed visibility:

- Owners and admins can change feed visibility.
- Owners and admins can change default post visibility.

Post visibility:

- The post author can publish or unpublish their own post.
- Owners and admins can force any post private.
- Owners and admins should not publish another user's private post in v1 unless
  we explicitly decide that group managers own publishing rights over all group
  content.

That rule avoids surprising authors while still giving managers moderation
control.

## Public Response Shapes

Do not reuse full private DTOs blindly. Public routes should return purpose-built
responses that expose only what public pages need.

### Public Group

```json
{
  "id": "group-id",
  "name": "Group name",
  "slug": "group-slug",
  "description": "Optional description",
  "visibility": "public",
  "feeds": []
}
```

Include only public, enabled feeds in `feeds`.

### Public Feed

```json
{
  "id": "feed-id",
  "group": {
    "id": "group-id",
    "name": "Group name",
    "slug": "group-slug",
    "visibility": "private"
  },
  "name": "Feed name",
  "description": "Optional description",
  "date": "2026-06-30",
  "items": [],
  "posts": []
}
```

The group may be private. In that case, the feed page still works because the
feed itself was explicitly published, but the group page link should not be
shown unless the group is public.

Feed output items should not include raw catalog `data`, filter definitions,
source IDs, or source field metadata. A safe item shape is:

```json
{
  "position": 1,
  "title": "Rendered title",
  "action": {
    "type": "link",
    "label": "Open",
    "url": "https://example.com"
  }
}
```

For text prompt items:

```json
{
  "position": 1,
  "title": "Prompt title",
  "action": {
    "type": "text",
    "label": "Prompt",
    "text": "Prompt text"
  }
}
```

### Public Post

```json
{
  "id": "post-id",
  "group": {
    "id": "group-id",
    "name": "Group name",
    "slug": "group-slug",
    "visibility": "private"
  },
  "feed": {
    "id": "feed-id",
    "name": "Feed name"
  },
  "feed_date": "2026-06-30",
  "author": {
    "id": "user-id",
    "username": "username",
    "display_name": "Display Name",
    "avatar_url": null
  },
  "evidence_kind": "text",
  "evidence_text": "Post body",
  "caption": "Optional caption",
  "tags": [],
  "created_at": "2026-06-30T12:00:00Z",
  "updated_at": "2026-06-30T12:00:00Z"
}
```

The public post response should never include deleted posts, private tags that
are not already attached to the post, member lists, metrics, judgments, or
invite state.

## Backend Implementation Notes

### Auth Allowlist

Extend public API route detection to allow:

```text
GET /api/public/...
```

Only `GET` should be allowed without auth.

### Feed Public Read

Public feed output lookup should:

1. Load the feed by ID.
2. Return 404 if no feed exists.
3. Return 404 if `feed.visibility != 'public'`.
4. Return 404 if `feed.enabled = false`.
5. Generate the requested output date with existing feed scheduling logic.
6. Load public posts for that feed instance/date only.
7. Return a sanitized public DTO.

### Post Public Read

Public post lookup should:

1. Load the post by ID.
2. Return 404 if no post exists.
3. Return 404 if `post.visibility != 'public'`.
4. Return 404 if `post.deleted_at is not null`.
5. Join feed, group, author, and attached tags.
6. Return a sanitized public DTO.

### Existing Authenticated Reads

Existing authenticated member routes should continue to return private content
to active group members. Adding public visibility should not hide private
content from members.

## Frontend Implementation Notes

### Group Settings

Add a visibility control to the settings dialog:

```text
Visibility: Public | Private
```

Copy:

- Public: "Visible on public group pages and discovery."
- Private: "Visible only to members."

This control writes `PATCH /api/groups/{group_id}` with `visibility`.

### Feed Controls

Add feed-level controls for owners/admins:

- Make feed public/private.
- Copy feed link when public.
- Set default visibility for new posts: public/private.

The feed list action menu is a good first placement. If a fuller feed edit
screen is added later, these controls can move there.

### Post Controls

Add post-level controls:

- Author can make their own post public/private.
- Author can copy public post link when public.
- Owner/admin can make any public post private.

The post card action row is the natural placement.

### Public Pages

The public routes should render read-only pages outside the authenticated
dashboard workflow:

```text
/g/{group_slug}
/f/{feed_id}
/f/{feed_id}/{YYYY-MM-DD}
/p/{post_id}
```

They should work for signed-out users. If the viewer is signed in, the page can
still show a normal app link, but editing controls should remain absent unless
the user navigates into the authenticated dashboard.

## Testing Plan

Run `./ci.sh` after implementation.

Backend tests:

- `invite_only` rows migrate to `public`.
- `validGroupVisibility("invite_only")` is rejected after migration.
- Creating a group without visibility defaults to `public`.
- Private groups are absent from group listing for non-members.
- Public group API returns a public group DTO.
- Private group API returns 404.
- Public feed output route returns 200 for public, enabled feeds.
- Public feed output route returns 404 for private feeds.
- Public feed output route returns 404 for disabled feeds.
- Public feed output includes only public posts.
- Public feed output does not expose raw catalog `data` or filters.
- Public post route returns 200 for public, non-deleted posts.
- Public post route returns 404 for private posts.
- Public post route returns 404 for deleted posts.
- Public post route can return a post whose parent group or feed is private.
- A post author can publish/unpublish their own post.
- An owner/admin can force another user's post private.
- An owner/admin cannot publish another user's post unless that permission is
  explicitly added.

Frontend tests:

- Group settings exposes Public/Private and saves the selected value.
- Feed action menu can publish/unpublish a feed.
- Feed public link button appears only when the feed is public.
- Post action menu can publish/unpublish a post.
- Post public link button appears only when the post is public.
- Public feed page renders signed out.
- Public post page renders signed out.
- Private or disabled public routes render a not-found state.

Use `locator.ts` heavily for frontend validation and scenario authoring,
especially for the settings dialog, feed action menu, post action controls, and
public read-only pages.

## Rollout Sequence

1. Add migrations for group visibility simplification and feed/post visibility.
2. Update Go types, validators, scans, inserts, and patches.
3. Add public DTOs and public read handlers.
4. Add public API auth allowlist entries.
5. Add backend tests.
6. Add frontend API helpers and types.
7. Add group, feed, and post visibility controls.
8. Add public page routes and read-only components.
9. Add frontend scenarios and locator coverage.
10. Run `./ci.sh`.

## Open Decisions

### Should private groups allow public feed links?

Recommendation: yes. Group visibility should govern browseability; feed
visibility should govern direct feed publication.

### Should private groups allow public post links?

Recommendation: yes. This is the main "share a specific post" use case.

### Should managers be able to publish another user's post?

Recommendation: no for v1. Managers can force posts private for moderation, but
only authors can publish their own posts.

### Should public pages be indexable?

Recommendation: start with `noindex` metadata on public feed and post pages.
Group public pages can become indexable later if public discovery becomes a
product goal.

### Should public links use slugs?

Recommendation: use stable IDs for feed and post links. Use slugs for group
pages. Add pretty feed slug routes later only if slug redirects or immutable
public slugs are added.

