# Arcade Model

Arcade is a social practice layer over competitive programming sources such as
Codeforces, Advent of Code, AtCoder, and similar archives. It should not model
itself as a full Codeforces replacement. The important product object is the
ritual around practice: groups, divisions, tailored dailies, virtual sessions,
streaks, and leaderboards.

The external platforms provide problem catalogs, ratings, tags, contests, and
submission data. Arcade owns the social graph, recommendation state, generated
practice sets, scoring rules, and historical leaderboard views.

## Product Shape

The conversation suggests this core loop:

1. Users link one or more competitive programming accounts.
2. Users join groups, which act like dojos, crews, or private leaderboards.
3. The app assigns or recommends divisions based on rating, topic skill, source,
   and preferences.
4. The app generates dailies and practice sets tailored to the user, group, or
   division.
5. Users run virtual sessions together.
6. Solves and submissions become points, streaks, rating signals, and
   leaderboard rows.

The product should therefore be modeled around social scopes and practice
events, not just around problems.

## Core Assumptions

- A user in Arcade is not the same thing as a Codeforces handle.
- A user may link multiple external accounts.
- A group is the primary social unit.
- A division is an Arcade concept, even when it resembles Codeforces divisions.
- A daily set is a generated artifact that should be stored, not recomputed from
  scratch every time.
- A virtual session is a first-class event with participants, timing, scoring,
  and a leaderboard.
- Submissions and solve events are the source of truth.
- Leaderboards are derived views or materialized snapshots.
- Skill should eventually be modeled per source and per topic, not only as a
  single global rating.
- Avoid JSONB columns in the Arcade model. Event-specific context should be
  represented by typed columns, rows, or dedicated detail tables when it becomes
  worth storing.

## Entities

### users

Represents an Arcade identity.

Assumptions imposed:

- The app owns identity, auth, display names, and local preferences.
- External handles are linked to a user instead of being the user.
- Social features use `users.id`, not provider-specific handles.

Suggested fields:

```sql
id uuid primary key
username text unique not null
display_name text not null
avatar_url text
created_at timestamptz not null
updated_at timestamptz not null
```

Notes:

- `username` should be stable enough for URLs.
- `display_name` can be mutable.
- Auth provider fields can live here or in a separate auth table depending on the
  stack.

### problem_sources

Represents external competitive programming platforms.

Assumptions imposed:

- Arcade will support more than one source.
- Source-specific identifiers should be normalized behind one local table.
- Source-specific metadata should not leak into every downstream table.

Suggested fields:

```sql
id uuid primary key
slug text unique not null -- codeforces, advent_of_code, atcoder
name text not null
base_url text not null
supports_submissions boolean not null default true
supports_problem_ratings boolean not null default false
supports_tags boolean not null default false
created_at timestamptz not null
updated_at timestamptz not null
```

### external_accounts

Links an Arcade user to a provider account.

Assumptions imposed:

- One user can have multiple provider accounts.
- A provider account should belong to at most one Arcade user.
- Verification and syncing are separate concerns.

Suggested fields:

```sql
id uuid primary key
user_id uuid not null references users(id)
source_id uuid not null references problem_sources(id)
external_handle text not null
external_user_id text
verified_at timestamptz
last_synced_at timestamptz
sync_status text not null default 'pending'
created_at timestamptz not null
updated_at timestamptz not null

unique (source_id, external_handle)
```

Common `sync_status` values:

```txt
pending
syncing
synced
failed
disabled
```

### groups

Represents a dojo, crew, friend group, server, or local leaderboard community.

Assumptions imposed:

- Social activity is scoped.
- A user can participate in multiple independent practice scenes.
- Groups own dailies, sessions, divisions, and leaderboards.

Suggested fields:

```sql
id uuid primary key
name text not null
slug text unique not null
description text
visibility text not null -- public, invite_only, private
created_by_user_id uuid not null references users(id)
created_at timestamptz not null
updated_at timestamptz not null
```

### group_memberships

Represents membership and permissions inside a group.

Assumptions imposed:

- Group membership is many-to-many.
- Roles differ by group.
- Joining a group is separate from joining a session.

Suggested fields:

```sql
id uuid primary key
group_id uuid not null references groups(id)
user_id uuid not null references users(id)
role text not null -- owner, admin, member
status text not null -- invited, active, removed, left
joined_at timestamptz
created_at timestamptz not null
updated_at timestamptz not null

unique (group_id, user_id)
```

### problems

Represents a normalized problem from an external source.

Assumptions imposed:

- Problems have local IDs.
- Source IDs are still preserved for sync and linking.
- Rating and contest fields are optional because not every source has them.

Suggested fields:

```sql
id uuid primary key
source_id uuid not null references problem_sources(id)
external_id text not null
title text not null
url text not null
contest_id text
problem_index text
rating integer
difficulty_label text
published_at timestamptz
created_at timestamptz not null
updated_at timestamptz not null

unique (source_id, external_id)
```

For Codeforces, `external_id` can be derived from contest ID and index, for
example `1845C`.

For Advent of Code, `external_id` might be `2023/day/12/part/1` or
`2023/day/12` depending on whether parts are modeled as separate problems.

### problem_tags

Represents tags assigned to problems.

Assumptions imposed:

- Tags drive recommendation and division logic.
- Source tags may be noisy.
- Arcade may eventually add normalized tags independent of provider tags.

Suggested fields:

```sql
id uuid primary key
problem_id uuid not null references problems(id)
tag text not null
source text not null -- provider, arcade, user, model
confidence numeric
created_at timestamptz not null

unique (problem_id, tag, source)
```

Examples:

```txt
dp
graphs
greedy
math
bitmasks
binary search
data structures
```

### user_skill_ratings

Represents estimated skill for a user by source and optionally by tag.

Assumptions imposed:

- Skill is multidimensional.
- The app can know that someone is stronger at greedy than dynamic programming.
- Ratings should include confidence because sparse data is common.

Suggested fields:

```sql
id uuid primary key
user_id uuid not null references users(id)
source_id uuid references problem_sources(id)
tag text
rating numeric not null
confidence numeric not null
sample_size integer not null default 0
updated_at timestamptz not null

unique (user_id, source_id, tag)
```

Examples:

```txt
user=A, source=codeforces, tag=null, rating=1420, confidence=0.82
user=A, source=codeforces, tag=dp, rating=1280, confidence=0.47
user=A, source=codeforces, tag=graphs, rating=1510, confidence=0.63
```

### user_preferences

Represents explicit recommendation preferences.

Assumptions imposed:

- Practice generation should not be purely rating-based.
- Users may want to emphasize or avoid specific categories.
- Different sources may need different preferences.
- Tag preferences are queried during generation, so they should be rows rather
  than JSON arrays.

Suggested fields:

```sql
id uuid primary key
user_id uuid not null references users(id)
source_id uuid references problem_sources(id)
target_difficulty_delta integer not null default 100
daily_problem_count integer not null default 3
include_solved boolean not null default false
created_at timestamptz not null
updated_at timestamptz not null

unique (user_id, source_id)
```

`target_difficulty_delta` means "prefer problems roughly this many rating points
above the user's estimated skill." A positive value favors stretch practice.

### user_preference_tags

Represents tag-level preference rows for a user preference record.

Assumptions imposed:

- Preferred and blocked tags need normal indexes and joins.
- We may eventually weight preferences without changing the surrounding model.
- Tags can stay as text until a dedicated tag vocabulary is worth the ceremony.

Suggested fields:

```sql
id uuid primary key
user_preference_id uuid not null references user_preferences(id) on delete cascade
tag text not null
preference text not null -- preferred, blocked
weight numeric not null default 1
created_at timestamptz not null

unique (user_preference_id, tag, preference)
```

Examples:

```txt
preferred dp, weight 1.0
preferred graphs, weight 0.7
blocked implementation, weight 1.0
```

### divisions

Represents a named product category for users or practice sets.

Assumptions imposed:

- Divisions are Arcade-native.
- Divisions can be global or group-specific.
- Divisions can represent rating bands, topic tracks, or novelty tracks.

Suggested fields:

```sql
id uuid primary key
group_id uuid references groups(id)
name text not null
slug text not null
description text
created_by_user_id uuid references users(id)
created_at timestamptz not null
updated_at timestamptz not null

unique (group_id, slug)
```

Examples:

```txt
Bronze
Silver
Div 2
DP Hards
Graph Week
Math Grind
```

### division_rules

Represents assignment and generation criteria for a division.

Assumptions imposed:

- Division membership can be computed rather than manually assigned.
- Division rules need to evolve without rewriting users.
- A division may target a rating range, a source, a topic, or a mix.
- Tag constraints are queried and composed, so they should be rows rather than
  JSON arrays.

Suggested fields:

```sql
id uuid primary key
division_id uuid not null references divisions(id)
source_id uuid references problem_sources(id)
min_user_rating integer
max_user_rating integer
min_problem_rating integer
max_problem_rating integer
problem_count integer
created_at timestamptz not null
updated_at timestamptz not null
```

### division_rule_tags

Represents tag constraints attached to a division rule.

Assumptions imposed:

- A rule can require multiple tags, exclude multiple tags, or do both.
- Rule evaluation should use ordinary relational predicates.
- This keeps division rules consistent with user preferences and problem tags.

Suggested fields:

```sql
id uuid primary key
division_rule_id uuid not null references division_rules(id) on delete cascade
tag text not null
constraint_type text not null -- required, excluded
created_at timestamptz not null

unique (division_rule_id, tag, constraint_type)
```

Examples:

```txt
Div 3: Codeforces user rating 0-1199
Div 2: Codeforces user rating 1200-1899
DP Hards: required tag dp, problem rating 1900+
```

### user_divisions

Optional table for materialized division assignments.

Assumptions imposed:

- Some division assignments should be stored for auditability and speed.
- Manual overrides may be useful.
- Computed assignment and explicit assignment should be distinguishable.

Suggested fields:

```sql
id uuid primary key
user_id uuid not null references users(id)
division_id uuid not null references divisions(id)
assignment_type text not null -- computed, manual
assigned_by_user_id uuid references users(id)
assigned_at timestamptz not null
expires_at timestamptz

unique (user_id, division_id)
```

This table is optional early on. For an MVP, division membership can be computed
from `division_rules`.

### daily_sets

Represents a generated daily practice set.

Assumptions imposed:

- Dailies are generated artifacts.
- A daily may be scoped to a user, group, division, or some combination.
- The app should remember what it recommended on a given date.

Suggested fields:

```sql
id uuid primary key
scope_type text not null -- user, group, division, group_division, global
scope_id uuid
group_id uuid references groups(id)
division_id uuid references divisions(id)
user_id uuid references users(id)
date date not null
title text
generation_reason text
generator_version text
created_at timestamptz not null

unique (scope_type, scope_id, date)
```

The redundant nullable scope columns make common queries easier. The canonical
scope can still be represented by `scope_type` and `scope_id`.

### daily_set_items

Represents the problems inside a daily set.

Assumptions imposed:

- Ordering matters.
- A daily can include warmups, target problems, and stretch problems.
- Problems may have different point values inside different sets.

Suggested fields:

```sql
id uuid primary key
daily_set_id uuid not null references daily_sets(id)
problem_id uuid not null references problems(id)
position integer not null
role text not null -- warmup, target, stretch, bonus
points integer not null default 1
recommendation_reason text
created_at timestamptz not null

unique (daily_set_id, problem_id)
unique (daily_set_id, position)
```

### virtual_sessions

Represents a scheduled or live practice event.

Assumptions imposed:

- "Rip a virtual" is a first-class workflow.
- Sessions have timing, participation, source, scoring, and status.
- Sessions can be generated from existing contests or from Arcade sets.

Suggested fields:

```sql
id uuid primary key
group_id uuid references groups(id)
host_user_id uuid not null references users(id)
source_id uuid references problem_sources(id)
daily_set_id uuid references daily_sets(id)
external_contest_id text
title text not null
mode text not null -- virtual_contest, practice_set, aoc_replay
status text not null -- scheduled, live, finished, cancelled
starts_at timestamptz
duration_minutes integer
scoring_rule_id uuid references scoring_rules(id)
created_at timestamptz not null
updated_at timestamptz not null
```

### session_participants

Represents a user's participation in a virtual session.

Assumptions imposed:

- Group membership does not imply session participation.
- Users may join late or finish early.
- Participant-level timing matters for virtual scoring.

Suggested fields:

```sql
id uuid primary key
session_id uuid not null references virtual_sessions(id)
user_id uuid not null references users(id)
status text not null -- joined, active, finished, abandoned
joined_at timestamptz not null
started_at timestamptz
finished_at timestamptz

unique (session_id, user_id)
```

### submissions

Represents provider submissions or Arcade solve events.

Assumptions imposed:

- Submissions and solves are the source of truth for scoring.
- Not every source has traditional judged submissions.
- Some solves may be manually entered or imported after the fact.

Suggested fields:

```sql
id uuid primary key
user_id uuid not null references users(id)
problem_id uuid not null references problems(id)
source_id uuid not null references problem_sources(id)
external_submission_id text
external_account_id uuid references external_accounts(id)
session_id uuid references virtual_sessions(id)
daily_set_id uuid references daily_sets(id)
verdict text not null
language text
submitted_at timestamptz not null
runtime_ms integer
memory_bytes integer
created_at timestamptz not null

unique (source_id, external_submission_id)
```

Common `verdict` values:

```txt
accepted
wrong_answer
time_limit_exceeded
memory_limit_exceeded
runtime_error
compile_error
partial
completed
manual_solve
```

For Advent of Code, `completed` may be more appropriate than `accepted`.

### problem_solves

Optional table for canonical first-solve facts.

Assumptions imposed:

- Many submissions can correspond to one solve.
- Scoring often cares about first accepted time.
- Leaderboard queries are easier when solve facts are materialized.

Suggested fields:

```sql
id uuid primary key
user_id uuid not null references users(id)
problem_id uuid not null references problems(id)
source_id uuid not null references problem_sources(id)
first_accepted_submission_id uuid references submissions(id)
first_solved_at timestamptz not null
solve_type text not null -- imported, live_session, manual
created_at timestamptz not null

unique (user_id, problem_id)
```

This can be derived from `submissions`, but it is useful enough to materialize
once imports and leaderboards become frequent.

### scoring_rules

Represents how points are computed for a scope.

Assumptions imposed:

- Different sessions and leaderboards may score differently.
- Common scoring knobs should be explicit columns instead of an opaque config
  blob.
- Historical leaderboards should know which scoring rule produced them.
- Truly novel scoring can be added as a new rule type or supporting table when
  it becomes real.

Suggested fields:

```sql
id uuid primary key
name text not null
slug text unique not null
description text
rule_type text not null -- contest, daily, streak
accepted_points integer not null default 1
use_daily_item_points boolean not null default false
wrong_submission_penalty_minutes integer not null default 0
all_solved_bonus_points integer not null default 0
rank_primary text not null -- points_desc, solves_desc, rating_gain_desc, streak_desc
rank_secondary text -- penalty_asc, finished_at_asc, none
created_at timestamptz not null
updated_at timestamptz not null
```

Example rules:

```txt
contest_standard: contest, accepted_points=1, wrong_penalty=20,
rank_primary=solves_desc, rank_secondary=penalty_asc

daily_standard: daily, use_daily_item_points=true, all_solved_bonus_points=2,
rank_primary=points_desc, rank_secondary=finished_at_asc
```

### leaderboard_snapshots

Represents a materialized leaderboard at a point in time.

Assumptions imposed:

- Leaderboards are derived views, not the primary source of truth.
- Historical snapshots are useful for weekly standings and post-session results.
- Different scopes and metrics should share one snapshot mechanism.
- Snapshot rows should be inspectable without parsing JSON.

Suggested fields:

```sql
id uuid primary key
scope_type text not null -- global, group, session, daily, division
scope_id uuid
period text not null -- all_time, yearly, monthly, weekly, daily, session
metric text not null -- points, solves, rating_gain, streak
scoring_rule_id uuid references scoring_rules(id)
computed_at timestamptz not null

unique (scope_type, scope_id, period, metric, computed_at)
```

### leaderboard_snapshot_rows

Represents materialized rows for a leaderboard snapshot.

Assumptions imposed:

- Rows are derived output, not source-of-truth solve history.
- Snapshot rows freeze display names and computed values as they appeared at
  computation time.
- Common leaderboard metrics should remain queryable.

Suggested fields:

```sql
id uuid primary key
snapshot_id uuid not null references leaderboard_snapshots(id) on delete cascade
rank integer not null
user_id uuid not null references users(id)
display_name text not null
points numeric not null default 0
solves integer not null default 0
penalty_seconds integer
rating_gain numeric
streak_count integer
tie_breaker_value numeric
created_at timestamptz not null

unique (snapshot_id, rank)
unique (snapshot_id, user_id)
```

Example row:

```txt
rank=1, user_id=..., display_name=Joey, points=42, solves=17,
penalty_seconds=3600
```

### activity_events

Optional append-only stream for social/activity surfaces.

Assumptions imposed:

- Feeds, notifications, and audit logs benefit from a common event stream.
- Not every event deserves its own table early.
- Events should reference typed entities.

Suggested fields:

```sql
id uuid primary key
actor_user_id uuid references users(id)
group_id uuid references groups(id)
event_type text not null
entity_type text not null
entity_id uuid not null
created_at timestamptz not null
```

Activity events intentionally avoid metadata blobs. Event-specific details should
live on the referenced entity or in a typed event detail table.

Examples:

```txt
session_created
session_joined
problem_solved
daily_completed
division_assigned
```

## Relationships

High-level relationship map:

```txt
users
  -> external_accounts
  -> group_memberships -> groups
  -> user_skill_ratings
  -> user_preferences -> user_preference_tags
  -> user_divisions -> divisions
  -> submissions -> problems
  -> problem_solves -> problems

problem_sources
  -> external_accounts
  -> problems
  -> user_skill_ratings
  -> virtual_sessions

problems
  -> problem_tags
  -> daily_set_items
  -> submissions
  -> problem_solves

groups
  -> group_memberships
  -> divisions -> division_rules -> division_rule_tags
  -> daily_sets
  -> virtual_sessions
  -> leaderboard_snapshots -> leaderboard_snapshot_rows

divisions
  -> division_rules -> division_rule_tags
  -> user_divisions
  -> daily_sets

daily_sets
  -> daily_set_items
  -> virtual_sessions
  -> submissions

virtual_sessions
  -> session_participants
  -> submissions
  -> leaderboard_snapshots -> leaderboard_snapshot_rows
```

## API Shape

The API should be organized around the product workflow:

- identity and linked accounts
- groups and memberships
- problem catalog
- divisions and preferences
- generated dailies
- virtual sessions
- submissions and sync
- leaderboards

### Identity

```http
GET    /me
PATCH  /me
PATCH  /me/preferences

GET    /me/external-accounts
POST   /me/external-accounts
GET    /me/external-accounts/:account_id
DELETE /me/external-accounts/:account_id
POST   /me/external-accounts/:account_id/verify
POST   /me/external-accounts/:account_id/sync
```

Example `POST /me/external-accounts`:

```json
{
  "source": "codeforces",
  "external_handle": "tourist"
}
```

### Sources And Problems

```http
GET /sources
GET /sources/:source_slug

GET /problems
GET /problems/:problem_id
GET /sources/:source_slug/problems
GET /sources/:source_slug/problems/:external_id
```

Suggested problem filters:

```txt
source
tag
min_rating
max_rating
contest_id
solved_by_me
unsolved_by_me
```

Example:

```http
GET /problems?source=codeforces&tag=dp&min_rating=1400&max_rating=1700&unsolved_by_me=true
```

### Groups

```http
POST   /groups
GET    /groups
GET    /groups/:group_id
PATCH  /groups/:group_id
DELETE /groups/:group_id

GET    /groups/:group_id/members
POST   /groups/:group_id/members
PATCH  /groups/:group_id/members/:user_id
DELETE /groups/:group_id/members/:user_id
```

Example `POST /groups`:

```json
{
  "name": "Morning Dojo",
  "slug": "morning-dojo",
  "visibility": "invite_only"
}
```

### Divisions

```http
GET    /groups/:group_id/divisions
POST   /groups/:group_id/divisions
GET    /groups/:group_id/divisions/:division_id
PATCH  /groups/:group_id/divisions/:division_id
DELETE /groups/:group_id/divisions/:division_id

GET    /groups/:group_id/divisions/:division_id/members
POST   /groups/:group_id/divisions/:division_id/recompute
```

Example `POST /groups/:group_id/divisions`:

```json
{
  "name": "DP Hards",
  "slug": "dp-hards",
  "rules": [
    {
      "source": "codeforces",
      "min_problem_rating": 1900,
      "required_tags": ["dp"],
      "problem_count": 3
    }
  ]
}
```

### Dailies

```http
GET  /me/daily
POST /me/dailies/generate
GET  /me/dailies

GET  /groups/:group_id/daily
POST /groups/:group_id/dailies/generate
GET  /groups/:group_id/dailies

GET  /groups/:group_id/divisions/:division_id/daily
POST /groups/:group_id/divisions/:division_id/dailies/generate

GET  /daily-sets/:daily_set_id
POST /daily-sets/:daily_set_id/start-session
```

Example `POST /me/dailies/generate`:

```json
{
  "source": "codeforces",
  "tags": ["dp", "graphs"],
  "count": 3,
  "difficulty": {
    "mode": "relative_to_user",
    "delta": 100
  }
}
```

Example response:

```json
{
  "id": "daily_set_id",
  "date": "2026-06-21",
  "title": "Codeforces Daily",
  "items": [
    {
      "position": 1,
      "role": "warmup",
      "points": 1,
      "problem": {
        "id": "problem_id",
        "title": "Example Problem",
        "source": "codeforces",
        "rating": 1300,
        "tags": ["greedy"]
      }
    }
  ]
}
```

### Virtual Sessions

```http
POST   /groups/:group_id/sessions
GET    /groups/:group_id/sessions

GET    /sessions/:session_id
PATCH  /sessions/:session_id
POST   /sessions/:session_id/join
POST   /sessions/:session_id/leave
POST   /sessions/:session_id/start
POST   /sessions/:session_id/finish
POST   /sessions/:session_id/cancel

GET    /sessions/:session_id/participants
GET    /sessions/:session_id/problems
GET    /sessions/:session_id/leaderboard
```

Example `POST /groups/:group_id/sessions`:

```json
{
  "title": "Saturday Virtual",
  "mode": "practice_set",
  "daily_set_id": "daily_set_id",
  "starts_at": "2026-06-21T15:00:00Z",
  "duration_minutes": 120,
  "scoring_rule": "contest_standard"
}
```

### Submissions And Solves

```http
GET  /me/submissions
GET  /me/solves
POST /submissions/manual

GET  /sessions/:session_id/submissions
GET  /sessions/:session_id/solves

POST /sources/:source_slug/sync/submissions
```

Example `POST /submissions/manual`:

```json
{
  "problem_id": "problem_id",
  "verdict": "manual_solve",
  "submitted_at": "2026-06-21T16:25:00Z",
  "session_id": "session_id"
}
```

Manual solves should be visually distinguished in serious leaderboards unless
the group explicitly allows them.

### Leaderboards

```http
GET /leaderboards
GET /groups/:group_id/leaderboard
GET /groups/:group_id/divisions/:division_id/leaderboard
GET /sessions/:session_id/leaderboard
GET /daily-sets/:daily_set_id/leaderboard
```

Suggested query params:

```txt
period=all_time|yearly|monthly|weekly|daily|session
metric=points|solves|rating_gain|streak
source=codeforces
tag=dp
from=2026-06-01
to=2026-06-21
```

Example:

```http
GET /groups/:group_id/leaderboard?period=weekly&metric=points&source=codeforces
```

## Recommendation Model

Daily generation should start simple and become more personalized over time.

MVP inputs:

- user source rating
- problem rating
- solved/unsolved status
- preferred tags
- blocked tags
- daily problem count

Better inputs:

- per-tag skill rating
- recent failed submissions
- recency of tag exposure
- group/division theme
- problem popularity
- problem quality signals
- target mix of warmup, target, and stretch problems

Suggested generation stages:

1. Determine scope: user, group, division, or group division.
2. Resolve source and tags from preferences/rules.
3. Estimate target rating range.
4. Exclude solved problems unless explicitly allowed.
5. Exclude blocked tags.
6. Select a mix of warmup, target, and stretch problems.
7. Store the result in `daily_sets` and `daily_set_items`.
8. Return the stored set.

The generator should write `generation_reason` and `recommendation_reason`
fields so the product can explain why a problem appeared.

## Leaderboard Model

Leaderboards should be treated as derived products of solve data.

Source of truth:

- `submissions`
- `problem_solves`
- `daily_set_items`
- `session_participants`
- `scoring_rules`

Derived output:

- live leaderboard response
- `leaderboard_snapshots`
- `leaderboard_snapshot_rows`
- group weekly standings
- session final results
- division rankings

Avoid making leaderboard rows canonical. A snapshot row is an immutable computed
claim about solve history under a scoring rule.

## MVP Cut

The smallest useful version can use these tables:

```txt
users
problem_sources
external_accounts
groups
group_memberships
problems
problem_tags
user_preferences
user_preference_tags
divisions
division_rules
division_rule_tags
daily_sets
daily_set_items
virtual_sessions
session_participants
submissions
scoring_rules
leaderboard_snapshots
leaderboard_snapshot_rows
```

Defer these until needed:

```txt
user_skill_ratings
user_divisions
problem_solves
activity_events
```

For the MVP, Codeforces can be the first source. Advent of Code can fit the same
shape, but it will stress the model differently because it has completion events,
calendar years, days, parts, and no native rating.

## Open Design Questions

- Should Advent of Code parts be separate `problems`, or should one day contain
  multiple parts?
- Should groups have their own normalized tag vocabulary?
- Should manual solves count toward public leaderboards?
- Should divisions be exclusive, or can a user belong to many divisions?
- Should daily generation be deterministic per date and scope?
- Should imported historical solves backfill streaks and leaderboards?
- Should private groups be allowed to define custom scoring rules?
- Should session timing be absolute for everyone or relative to each
  participant's start time?

## Naming Notes

The product language should support casual group culture without hardcoding jokes
or slang into schema names. Store user-facing names like `DP Hards` in data.
Keep table names and enum values boring, stable, and portable.
