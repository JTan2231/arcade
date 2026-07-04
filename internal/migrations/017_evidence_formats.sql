create table group_evidence_formats (
	id uuid primary key default gen_random_uuid(),
	group_id uuid not null references groups(id) on delete cascade,
	slug text not null,
	name text not null,
	description text,
	archived_at timestamptz,
	created_by_user_id uuid references users(id) on delete set null,
	updated_by_user_id uuid references users(id) on delete set null,
	created_at timestamptz not null default now(),
	updated_at timestamptz not null default now(),
	unique (id, group_id),
	unique (group_id, slug),
	check (slug ~ '^[a-z0-9][a-z0-9-]*[a-z0-9]$'),
	check (length(btrim(name)) > 0),
	check (description is null or length(btrim(description)) > 0)
);

create unique index group_evidence_formats_group_name_unique
	on group_evidence_formats (group_id, lower(name));

create index group_evidence_formats_active_idx
	on group_evidence_formats (group_id, lower(name))
	where archived_at is null;

create trigger group_evidence_formats_set_updated_at
before update on group_evidence_formats
for each row execute function set_updated_at();

create table group_evidence_format_versions (
	id uuid primary key default gen_random_uuid(),
	group_id uuid not null,
	format_id uuid not null,
	version_number integer not null,

	min_chars integer not null default 1,
	max_chars integer,
	min_lines integer,
	max_lines integer,
	exact_lines integer,
	line_min_chars integer,
	line_max_chars integer,
	allow_blank_lines boolean not null default true,

	created_by_user_id uuid references users(id) on delete set null,
	created_at timestamptz not null default now(),

	unique (id, group_id),
	unique (format_id, version_number),
	foreign key (format_id, group_id)
		references group_evidence_formats (id, group_id)
		on delete cascade,

	check (version_number > 0),
	check (min_chars >= 1),
	check (max_chars is null or max_chars >= min_chars),
	check (min_lines is null or min_lines >= 1),
	check (max_lines is null or max_lines >= 1),
	check (exact_lines is null or exact_lines >= 1),
	check (min_lines is null or max_lines is null or max_lines >= min_lines),
	check (exact_lines is null or (min_lines is null and max_lines is null)),
	check (line_min_chars is null or line_min_chars >= 1),
	check (line_max_chars is null or line_max_chars >= 1),
	check (
		line_min_chars is null
		or line_max_chars is null
		or line_max_chars >= line_min_chars
	)
);

create index group_evidence_format_versions_format_idx
	on group_evidence_format_versions (format_id, version_number desc);

alter table group_daily_feeds
	add column evidence_format_id uuid;

alter table group_feed_posts
	add column evidence_format_version_id uuid;

insert into group_evidence_formats (
	group_id,
	slug,
	name,
	description,
	created_by_user_id,
	updated_by_user_id
)
select
	id,
	'plain-text',
	'Plain text',
	null,
	created_by_user_id,
	created_by_user_id
from groups;

insert into group_evidence_format_versions (
	group_id,
	format_id,
	version_number,
	min_chars,
	max_chars,
	min_lines,
	max_lines,
	exact_lines,
	line_min_chars,
	line_max_chars,
	allow_blank_lines,
	created_by_user_id
)
select
	group_id,
	id,
	1,
	1,
	null,
	null,
	null,
	null,
	null,
	null,
	true,
	created_by_user_id
from group_evidence_formats
where slug = 'plain-text';

update group_daily_feeds f
set evidence_format_id = fmt.id
from group_evidence_formats fmt
where fmt.group_id = f.group_id
  and fmt.slug = 'plain-text';

update group_feed_posts p
set evidence_format_version_id = v.id
from group_daily_feed_instances i
join group_evidence_formats fmt on fmt.group_id = i.group_id and fmt.slug = 'plain-text'
join group_evidence_format_versions v on v.format_id = fmt.id and v.group_id = fmt.group_id
where i.id = p.feed_instance_id
  and i.group_id = p.group_id
  and v.version_number = 1;

alter table group_daily_feeds
	alter column evidence_format_id set not null,
	add constraint group_daily_feeds_evidence_format_fk
		foreign key (evidence_format_id, group_id)
		references group_evidence_formats (id, group_id);

create index group_daily_feeds_evidence_format_idx
	on group_daily_feeds (group_id, evidence_format_id);

alter table group_feed_posts
	alter column evidence_format_version_id set not null,
	add constraint group_feed_posts_evidence_format_version_fk
		foreign key (evidence_format_version_id, group_id)
		references group_evidence_format_versions (id, group_id)
		on delete restrict;

create index group_feed_posts_evidence_format_version_idx
	on group_feed_posts (evidence_format_version_id)
	where deleted_at is null;

alter table group_feed_posts
	drop constraint if exists group_feed_posts_evidence_kind_check,
	drop column evidence_kind;
