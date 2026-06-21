# Daily Feed Design

This document describes the target design for Arcade dailies as group-owned,
deterministic pointer feeds.

Arcade does not host problem statements, prompts, sample data, editorials,
solutions, or other source-owned content. Arcade stores only the metadata needed
to select a feed item and route the user to the owning source.

The short version:

- A group is the delivery and permission boundary.
- A daily feed is a saved group-owned definition.
- A feed stores audience, schedule, and generation rules.
- Source catalogs store minimal pointer metadata, not problem content.
- A dated feed output is generated from feed rules, catalog data, and date.
- Feed outputs resolve catalog items into external actions, usually URLs.
- Generated feed outputs are not persisted as `daily_sets` or item rows.
- Submissions, completions, and leaderboards are outside this design.

## Goals

1. Make groups the only way users receive daily feed outputs.
2. Let groups define one or more daily feeds.
3. Let each feed own durable audience, schedule, and selection rules.
4. Generate dated outputs deterministically from feed rules and catalog data.
5. Store source-specific seed data as pointer metadata only.
6. Store source-specific launch rules separately from feed selection rules.
7. Route users to external/source-owned items instead of hosting content.
8. Keep selection independent of the user who requests the output.
9. Keep the first implementation small enough for Codeforces and custom links.

## Non-Goals

- No hosted problem or prompt content.
- No copied statements, samples, editorials, explanations, or solutions.
- No materialized `daily_sets` or `daily_set_items`.
- No submission, completion, or solve-tracking model.
- No daily leaderboards.
- No required scheduler or background generation.
- No external provider import pipeline beyond seed catalog data.
- No direct user-to-daily subscriptions.

## Concepts

### Group

The group is the permission and delivery boundary.

Users do not subscribe to dailies directly. They see feed outputs because they
are active members of a group and because they match the feed audience inside
that group.

### Item Source

An item source is an external system or source namespace that owns feed items.

Examples:

- Codeforces
- AtCoder
- Advent of Code
- A custom URL source
- A course discussion source

An item source owns the rules for turning a catalog item locator into a user
action. In the first implementation, the only required action type is an
external URL.

### Source Resolver

A source resolver describes how Arcade launches an item from a source.

For Codeforces, the source can construct a URL from `contest_id` and `index`.
For a custom URL source, the source may read a direct URL from the item locator.

Resolvers belong to sources, not feeds. Feeds select catalog items. Sources
resolve selected items into actions.

### Catalog Item

A catalog item is the minimum Arcade needs to identify, filter, display, and
launch an external item.

A catalog item is not content. It must not include a statement, prompt body,
sample input, sample output, editorial, or solution.

For Codeforces, a catalog item can look like:

```json
{
  "source": "codeforces",
  "external_id": "4A",
  "kind": "competitive_programming_problem",
  "title": "Watermelon",
  "locator": {
    "contest_id": "4",
    "index": "A"
  },
  "metadata": {
    "rating": 800,
    "tags": ["math", "implementation"]
  }
}
```

### Daily Feed

A daily feed is a saved definition owned by a group. It describes who receives
the feed, how feed-local dates are resolved, and which catalog items can be
selected.

Examples:

- Beginner Daily
- Div 2 Practice
- Graphs Week
- Interview Prep

A feed is not the list of today's items. It is the durable definition used to
compute today's output.

### Daily Output

A daily output is the computed response for one feed on one date.

It is generated on demand from:

- the feed definition
- the requested date
- source catalog data
- source resolver definitions

Daily outputs are not stored. For the same feed definition, catalog data,
resolver definitions, and date, Arcade should return the same output.

### Feed Item

A feed item is one item in a generated daily output. It carries response-only
fields such as position, role, points, recommendation reason, catalog metadata,
and launch action.

Feed items are not stored separately.

### Audience

The audience is the subset of active group members who can receive a feed.

The first implementation should support:

- `all_group_members`
- `division`

Role-based audiences can be added later if they become useful.

## Core Invariants

The access invariant is:

```text
A user can receive or view a daily feed output only if:
  the user has active membership in the feed's group
  and the user matches the feed audience
```

The content invariant is:

```text
Arcade never stores or serves external problem content.

A catalog item is a pointer plus selection metadata.
A daily output is a generated list of pointers.
A feed item action sends the user to the external/source-owned location.
```

Public group visibility should not imply public feed access. A public group may
be discoverable, but feed outputs are still received through membership.

Viewer-specific fields may decorate an output later, but they must not affect
shared feed selection.

## Data Model

### Relationship Shape

```text
groups
  -> group_daily_feeds

item_sources
  -> catalog_items
```

There are no persisted daily output tables in this design.

### `item_sources`

```sql
create table item_sources (
	id uuid primary key default gen_random_uuid(),
	slug text not null unique,
	name text not null,
	base_url text,
	resolver_schema_version integer not null default 1,
	resolver jsonb not null default '{}'::jsonb,
	capabilities jsonb not null default '{}'::jsonb,
	created_at timestamptz not null default now(),
	updated_at timestamptz not null default now(),
	check (slug ~ '^[a-z0-9][a-z0-9-]*[a-z0-9]$')
);
```

`resolver` defines how selected catalog items become launch actions.

Codeforces source resolver:

```json
{
  "default_action": {
    "type": "external_url",
    "label": "Open on Codeforces",
    "template": "https://codeforces.com/problemset/problem/{contest_id}/{index}"
  },
  "required_locator_fields": ["contest_id", "index"]
}
```

Custom direct URL resolver:

```json
{
  "default_action": {
    "type": "external_url",
    "label": "Open",
    "field": "url"
  },
  "required_locator_fields": ["url"]
}
```

The initial resolver implementation should support only `external_url`.

Template variables are read from the selected catalog item's `locator` object.
Missing required fields make the source item invalid for that resolver.

### `catalog_items`

```sql
create table catalog_items (
	id uuid primary key default gen_random_uuid(),
	source_id uuid not null references item_sources(id) on delete cascade,
	external_id text not null,
	kind text not null,
	title text not null,
	locator jsonb not null default '{}'::jsonb,
	metadata jsonb not null default '{}'::jsonb,
	created_at timestamptz not null default now(),
	updated_at timestamptz not null default now(),
	unique (source_id, external_id),
	check (kind <> ''),
	check (title <> '')
);

create index catalog_items_source_kind_idx
	on catalog_items (source_id, kind);

create index catalog_items_metadata_gin_idx
	on catalog_items using gin (metadata jsonb_path_ops);
```

`locator` contains the minimum source-specific data needed to launch the item.
For Codeforces this is `contest_id` and `index`.

`metadata` contains filterable facts such as rating and tags. The first
Codeforces seed can use:

```json
{
  "rating": 800,
  "tags": ["math", "implementation"]
}
```

`metadata` must not contain hosted item content.

### `group_daily_feeds`

```sql
create table group_daily_feeds (
	id uuid primary key default gen_random_uuid(),
	group_id uuid not null references groups(id) on delete cascade,
	name text not null,
	slug text not null,
	description text,
	enabled boolean not null default true,
	audience jsonb not null default '{"type":"all_group_members"}'::jsonb,
	schedule jsonb not null default '{"cadence":"daily","timezone":"UTC"}'::jsonb,
	rules_schema_version integer not null default 1,
	rules jsonb not null,
	created_by_user_id uuid references users(id),
	created_at timestamptz not null default now(),
	updated_at timestamptz not null default now(),
	unique (group_id, slug),
	check (slug ~ '^[a-z0-9][a-z0-9-]*[a-z0-9]$'),
	check (name <> '')
);

create index group_daily_feeds_group_enabled_idx
	on group_daily_feeds (group_id, enabled);
```

`audience` controls who can view the feed output.

All group members:

```json
{
  "type": "all_group_members"
}
```

Division audience:

```json
{
  "type": "division",
  "division_id": "division-id"
}
```

`schedule` controls feed-local date resolution.

```json
{
  "cadence": "daily",
  "timezone": "America/Chicago"
}
```

The first implementation only needs `cadence = "daily"`.

`rules` controls item selection. Rules select catalog items. They do not build
URLs and they do not contain hosted item content.

Example Codeforces rules:

```json
{
  "blocks": [
    {
      "source": "codeforces",
      "kind": "competitive_programming_problem",
      "count": 3,
      "filters": {
        "rating": {
          "min": 800,
          "max": 1200,
          "target": 1000
        },
        "tags": {
          "include_any": ["implementation"],
          "exclude_any": ["geometry"]
        }
      },
      "roles": ["warmup", "target", "stretch"],
      "points": [1, 1, 2]
    }
  ]
}
```

## Rule Semantics

The first rule schema uses `blocks`. Each block selects some number of catalog
items from one source and item kind.

Required block fields:

- `source`
- `kind`
- `count`

Optional block fields:

- `filters.rating.min`
- `filters.rating.max`
- `filters.rating.target`
- `filters.tags.include_any`
- `filters.tags.exclude_any`
- `roles`
- `points`

Rating filters read `catalog_items.metadata.rating`.

Tag filters read `catalog_items.metadata.tags`.

`include_any` means the item must have at least one listed tag. `exclude_any`
means the item must have none of the listed tags.

If `roles` is omitted, roles are assigned by position:

```text
1 item: target
2 items: warmup, target
3 items: warmup, target, stretch
4+ items: warmup, target, stretch, bonus...
```

If `points` is omitted, each item is worth `1`.

If multiple blocks select the same catalog item, the first block wins and later
blocks skip that item.

If a block cannot select enough items, generation returns a structured error.
The generator should not silently include items that fail the rule.

## Generation Model

Daily output generation is an on-demand read operation.

Input:

- feed id
- optional date
- current user

Process:

1. Load the feed and group.
2. Verify the feed is enabled.
3. Verify the current user is an active group member.
4. Verify the current user matches the feed audience.
5. Resolve the target date in the feed schedule timezone.
6. Load candidate catalog items for each rule block.
7. Apply metadata filters.
8. Rank candidates deterministically.
9. Select the requested number of items from each block.
10. Assign positions, roles, points, and recommendation reasons.
11. Resolve each selected item into an external action.
12. Return the daily output.

Generation must not use the requesting user's preferences or solved history.
The requesting user can cause the read, but cannot influence shared selection.

### Deterministic Ranking

Selection should vary by feed and date without requiring stored output rows.

For a block with a target rating, rank by:

```text
abs(metadata.rating - target_rating),
stable_hash(feed_id, date, block_index, catalog_item_id)
```

For a block without a target rating, rank by:

```text
stable_hash(feed_id, date, block_index, catalog_item_id)
```

The exact hash function can be implemented in Go or SQL. The important property
is deterministic variation by feed, date, block, and item.

Because outputs are not materialized, changing feed rules, source resolvers, or
catalog seed data can change the generated response for any date.

### Recommendation Reasons

Recommendation reasons are response fields, not stored records.

Examples:

```text
warmup pick, rating 800 within 200 of target
target pick from implementation tag
selected by deterministic date rotation
```

## Source Resolution

The response layer resolves selected catalog items into actions using the item
source resolver.

For a template action:

```json
{
  "type": "external_url",
  "label": "Open on Codeforces",
  "template": "https://codeforces.com/problemset/problem/{contest_id}/{index}"
}
```

Arcade substitutes fields from `catalog_items.locator`.

For a field action:

```json
{
  "type": "external_url",
  "label": "Open",
  "field": "url"
}
```

Arcade reads `catalog_items.locator.url`.

Resolved action:

```json
{
  "type": "external_url",
  "label": "Open on Codeforces",
  "url": "https://codeforces.com/problemset/problem/4/A"
}
```

URLs should be validated before being returned. The first implementation should
allow only `https://` URLs for generated external actions.

## API Design

Recommended feed management endpoints:

```text
GET    /api/groups/{group_id}/daily-feeds
POST   /api/groups/{group_id}/daily-feeds
GET    /api/groups/{group_id}/daily-feeds/{feed_id}
PATCH  /api/groups/{group_id}/daily-feeds/{feed_id}
DELETE /api/groups/{group_id}/daily-feeds/{feed_id}
```

Recommended output endpoints:

```text
GET /api/groups/{group_id}/daily-feeds/{feed_id}/today
GET /api/groups/{group_id}/daily-feeds/{feed_id}/outputs/{date}

GET /api/me/daily-feeds
GET /api/me/daily-feed-outputs
```

`GET /api/me/daily-feeds` returns feed definitions visible to the current user
through group membership.

`GET /api/me/daily-feed-outputs` returns today's generated outputs across all
groups and feeds the current user receives.

There is no generate endpoint in this design. Reading a feed output computes it.

### Create Feed Request

```json
{
  "name": "Beginner Daily",
  "slug": "beginner-daily",
  "description": "Three approachable Codeforces pointers for new members.",
  "audience": {
    "type": "all_group_members"
  },
  "schedule": {
    "cadence": "daily",
    "timezone": "America/Chicago"
  },
  "rules": {
    "blocks": [
      {
        "source": "codeforces",
        "kind": "competitive_programming_problem",
        "count": 3,
        "filters": {
          "rating": {
            "min": 800,
            "max": 1200,
            "target": 1000
          },
          "tags": {
            "include_any": ["implementation"],
            "exclude_any": ["geometry"]
          }
        },
        "roles": ["warmup", "target", "stretch"],
        "points": [1, 1, 2]
      }
    ]
  }
}
```

### Feed Response

```json
{
  "id": "feed-id",
  "group_id": "group-id",
  "name": "Beginner Daily",
  "slug": "beginner-daily",
  "description": "Three approachable Codeforces pointers for new members.",
  "enabled": true,
  "audience": {
    "type": "all_group_members"
  },
  "schedule": {
    "cadence": "daily",
    "timezone": "America/Chicago"
  },
  "rules_schema_version": 1,
  "rules": {
    "blocks": []
  }
}
```

### Daily Output Response

```json
{
  "feed_id": "feed-id",
  "group_id": "group-id",
  "date": "2026-06-21",
  "title": "Beginner Daily",
  "items": [
    {
      "position": 1,
      "role": "warmup",
      "points": 1,
      "reason": "warmup pick, rating 800 within 200 of target",
      "item": {
        "id": "catalog-item-id",
        "source": "codeforces",
        "external_id": "4A",
        "kind": "competitive_programming_problem",
        "title": "Watermelon",
        "metadata": {
          "rating": 800,
          "tags": ["math", "implementation"]
        }
      },
      "action": {
        "type": "external_url",
        "label": "Open on Codeforces",
        "url": "https://codeforces.com/problemset/problem/4/A"
      }
    }
  ]
}
```

The response can include catalog metadata, but must not include source-owned
content.

## Authorization

### Feed Management

Owners and admins can:

- create feeds
- update feeds
- enable or disable feeds
- delete feeds

Members can:

- list feeds they are eligible to receive
- view eligible feed outputs

### Feed Output Access

Feed output access is checked from the feed definition:

- The user must have active membership in the feed's group.
- The user must match the feed audience.
- The feed must be enabled unless the requester is an owner or admin previewing
  the feed.

Division-targeted feeds require a reliable division membership check. If
division membership is not available, division audiences should not be exposed
in the UI.

## Seed Data

Source definitions and catalog items can be maintained as JSON seed data.

Recommended file shape:

```text
data/sources/codeforces.source.json
data/sources/codeforces.items.json
```

Source definition:

```json
{
  "slug": "codeforces",
  "name": "Codeforces",
  "base_url": "https://codeforces.com",
  "resolver_schema_version": 1,
  "resolver": {
    "default_action": {
      "type": "external_url",
      "label": "Open on Codeforces",
      "template": "https://codeforces.com/problemset/problem/{contest_id}/{index}"
    },
    "required_locator_fields": ["contest_id", "index"]
  },
  "capabilities": {
    "ratings": true,
    "tags": true
  }
}
```

Catalog item seed:

```json
{
  "source": "codeforces",
  "items": [
    {
      "external_id": "4A",
      "kind": "competitive_programming_problem",
      "title": "Watermelon",
      "locator": {
        "contest_id": "4",
        "index": "A"
      },
      "metadata": {
        "rating": 800,
        "tags": ["math", "implementation"]
      }
    }
  ]
}
```

Seed loading should reject item fields that attempt to store hosted content.
Examples of rejected field names include:

- `statement`
- `prompt`
- `body`
- `content`
- `sample_input`
- `sample_output`
- `editorial`
- `solution`

## UI Shape

The main daily surface should become an inbox of eligible feed outputs:

```text
My Dailies
  ICPC Club / Beginner Daily / Today
  ICPC Club / Graphs Week / Today
  Interview Group / Mock Prep / Today
```

Group pages should expose feed management to owners/admins:

```text
Group
  Feeds
    Beginner Daily
    Div 2 Practice
    Graphs Week
```

For a member, a feed output page shows:

- generated items for the selected date
- source, title, rating, tags, role, and points
- an external action button for each item

For an owner/admin, the feed page also shows:

- edit feed
- edit criteria
- enable or disable

The UI should not route users to an Arcade-hosted problem page. The primary
action for a feed item should open the source-owned location.

## Testing

Server tests should cover:

- owner/admin can create and update a feed
- member cannot mutate a feed
- active member can view an eligible feed output
- non-member cannot view a feed output
- division audience blocks users outside the division
- generation does not use the requesting user's preferences
- generation does not use the requesting user's solved history
- repeated reads return the same output for unchanged feed/catalog/date inputs
- different dates produce deterministic variation
- Codeforces resolver builds the expected external URL
- direct URL resolver returns only valid `https://` URLs
- generated output does not include hosted content fields
- insufficient candidates return a structured error

Seed validation tests should cover:

- source resolver required fields are enforced
- catalog item uniqueness by `(source_id, external_id)` is enforced
- content-like seed fields are rejected
- tag and rating filters read from `metadata`
