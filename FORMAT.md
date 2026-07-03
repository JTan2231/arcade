# Evidence Formats

Arcade stores feed post evidence as text. Evidence formats define the validation
constraints for that text. Formats are group-owned, named records with immutable
versions. Feed posts reference the exact format version used at submission time.

This design does not add `jsonb`, `evidence_options`, rendering rules, language
columns, or code-specific metadata.

## Goals

- Replace the hard-coded `evidence_kind = 'text'` model with group-defined
  evidence formats.
- Store format constraints in relational columns.
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
format changes; it does not remove historical references.

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

## Post Changes

`group_feed_posts` stores the selected version on each post.

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

The database stores the selected format version. The backend validates
`evidence_text` against that version before insert or update.

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

The migration creates this format and version for every existing group. Group
creation creates the same format and version for new groups.

Existing posts are backfilled to the owning group's `plain-text` version.

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

Archiving a format sets `group_evidence_formats.archived_at`. Archived formats
are excluded from new post creation and format-change choices. Existing posts
that already reference an archived format can still update `evidence_text`
against their stored version.

## API Shape

Post create requests send a format id and evidence text:

```json
{
  "evidence_format_id": "00000000-0000-0000-0000-000000000000",
  "evidence_text": "submitted evidence",
  "caption": "optional caption"
}
```

The backend resolves `evidence_format_id` to the active version for that format,
validates `evidence_text`, and stores `evidence_format_version_id`.

Post update requests that only change `evidence_text` validate against the
post's stored format version:

```json
{
  "evidence_text": "updated evidence"
}
```

Post update requests that change format send `evidence_format_id`:

```json
{
  "evidence_format_id": "00000000-0000-0000-0000-000000000000",
  "evidence_text": "updated evidence"
}
```

The backend resolves the new format to its active version, validates the body
against that version, and stores the new `evidence_format_version_id`.

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

## Format Management Routes

Group owners and admins manage formats.

```text
GET    /api/groups/{group_id}/evidence-formats
POST   /api/groups/{group_id}/evidence-formats
PATCH  /api/groups/{group_id}/evidence-formats/{format_id}
POST   /api/groups/{group_id}/evidence-formats/{format_id}/versions
POST   /api/groups/{group_id}/evidence-formats/{format_id}/archive
POST   /api/groups/{group_id}/evidence-formats/{format_id}/unarchive
```

Active group members can list active formats. Owners and admins can request
archived formats for management screens.

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

Patch format request updates metadata only:

```json
{
  "name": "Sonnet",
  "description": "Fourteen lines, no blank lines."
}
```

## Frontend Behavior

The post composer loads active group evidence formats and requires one selected
format. The default selected format is `plain-text`.

The composer displays the selected format's constraints near the evidence
textarea and performs the same validation before submit. Backend validation is
authoritative.

The edit form uses the post's current format version for evidence-only edits.
When the user changes format, the form validates against the selected format's
active version.
