create table group_daily_feed_generations (
	id uuid primary key default gen_random_uuid(),
	group_id uuid not null,
	feed_id uuid not null,
	feed_date date not null,
	generation integer not null default 1,
	seed text not null,
	refreshed_by_user_id uuid references users(id) on delete set null,
	created_at timestamptz not null default now(),
	updated_at timestamptz not null default now(),

	unique (feed_id, feed_date),
	unique (id, group_id),

	foreign key (feed_id, group_id)
		references group_daily_feeds (id, group_id)
		on delete cascade,

	check (generation > 0),
	check (length(btrim(seed)) between 1 and 128)
);

create index group_daily_feed_generations_group_date_idx
	on group_daily_feed_generations (group_id, feed_date desc);

create trigger group_daily_feed_generations_set_updated_at
before update on group_daily_feed_generations
for each row execute function set_updated_at();
