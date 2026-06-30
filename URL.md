# Public URL And Visibility Model

## Goal

Arcade supports public links for groups, feeds, and specific feed posts. Anyone
with the link can view published content without signing in, while ordinary app
workflows remain authenticated and member-scoped.

## Visibility Rule

Group visibility is the only meaningful public/private setting.

- Groups have `public` or `private` visibility.
- New groups default to `public`.
- Feeds do not have their own visibility.
- Posts do not have their own visibility.

If a group is public, its public group page works, its enabled feeds are public,
and its non-deleted posts are public. If a group is private, public group, feed,
and post routes return 404. Membership and management permissions remain
separate from visibility.

Invite state is not visibility. Pending invites remain membership rows with
`status = 'invited'`.

## URLs

User-facing public routes:

```text
/g/{group_slug}
/f/{feed_id}
/f/{feed_id}/{YYYY-MM-DD}
/p/{post_id}
```

Feed and post URLs use stable IDs because group and feed slugs are mutable.
Group pages use slugs because they are the browseable public surface.

## Public API

Public read-only routes:

```text
GET /api/public/groups/{group_slug}
GET /api/public/feeds/{feed_id}
GET /api/public/feeds/{feed_id}/outputs/{date}
GET /api/public/posts/{post_id}
```

These routes bypass required session auth only for `GET /api/public/...`.

Public group lookup returns 404 unless `groups.visibility = 'public'`. The group
response includes enabled feeds in that group.

Public feed lookup returns 404 unless the parent group is public and the feed is
enabled. The response includes generated output items and all non-deleted posts
for that feed/date.

Public post lookup returns 404 unless the parent group is public and the post is
not deleted. Post publication does not depend on any post-level flag.

## Authenticated Writes

`PATCH /api/groups/{group_id}` is the visibility write surface:

```json
{
  "visibility": "public"
}
```

Owners and admins can change group visibility. Feed and post create/patch APIs
do not accept `visibility` or `default_post_visibility`; unknown request fields
are rejected by the JSON decoder.

## Data Model

`groups.visibility` is constrained to:

```text
public
private
```

`group_daily_feeds` and `group_feed_posts` do not carry visibility columns.
Migration `014_public_visibility.sql` introduced feed/post visibility during the
initial public URL work; migration `015_group_owned_visibility.sql` removes
those columns and indexes without editing the existing migration.

## Frontend

Public group, feed, and post routes render the same selected group/feed dashboard
surface used by members. Public or nonmember viewers do not get the user-specific
group sidebar, and write/management controls are disabled or omitted according
to membership capability rather than by switching to a different page design.

Group settings exposes one visibility control:

```text
Visibility: Public | Private
```

Feed action menus can copy public feed links when the selected group is public
and the feed is enabled. Post cards can copy public post links when the selected
group is public. There are no feed or post controls for making content public or
private.

## Testing Plan

Run `./ci.sh` after implementation.

Important coverage:

- Creating a group without visibility defaults to `public`.
- `invite_only` is rejected as a group visibility.
- Private groups are absent from public group reads.
- Public group reads include enabled feeds.
- Public feed reads work for enabled feeds in public groups.
- Public feed reads return 404 for private groups or disabled feeds.
- Public post reads work for non-deleted posts in public groups.
- Public post reads return 404 for private groups or deleted posts.
- Feed and post write APIs reject visibility fields.
