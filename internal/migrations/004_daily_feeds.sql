create table item_sources (
	id uuid primary key default gen_random_uuid(),
	slug text not null unique,
	name text not null,
	base_url text,
	resolver_schema_version integer not null default 1,
	resolver jsonb not null default '{}'::jsonb,
	capabilities jsonb not null default '{}'::jsonb,
	created_at timestamptz not null default now(),
	updated_at timestamptz not null default now(),
	check (slug ~ '^[a-z0-9][a-z0-9-]*[a-z0-9]$'),
	check (name <> ''),
	check (jsonb_typeof(resolver) = 'object'),
	check (jsonb_typeof(capabilities) = 'object')
);

create table catalog_items (
	id uuid primary key default gen_random_uuid(),
	source_id uuid not null references item_sources(id) on delete cascade,
	external_id text not null,
	kind text not null,
	title text not null,
	locator jsonb not null default '{}'::jsonb,
	metadata jsonb not null default '{}'::jsonb,
	created_at timestamptz not null default now(),
	updated_at timestamptz not null default now(),
	unique (source_id, external_id),
	check (kind <> ''),
	check (title <> ''),
	check (jsonb_typeof(locator) = 'object'),
	check (jsonb_typeof(metadata) = 'object'),
	check (not (locator ?| array[
		'statement',
		'prompt',
		'body',
		'content',
		'sample_input',
		'sample_output',
		'editorial',
		'solution'
	])),
	check (not (metadata ?| array[
		'statement',
		'prompt',
		'body',
		'content',
		'sample_input',
		'sample_output',
		'editorial',
		'solution'
	]))
);

create index catalog_items_source_kind_idx
	on catalog_items (source_id, kind);

create index catalog_items_metadata_gin_idx
	on catalog_items using gin (metadata jsonb_path_ops);

create table group_daily_feeds (
	id uuid primary key default gen_random_uuid(),
	group_id uuid not null references groups(id) on delete cascade,
	name text not null,
	slug text not null,
	description text,
	enabled boolean not null default true,
	audience jsonb not null default '{"type":"all_group_members"}'::jsonb,
	schedule jsonb not null default '{"cadence":"daily","timezone":"UTC"}'::jsonb,
	rules_schema_version integer not null default 1,
	rules jsonb not null,
	created_by_user_id uuid references users(id),
	created_at timestamptz not null default now(),
	updated_at timestamptz not null default now(),
	unique (group_id, slug),
	check (slug ~ '^[a-z0-9][a-z0-9-]*[a-z0-9]$'),
	check (name <> ''),
	check (jsonb_typeof(audience) = 'object'),
	check (jsonb_typeof(schedule) = 'object'),
	check (jsonb_typeof(rules) = 'object')
);

create index group_daily_feeds_group_enabled_idx
	on group_daily_feeds (group_id, enabled);

create trigger item_sources_set_updated_at
before update on item_sources
for each row execute function set_updated_at();

create trigger catalog_items_set_updated_at
before update on catalog_items
for each row execute function set_updated_at();

create trigger group_daily_feeds_set_updated_at
before update on group_daily_feeds
for each row execute function set_updated_at();

insert into item_sources (
	slug,
	name,
	base_url,
	resolver_schema_version,
	resolver,
	capabilities
)
values
	(
		'codeforces',
		'Codeforces',
		'https://codeforces.com',
		1,
		'{
			"default_action": {
				"type": "external_url",
				"label": "Open on Codeforces",
				"template": "https://codeforces.com/problemset/problem/{contest_id}/{index}"
			},
			"required_locator_fields": ["contest_id", "index"]
		}'::jsonb,
		'{"ratings": true, "tags": true}'::jsonb
	),
	(
		'custom-url',
		'Custom URL',
		null,
		1,
		'{
			"default_action": {
				"type": "external_url",
				"label": "Open",
				"field": "url"
			},
			"required_locator_fields": ["url"]
		}'::jsonb,
		'{"direct_url": true}'::jsonb
	)
on conflict (slug) do update set
	name = excluded.name,
	base_url = excluded.base_url,
	resolver_schema_version = excluded.resolver_schema_version,
	resolver = excluded.resolver,
	capabilities = excluded.capabilities;

insert into catalog_items (
	source_id,
	external_id,
	kind,
	title,
	locator,
	metadata
)
select
	item_sources.id,
	p.external_id,
	'competitive_programming_problem',
	p.title,
	jsonb_build_object(
		'contest_id', p.contest_id,
		'index', p.problem_index
	),
	jsonb_strip_nulls(jsonb_build_object(
		'rating', p.rating,
		'difficulty_label', p.difficulty_label,
		'tags', to_jsonb(coalesce((
			select array_agg(distinct pt.tag order by pt.tag)
			from problem_tags pt
			where pt.problem_id = p.id
		), array[]::text[]))
	))
from problems p
join problem_sources ps on ps.id = p.source_id
join item_sources on item_sources.slug = ps.slug
where ps.slug = 'codeforces'
  and p.contest_id is not null
  and p.problem_index is not null
on conflict (source_id, external_id) do update set
	kind = excluded.kind,
	title = excluded.title,
	locator = excluded.locator,
	metadata = excluded.metadata;
