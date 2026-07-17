create extension if not exists btree_gist;

alter table group_daily_feeds
	add constraint group_daily_feeds_id_group_id_kind_unique
		unique (id, group_id, kind);

create table group_daily_feed_events (
	id uuid primary key default gen_random_uuid(),
	group_id uuid not null,
	feed_id uuid not null,
	feed_kind text not null default 'catalog_daily',
	name text not null,
	description text,
	starts_on date not null,
	ends_before date not null,
	source_id uuid not null references catalog_sources(id) on delete restrict,
	item_count integer not null,
	selection_seed text not null,
	created_by_user_id uuid references users(id) on delete set null,
	updated_by_user_id uuid references users(id) on delete set null,
	created_at timestamptz not null default now(),
	updated_at timestamptz not null default now(),

	unique (id, group_id),
	unique (id, source_id),

	foreign key (feed_id, group_id, feed_kind)
		references group_daily_feeds (id, group_id, kind)
		on delete cascade,

	check (feed_kind = 'catalog_daily'),
	check (length(btrim(name)) > 0),
	check (description is null or length(btrim(description)) > 0),
	check (starts_on < ends_before),
	check (item_count between 1 and 50),
	check (length(btrim(selection_seed)) between 1 and 128),

	constraint group_daily_feed_events_no_overlap
		exclude using gist (
			feed_id with =,
			daterange(starts_on, ends_before, '[)') with &&
		)
);

create index group_daily_feed_events_feed_start_idx
	on group_daily_feed_events (feed_id, starts_on desc);

create index group_daily_feed_events_group_start_idx
	on group_daily_feed_events (group_id, starts_on desc);

create trigger group_daily_feed_events_set_updated_at
before update on group_daily_feed_events
for each row execute function set_updated_at();

create table group_daily_feed_event_filters (
	id uuid primary key default gen_random_uuid(),
	event_id uuid not null,
	source_id uuid not null,
	field_id uuid not null,
	position integer not null,
	op text not null,
	text_values text[],
	number_values numeric[],
	created_at timestamptz not null default now(),
	updated_at timestamptz not null default now(),

	unique (event_id, position),

	foreign key (event_id, source_id)
		references group_daily_feed_events (id, source_id)
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

create trigger group_daily_feed_event_filters_set_updated_at
before update on group_daily_feed_event_filters
for each row execute function set_updated_at();
