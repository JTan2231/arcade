# Group Feed Posts

## Context

`group_daily_feeds` is currently the durable group-owned feed definition. Daily
feed outputs are generated on demand for a date. `catalog_daily` feeds generate
items from catalog rules, while `daily_thread` feeds return a daily shell with
no generated items.

Posting adds durable member-authored content to that model. A post is not part
of feed output generation. It is a response attached to a specific feed on a
specific date.

## Goals

- Allow an active group member to post one response to a group feed for a given
  date.
- Require evidence for a post to exist.
- Keep caption separate from evidence and optional.
- Support plaintext evidence first.
- Avoid persisting generated feed output snapshots.
- Ignore frontend and media upload concerns for now.

## Non-Goals

- No image, video, or file storage model yet.
- No frontend or UX design.
- No feed output snapshot JSON.
- No per-catalog-item responses yet. A post is tied to the feed instance as a
  whole.

## Terms

- Feed definition: a row in `group_daily_feeds`.
- Feed instance: a materialized `(feed_id, feed_date)` pair.
- Post: a member-authored response to a feed instance.
- Evidence: required response content. Initially this is plaintext only.
- Caption: optional text that accompanies the evidence.

## Data Model

### `group_daily_feed_instances`

This table materializes the date-specific parent for posts.

```sql
create table group_daily_feed_instances (
	id uuid primary key default gen_random_uuid(),
	group_id uuid not null,
	feed_id uuid not null,
	feed_date date not null,
	created_at timestamptz not null default now(),
	unique (feed_id, feed_date),
	unique (id, group_id),
	foreign key (feed_id, group_id)
		references group_daily_feeds (id, group_id)
		on delete cascade
);
```

Supporting index:

```sql
create index group_daily_feed_instances_group_date_idx
	on group_daily_feed_instances (group_id, feed_date desc);
```

`group_id` is denormalized for group-scoped lookups and authorization. The
composite foreign key keeps it consistent with `group_daily_feeds.group_id`.
This requires `group_daily_feeds` to expose a matching unique key:

```sql
create unique index group_daily_feeds_id_group_id_unique
	on group_daily_feeds (id, group_id);
```

### `group_feed_posts`

This table stores the member response.

```sql
create table group_feed_posts (
	id uuid primary key default gen_random_uuid(),
	group_id uuid not null,
	feed_instance_id uuid not null,
	author_user_id uuid not null references users(id) on delete cascade,
	evidence_kind text not null default 'text',
	evidence_text text not null,
	caption text,
	deleted_at timestamptz,
	created_at timestamptz not null default now(),
	updated_at timestamptz not null default now(),
	unique (feed_instance_id, author_user_id),
	foreign key (feed_instance_id, group_id)
		references group_daily_feed_instances (id, group_id)
		on delete cascade,
	check (evidence_kind = 'text'),
	check (length(btrim(evidence_text)) > 0),
	check (caption is null or length(btrim(caption)) > 0)
);
```

Supporting indexes:

```sql
create index group_feed_posts_instance_created_idx
	on group_feed_posts (feed_instance_id, created_at desc)
	where deleted_at is null;

create index group_feed_posts_author_created_idx
	on group_feed_posts (author_user_id, created_at desc)
	where deleted_at is null;
```

The unique constraint means a member has at most one post for a feed instance.
Because the uniqueness is not partial, deletion does not create a second row.
A later `POST` for the same member and instance should update or reactivate the
existing row instead of inserting a duplicate.

## Posting Semantics

When a member posts to a feed/date:

1. Resolve the group, feed, and requested date.
2. Verify the feed belongs to the group.
3. Verify the requester is an active group member.
4. Verify the feed is enabled and the requester matches the feed audience.
5. Get or create `group_daily_feed_instances` for `(feed_id, feed_date)`.
6. Insert or update the user's `group_feed_posts` row for that instance.

The instance should be created lazily. Reading feed output can continue to be
computed on demand without creating an instance. The first post is what makes
the dated parent durable.

`daily_thread` and `catalog_daily` can both accept posts under this model. The
post attaches to the dated feed instance, not to generated catalog items.

## API Surface

Initial backend-only routes:

```http
GET  /api/groups/{group_id}/daily-feeds/{feed_id}/outputs/{date}/posts
POST /api/groups/{group_id}/daily-feeds/{feed_id}/outputs/{date}/posts
GET  /api/groups/{group_id}/feed-posts/{post_id}
PATCH /api/groups/{group_id}/feed-posts/{post_id}
DELETE /api/groups/{group_id}/feed-posts/{post_id}
```

Create or replace the requester's post:

```json
{
  "evidence_kind": "text",
  "evidence_text": "I completed the prompt and wrote up the result here.",
  "caption": "Optional note."
}
```

`caption` may be omitted or null. `evidence_kind` should be accepted only as
`text` until a media model exists.

## Authorization

Post listing should use the same read gate as feed output:

- active group membership is required;
- the feed must be enabled unless the requester can manage daily feeds;
- the requester must match the feed audience.

Post creation should be stricter:

- active group membership is required;
- the feed must be enabled;
- the requester must match the feed audience.

Post mutation:

- authors can edit or delete their own posts;
- group owners and admins can delete or hide posts if moderation is needed;
- owners and admins should not edit another member's evidence or caption.

## Delete Behavior

The initial delete can be a soft delete by setting `deleted_at`.

`GET` list routes should exclude rows where `deleted_at is not null`.
`GET /feed-posts/{post_id}` can return deleted rows only to the author or to
group owners/admins if moderation review is needed.

If a user posts again after deleting, the server should reuse the existing row:
clear `deleted_at`, replace `evidence_text`, replace `caption`, and update
`updated_at`.

## Validation

- `evidence_text` is required and must be non-empty after trimming.
- `caption` is optional, but if present should be non-empty after trimming.
- `evidence_kind` must be `text`.
- `feed_date` should use the same date parsing and schedule rules as daily feed
  output.
- Posting to a feed/date outside the feed's allowed date range should follow the
  existing daily feed output rules.
