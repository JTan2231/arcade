# Group Post Tags

## Decision

Add group-managed tags that members can attach to feed posts. Tags are owned by
groups, managed by owners/admins, and applied by post authors from the group's
configured vocabulary.

Arcade does not create default tags. A group has no tags until its owners or
admins create them.

Tags are not feed metrics. They are post metadata that can be rendered,
filtered, and consumed by metric code when a metric explicitly chooses to use
them.

Tags do not have per-tag colors in storage. The frontend renders them with the
standard neutral tag/pill treatment from the design system.

## User Behavior

- Active group members can read active post tags for their group.
- Owners and admins can create, rename, reorder, archive, and unarchive group
  post tags.
- Members can apply zero or more active group tags to their own feed post.
- Members cannot create free-form tags while posting.
- Archived tags are hidden from the normal post composer and editor.
- Archived tags remain visible on posts that already have them.
- A post update that omits `tag_ids` leaves the post's tag set unchanged.
- A post update that includes `tag_ids` replaces the post's tag set.
- A soft-deleted post keeps its tag rows; the rows are removed only when the post
  row is hard-deleted by cascading database behavior.

## Data Model

Add migration `internal/migrations/013_group_post_tags.sql`.

Add `group_post_tags`:

```sql
create table group_post_tags (
    id uuid primary key default gen_random_uuid(),
    group_id uuid not null references groups(id) on delete cascade,
    name text not null,
    display_order integer not null default 0,
    archived_at timestamptz,
    created_by_user_id uuid references users(id),
    updated_by_user_id uuid references users(id),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),

    unique (id, group_id),

    check (length(btrim(name)) between 1 and 48),
    check (display_order >= 0)
);

create unique index group_post_tags_group_name_unique
    on group_post_tags (group_id, lower(name));

create index group_post_tags_group_active_order_idx
    on group_post_tags (group_id, display_order, lower(name))
    where archived_at is null;

create trigger group_post_tags_set_updated_at
before update on group_post_tags
for each row execute function set_updated_at();
```

Add `group_feed_post_tags`:

```sql
create table group_feed_post_tags (
    group_id uuid not null,
    post_id uuid not null,
    tag_id uuid not null,
    created_at timestamptz not null default now(),

    primary key (post_id, tag_id),

    foreign key (post_id, group_id)
        references group_feed_posts (id, group_id)
        on delete cascade,

    foreign key (tag_id, group_id)
        references group_post_tags (id, group_id)
        on delete restrict
);

create index group_feed_post_tags_group_tag_idx
    on group_feed_post_tags (group_id, tag_id);
```

Rationale:

- `group_id` on the join table gives Postgres a direct same-group constraint for
  posts and tags.
- `on delete restrict` prevents deleting tag definitions that are attached to
  historical posts. User-facing removal is archive/unarchive.
- Case-insensitive tag names are unique across active and archived tags in the
  same group, which prevents ambiguous reuse.

## API Model

Add Go response types in `internal/app/types.go`:

```go
type GroupPostTag struct {
    ID              string     `json:"id"`
    GroupID         string     `json:"group_id"`
    Name            string     `json:"name"`
    DisplayOrder    int        `json:"display_order"`
    ArchivedAt      *time.Time `json:"archived_at,omitempty"`
    CreatedByUserID *string    `json:"created_by_user_id,omitempty"`
    UpdatedByUserID *string    `json:"updated_by_user_id,omitempty"`
    CreatedAt       time.Time  `json:"created_at"`
    UpdatedAt       time.Time  `json:"updated_at"`
}
```

Extend `GroupFeedPost`:

```go
Tags []GroupPostTag `json:"tags"`
```

Tag management routes:

```text
GET    /api/groups/{group_id}/post-tags
POST   /api/groups/{group_id}/post-tags
GET    /api/groups/{group_id}/post-tags/{tag_id}
PATCH  /api/groups/{group_id}/post-tags/{tag_id}
DELETE /api/groups/{group_id}/post-tags/{tag_id}
```

`GET /api/groups/{group_id}/post-tags`:

- Requires active group membership.
- Returns active tags ordered by `display_order`, then `lower(name)`.
- Accepts `include_archived=true` for owners/admins. Non-managers receive
  `403` when requesting archived definitions.

`POST /api/groups/{group_id}/post-tags`:

```json
{
  "name": "AC",
  "display_order": 10
}
```

- Requires owner/admin role.
- Normalizes `name` with whitespace trimming.
- Allows omitted `display_order`, defaulting to `0`.
- Records `created_by_user_id` and `updated_by_user_id`.

`PATCH /api/groups/{group_id}/post-tags/{tag_id}`:

```json
{
  "name": "Accepted",
  "display_order": 20,
  "archived": false
}
```

- Requires owner/admin role.
- Requires at least one field.
- `archived: true` sets `archived_at = coalesce(archived_at, now())`.
- `archived: false` sets `archived_at = null`.
- Updates `updated_by_user_id`.

`DELETE /api/groups/{group_id}/post-tags/{tag_id}`:

- Requires owner/admin role.
- Archives the tag by setting `archived_at = coalesce(archived_at, now())`.
- Returns `204`.
- Does not delete the row.

Extend post create and patch requests:

```json
{
  "evidence_kind": "text",
  "evidence_text": "...",
  "caption": "...",
  "tag_ids": ["..."]
}
```

Post response shape:

```json
{
  "id": "...",
  "tags": [
    {
      "id": "...",
      "group_id": "...",
      "name": "AC",
      "display_order": 10,
      "created_at": "...",
      "updated_at": "..."
    }
  ]
}
```

## Backend Changes

Add `internal/app/handlers_post_tags.go` for tag definition CRUD. Follow the
existing handler style:

- `requireUser`
- `activeGroupRole` for member reads
- `requireGroupRole(ctx, userID, groupID, "owner", "admin")` for mutations
- `decodeJSON`, `writeJSON`, and `handleError`
- `badRequest`, `forbidden`, and `errNotFound` error helpers

Register routes in `internal/app/server.go` next to the other group-owned
resources.

Add request normalization helpers:

- `normalizeCreateGroupPostTagRequest`
- `normalizePatchGroupPostTagRequest`
- `normalizeGroupPostTagName`
- `normalizeGroupPostTagDisplayOrder`
- `normalizeGroupFeedPostTagIDs`

Validation rules:

- tag name trims to 1-48 characters
- display order is `>= 0`
- `tag_ids` must be an array of non-empty UUID strings
- duplicate `tag_ids` are deduplicated before validation
- no more than 20 tags can be attached to one post
- archived tags cannot be attached through create or patch
- all attached tags must belong to the post's group

Add database helpers:

- `listGroupPostTags(ctx, groupID string, includeArchived bool) ([]GroupPostTag, error)`
- `getGroupPostTag(ctx, groupID string, tagID string) (GroupPostTag, error)`
- `setGroupFeedPostTags(ctx, tx pgx.Tx, groupID string, postID string, tagIDs []string) error`
- `hydrateGroupFeedPostTags(ctx, posts []GroupFeedPost) ([]GroupFeedPost, error)`

`setGroupFeedPostTags` behavior:

- Validates all requested tags with one query against `group_post_tags` using
  `group_id`, `id = any($2)`, and `archived_at is null`.
- Compares the number of unique requested IDs with the number of active rows
  found.
- Deletes existing rows for `(group_id, post_id)`.
- Inserts the requested rows into `group_feed_post_tags`.
- Treats an empty array as clearing all tags.

Post creation changes in `handleCreateGroupFeedPost`:

- Add `TagIDs []string` to `createGroupFeedPostRequest` and
  `normalizedGroupFeedPostPayload`.
- Keep instance creation, post upsert, tag replacement, and transaction commit
  in the same transaction.
- When a soft-deleted post is reactivated by the existing upsert path, replace
  its tags with the request's `tag_ids` or clear tags when `tag_ids` is omitted.
- Return the hydrated post through `getGroupFeedPost`.

Post patch changes in `handlePatchGroupFeedPost`:

- Add optional `TagIDs` to `patchGroupFeedPostRequest` and a `TagIDsSet` flag to
  `normalizedGroupFeedPostPatch`.
- Accept a patch that only changes `tag_ids`.
- Keep the post update and tag replacement in the same transaction.
- Leave tags unchanged when `tag_ids` is omitted.
- Clear tags when `tag_ids: []` is provided.
- Return the hydrated post through `getGroupFeedPost`.

Post read changes:

- Keep the existing base post select narrow.
- After `listGroupFeedPosts` scans base posts, load tags for all returned post
  IDs in one query and attach them in API order.
- After `getGroupFeedPost` scans the base post, load tags for that post.
- Order attached tags by `display_order`, then `lower(name)`.
- Include archived tags on posts, since the join table is the source of
  historical attachment state.

## Frontend Changes

Update `web/frontend/src/types.ts`:

- Add `GroupPostTag`.
- Add `tags: GroupPostTag[]` to `GroupFeedPost`.
- Add `tag_ids?: string[]` to `CreateGroupFeedPostRequest`.
- Add `tag_ids?: string[]` to `PatchGroupFeedPostRequest`.
- Add create/patch request types for group post tags.

Update `web/frontend/src/api.ts`:

- `listGroupPostTags(groupID, { includeArchived?: boolean })`
- `createGroupPostTag(groupID, payload)`
- `getGroupPostTag(groupID, tagID)`
- `updateGroupPostTag(groupID, tagID, payload)`
- `deleteGroupPostTag(groupID, tagID)`
- Include `tag_ids` when creating or updating feed posts.

Update `web/frontend/src/machines/dashboardMachine.ts`:

- Add `postTags`, `postTagsError`, and tag mutation state to context.
- Load group post tags when a group is selected and refresh them after tag
  mutations.
- Include `tagIds: string[]` in `PostPayload`, create mutation input, and update
  mutation input.
- Preserve selected tag IDs while create/update requests are in flight.
- Update local post state from hydrated post responses after create/update.

Update `web/frontend/src/components/GroupDashboard.tsx`:

- Pass `postTags` to feed post composer and post cards.
- Render active tags as a multi-select checklist in the create form.
- Render active tags as a multi-select checklist in the edit form.
- Initialize the edit form's selected tag IDs from `post.tags`.
- Display attached tags on post cards near the caption/evidence area.
- Render archived attached tags with the same neutral pill structure plus muted
  archived styling.
- Add an owner/admin tag manager on the selected group dashboard.
- In the tag manager, support create, rename, display order edit, archive, and
  unarchive.
- Keep all tag labels and controls compact; tags are metadata, not a new primary
  surface.

Update `web/frontend/src/styles.css`:

- Add neutral `.post-tag-pill` styles.
- Add muted styling for archived attached tags.
- Add compact tag checklist styles for composer/editor forms.
- Add tag manager form/table styles using existing spacing, border, and control
  tokens.

Frontend validation:

- Use `locator.ts` while developing the tag manager, composer tag checklist, edit
  tag checklist, and post card tag rendering.
- Verify desktop and mobile layouts do not overlap and that long tag names fit or
  wrap cleanly.
- Do not start or leave a persistent dev server for the completed work.

## Tests

Backend unit tests:

- create tag normalization trims names
- create tag normalization rejects empty names
- create tag normalization rejects overlong names
- patch tag normalization requires at least one field
- post create normalization accepts omitted `tag_ids`
- post create normalization deduplicates `tag_ids`
- post create normalization rejects empty tag IDs
- post patch normalization accepts `tag_ids` as the only changed field
- post patch normalization accepts `tag_ids: []`

Backend integration/scenario coverage:

- active group member can list active group tags
- non-member cannot list group tags
- member cannot create, patch, delete, archive, or unarchive tag definitions
- owner/admin can create a tag
- duplicate tag names in one group are rejected case-insensitively
- owner/admin can rename, reorder, archive, and unarchive a tag
- member can attach active group tags to their own post
- member cannot attach a tag from another group
- member cannot attach an archived tag
- author can replace tags while editing their own post
- author can clear tags with `tag_ids: []`
- author can edit evidence/caption without changing tags by omitting `tag_ids`
- archived tags remain visible on posts that already have them
- soft-deleted posts do not appear in post lists, and their tag rows do not leak
  through list responses
- reactivating a soft-deleted post through the existing upsert path replaces the
  post's tags with the request payload

Frontend tests or locator-backed manual checks:

- member composer shows active tags and excludes archived tags
- edit form loads the post's current tags
- post card renders attached tags
- archived attached tags render muted on post cards
- owner/admin tag manager supports all mutation controls
- member view does not show tag management controls

## Documentation

Update `docs/data-model.md`:

- Add `group_post_tags` and `group_feed_post_tags` to the relationship map.
- Document group-managed post tags in the daily feed/post section.
- State that Arcade creates no default tag definitions.
- State that tag styling is frontend-controlled and not stored per tag.

Update `docs/architecture.md`:

- Add post tags to the route/resource list.
- Add post tags to the domain model.
- Document that feed post read responses are hydrated with attached group tags.

Update generated frontend handler docs if the frontend inventory changes.

## Validation

Run:

```sh
./ci.sh
```

The completed work is valid only when the full CI script passes.
