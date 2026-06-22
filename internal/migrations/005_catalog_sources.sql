alter index if exists catalog_items_source_kind_idx
	rename to legacy_catalog_items_source_kind_idx;

alter index if exists catalog_items_metadata_gin_idx
	rename to legacy_catalog_items_metadata_gin_idx;

alter table catalog_items
	rename to legacy_catalog_items;

alter table item_sources
	rename to legacy_item_sources;

create table catalog_sources (
	id uuid primary key default gen_random_uuid(),
	group_id uuid not null references groups(id) on delete cascade,
	name text not null,
	template text not null,
	created_by_user_id uuid references users(id),
	created_at timestamptz not null default now(),
	updated_at timestamptz not null default now(),
	check (name <> ''),
	check (template <> '')
);

create unique index catalog_sources_group_lower_name_unique
	on catalog_sources (group_id, lower(name));

create table catalog_items (
	id uuid primary key default gen_random_uuid(),
	source_id uuid not null references catalog_sources(id) on delete cascade,
	title text not null,
	data jsonb not null default '{}'::jsonb,
	created_at timestamptz not null default now(),
	updated_at timestamptz not null default now(),
	check (title <> ''),
	check (jsonb_typeof(data) = 'object'),
	check (not (data ?| array[
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

create index catalog_items_source_idx
	on catalog_items (source_id);

create index catalog_items_data_gin_idx
	on catalog_items using gin (data jsonb_path_ops);

create trigger catalog_sources_set_updated_at
before update on catalog_sources
for each row execute function set_updated_at();

create trigger catalog_items_set_updated_at
before update on catalog_items
for each row execute function set_updated_at();

with source_blocks as (
	select
		f.group_id,
		ls.id as legacy_source_id,
		ls.name,
		coalesce(
			nullif(ls.resolver #>> '{default_action,template}', ''),
			case
				when nullif(ls.resolver #>> '{default_action,field}', '') is not null
					then format('{%s}', ls.resolver #>> '{default_action,field}')
			end
		) as template,
		min(f.created_by_user_id::text)::uuid as created_by_user_id
	from group_daily_feeds f
	cross join lateral jsonb_array_elements(coalesce(f.rules->'blocks', '[]'::jsonb)) block
	join legacy_item_sources ls on ls.slug = block->>'source'
	group by f.group_id, ls.id, ls.name, template
)
insert into catalog_sources (
	group_id,
	name,
	template,
	created_by_user_id
)
select
	group_id,
	name,
	template,
	created_by_user_id
from source_blocks
where template is not null
on conflict do nothing;

with source_map as (
	select distinct
		f.group_id,
		ls.id as legacy_source_id,
		cs.id as source_id
	from group_daily_feeds f
	cross join lateral jsonb_array_elements(coalesce(f.rules->'blocks', '[]'::jsonb)) block
	join legacy_item_sources ls on ls.slug = block->>'source'
	join catalog_sources cs on cs.group_id = f.group_id and lower(cs.name) = lower(ls.name)
)
insert into catalog_items (
	source_id,
	title,
	data
)
select
	source_map.source_id,
	legacy_catalog_items.title,
	jsonb_strip_nulls(legacy_catalog_items.locator || legacy_catalog_items.metadata)
from source_map
join legacy_catalog_items on legacy_catalog_items.source_id = source_map.legacy_source_id;

with rewritten as (
	select
		f.id,
		jsonb_agg(
			case
				when cs.id is null then block - 'kind'
				else (block - 'source' - 'kind') || jsonb_build_object('source_id', cs.id::text)
			end
			order by ordinality
		) as blocks
	from group_daily_feeds f
	cross join lateral jsonb_array_elements(coalesce(f.rules->'blocks', '[]'::jsonb)) with ordinality as b(block, ordinality)
	left join legacy_item_sources ls on ls.slug = block->>'source'
	left join catalog_sources cs on cs.group_id = f.group_id and lower(cs.name) = lower(ls.name)
	group by f.id
)
update group_daily_feeds f
set rules = jsonb_set(f.rules, '{blocks}', rewritten.blocks),
    rules_schema_version = 1
from rewritten
where rewritten.id = f.id;
