# Data Model

Arcade uses Postgres as the source of truth. The canonical schema lives in
`internal/migrations/*.sql`; the Go structs in `internal/app/types.go` describe
the JSON shape exposed by the API.

## Conventions

- Primary keys are UUIDs generated in Postgres with `gen_random_uuid()` from
  `pgcrypto`.
- Most user-facing mutable tables carry `created_at` and `updated_at`
  timestamps. Tables with `updated_at` use the shared `set_updated_at()` trigger.
- Enum-like values are stored as `text` with `check` constraints instead of
  Postgres enum types.
- Deletion behavior is encoded with foreign-key actions. Ownership-style child
  rows usually cascade; historical records such as submissions generally keep
  their problem and source references.
- Some uniqueness rules use partial indexes to model optional scope, especially
  rows where `source_id` or `scope_id` can be null.

## Relationship Map

```mermaid
erDiagram
    users ||--o{ user_sessions : authenticates
    users ||--o{ external_accounts : owns
    problem_sources ||--o{ external_accounts : provides
    problem_sources ||--o{ problems : catalogs
    problems ||--o{ problem_tags : tagged_by

    users ||--o{ user_preferences : configures
    problem_sources ||--o{ user_preferences : scopes
    user_preferences ||--o{ user_preference_tags : filters

    users ||--o{ groups : creates
    groups ||--o{ group_memberships : has
    users ||--o{ group_memberships : joins
    groups ||--o{ divisions : contains
    users ||--o{ divisions : creates
    divisions ||--o{ division_rules : defines
    problem_sources ||--o{ division_rules : scopes
    division_rules ||--o{ division_rule_tags : constrains

    users ||--o{ daily_sets : receives
    groups ||--o{ daily_sets : receives
    divisions ||--o{ daily_sets : receives
    daily_sets ||--o{ daily_set_items : contains
    problems ||--o{ daily_set_items : assigned

    users ||--o{ submissions : makes
    problems ||--o{ submissions : solves
    problem_sources ||--o{ submissions : reports
    external_accounts ||--o{ submissions : imports
    daily_sets ||--o{ submissions : attributes

    leaderboard_snapshots ||--o{ leaderboard_snapshot_rows : contains
    users ||--o{ leaderboard_snapshot_rows : ranks
```

## Identity And Providers

`users` stores local account credentials and profile data. Email is normalized
before storage and enforced uniquely by `lower(email)`. Passwords are stored as
hashes only; plaintext passwords are never persisted. `username` remains for
compatibility and display URLs, but login uses email.

`user_sessions` stores cookie-backed sessions. Only a SHA-256 hash of the raw
session token is stored; the browser receives the raw token in the
`arcade_session` cookie. Sessions track expiration, optional remember-me
lifetime, revocation, and last-seen metadata.

`problem_sources` stores external problem providers such as Codeforces, AtCoder,
and Advent of Code. Each source has a stable `slug`, display name, base URL, and
capability flags for submissions, ratings, and tags.

`external_accounts` links a local user to a handle on a problem source. The
same `(source_id, external_handle)` can only be linked once. Sync state is
tracked with `sync_status`, `verified_at`, and `last_synced_at`.

## Catalog

`problems` stores provider problems. The provider identity is
`(source_id, external_id)`, which is unique. Optional contest metadata, rating,
difficulty label, and publish timestamp support source-specific catalog views.

`problem_tags` stores tags for a problem. Tags have a `source` value of
`provider`, `arcade`, `user`, or `model`, with one row per
`(problem_id, tag, source)`.

The initial migration seeds source rows and a small Codeforces problem catalog
with provider tags. Seed rows use `on conflict` so a fresh database can be
created from migrations alone.

## Preferences

`user_preferences` stores daily recommendation settings. A row can be global
for a user when `source_id` is null, or scoped to a single problem source when
`source_id` is set. Partial unique indexes enforce one global preference row per
user and one source-specific row per `(user_id, source_id)`.

`user_preference_tags` stores tag preferences for a preference row. The
`preference` value is either `preferred` or `blocked`, and each
`(user_preference_id, tag, preference)` is unique.

## Groups And Divisions

`groups` represents a social or team scope. Group slugs are globally unique.
Visibility is constrained to `public`, `invite_only`, or `private`.

`group_memberships` connects users to groups with a role and lifecycle status.
Roles are `owner`, `admin`, or `member`; statuses are `invited`, `active`,
`removed`, or `left`. A user has at most one membership row per group.

`divisions` partitions a group or defines a global division when `group_id` is
null. Slugs are unique within a group via `(group_id, slug)`, and global
division slugs are unique through a partial index on rows where `group_id` is
null.

`division_rules` stores rating, source, and problem-count criteria for a
division. `division_rule_tags` adds required or excluded tag constraints for a
rule.

## Daily Practice

`daily_sets` is the header for generated daily assignments. The `scope_type`
can be `user`, `group`, `division`, `group_division`, or `global`. Scope-specific
foreign keys are optional so the row can represent different scopes, while
uniqueness is enforced by `(scope_type, scope_id, date)` plus a partial unique
index for null `scope_id`.

`daily_set_items` stores the ordered problems in a daily set. Each problem can
appear once per set, and each position can be used once per set. Item roles are
`warmup`, `target`, `stretch`, or `bonus`.

## Submissions And Solves

`submissions` records imported or manual user attempts. Verdicts include
provider-style results such as `accepted`, `wrong_answer`, and
`time_limit_exceeded`, plus Arcade-specific values such as `completed` and
`manual_solve`.

External submissions are deduplicated by `(source_id, external_submission_id)`.
Because Postgres unique indexes allow multiple null values, manual submissions
without an external submission ID are not blocked by that constraint.

If a daily set is deleted, related submissions keep their solve history and set
`daily_set_id` to null. If a user is deleted, that user's submissions are
deleted.

## Leaderboards

The live leaderboard API is derived from `submissions`. The
`leaderboard_snapshots` and `leaderboard_snapshot_rows` tables exist for future
materialized leaderboards. Snapshot scope is constrained to `global`, `group`,
`daily`, or `division`; periods are `all_time`, `yearly`, `monthly`, `weekly`,
or `daily`; metrics are `points`, `solves`, `rating_gain`, or `streak`.

Rows are unique by rank and user within a snapshot. Snapshot headers also have a
partial unique index for null `scope_id` so global snapshots are unique by
`(scope_type, period, metric, computed_at)`.
