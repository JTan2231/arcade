# Evidence Formats

Arcade stores feed post evidence as text. Evidence formats define the validation
constraints for that text. Formats are group-owned, named records with immutable
versions. Daily feeds choose one active format for future posts, and feed posts
reference the exact format version used at submission time.

This design does not add `jsonb`, `evidence_options`, rendering rules, language
columns, or code-specific metadata.

## Goals

- Replace the hard-coded `evidence_kind = 'text'` model with group-defined
  evidence formats.
- Store format constraints in relational columns.
- Let group owners and admins define reusable formats at the group level.
- Let group owners and admins assign one active format to each daily feed.
- Preserve the exact rules that validated each existing post.
- Keep `evidence_text` as the canonical submitted body.
- Allow archived formats to remain attached to historical posts.

## Tables

### `group_evidence_formats`

`group_evidence_formats` stores the named format visible to group members.

```sql
create table group_evidence_formats (
	id uuid primary key default gen_random_uuid(),
	group_id uuid not null references groups(id) on delete cascade,
	slug text not null,
	name text not null,
	description text,
	archived_at timestamptz,
	created_by_user_id uuid references users(id) on delete set null,
	updated_by_user_id uuid references users(id) on delete set null,
	created_at timestamptz not null default now(),
	updated_at timestamptz not null default now(),
	unique (id, group_id),
	unique (group_id, slug),
	check (slug ~ '^[a-z0-9][a-z0-9-]*[a-z0-9]$'),
	check (length(btrim(name)) > 0),
	check (description is null or length(btrim(description)) > 0)
);

create unique index group_evidence_formats_group_name_unique
	on group_evidence_formats (group_id, lower(name));

create index group_evidence_formats_active_idx
	on group_evidence_formats (group_id, lower(name))
	where archived_at is null;

create trigger group_evidence_formats_set_updated_at
before update on group_evidence_formats
for each row execute function set_updated_at();
```

Format slugs are stable identifiers within a group. Format names are unique
case-insensitively within a group. Archiving hides a format from new posts and
feed assignment choices; it does not remove historical references.

### `group_evidence_format_versions`

`group_evidence_format_versions` stores the validation constraints. Version
rows are append-only. Changing constraints creates the next version number for
the same format.

```sql
create table group_evidence_format_versions (
	id uuid primary key default gen_random_uuid(),
	group_id uuid not null,
	format_id uuid not null,
	version_number integer not null,

	min_chars integer not null default 1,
	max_chars integer,
	min_lines integer,
	max_lines integer,
	exact_lines integer,
	line_min_chars integer,
	line_max_chars integer,
	allow_blank_lines boolean not null default true,

	created_by_user_id uuid references users(id) on delete set null,
	created_at timestamptz not null default now(),

	unique (id, group_id),
	unique (format_id, version_number),
	foreign key (format_id, group_id)
		references group_evidence_formats (id, group_id)
		on delete cascade,

	check (version_number > 0),
	check (min_chars >= 1),
	check (max_chars is null or max_chars >= min_chars),
	check (min_lines is null or min_lines >= 1),
	check (max_lines is null or max_lines >= 1),
	check (exact_lines is null or exact_lines >= 1),
	check (min_lines is null or max_lines is null or max_lines >= min_lines),
	check (exact_lines is null or (min_lines is null and max_lines is null)),
	check (line_min_chars is null or line_min_chars >= 1),
	check (line_max_chars is null or line_max_chars >= 1),
	check (
		line_min_chars is null
		or line_max_chars is null
		or line_max_chars >= line_min_chars
	)
);

create index group_evidence_format_versions_format_idx
	on group_evidence_format_versions (format_id, version_number desc);
```

The active version for a format is the row with the greatest `version_number`.
Creating a format creates version `1`. Updating a format's constraints inserts
version `n + 1`.

## Feed Changes

`group_daily_feeds` stores the format assigned to future posts in that feed.

```sql
alter table group_daily_feeds
	add column evidence_format_id uuid;

alter table group_daily_feeds
	add constraint group_daily_feeds_evidence_format_fk
	foreign key (evidence_format_id, group_id)
	references group_evidence_formats (id, group_id);

create index group_daily_feeds_evidence_format_idx
	on group_daily_feeds (group_id, evidence_format_id);
```

After backfill:

```sql
alter table group_daily_feeds
	alter column evidence_format_id set not null;
```

The feed assignment points at the named format, not a specific version. New
posts resolve the feed's `evidence_format_id` to that format's active version at
submission time. Existing posts keep their stored version even if the feed later
switches formats or the assigned format receives a new version.

Create and patch feed requests accept `evidence_format_id`. If omitted during
feed creation, the backend uses the group's `plain-text` format. The backend
rejects archived formats, formats outside the feed's group, and unknown format
ids.

## Post Changes

`group_feed_posts` stores the selected format version on each post.

```sql
alter table group_feed_posts
	add column evidence_format_version_id uuid;

alter table group_feed_posts
	add constraint group_feed_posts_evidence_format_version_fk
	foreign key (evidence_format_version_id, group_id)
	references group_evidence_format_versions (id, group_id)
	on delete restrict;

create index group_feed_posts_evidence_format_version_idx
	on group_feed_posts (evidence_format_version_id)
	where deleted_at is null;
```

After backfill:

```sql
alter table group_feed_posts
	alter column evidence_format_version_id set not null;

alter table group_feed_posts
	drop constraint if exists group_feed_posts_evidence_kind_check;

alter table group_feed_posts
	drop column evidence_kind;
```

`evidence_text` remains `text not null`. The existing non-empty check remains:

```sql
check (length(btrim(evidence_text)) > 0)
```

The database stores the selected format version. On post creation or
reactivation, the backend resolves the feed's assigned format to its active
version, validates `evidence_text` against that version, and stores
`evidence_format_version_id`. On post update, the backend validates
`evidence_text` against the post's stored version.

## Default Format

Every group has a default format:

```text
slug: plain-text
name: Plain text
version_number: 1
min_chars: 1
max_chars: null
min_lines: null
max_lines: null
exact_lines: null
line_min_chars: null
line_max_chars: null
allow_blank_lines: true
```

The migration creates this format and version for every existing group, assigns
every existing feed to that format, and backfills every existing post to the
owning group's `plain-text` version. Group creation creates the same format and
version for new groups.

Feed creation defaults to the owning group's `plain-text` format when
`evidence_format_id` is omitted.

## Validation Semantics

The backend normalizes submitted evidence before validation:

1. Convert `\r\n` and `\r` line endings to `\n`.
2. Trim leading and trailing Unicode whitespace from the full body.
3. Store the normalized body in `group_feed_posts.evidence_text`.

Validation uses the normalized body.

`min_chars` and `max_chars` apply to the full normalized body. Newline
characters count as characters.

Line counts are computed by splitting the normalized body on `\n`.

`exact_lines` requires the body to contain exactly that many lines. When
`exact_lines` is set, `min_lines` and `max_lines` are unset.

`min_lines` and `max_lines` apply to the computed line count.

A blank line is a line whose trimmed value is empty. When `allow_blank_lines` is
`false`, any blank line is invalid. When `allow_blank_lines` is `true`, blank
lines are valid and count toward `min_lines`, `max_lines`, and `exact_lines`.

`line_min_chars` and `line_max_chars` apply to each non-blank line after
trimming leading and trailing whitespace from that line.

## Format Lifecycle

Creating a format inserts one `group_evidence_formats` row and one
`group_evidence_format_versions` row with `version_number = 1`.

Renaming a format or changing its description updates
`group_evidence_formats`.

Changing validation constraints inserts a new
`group_evidence_format_versions` row. Existing posts keep referencing their
original version.

Archiving a format sets `group_evidence_formats.archived_at`. The backend
rejects archiving while any `group_daily_feeds` row in the group still references
that format; admins must first move those feeds to another active format.

Archived formats are excluded from feed assignment choices and new post
creation. Existing posts that already reference an archived format version can
still update `evidence_text` against their stored version.

Unarchiving a format clears `archived_at` and makes the format available for
feed assignment again. Unarchiving does not create a new version.

## API Shape

### Format Management Routes

Group owners and admins manage formats. Active group members can list active
formats. Owners and admins can request archived formats for management screens.

```text
GET    /api/groups/{group_id}/evidence-formats
POST   /api/groups/{group_id}/evidence-formats
GET    /api/groups/{group_id}/evidence-formats/{format_id}
PATCH  /api/groups/{group_id}/evidence-formats/{format_id}
POST   /api/groups/{group_id}/evidence-formats/{format_id}/versions
DELETE /api/groups/{group_id}/evidence-formats/{format_id}
```

`GET /api/groups/{group_id}/evidence-formats` returns active formats by
default. Owners and admins can pass `include_archived=true` to include archived
formats. Responses are ordered by active state, then `lower(name)`.

Format catalog responses include the active version and current feed assignment
count:

```json
{
  "id": "00000000-0000-0000-0000-000000000000",
  "group_id": "00000000-0000-0000-0000-000000000000",
  "slug": "plain-text",
  "name": "Plain text",
  "description": null,
  "archived_at": null,
  "created_by_user_id": "00000000-0000-0000-0000-000000000000",
  "updated_by_user_id": "00000000-0000-0000-0000-000000000000",
  "active_version": {
    "id": "00000000-0000-0000-0000-000000000000",
    "format_id": "00000000-0000-0000-0000-000000000000",
    "version_number": 1,
    "min_chars": 1,
    "max_chars": null,
    "min_lines": null,
    "max_lines": null,
    "exact_lines": null,
    "line_min_chars": null,
    "line_max_chars": null,
    "allow_blank_lines": true,
    "created_by_user_id": "00000000-0000-0000-0000-000000000000",
    "created_at": "2026-01-01T00:00:00Z"
  },
  "assigned_feed_count": 0,
  "created_at": "2026-01-01T00:00:00Z",
  "updated_at": "2026-01-01T00:00:00Z"
}
```

Create format request:

```json
{
  "slug": "sonnet",
  "name": "Sonnet",
  "description": "Fourteen non-blank lines.",
  "min_chars": 1,
  "max_chars": 10000,
  "min_lines": null,
  "max_lines": null,
  "exact_lines": 14,
  "line_min_chars": 1,
  "line_max_chars": 80,
  "allow_blank_lines": false
}
```

Creating a format inserts the format metadata and version `1` in one
transaction. The backend rejects duplicate slugs, duplicate names, invalid
slugs, and invalid constraint combinations.

Patch format request updates metadata or archive state only:

```json
{
  "name": "Sonnet",
  "description": "Fourteen lines, no blank lines.",
  "archived": false
}
```

`DELETE /api/groups/{group_id}/evidence-formats/{format_id}` archives the
format. It does not hard-delete the row.

Create version request:

```json
{
  "min_chars": 1,
  "max_chars": 10000,
  "min_lines": null,
  "max_lines": null,
  "exact_lines": 14,
  "line_min_chars": 1,
  "line_max_chars": 80,
  "allow_blank_lines": false
}
```

Creating a version inserts `version_number = current_active_version + 1`. The
backend rejects version creation for archived formats.

### Feed API

Feed create requests may assign an active format:

```json
{
  "name": "Daily Thread",
  "kind": "daily_thread",
  "description": "General daily posts.",
  "enabled": true,
  "evidence_format_id": "00000000-0000-0000-0000-000000000000",
  "schedule": {
    "starts_at": "2026-01-01T00:00:00Z",
    "timezone": "America/Chicago",
    "interval_seconds": 86400
  }
}
```

If `evidence_format_id` is absent, the backend assigns the group's `plain-text`
format.

Feed patch requests use the same field for format changes:

```json
{
  "evidence_format_id": "00000000-0000-0000-0000-000000000000"
}
```

Changing a feed's format only affects future post creation or reactivation.
Existing posts keep their stored `evidence_format_version_id`.

Feed responses include the assigned format and its active version. Embedded
format objects may omit management-only fields such as `assigned_feed_count`.

```json
{
  "id": "00000000-0000-0000-0000-000000000000",
  "group_id": "00000000-0000-0000-0000-000000000000",
  "name": "Daily Thread",
  "kind": "daily_thread",
  "evidence_format": {
    "id": "00000000-0000-0000-0000-000000000000",
    "slug": "plain-text",
    "name": "Plain text",
    "description": null,
    "archived_at": null,
    "active_version": {
      "id": "00000000-0000-0000-0000-000000000000",
      "version_number": 1,
      "min_chars": 1,
      "max_chars": null,
      "min_lines": null,
      "max_lines": null,
      "exact_lines": null,
      "line_min_chars": null,
      "line_max_chars": null,
      "allow_blank_lines": true
    }
  }
}
```

### Post API

Post create requests send evidence text, not a format id:

```json
{
  "evidence_text": "submitted evidence",
  "caption": "optional caption",
  "tag_ids": ["00000000-0000-0000-0000-000000000000"]
}
```

The backend resolves the target feed's `evidence_format_id` to that format's
active version, validates `evidence_text`, and stores
`evidence_format_version_id`.

Post update requests do not change format. Evidence updates validate against the
post's stored format version:

```json
{
  "evidence_text": "updated evidence",
  "caption": null,
  "tag_ids": []
}
```

Post responses include the selected format and version:

```json
{
  "id": "00000000-0000-0000-0000-000000000000",
  "evidence_text": "submitted evidence",
  "evidence_format": {
    "id": "00000000-0000-0000-0000-000000000000",
    "slug": "plain-text",
    "name": "Plain text",
    "description": null,
    "archived_at": null
  },
  "evidence_format_version": {
    "id": "00000000-0000-0000-0000-000000000000",
    "format_id": "00000000-0000-0000-0000-000000000000",
    "version_number": 1,
    "min_chars": 1,
    "max_chars": null,
    "min_lines": null,
    "max_lines": null,
    "exact_lines": null,
    "line_min_chars": null,
    "line_max_chars": null,
    "allow_blank_lines": true
  }
}
```

Public post responses include the same `evidence_format` and
`evidence_format_version` objects so historical public posts can explain the
rules that applied when they were submitted.

## Backend Implementation

### Migration Order

The migration should keep the application valid throughout deployment:

1. Create `group_evidence_formats` and `group_evidence_format_versions`.
2. Add nullable `group_daily_feeds.evidence_format_id`.
3. Add nullable `group_feed_posts.evidence_format_version_id`.
4. Insert the `plain-text` format and version for every existing group.
5. Backfill every feed to the owning group's `plain-text` format.
6. Backfill every post to the owning group's `plain-text` version.
7. Set both new columns `not null`.
8. Drop `group_feed_posts.evidence_kind` and its check constraint.

Group creation must insert the `plain-text` format and version in the same
transaction that creates the group and default daily thread feed. The default
daily thread feed stores that format id in `group_daily_feeds`.

### Types And Routes

`internal/app/types.go` adds response types for `EvidenceFormat` and
`EvidenceFormatVersion`. `DailyFeed` includes an `EvidenceFormat` field for the
assigned format. `GroupFeedPost` and `PublicPost` include both
`EvidenceFormat` and `EvidenceFormatVersion`.

`Server.Routes()` registers a new handler group:

```text
GET    /api/groups/{group_id}/evidence-formats
POST   /api/groups/{group_id}/evidence-formats
GET    /api/groups/{group_id}/evidence-formats/{format_id}
PATCH  /api/groups/{group_id}/evidence-formats/{format_id}
POST   /api/groups/{group_id}/evidence-formats/{format_id}/versions
DELETE /api/groups/{group_id}/evidence-formats/{format_id}
```

`handlers_evidence_formats.go` owns format CRUD, version creation, archive
checks, active-version lookup, and scanning response rows. It should follow the
same permission boundary as post tags:

- active group members can list active formats and get active formats;
- owners and admins can include archived formats, get archived formats, create
  formats, patch metadata, create versions, archive, and unarchive;
- public routes do not expose the group format catalog.

### Feed Handlers

`handlers_daily_feeds.go` accepts `evidence_format_id` in create and patch
requests. Normalization resolves an omitted create value to the group's
`plain-text` format, and resolves provided ids with:

```sql
select id::text
from group_evidence_formats
where id = $1
  and group_id = $2
  and archived_at is null
```

Feed reads join the assigned format and active version. The affected reads are:

- `listGroupDailyFeeds`
- `listMeDailyFeeds`
- `getGroupDailyFeed`
- `getPublicGroup`
- `getPublicFeed`

Public feed responses need the assigned format only if the public frontend uses
the shared `DailyFeed` shape. Public posts always include their stored format
metadata.

### Post Handlers

`handlers_feed_posts.go` removes `evidence_kind` from create and patch request
normalization after the migration. Create and reactivation resolve the format
version through the target feed:

```sql
select v.id::text
from group_daily_feeds f
join lateral (
	select id
	from group_evidence_format_versions
	where format_id = f.evidence_format_id
	  and group_id = f.group_id
	order by version_number desc
	limit 1
) v on true
where f.id = $1
  and f.group_id = $2
  and exists (
	select 1
	from group_evidence_formats fmt
	where fmt.id = f.evidence_format_id
	  and fmt.group_id = f.group_id
	  and fmt.archived_at is null
  )
```

The insert/upsert writes `evidence_format_version_id` with the normalized
`evidence_text`. Patch reads the post's stored version, validates the normalized
new body against that version, and never changes
`evidence_format_version_id`.

`getGroupFeedPost`, `listGroupFeedPosts`, member post route helpers, metric
leaderboard reads, and public post reads join the stored format version and its
parent format. Joins use the version id from `group_feed_posts`, not the feed's
current format assignment.

### Validation Helpers

Evidence validation should live behind one backend helper, for example:

```go
func normalizeEvidenceText(input string) string
func validateEvidenceText(text string, version EvidenceFormatVersion) error
```

The helper returns structured `400` errors whose messages identify the violated
constraint, such as `evidence_text must be at least 14 lines` or
`evidence_text cannot contain blank lines`. Database checks still enforce
structural validity of format definitions; request normalization should catch
the same invalid combinations before insert.

### Backend Tests

Backend tests should cover:

- group creation creates `plain-text` and assigns the default daily thread feed;
- existing posts backfill to `plain-text` during migration;
- format create rejects invalid slugs and invalid constraint combinations;
- version creation increments `version_number` and leaves historical posts on
  their original version;
- feed create and patch reject archived or cross-group formats;
- post create validates against the feed's current active version;
- post update validates against the post's stored version after the feed format
  changes;
- archiving a format referenced by any feed is rejected;
- archived formats remain visible on historical posts.

## Frontend Implementation

Users add and edit formatting rules in group settings, not in the posting form.
Feeds assign one of those existing formats. Post creation uses the selected
feed's assigned format.

### Frontend Types And API

`web/frontend/src/types.ts` adds:

```ts
export type EvidenceFormatVersion = {
  id: string;
  format_id: string;
  version_number: number;
  min_chars: number;
  max_chars?: number;
  min_lines?: number;
  max_lines?: number;
  exact_lines?: number;
  line_min_chars?: number;
  line_max_chars?: number;
  allow_blank_lines: boolean;
  created_by_user_id?: string;
  created_at: string;
};

export type EvidenceFormat = {
  id: string;
  group_id: string;
  slug: string;
  name: string;
  description?: string;
  archived_at?: string;
  active_version: EvidenceFormatVersion;
  assigned_feed_count?: number;
  created_by_user_id?: string;
  updated_by_user_id?: string;
  created_at: string;
  updated_at: string;
};
```

`DailyFeed` gains `evidence_format: EvidenceFormat`. `GroupFeedPost` and
`PublicPost` gain `evidence_format: EvidenceFormat` and
`evidence_format_version: EvidenceFormatVersion`. `CreateDailyFeedRequest` and
`PatchDailyFeedRequest` include optional `evidence_format_id`. Post create and
patch request types remove `evidence_kind`.

`web/frontend/src/api.ts` adds wrappers:

```ts
listGroupEvidenceFormats(groupID, { includeArchived }, options)
createGroupEvidenceFormat(groupID, payload, options)
getGroupEvidenceFormat(groupID, formatID, options)
updateGroupEvidenceFormat(groupID, formatID, payload, options)
createGroupEvidenceFormatVersion(groupID, formatID, payload, options)
deleteGroupEvidenceFormat(groupID, formatID, options)
```

### Dashboard Machine

`dashboardMachine` stores group formats alongside feeds and post tags:

```ts
evidenceFormats: EvidenceFormat[];
evidenceFormatsError: string;
evidenceFormatMutation: EvidenceFormatMutation | null;
```

`loadGroupWorkspace` loads active formats whenever a group is selected. When the
group settings dialog is opened, it reloads with `include_archived=true` for
owners and admins, matching the post-tag manager pattern.

New events cover format management:

```ts
EVIDENCE_FORMAT_CREATE_SUBMITTED
EVIDENCE_FORMAT_UPDATE_SUBMITTED
EVIDENCE_FORMAT_VERSION_CREATE_SUBMITTED
EVIDENCE_FORMAT_DELETE_SUBMITTED
FEED_FORMAT_CHANGED
```

Format mutations update `evidenceFormats` by replacing the returned format and
sorting by active state then name. Feed format changes call
`updateGroupDailyFeed(groupId, feedId, { evidence_format_id })`, replace the
returned feed in `feeds`, and update `selectedFeedId` output state without
reloading posts.

### Group Settings

`GroupSettingsDialog` adds an `EvidenceFormatManager` section beside the
existing post-tag manager. This is where owners and admins add formatting rules.

The create form includes:

- slug;
- name;
- description;
- full-body min and max characters;
- min, max, or exact line count;
- per-line min and max characters;
- allow blank lines toggle.

The row editor shows the format name, description, active version number,
constraint summary, archive state, and assigned feed count. Metadata changes
call `PATCH /evidence-formats/{format_id}`. Constraint changes call
`POST /evidence-formats/{format_id}/versions`. Archive uses `DELETE`; unarchive
uses `PATCH` with `archived: false`.

Archive controls are disabled when `assigned_feed_count > 0` and show which rule
is blocking the action. The backend still enforces the same rule.

### Feed Creation And Settings

`AddFeedDialog` loads active evidence formats with the rest of the add-feed
workflow. It renders a `Post format` select near the feed name/status fields.
The default selected option is the group's `plain-text` format. Create submits
`evidence_format_id` with the feed payload.

`FeedSettingsDialog` adds a `Post format` section. The select lists active group
formats plus the feed's current format if it is archived. Selecting a different
active format dispatches `FEED_FORMAT_CHANGED`. The archived-current-format case
is defensive; the normal archive flow rejects archiving formats still assigned
to feeds.

The feed list does not need to show the format by default; the selected feed
output and feed settings carry the detail.

### Posting And Editing

`FeedPostSection` reads `feed.evidence_format.active_version` and shows a compact
constraint summary under the `Evidence` label. The post form does not include a
format selector. Submit sends `evidence_text`, optional `caption`, and optional
`tag_ids`.

Client-side validation mirrors the backend normalization and constraints to show
immediate form errors and disable submit for invalid text. The backend remains
authoritative.

`FeedPostCard` displays the stored `post.evidence_format.name` and version
number near the evidence block when the format is not `plain-text`, when the
format is archived, or when the post is being edited. The edit form validates
against `post.evidence_format_version`, not the selected feed's active version.

### Public Pages

`PublicPages.tsx` maps public post responses through the same evidence format
types. Public pages render historical post evidence with the stored format name
and version when that information is needed to explain the submission rules.
Public pages do not expose format management or feed assignment controls.
