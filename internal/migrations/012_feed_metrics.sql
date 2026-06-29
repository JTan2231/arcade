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

alter table group_feed_posts
	add constraint group_feed_posts_id_group_id_unique unique (id, group_id);

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
