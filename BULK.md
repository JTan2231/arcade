# Bulk Catalog Imports

This document describes the proposed contract for loading large external
catalogs into Arcade through a normalized JSONL upload. The motivating first
case is Codeforces problem metadata, but the upload shape is intentionally
provider-neutral.

## Current Model

Arcade practice feeds are powered by catalog tables:

- `catalog_sources` stores a source collection and its render template.
- `catalog_items` stores source-specific metadata in `data` JSON.
- `catalog_source_fields` declares which `data` keys can be used in feed rules.
- `group_daily_feeds` references one catalog source for `catalog_daily` feeds.

The old provider-backed problem catalog (`problem_sources`, `problems`, and
`problem_tags`) has been removed by migration `009_drop_provider_problem_catalog.sql`.
Bulk imports should therefore load catalog source data directly instead of
trying to maintain a separate provider problem table.

Current constraints that matter for this design:

- `catalog_sources` are group-owned today because `group_id` is required.
- `catalog_items` do not have a stable external identity column.
- Feed creation only accepts catalog sources owned by the current group.
- Catalog item `data` must not contain statements, prompts, samples,
  editorials, solutions, or other answer-bearing content.

The global Codeforces problemset source requires schema/API work before it can
be represented exactly as "available to everyone and owned by no group."

## Goals

- Accept one uploaded JSONL file containing normalized catalog data.
- Provide a local Codeforces loading helper that can fetch raw Codeforces
  metadata, convert it to the normalized JSONL contract, and upload/import the
  result.
- Keep provider-specific scraping and transformation outside Arcade.
- Make uploads idempotent by using stable source and item keys.
- Allow dry-run validation before any database writes.
- Load datasets the size of Codeforces in one synchronous request or command.
- Keep feed generation based on `catalog_items.data` and source templates.

## Non-Goals

- Do not upload problem statements, samples, editorials, solutions, or source
  code.
- Do not make Arcade parse raw Codeforces API responses in the upload path.
- Do not make normal app startup depend on remote provider availability.
- Do not hard-delete missing provider rows during the first implementation.

## Local Codeforces Loader

The normalized JSONL contract does not mean operators should hand-build the
Codeforces file. The local Codeforces loading script should own the
provider-specific end-to-end flow:

1. Fetch `https://codeforces.com/api/problemset.problems`, or optionally read a
   saved API response from disk for repeatable debugging.
2. Validate and reformat the raw Codeforces response into the
   `arcade.catalog_import.v1` JSONL shape described below.
3. Optionally write the generated JSONL file to disk for inspection and replay.
4. Run a dry-run validation against Arcade's importer when requested.
5. Upload or import the generated JSONL.

Arcade's import endpoint or command should still receive only normalized JSONL.
It should not make remote Codeforces API calls, and raw Codeforces response
bodies should not become part of the provider-neutral upload contract.

## Required Schema Support

The upload contract is easiest to implement after these model additions:

1. Add stable keys to `catalog_sources`.

   Suggested columns:

   ```sql
   slug text,
   scope text not null default 'group',
   ```

   Suggested scopes:

   - `group`: source belongs to one group.
   - `global`: source is available to every group and has no group owner.

   For global sources, `group_id` should be nullable. Unique rules should allow
   one global source per slug and one group source per `(group_id, slug)`.

2. Add stable keys to `catalog_items`.

   Suggested column:

   ```sql
   external_id text
   ```

   Suggested unique index:

   ```sql
   create unique index catalog_items_source_external_id_unique
     on catalog_items (source_id, external_id)
     where external_id is not null;
   ```

   The importer can still copy `external_id` into `data` for display/debugging,
   but idempotent writes should rely on a real column.

3. Update feed source visibility.

   API queries and validation should treat a source as available when either:

   - `catalog_sources.group_id = current group`, or
   - `catalog_sources.scope = 'global'`.

   Feed foreign keys and helper checks currently assume source/group equality;
   they need to allow global sources without weakening group authorization for
   feeds themselves.

## JSONL File Contract

Files are UTF-8 JSON Lines. Every non-empty line is one JSON object. The first
line must be a manifest. Later lines may appear in any order, but importer
implementations may choose to buffer validation before writing.

Every line has:

```json
{
  "schema": "arcade.catalog_import.v1",
  "kind": "..."
}
```

Unknown schemas are rejected. Unknown kinds are rejected.

### Manifest

The manifest describes one catalog source.

```json
{
  "schema": "arcade.catalog_import.v1",
  "kind": "manifest",
  "generated_at": "2026-06-26T00:00:00Z",
  "catalog_source": {
    "slug": "codeforces-problemset",
    "name": "Codeforces Problemset",
    "scope": "global",
    "template": "https://codeforces.com/problemset/problem/{contest_id}/{index}"
  },
  "provider": {
    "slug": "codeforces",
    "name": "Codeforces",
    "base_url": "https://codeforces.com"
  }
}
```

Required manifest fields:

- `generated_at`: RFC3339 timestamp for provenance.
- `catalog_source.slug`: stable source key.
- `catalog_source.name`: display name.
- `catalog_source.scope`: `global` or `group`.
- `catalog_source.template`: render template used by daily outputs.

Optional provider fields are stored only if we add metadata columns for them;
otherwise they are informational and should be included in import logs.

### Catalog Field

Field rows declare filterable item metadata.

```json
{
  "schema": "arcade.catalog_import.v1",
  "kind": "catalog_field",
  "catalog_source_slug": "codeforces-problemset",
  "key": "rating",
  "label": "Rating",
  "value_type": "number",
  "is_array": false,
  "display_order": 10
}
```

Required fields:

- `catalog_source_slug`
- `key`
- `label`
- `value_type`: `string` or `number`
- `is_array`
- `display_order`

For Codeforces, the initial field set should be:

```jsonl
{"schema":"arcade.catalog_import.v1","kind":"catalog_field","catalog_source_slug":"codeforces-problemset","key":"rating","label":"Rating","value_type":"number","is_array":false,"display_order":10}
{"schema":"arcade.catalog_import.v1","kind":"catalog_field","catalog_source_slug":"codeforces-problemset","key":"tags","label":"Tags","value_type":"string","is_array":true,"display_order":20}
{"schema":"arcade.catalog_import.v1","kind":"catalog_field","catalog_source_slug":"codeforces-problemset","key":"solved_count","label":"Solved Count","value_type":"number","is_array":false,"display_order":30}
{"schema":"arcade.catalog_import.v1","kind":"catalog_field","catalog_source_slug":"codeforces-problemset","key":"type","label":"Type","value_type":"string","is_array":false,"display_order":40}
```

### Catalog Item

Item rows are source entries. They map directly to `catalog_items`.

```json
{
  "schema": "arcade.catalog_import.v1",
  "kind": "catalog_item",
  "catalog_source_slug": "codeforces-problemset",
  "external_id": "4A",
  "data": {
    "external_id": "4A",
    "name": "Watermelon",
    "contest_id": "4",
    "index": "A",
    "rating": 800,
    "tags": ["brute force", "math"],
    "solved_count": 319000,
    "type": "PROGRAMMING",
    "points": 500
  }
}
```

Required item fields:

- `catalog_source_slug`
- `external_id`
- `data`

Required `data` fields are determined by the source template. For the
Codeforces template, each item must include:

- `name`
- `contest_id`
- `index`

Recommended Codeforces metadata:

- `external_id`: stable Arcade key such as `4A`.
- `name`: Codeforces problem name.
- `contest_id`: stringified Codeforces `contestId`.
- `index`: Codeforces problem index.
- `rating`: Codeforces problem rating, when present.
- `tags`: Codeforces tags.
- `solved_count`: joined from Codeforces `problemStatistics`.
- `type`: Codeforces problem type, usually `PROGRAMMING`.
- `points`: Codeforces points, when present.

Do not include statements, prompts, samples, editorials, or solutions.

## Codeforces Formatter Contract

The Codeforces formatter is responsible for turning raw Codeforces API data
into the JSONL contract above.

Input:

- `problemset.problems` response from Codeforces, either fetched live or read
  from a local JSON file.

Formatter responsibilities:

1. Require `status = "OK"`.
2. Join `result.problemStatistics` to `result.problems` by `(contestId, index)`.
3. Derive `external_id` as `contestId + index`, matching Arcade's historical
   Codeforces key style, for example `4A`.
4. Derive the URL only implicitly through the source template; do not store it
   in every item unless we add a dedicated use for it.
5. Emit one manifest line.
6. Emit catalog field lines.
7. Emit one catalog item line per problem that can satisfy the template.
8. Skip or report rows missing `contestId` or `index`.
9. Emit normalized metadata only.

Current Codeforces dataset size is small enough for whole-file formatting:
roughly 11k problems, 11k statistics rows, and low single-digit MiB raw JSON.

## Upload API Contract

Proposed route:

```http
POST /api/catalog-imports
Content-Type: multipart/form-data
```

Fields:

- `file`: required JSONL file.
- `dry_run`: optional boolean, default `false`.
- `owner_user_id`: optional UUID for admin/operator-driven provenance.

Ownership rules:

- For ordinary authenticated users, the importer should use the current session
  user as `created_by_user_id` for newly created sources.
- For global/built-in sources, `created_by_user_id` may be null if the schema
  allows it. If a user id is required, use it as provenance rather than
  ownership.
- `owner_user_id` should be accepted only from an operator/admin surface, not
  trusted from arbitrary clients.

Suggested response:

```json
{
  "dry_run": false,
  "status": "completed",
  "counts": {
    "lines": 11260,
    "sources_seen": 1,
    "sources_inserted": 1,
    "sources_updated": 0,
    "fields_seen": 4,
    "fields_upserted": 4,
    "items_seen": 11255,
    "items_inserted": 11255,
    "items_updated": 0,
    "items_skipped": 0
  },
  "warnings": [],
  "errors": []
}
```

For invalid uploads, return `400` with structured errors:

```json
{
  "error": "catalog import validation failed",
  "errors": [
    {
      "line": 42,
      "code": "missing_template_field",
      "message": "catalog item data is missing required template field contest_id"
    }
  ]
}
```

## Import Semantics

The import should validate the entire file before writing unless the file is
too large to hold. Codeforces-sized imports can be fully validated in memory.

For non-dry-run imports:

1. Start a database transaction.
2. Upsert the catalog source by global slug or group slug.
3. Upsert catalog fields by `(source_id, key)`.
4. Upsert catalog items by `(source_id, external_id)`.
5. Commit.

Upsert behavior:

- Source updates may change `name` and `template`.
- Field updates may change `label`, `value_type`, `is_array`, and
  `display_order`.
- Item updates replace the stored `data` object for that `external_id`.

Deletion behavior:

- Do not delete catalog items absent from an upload by default.
- A later contract can add manifest options for `delete_missing`,
  `mark_missing_inactive`, or generation scoping.
- Avoid hard deletion initially because daily feed outputs are computed from
  the current item set; deleting rows could change historical generated output.

## Validation Rules

Reject the upload when:

- The first non-empty line is not a manifest.
- Any line is invalid JSON.
- Any line has an unknown schema or kind.
- More than one manifest is present.
- `catalog_source.slug` is missing or malformed.
- `catalog_source.scope` is not `global` or `group`.
- A group-scoped import has no target group.
- A global import is attempted by an unauthorized caller.
- A catalog field has invalid `value_type`.
- A catalog item is missing `external_id`.
- A catalog item has duplicate `external_id` within the file.
- A catalog item `data` value is not a JSON object.
- A catalog item is missing data required by the source template.
- A catalog item includes forbidden answer-bearing keys.
- A filterable field's declared type does not match item data in a way that
  would make filters unreliable.

Warnings are appropriate when:

- Optional metadata is missing, such as `rating`, `points`, or `solved_count`.
- Unknown extra `data` keys are present but harmless.
- A formatter reports skipped upstream rows.

## Memory And Size Expectations

The current Codeforces problemset payload is small enough for simple processing:

- About 2.2 MB raw JSON.
- About 294 KB compressed over HTTP.
- About 11k problem rows.
- About 32k tag values.

A Go importer can read the uploaded JSONL, decode it into typed structs, keep a
map of `external_id` values for duplicate detection, and batch database writes
without meaningful memory pressure. A plain implementation should stay in the
low tens of MiB of transient memory for Codeforces-sized imports.

## Implementation Shape

Keep responsibilities separate:

- Formatter script: provider-specific fetch, join, normalization, JSONL emit.
- Upload handler: auth, file limit, JSONL parse, validation, transaction.
- Import package: reusable validation and upsert logic.
- Optional CLI: call the same import package from a local file path.

Suggested local command shape:

```sh
go run ./cmd/catalog-import -file codeforces.jsonl -dry-run
go run ./cmd/catalog-import -file codeforces.jsonl
```

Suggested HTTP shape:

```sh
curl -F dry_run=true -F file=@codeforces.jsonl http://localhost:8080/api/catalog-imports
```

The HTTP and CLI paths should share the same parser and importer so validation
does not drift.

## Open Decisions

- Whether global catalog sources should have `created_by_user_id = null` or a
  provenance user id.
- Whether source slugs should be user-visible in API responses.
- Whether import access should be group admin, site admin, or local CLI only.
- Whether imports should support `delete_missing` later.
- Whether to add provider metadata columns to `catalog_sources` or keep provider
  details only in import logs.
- Whether `points` should be a default filterable Codeforces field.
