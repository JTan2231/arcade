# Score

This document defines the complete feed scoring and leaderboard design for
Arcade.

Arcade scores are attached to daily feeds. A score is not a standalone group
object and there is no formula builder. Each feed can expose system-computed
metrics and human-judged metrics. Leaderboards are computed views over those
feed metrics.

## Goals

- Let a group configure scores for a specific daily feed.
- Keep system metrics curated and dataset-agnostic.
- Let users define judged metrics with plain-language prompts.
- Persist human judgments separately from posts.
- Compute leaderboards from feed posts, feed schedules, and persisted judgments.
- Avoid exposing catalog schemas, JSON fields, SQL, or formula mechanics in the
  user experience.

## Domain Model

A daily feed owns its metric definitions through
`group_daily_feed_metrics`.

A row with a built-in `system_key` means:

> For this feed, compute this built-in metric and aggregate it this way.

A row with `system_key = 'judged'` means:

> For this feed, show this judgment prompt, collect numeric judgments on posts,
> and aggregate those judgments this way.

Judged metric values are stored in
`group_daily_feed_metric_judgments`.

System metric values are not stored. They are computed from
`group_daily_feeds`, `group_daily_feed_instances`, and `group_feed_posts`.
Metrics that need expected dates use the feed schedule, not only materialized
instances, because `group_daily_feed_instances` exists only after durable member
content exists for a feed/date.

## Database Schema

Add `internal/migrations/012_feed_metrics.sql`.

### Feed Metrics

```sql
create table group_daily_feed_metrics (
	id uuid primary key default gen_random_uuid(),
	group_id uuid not null,
	feed_id uuid not null,
	system_key text not null check (
		system_key in (
			'judged',
			'post_count',
			'average_post_length_words',
			'missed_days',
			'current_streak',
			'typical_posting_window'
		)
	),
	judgment_prompt text,
	aggregation text not null check (
		aggregation in ('sum', 'average', 'latest', 'count', 'max', 'min')
	),
	display_name text not null,
	created_by_user_id uuid references users(id),
	created_at timestamptz not null default now(),
	updated_at timestamptz not null default now(),

	unique (id, group_id),

	foreign key (feed_id, group_id)
		references group_daily_feeds (id, group_id)
		on delete cascade,

	check (length(btrim(display_name)) > 0),
	check (
		(system_key <> 'judged'
			and judgment_prompt is null)
		or
		(system_key = 'judged'
			and judgment_prompt is not null
			and length(btrim(judgment_prompt)) > 0)
	)
);

create unique index group_daily_feed_metrics_system_unique
	on group_daily_feed_metrics (feed_id, system_key)
	where system_key <> 'judged';

create unique index group_daily_feed_metrics_display_name_unique
	on group_daily_feed_metrics (feed_id, lower(display_name));

create index group_daily_feed_metrics_group_feed_idx
	on group_daily_feed_metrics (group_id, feed_id);

create trigger group_daily_feed_metrics_set_updated_at
before update on group_daily_feed_metrics
for each row execute function set_updated_at();
```

Column semantics:

- `group_id`: denormalized permission and composite foreign-key boundary.
- `feed_id`: the feed that owns the metric.
- `system_key`: selects a built-in computation or the reserved `judged` path.
- `judgment_prompt`: user-authored evaluation prompt required for judged metrics.
- `aggregation`: how per-post or per-date samples collapse into a member score.
- `display_name`: user-facing label for the metric on the feed and leaderboard.
- `created_by_user_id`: audit reference to the user who configured the metric.

The table intentionally does not include target type, feed scope, value type,
direction, unit labels, precision, scale, evaluator policy, or visibility.
Those are application-owned semantics derived from the metric key and system
registry.

### Post Composite Key

Judgments need to prove that the judged post belongs to the same group as the
metric. Add a composite uniqueness rule to `group_feed_posts`:

```sql
alter table group_feed_posts
	add constraint group_feed_posts_id_group_id_unique unique (id, group_id);
```

### Metric Judgments

```sql
create table group_daily_feed_metric_judgments (
	id uuid primary key default gen_random_uuid(),
	metric_id uuid not null,
	group_id uuid not null,
	post_id uuid not null,
	subject_user_id uuid not null references users(id) on delete cascade,
	evaluator_user_id uuid not null references users(id) on delete cascade,
	value numeric not null,
	note text,
	created_at timestamptz not null default now(),
	updated_at timestamptz not null default now(),

	unique (metric_id, post_id, evaluator_user_id),

	foreign key (metric_id, group_id)
		references group_daily_feed_metrics (id, group_id)
		on delete cascade,

	foreign key (post_id, group_id)
		references group_feed_posts (id, group_id)
		on delete cascade,

	check (value >= 0),
	check (note is null or length(btrim(note)) > 0)
);

create index group_daily_feed_metric_judgments_metric_subject_idx
	on group_daily_feed_metric_judgments (metric_id, subject_user_id);

create index group_daily_feed_metric_judgments_post_idx
	on group_daily_feed_metric_judgments (post_id);

create index group_daily_feed_metric_judgments_evaluator_idx
	on group_daily_feed_metric_judgments (evaluator_user_id);

create trigger group_daily_feed_metric_judgments_set_updated_at
before update on group_daily_feed_metric_judgments
for each row execute function set_updated_at();
```

The application must set `subject_user_id` to `group_feed_posts.author_user_id`
for the judged post. Clients do not choose the subject.

The application must reject judgment writes for metrics whose `system_key` is
not `judged`.

## System Metric Registry

System metrics are curated Go implementations. They are not user-authored
formulas.

For built-in system metrics, the registry maps non-`judged` `system_key`
values to:

- key
- default display name
- allowed aggregations
- default aggregation
- rankability
- display metadata
- computation function

Supported built-in keys:

```text
post_count
average_post_length_words
missed_days
current_streak
typical_posting_window
```

### `post_count`

Counts non-deleted posts for each active group member on the metric feed during
the requested leaderboard window.

Sample source:

- `group_feed_posts`
- `group_daily_feed_instances`

Valid aggregations:

- `count`
- `sum`

Default aggregation:

- `count`

Ranking:

- Higher value ranks first.

### `average_post_length_words`

Computes word count from `group_feed_posts.evidence_text` for non-deleted posts
on the metric feed during the requested leaderboard window.

Sample source:

- `group_feed_posts.evidence_text`
- `group_daily_feed_instances.feed_date`

Valid aggregations:

- `average`
- `max`
- `min`

Default aggregation:

- `average`

Ranking:

- Higher value ranks first for `average` and `max`.
- Lower value ranks first for `min`.

### `missed_days`

Counts scheduled dates on the metric feed where a member did not have an active
post.

Sample source:

- `group_daily_feeds.schedule_starts_at`
- `group_daily_feeds.schedule_timezone`
- `group_daily_feeds.schedule_interval_seconds`
- `group_feed_posts`
- `group_daily_feed_instances`

Expected dates are generated from the feed schedule for the requested
leaderboard window. Do not infer expected dates from
`group_daily_feed_instances`, because instances are lazily materialized only
when posts exist.

Valid aggregations:

- `count`
- `sum`

Default aggregation:

- `count`

Ranking:

- Lower value ranks first.

### `current_streak`

Counts consecutive scheduled feed dates with active posts for each member,
ending at the latest scheduled date in the requested leaderboard window.

Sample source:

- `group_daily_feeds.schedule_*`
- `group_feed_posts`
- `group_daily_feed_instances`

Expected dates are generated from the feed schedule.

Valid aggregations:

- `latest`
- `max`

Default aggregation:

- `latest`

Ranking:

- Higher value ranks first.

### `typical_posting_window`

Computes the typical local time range when a member posts on the metric feed.
This is a display metric, not a competitive ranking metric.

Sample source:

- `group_feed_posts.created_at`
- `group_daily_feeds.schedule_timezone`

Valid aggregations:

- `latest`

Default aggregation:

- `latest`

Ranking:

- Neutral. Rows are not ranked and are ordered by display name, then user id.

## Aggregation Semantics

Aggregations collapse samples into one row per member.

- `sum`: sum all numeric samples.
- `average`: average all numeric samples.
- `latest`: use the latest sample by sample timestamp.
- `count`: count samples.
- `max`: use the highest numeric sample.
- `min`: use the lowest numeric sample.

For judged metrics, samples come from
`group_daily_feed_metric_judgments.value`.

For system metrics, samples are produced by the registry computation for the
metric key.

The backend validates that the selected aggregation is allowed for the metric.
Invalid metric-key and aggregation combinations return a structured bad-request
error.

## API Types

Add Go response types in `internal/app/types.go` and matching TypeScript types
in `web/frontend/src/types.ts`.

```ts
export type FeedMetric = {
  id: string;
  group_id: string;
  feed_id: string;
  system_key: FeedMetricKey;
  judgment_prompt?: string;
  aggregation: MetricAggregation;
  display_name: string;
  created_by_user_id?: string;
  created_at: string;
  updated_at: string;
};

export type FeedMetricKey =
  | "judged"
  | "post_count"
  | "average_post_length_words"
  | "missed_days"
  | "current_streak"
  | "typical_posting_window";

export type SystemMetricKey = Exclude<FeedMetricKey, "judged">;

export type MetricAggregation =
  | "sum"
  | "average"
  | "latest"
  | "count"
  | "max"
  | "min";

export type FeedMetricJudgment = {
  id: string;
  metric_id: string;
  group_id: string;
  post_id: string;
  subject_user_id: string;
  evaluator_user_id: string;
  value: number;
  note?: string;
  created_at: string;
  updated_at: string;
};

export type MetricLeaderboard = {
  metric: FeedMetric;
  from: string;
  to: string;
  rows: MetricLeaderboardRow[];
};

export type MetricLeaderboardRow = {
  rank: number | null;
  user: PublicUser;
  value: number | string;
  raw_value: number | null;
  sample_count: number;
};
```

Create request:

```ts
export type CreateFeedMetricRequest = {
  system_key: FeedMetricKey;
  judgment_prompt?: string;
  aggregation: MetricAggregation;
  display_name: string;
};
```

Patch request:

```ts
export type PatchFeedMetricRequest = {
  judgment_prompt?: string;
  aggregation?: MetricAggregation;
  display_name?: string;
};
```

Judgment create request:

```ts
export type CreateFeedMetricJudgmentRequest = {
  post_id: string;
  value: number;
  note?: string;
};
```

Judgment patch request:

```ts
export type PatchFeedMetricJudgmentRequest = {
  value?: number;
  note?: string | null;
};
```

## HTTP API

Routes belong under the selected daily feed.

### Metric Definitions

```http
GET    /api/groups/{group_id}/daily-feeds/{feed_id}/metrics
POST   /api/groups/{group_id}/daily-feeds/{feed_id}/metrics
GET    /api/groups/{group_id}/daily-feeds/{feed_id}/metrics/{metric_id}
PATCH  /api/groups/{group_id}/daily-feeds/{feed_id}/metrics/{metric_id}
DELETE /api/groups/{group_id}/daily-feeds/{feed_id}/metrics/{metric_id}
```

Behavior:

- `GET` returns metrics ordered by `display_name`.
- `POST` validates feed ownership, group permissions, metric key,
  aggregation, and non-empty display text.
- `PATCH` can rename, update aggregation, and update judged prompts.
- `PATCH` cannot change `system_key`.
- `PATCH` cannot turn a system metric into a judged metric.
- `DELETE` cascades judged values through the metric foreign key.

### Leaderboards

```http
GET /api/groups/{group_id}/daily-feeds/{feed_id}/metrics/{metric_id}/leaderboard?from=YYYY-MM-DD&to=YYYY-MM-DD
```

Behavior:

- `from` and `to` are inclusive dates.
- `from` and `to` are required.
- `from` must be less than or equal to `to`.
- The metric must belong to the feed and group in the path.
- The handler computes rows for current active group members.
- Every current active group member receives a row.
- Rows with no samples use `sample_count = 0`, `raw_value = null`,
  `value = "-"`, and `rank = null`.
- Rank ties use the same rank number.
- Tie ordering after rank is by display name, then user id.
- Neutral metrics return `rank = null`.

### Judgments

```http
POST   /api/groups/{group_id}/daily-feeds/{feed_id}/metrics/{metric_id}/judgments
PATCH  /api/groups/{group_id}/metric-judgments/{judgment_id}
DELETE /api/groups/{group_id}/metric-judgments/{judgment_id}
```

Behavior:

- `POST` creates or replaces the current evaluator's judgment for the metric and
  post.
- The metric must have `system_key = 'judged'`.
- The post must belong to the same group and feed as the metric.
- The post must not be deleted.
- `subject_user_id` is always copied from the post author.
- `PATCH` updates only the current evaluator's judgment unless the current user
  is a group owner/admin.
- `DELETE` removes only the current evaluator's judgment unless the current user
  is a group owner/admin.

## Backend Implementation

Add `internal/app/handlers_feed_metrics.go`.

Responsibilities:

- request decoding and normalization
- group/feed/metric authorization
- metric CRUD
- judgment CRUD
- leaderboard response generation

Route registration goes in `Server.Routes()`.

Add helpers:

- `listGroupDailyFeedMetrics(ctx, groupID, feedID)`
- `getGroupDailyFeedMetric(ctx, groupID, feedID, metricID)`
- `normalizeCreateFeedMetricRequest(req)`
- `normalizePatchFeedMetricRequest(req)`
- `normalizeCreateMetricJudgmentRequest(req)`
- `normalizePatchMetricJudgmentRequest(req)`
- `requireMetricManager(ctx, userID, groupID)`
- `canJudgeMetric(ctx, userID, groupID, metricID, postID)`

Metric management permissions use existing group roles:

- owners and admins create, update, and delete metrics
- active group members read metrics and leaderboards

Judgment permissions:

- owners and admins can judge posts
- evaluators cannot judge deleted posts
- evaluators cannot judge posts outside the metric feed
- self-judgment is rejected

System computation should live behind a registry interface. The registry is for
non-`judged` metric keys only:

```go
type systemMetricDefinition struct {
	Key                 string
	DefaultDisplayName  string
	DefaultAggregation  string
	AllowedAggregations []string
	Rankable            bool
	Compute             systemMetricComputeFunc
}
```

Computation input:

```go
type metricComputationInput struct {
	GroupID string
	Feed   DailyFeed
	Metric FeedMetric
	From   time.Time
	To     time.Time
}
```

Computation output:

```go
type metricSample struct {
	UserID    string
	Value     float64
	TextValue *string
	At        time.Time
}
```

The leaderboard handler aggregates samples into rows, joins active group
members, applies ranking semantics, and formats values.

## Frontend Implementation

Add API functions in `web/frontend/src/api.ts`:

- `listFeedMetrics(groupID, feedID)`
- `createFeedMetric(groupID, feedID, payload)`
- `getFeedMetric(groupID, feedID, metricID)`
- `updateFeedMetric(groupID, feedID, metricID, payload)`
- `deleteFeedMetric(groupID, feedID, metricID)`
- `getMetricLeaderboard(groupID, feedID, metricID, range)`
- `createFeedMetricJudgment(groupID, feedID, metricID, payload)`
- `updateFeedMetricJudgment(groupID, judgmentID, payload)`
- `deleteFeedMetricJudgment(groupID, judgmentID)`

Extend `dashboardMachine` context:

- `metrics: FeedMetric[]`
- `selectedMetricId: string | null`
- `metricLeaderboard: MetricLeaderboard | null`
- `metricsError: string | null`
- `metricMutation: ...`
- `judgmentMutation: ...`

Machine behavior:

- load metrics after feed selection
- clear metrics when group or feed changes
- load leaderboard when selected metric changes
- reload leaderboard after metric create/update/delete
- reload leaderboard after judgment create/update/delete
- preserve existing post loading and mutation flows

UI changes in `GroupDashboard`:

- Add a metrics/leaderboard area for the selected feed.
- Show configured metrics for the feed.
- Owners/admins see Add metric, Edit metric, and Delete metric actions.
- Selecting a metric shows its leaderboard.
- Judged metrics show their prompt near the leaderboard and on post cards.
- Owners/admins see score controls on each post for judged metrics.
- System metrics do not show score controls.

Add metric flow:

- User chooses calculated or judged.
- Calculated:
  - choose one built-in system metric
  - choose aggregation from allowed options
  - set display name
- Calculated requests submit the selected built-in `system_key`.
- Judged:
  - enter display name
  - enter judgment prompt
  - choose aggregation
- Judged requests submit `system_key: "judged"`.
- The UI does not expose formula creation, catalog fields, JSON paths, SQL, or
  feed source internals.

Post card judged controls:

- Display each judged metric prompt configured on the feed.
- Allow numeric score entry.
- Allow optional note.
- Save creates or updates the evaluator's judgment.
- Deleted posts cannot be judged.

## Display Rules

Display metadata is owned by the frontend and backend presenter, not stored in
the metric table.

System metric display:

- `post_count`: integer
- `average_post_length_words`: decimal or rounded word count
- `missed_days`: integer
- `current_streak`: integer days
- `typical_posting_window`: local time range string

Judged metric display:

- numeric score
- optional note on judgment detail surfaces
- leaderboard value formatted according to aggregation

Ranking direction:

- `post_count`: higher first
- `average_post_length_words`: aggregation-dependent
- `missed_days`: lower first
- `current_streak`: higher first
- `typical_posting_window`: neutral
- judged metrics: higher first, except `min` where lower first

## Documentation Updates

When implemented, update:

- `docs/data-model.md`
- `docs/architecture.md`
- `docs/generated/frontend-event-handlers.md` if event-handler generation is
  affected

The data-model docs should mention:

- feeds own metrics through `group_daily_feed_metrics`
- judged values are stored in `group_daily_feed_metric_judgments`
- system metrics are computed, not stored
- schedule-based metrics generate expected dates from feed schedules

The architecture docs should mention:

- metric routes
- metric computation registry
- frontend dashboard metric state
- judged controls on posts

## Validation

Use `./ci.sh` to validate code changes.

Frontend implementation work should use `locator.ts` extensively when rendering
and debugging metric and leaderboard surfaces.
