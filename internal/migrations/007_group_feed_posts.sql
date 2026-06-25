create unique index group_daily_feeds_id_group_id_unique
	on group_daily_feeds (id, group_id);

create table group_daily_feed_instances (
	id uuid primary key default gen_random_uuid(),
	group_id uuid not null,
	feed_id uuid not null,
	feed_date date not null,
	created_at timestamptz not null default now(),
	unique (feed_id, feed_date),
	unique (id, group_id),
	foreign key (feed_id, group_id)
		references group_daily_feeds (id, group_id)
		on delete cascade
);

create index group_daily_feed_instances_group_date_idx
	on group_daily_feed_instances (group_id, feed_date desc);

create table group_feed_posts (
	id uuid primary key default gen_random_uuid(),
	group_id uuid not null,
	feed_instance_id uuid not null,
	author_user_id uuid not null references users(id) on delete cascade,
	evidence_kind text not null default 'text',
	evidence_text text not null,
	caption text,
	deleted_at timestamptz,
	created_at timestamptz not null default now(),
	updated_at timestamptz not null default now(),
	unique (feed_instance_id, author_user_id),
	foreign key (feed_instance_id, group_id)
		references group_daily_feed_instances (id, group_id)
		on delete cascade,
	check (evidence_kind = 'text'),
	check (length(btrim(evidence_text)) > 0),
	check (caption is null or length(btrim(caption)) > 0)
);

create index group_feed_posts_instance_created_idx
	on group_feed_posts (feed_instance_id, created_at desc)
	where deleted_at is null;

create index group_feed_posts_author_created_idx
	on group_feed_posts (author_user_id, created_at desc)
	where deleted_at is null;

create trigger group_feed_posts_set_updated_at
before update on group_feed_posts
for each row execute function set_updated_at();
