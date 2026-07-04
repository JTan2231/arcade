create table group_daily_feed_schedule_versions (
	id uuid primary key default gen_random_uuid(),
	group_id uuid not null,
	feed_id uuid not null,
	starts_at timestamptz not null,
	timezone text not null,
	interval_seconds integer not null,
	created_by_user_id uuid references users(id) on delete set null,
	created_at timestamptz not null default now(),

	unique (id, group_id),

	foreign key (feed_id, group_id)
		references group_daily_feeds (id, group_id)
		on delete cascade,

	check (timezone <> ''),
	check (interval_seconds > 0)
);

create index group_daily_feed_schedule_versions_feed_start_idx
	on group_daily_feed_schedule_versions (feed_id, starts_at desc, created_at desc);

insert into group_daily_feed_schedule_versions (
	group_id,
	feed_id,
	starts_at,
	timezone,
	interval_seconds,
	created_by_user_id,
	created_at
)
select
	group_id,
	id,
	schedule_starts_at,
	schedule_timezone,
	schedule_interval_seconds,
	created_by_user_id,
	created_at
from group_daily_feeds;
