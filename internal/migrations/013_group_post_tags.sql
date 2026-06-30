create table group_post_tags (
	id uuid primary key default gen_random_uuid(),
	group_id uuid not null references groups(id) on delete cascade,
	name text not null,
	display_order integer not null default 0,
	archived_at timestamptz,
	created_by_user_id uuid references users(id),
	updated_by_user_id uuid references users(id),
	created_at timestamptz not null default now(),
	updated_at timestamptz not null default now(),

	unique (id, group_id),

	check (length(btrim(name)) between 1 and 48),
	check (display_order >= 0)
);

create unique index group_post_tags_group_name_unique
	on group_post_tags (group_id, lower(name));

create index group_post_tags_group_active_order_idx
	on group_post_tags (group_id, display_order, lower(name))
	where archived_at is null;

create trigger group_post_tags_set_updated_at
before update on group_post_tags
for each row execute function set_updated_at();

create table group_feed_post_tags (
	group_id uuid not null,
	post_id uuid not null,
	tag_id uuid not null,
	created_at timestamptz not null default now(),

	primary key (post_id, tag_id),

	foreign key (post_id, group_id)
		references group_feed_posts (id, group_id)
		on delete cascade,

	foreign key (tag_id, group_id)
		references group_post_tags (id, group_id)
		on delete restrict
);

create index group_feed_post_tags_group_tag_idx
	on group_feed_post_tags (group_id, tag_id);
