create table group_daily_feed_cycle_settings (
	id uuid primary key default gen_random_uuid(),
	group_id uuid not null,
	feed_id uuid not null,
	feed_kind text not null default 'catalog_daily',
	starts_on date not null,
	ends_before date,
	schedule_starts_at timestamptz not null,
	schedule_timezone text not null,
	schedule_interval_seconds integer not null,
	created_by_user_id uuid references users(id) on delete set null,
	updated_by_user_id uuid references users(id) on delete set null,
	created_at timestamptz not null default now(),
	updated_at timestamptz not null default now(),

	unique (id, group_id),
	unique (id, feed_id),

	foreign key (feed_id, group_id, feed_kind)
		references group_daily_feeds (id, group_id, kind)
		on delete cascade,

	check (feed_kind = 'catalog_daily'),
	check (ends_before is null or starts_on < ends_before),
	check (length(btrim(schedule_timezone)) > 0),
	check (schedule_interval_seconds >= 86400)
);

create index group_daily_feed_cycle_settings_group_start_idx
	on group_daily_feed_cycle_settings (group_id, starts_on desc);

create unique index group_daily_feed_cycle_settings_open_feed_idx
	on group_daily_feed_cycle_settings (feed_id)
	where ends_before is null;

create trigger group_daily_feed_cycle_settings_set_updated_at
before update on group_daily_feed_cycle_settings
for each row execute function set_updated_at();

create table group_daily_feed_cycle_setting_revisions (
	id uuid primary key default gen_random_uuid(),
	settings_id uuid not null,
	feed_id uuid not null,
	starts_on date not null,
	output_count integer not null,
	selection_seed text not null,
	created_by_user_id uuid references users(id) on delete set null,
	created_at timestamptz not null default now(),

	unique (id, settings_id),
	unique (id, feed_id),
	unique (id, settings_id, feed_id),
	unique (settings_id, starts_on),

	foreign key (settings_id, feed_id)
		references group_daily_feed_cycle_settings (id, feed_id)
		on delete cascade,

	check (output_count between 1 and 50),
	check (length(btrim(selection_seed)) between 1 and 128)
);

create index group_daily_feed_cycle_setting_revisions_start_idx
	on group_daily_feed_cycle_setting_revisions (settings_id, starts_on desc, created_at desc);

create table group_daily_feed_cycle_configurations (
	id uuid primary key default gen_random_uuid(),
	revision_id uuid not null,
	feed_id uuid not null,
	source_id uuid not null,
	key text not null,
	name text not null,
	description text,
	position integer not null,
	distinct_field_id uuid,
	order_kind text not null,
	order_field_id uuid,
	order_direction text,
	created_at timestamptz not null default now(),

	unique (id, source_id),
	unique (id, revision_id, source_id),
	unique (id, feed_id, source_id),
	unique (revision_id, position),
	unique (revision_id, key),

	foreign key (revision_id, feed_id)
		references group_daily_feed_cycle_setting_revisions (id, feed_id)
		on delete cascade,
	foreign key (source_id)
		references catalog_sources (id)
		on delete restrict,
	foreign key (distinct_field_id, source_id)
		references catalog_source_fields (id, source_id)
		on delete restrict,
	foreign key (order_field_id, source_id)
		references catalog_source_fields (id, source_id)
		on delete restrict,

	check (key ~ '^[a-z0-9][a-z0-9_-]*$'),
	check (length(key) <= 64),
	check (length(btrim(name)) > 0),
	check (description is null or length(btrim(description)) > 0),
	check (position >= 0),
	check (order_kind in ('seeded_shuffle', 'field')),
	check (
		(order_kind = 'seeded_shuffle' and order_field_id is null and order_direction is null)
		or
		(order_kind = 'field' and order_field_id is not null and order_direction in ('asc', 'desc'))
	)
);

create index group_daily_feed_cycle_configurations_revision_idx
	on group_daily_feed_cycle_configurations (revision_id, position);

create table group_daily_feed_cycle_configuration_filters (
	id uuid primary key default gen_random_uuid(),
	configuration_id uuid not null,
	source_id uuid not null,
	field_id uuid not null,
	position integer not null,
	op text not null,
	text_values text[],
	number_values numeric[],
	created_at timestamptz not null default now(),

	unique (configuration_id, position),

	foreign key (configuration_id, source_id)
		references group_daily_feed_cycle_configurations (id, source_id)
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

create table group_daily_feed_cycles (
	id uuid primary key default gen_random_uuid(),
	group_id uuid not null,
	feed_id uuid not null,
	settings_id uuid not null,
	revision_id uuid not null,
	configuration_id uuid not null,
	source_id uuid not null,
	cycle_number bigint not null,
	revision_cycle_number bigint not null,
	starts_on date not null,
	ends_before date not null,
	generation integer not null default 1,
	selection_seed text not null,
	refreshed_by_user_id uuid references users(id) on delete set null,
	refreshed_at timestamptz,
	created_at timestamptz not null default now(),
	updated_at timestamptz not null default now(),

	unique (id, group_id),
	unique (id, feed_id),
	unique (settings_id, cycle_number),
	unique (revision_id, revision_cycle_number),
	unique (feed_id, starts_on),

	foreign key (settings_id, group_id)
		references group_daily_feed_cycle_settings (id, group_id)
		on delete cascade,
	foreign key (settings_id, feed_id)
		references group_daily_feed_cycle_settings (id, feed_id)
		on delete cascade,
	foreign key (revision_id, settings_id, feed_id)
		references group_daily_feed_cycle_setting_revisions (id, settings_id, feed_id)
		on delete restrict,
	foreign key (configuration_id, revision_id, source_id)
		references group_daily_feed_cycle_configurations (id, revision_id, source_id)
		on delete restrict,

	check (cycle_number >= 0),
	check (revision_cycle_number >= 0),
	check (starts_on < ends_before),
	check (generation > 0),
	check (length(btrim(selection_seed)) between 1 and 128)
);

create index group_daily_feed_cycles_feed_start_idx
	on group_daily_feed_cycles (feed_id, starts_on desc);

create trigger group_daily_feed_cycles_set_updated_at
before update on group_daily_feed_cycles
for each row execute function set_updated_at();

alter table catalog_items
	add constraint catalog_items_id_source_id_unique unique (id, source_id);

create table group_daily_feed_cycle_items (
	id uuid primary key default gen_random_uuid(),
	cycle_id uuid not null,
	feed_id uuid not null,
	catalog_item_id uuid not null,
	position integer not null,
	feed_date date not null,
	item_source_id uuid not null,
	item_source_name text not null,
	item_title text not null,
	item_data jsonb not null,
	action_type text not null,
	action_label text not null,
	action_url text,
	action_text text,
	created_at timestamptz not null default now(),

	unique (cycle_id, position),
	unique (cycle_id, feed_date),
	unique (cycle_id, catalog_item_id),

	foreign key (cycle_id, feed_id)
		references group_daily_feed_cycles (id, feed_id)
		on delete cascade,
	foreign key (catalog_item_id, item_source_id)
		references catalog_items (id, source_id)
		on delete restrict,

	check (position > 0),
	check (length(btrim(item_source_name)) > 0),
	check (length(btrim(item_title)) > 0),
	check (jsonb_typeof(item_data) = 'object'),
	check (action_type in ('external_url', 'text')),
	check (length(btrim(action_label)) > 0),
	check (
		(action_type = 'external_url' and action_url is not null and action_text is null)
		or
		(action_type = 'text' and action_url is null and action_text is not null)
	)
);

create index group_daily_feed_cycle_items_feed_date_idx
	on group_daily_feed_cycle_items (feed_id, feed_date desc);
