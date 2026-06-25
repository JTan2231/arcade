# Feed Creation Design

This document captures the desired direction for group feed creation. It is a
design note for the next implementation pass, not a description of the current
database exactly as it exists today.

## Goals

- Add an owner/admin-only `Add feed` action at the bottom of the selected
  group's feed list.
- Keep the creation UI focused on fields users understand.
- Remove `audience` from the feed model. Feed visibility is group-scoped:
  active group members can read enabled feeds, and owners/admins can manage all
  group feeds.
- Replace schedule JSON with explicit schedule columns: a start time, timezone,
  and interval.
- Store practice feed rules in relational tables instead of `rules jsonb`.
- Make rule filters source-driven instead of hard-coding Codeforces-ish fields
  like `rating` and `tags`.
- Remove item `roles` and `points` from the feed rules model unless scoring is
  later given a specific product requirement.

## Existing Shape

The current feed system centers on these tables:

- `catalog_sources`: group-owned source collections. Each source has a display
  name and render template.
- `catalog_items`: rows for a source. Current rows have a display `title` and
  source-specific `data jsonb`.
- `group_daily_feeds`: durable feed definitions owned by a group. Current rows
  store audience, schedule, and rules as JSON.
- `group_daily_feed_instances`: materialized only when member-authored posts
  exist for a feed/date.
- `group_feed_posts`: member-authored posts against a feed instance.

Today, feed rules know about `rating` and `tags` directly. That should be
replaced by source metadata so different sources can expose their own
filterable fields.

## Feed Types

There are two feed types in the system:

- Practice feed: selects catalog item rows from one source according to an item
  count and zero or more filters.
- Daily thread: a general group daily surface with no catalog item selection.

Users should not see raw `kind` values like `catalog_daily` or `daily_thread`.

When a daily thread already exists for the group, enabled or disabled, the
create form should hide feed type selection and create only practice feeds.
There can be only one daily thread per group.

When no daily thread exists, the first step can offer:

- `Practice feed`
- `Daily thread`

The first implementation does not need rule blocks or mixed-source feeds. A
practice feed selects from exactly one source. Multi-block feeds can be added
later as a separate model extension.

## Add Feed UI

The `Add feed` button belongs at the bottom of the feed list for the selected
group. It is visible only to active owners and admins.

Clicking `Add feed` opens a modal or side panel.

For a practice feed, show:

- Name.
- Description.
- Status: active or inactive.
- Source.
- Item count.
- Start time.
- Timezone.
- Repeat interval.
- Filters.

For a daily thread, show:

- Name.
- Description.
- Status: active or inactive.
- Start time.
- Timezone.
- Repeat interval.

Daily threads do not show source, item count, or filter controls.

The slug should be generated from the name. It does not need to be shown in the
default create flow.

## Catalog Sources And Items

`catalog_sources` represents one uploaded or configured source collection for a
group.

Examples:

```text
Codeforces Problems
June Training CSV
Team Reading List
```

`catalog_items` represents one row inside that source. One uploaded/input row
should become one SQL row. The items table should not have a dedicated `title`
column; any display name or label belongs in `data` like every other
source-specific field.

Example source:

```text
name: Codeforces Problems
template: https://codeforces.com/problemset/problem/{contest_id}/{index}
```

Example item rows:

```json
{
  "name": "Two Sum",
  "contest_id": 1,
  "index": "A",
  "rating": 800,
  "tags": ["implementation"]
}
```

```json
{
  "name": "Shortest Path",
  "contest_id": 2,
  "index": "C",
  "rating": 1400,
  "tags": ["graphs"]
}
```

The template renders output from keys in the item's `data` object. If display
text is needed, the source should include a display field such as `name` in
`data` and either the frontend or template should use that field explicitly.

Catalog items should still avoid storing full statements, samples, editorials,
or solutions unless that product requirement is deliberately revisited.

## Schedule Model

Schedule should not be stored as JSON. It should be explicit data:

```sql
schedule_starts_at timestamptz not null,
schedule_timezone text not null,
schedule_interval_seconds integer not null
```

`schedule_starts_at` identifies the first feed boundary. `schedule_timezone`
controls how dates and local boundaries are displayed and interpreted.
`schedule_interval_seconds` keeps the API and Go implementation simple.

Use an interval in seconds unless calendar intervals such as "every month"
become a requirement. For daily feeds, the interval is `86400`.

The create request should use the same shape:

```json
{
  "schedule": {
    "starts_at": "2026-06-25T08:00:00-05:00",
    "timezone": "America/Chicago",
    "interval_seconds": 86400
  }
}
```

Implementation detail: this can be accepted as a nested request object while
still being stored as flat table columns.

## Filterable Fields

Catalog item particulars stay in `catalog_items.data jsonb`. The database also
stores source-owned metadata describing which JSON keys are legal to filter on
and what type each field has.

Presence in `catalog_source_fields` means the field is filterable. There should
not be a separate `filterable` boolean.

Proposed table:

```sql
create table catalog_source_fields (
  id uuid primary key default gen_random_uuid(),
  source_id uuid not null references catalog_sources(id) on delete cascade,
  key text not null,
  label text not null,
  value_type text not null,
  is_array boolean not null default false,
  display_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, source_id),
  unique (source_id, key),
  check (key <> ''),
  check (label <> ''),
  check (value_type in ('string', 'number'))
);
```

This table stores field metadata only. It should not encode filtering behavior
beyond field type and cardinality. Filtering semantics live in application
code.

Example metadata for a Codeforces-like source:

```json
[
  {
    "key": "rating",
    "label": "Rating",
    "value_type": "number",
    "is_array": false
  },
  {
    "key": "tags",
    "label": "Tags",
    "value_type": "string",
    "is_array": true
  }
]
```

Fields such as `contest_id`, `index`, or `name` may exist in item `data`, but
they are not filterable unless they appear in `catalog_source_fields`.

## Filter Operators

Operators are controlled by application code based on source field metadata.

String scalar fields:

- `eq`
- `contains`
- `like`

String array fields:

- `contains`
- `contains_any`
- `contains_all`

Number scalar fields:

- `eq`
- `gt`
- `gte`
- `lt`
- `lte`
- `between`

Numbers should be treated as real values, not only integers.

The implementation can still use database indexes for performance later, but
the filtering mechanisms and validation rules should live in Go.

## Rules UI

A practice feed rule says how many items to pick from one source, plus which
filters those items must satisfy.

The UI should read like this:

```text
Pick [3] items from [Codeforces Problems]

Filters
  [Rating] [>=] [1200]
  [Tags] [contains] [dp]

+ Add filter
```

The source dropdown is populated from the group's `catalog_sources`. The field
dropdown is populated from `catalog_source_fields` for the selected source. The
operator dropdown changes based on the selected field's type and cardinality.
The value input changes based on the selected field:

- string: text input.
- string array: text input, tag/token input, or multi-value input.
- number: numeric input.
- number `between`: two numeric inputs.

The UI should not ask users to type JSON paths, source IDs, or field IDs. It
should show source names and field labels.

## Rule Request Shape

The API may accept a nested request shape for convenience, but persistence
should be relational. A practice feed create request can look like this:

```json
{
  "name": "Daily Practice",
  "description": "Optional text",
  "enabled": true,
  "source_id": "catalog-source-uuid",
  "item_count": 3,
  "schedule": {
    "starts_at": "2026-06-25T08:00:00-05:00",
    "timezone": "America/Chicago",
    "interval_seconds": 86400
  },
  "filters": [
    {
      "field_id": "rating-field-uuid",
      "op": "gte",
      "number_values": [1200]
    },
    {
      "field_id": "tags-field-uuid",
      "op": "contains",
      "text_values": ["dp"]
    }
  ]
}
```

Daily thread create request:

```json
{
  "name": "Daily Thread",
  "description": "Optional text",
  "enabled": true,
  "schedule": {
    "starts_at": "2026-06-25T08:00:00-05:00",
    "timezone": "America/Chicago",
    "interval_seconds": 86400
  }
}
```

The API may still infer the internal feed kind from the route/form selection.
The user does not need to submit or see raw kind names.

## Rule Storage

Rules should be stored as data-model rows, not as `group_daily_feeds.rules
jsonb`.

`group_daily_feeds` stores the selected source and item count for a practice
feed:

```sql
source_id uuid,
item_count integer
```

`feed_rule_filters` stores the feed's filter rows:

```sql
create table feed_rule_filters (
  id uuid primary key default gen_random_uuid(),
  feed_id uuid not null,
  source_id uuid not null,
  field_id uuid not null,
  position integer not null,
  op text not null,
  text_values text[],
  number_values numeric[],
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (feed_id, position),
  foreign key (feed_id, source_id)
    references group_daily_feeds (id, source_id)
    on delete cascade,
  foreign key (field_id, source_id)
    references catalog_source_fields (id, source_id)
    on delete restrict,
  check (position >= 0),
  check (op <> ''),
  check ((text_values is null) <> (number_values is null)),
  check (text_values is null or cardinality(text_values) > 0),
  check (number_values is null or cardinality(number_values) > 0)
);
```

Scalar values are represented as one-element arrays. Multi-value operators use
the same columns with more elements.

Examples:

```text
rating >= 1200
op: gte
number_values: [1200]

rating between 1000 and 1400
op: between
number_values: [1000, 1400]

tags contains "graphs"
op: contains
text_values: ["graphs"]

tags contains any of "dp", "graphs"
op: contains_any
text_values: ["dp", "graphs"]
```

Do not store rule `roles`. Do not store rule `points` unless scoring is given a
specific product requirement.

## Rule Validation

When creating or updating a practice feed:

1. Verify the user is an active group owner or admin.
2. Verify the selected source belongs to the group.
3. Load `catalog_source_fields` for the source.
4. Verify each filter field belongs to the selected source. Presence in
   `catalog_source_fields` means the field is filterable.
5. Verify each operator is allowed for the field type/cardinality.
6. Verify exactly one operand column is used: `text_values` for strings or
   `number_values` for numbers.
7. Verify operand counts match the operator. For example, `between` needs
   exactly two numbers, while `gte` needs exactly one number.
8. Normalize values where appropriate, such as trimming strings and deduping
   text arrays.
9. If the feed is enabled, evaluate the filters against existing catalog items
   and ensure there are at least `item_count` eligible items.

Validation should fail with messages that identify the filter that needs
attention.

Inactive feeds may be saved even if the source does not currently have enough
eligible items. The UI should present this as "save inactive draft" rather than
as an obscure validation escape hatch.

## Selection Behavior

Feed output generation remains deterministic. For a given feed, interval/date,
source, filter set, and catalog item set, the same items should be selected.

The general process:

1. Resolve the feed interval for the requested time.
2. Load candidate items from `catalog_items` for the feed's `source_id`.
3. Apply `feed_rule_filters` in application code against `catalog_items.data`.
4. Deterministically sort or hash matching candidates.
5. Select `item_count` items.
6. Render each item through the source template.

The rendered output behavior stays the same:

- Rendered `https://` values become external links.
- Other rendered values become text prompts.
- Generated outputs are not persisted.

## Frontend Data Needs

The create feed form needs these API-backed resources:

- Existing group feeds, to know whether a daily thread already exists.
- Group catalog sources, for the source dropdown.
- Source field metadata, for filter fields and operators.
- Preview output, to show what the current rules would produce.

The frontend should hide unsupported choices rather than let users build invalid
rules and rely on backend errors.

## Preview

Practice feed creation should support preview before save.

Preview request can use the same source, item count, schedule, and filter shape
as create, but does not persist anything:

```json
{
  "name": "Daily Practice",
  "source_id": "catalog-source-uuid",
  "item_count": 3,
  "schedule": {
    "starts_at": "2026-06-25T08:00:00-05:00",
    "timezone": "America/Chicago",
    "interval_seconds": 86400
  },
  "filters": [
    {
      "field_id": "rating-field-uuid",
      "op": "between",
      "number_values": [1000, 1400]
    }
  ]
}
```

The preview response should include selected items and useful validation detail,
such as ineligible item count or missing template fields.

## Data Model Summary

Proposed `catalog_sources` direction:

```sql
create table catalog_sources (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references groups(id) on delete cascade,
  name text not null,
  template text not null,
  created_by_user_id uuid references users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, group_id),
  check (name <> ''),
  check (template <> '')
);

create unique index catalog_sources_group_lower_name_unique
  on catalog_sources (group_id, lower(name));
```

Proposed `catalog_items` direction:

```sql
create table catalog_items (
  id uuid primary key default gen_random_uuid(),
  source_id uuid not null references catalog_sources(id) on delete cascade,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (jsonb_typeof(data) = 'object'),
);

create index catalog_items_source_idx
  on catalog_items (source_id);

create index catalog_items_data_gin_idx
  on catalog_items using gin (data jsonb_path_ops);
```

Proposed `catalog_source_fields` direction:

```sql
create table catalog_source_fields (
  id uuid primary key default gen_random_uuid(),
  source_id uuid not null references catalog_sources(id) on delete cascade,
  key text not null,
  label text not null,
  value_type text not null,
  is_array boolean not null default false,
  display_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, source_id),
  unique (source_id, key),
  check (key <> ''),
  check (label <> ''),
  check (value_type in ('string', 'number'))
);
```

Proposed `group_daily_feeds` direction:

```sql
create table group_daily_feeds (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references groups(id) on delete cascade,
  name text not null,
  slug text not null,
  kind text not null,
  description text,
  enabled boolean not null default true,
  source_id uuid,
  item_count integer,
  schedule_starts_at timestamptz not null,
  schedule_timezone text not null,
  schedule_interval_seconds integer not null,
  created_by_user_id uuid references users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (group_id, slug),
  unique (id, group_id),
  unique (id, source_id),
  foreign key (source_id, group_id)
    references catalog_sources (id, group_id)
    on delete restrict,
  check (slug ~ '^[a-z0-9][a-z0-9-]*[a-z0-9]$'),
  check (name <> ''),
  check (kind in ('catalog_daily', 'daily_thread')),
  check (schedule_timezone <> ''),
  check (schedule_interval_seconds > 0),
  check (
    (kind = 'daily_thread' and source_id is null and item_count is null)
    or
    (kind = 'catalog_daily' and source_id is not null and item_count > 0)
  )
);

create unique index group_daily_feeds_one_daily_thread_per_group
  on group_daily_feeds (group_id)
  where kind = 'daily_thread';
```

Proposed `feed_rule_filters` direction:

```sql
create table feed_rule_filters (
  id uuid primary key default gen_random_uuid(),
  feed_id uuid not null,
  source_id uuid not null,
  field_id uuid not null,
  position integer not null,
  op text not null,
  text_values text[],
  number_values numeric[],
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (feed_id, position),
  foreign key (feed_id, source_id)
    references group_daily_feeds (id, source_id)
    on delete cascade,
  foreign key (field_id, source_id)
    references catalog_source_fields (id, source_id)
    on delete restrict,
  check (position >= 0),
  check (op <> ''),
  check ((text_values is null) <> (number_values is null)),
  check (text_values is null or cardinality(text_values) > 0),
  check (number_values is null or cardinality(number_values) > 0)
);
```

Remove:

- `group_daily_feeds.audience jsonb`.
- `group_daily_feeds.schedule jsonb`.
- `group_daily_feeds.rules jsonb`.
- `group_daily_feeds.rules_schema_version`.
- `catalog_items.title`.
- `catalog_source_fields.filterable`.
- rule blocks, for now.
- rule `roles`.
- rule `points`, unless scoring is deliberately reintroduced.

Keep:

- `catalog_sources.template`.
- `catalog_items.data jsonb` for arbitrary source-specific item row data.
- one `catalog_items` row per uploaded/input row.
- one daily thread per group.
- deterministic output generation.
- Go-owned validation and filtering semantics.

