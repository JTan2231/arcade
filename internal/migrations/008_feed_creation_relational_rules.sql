alter table catalog_sources
	add constraint catalog_sources_id_group_id_unique unique (id, group_id);

create table catalog_source_fields (
	id uuid primary key default gen_random_uuid(),
	source_id uuid not null references catalog_sources(id) on delete cascade,
	key text not null,
	label text not null,
	value_type text not null,
	is_array boolean not null default false,
	display_order integer not null default 0,
	created_at timestamptz not null default now(),
	updated_at timestamptz not null default now(),
	unique (id, source_id),
	unique (source_id, key),
	check (key <> ''),
	check (label <> ''),
	check (value_type in ('string', 'number'))
);

create trigger catalog_source_fields_set_updated_at
before update on catalog_source_fields
for each row execute function set_updated_at();

insert into catalog_source_fields (
	source_id,
	key,
	label,
	value_type,
	is_array,
	display_order
)
select
	id,
	'rating',
	'Rating',
	'number',
	false,
	10
from catalog_sources src
where exists (
	select 1
	from catalog_items item
	where item.source_id = src.id
	  and jsonb_typeof(item.data->'rating') = 'number'
)
on conflict do nothing;

insert into catalog_source_fields (
	source_id,
	key,
	label,
	value_type,
	is_array,
	display_order
)
select
	id,
	'tags',
	'Tags',
	'string',
	true,
	20
from catalog_sources src
where exists (
	select 1
	from catalog_items item
	where item.source_id = src.id
	  and jsonb_typeof(item.data->'tags') = 'array'
)
on conflict do nothing;

alter table group_daily_feeds
	add column source_id uuid,
	add column item_count integer,
	add column schedule_starts_at timestamptz,
	add column schedule_timezone text,
	add column schedule_interval_seconds integer;

update group_daily_feeds
set schedule_starts_at = date_trunc('day', created_at),
    schedule_timezone = coalesce(nullif(schedule->>'timezone', ''), 'UTC'),
    schedule_interval_seconds = 86400;

with first_blocks as (
	select
		f.id,
		block->>'source_id' as source_id,
		nullif(block->>'count', '')::integer as item_count
	from group_daily_feeds f
	cross join lateral (
		select block
		from jsonb_array_elements(coalesce(f.rules->'blocks', '[]'::jsonb)) with ordinality as b(block, ordinality)
		order by ordinality
		limit 1
	) block
	where f.kind = 'catalog_daily'
	  and block->>'source_id' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
)
update group_daily_feeds f
set source_id = first_blocks.source_id::uuid,
    item_count = greatest(first_blocks.item_count, 1)
from first_blocks
where f.id = first_blocks.id
  and exists (
	select 1
	from catalog_sources src
	where src.id = first_blocks.source_id::uuid
	  and src.group_id = f.group_id
  );

with unresolved as (
	select
		id,
		group_id,
		created_by_user_id
	from group_daily_feeds
	where kind = 'catalog_daily'
	  and source_id is null
)
insert into catalog_sources (
	group_id,
	name,
	template,
	created_by_user_id
)
select
	group_id,
	'Migrated Source ' || left(id::text, 8),
	'{name}',
	created_by_user_id
from unresolved
on conflict do nothing;

with unresolved as (
	select
		id,
		group_id
	from group_daily_feeds
	where kind = 'catalog_daily'
	  and source_id is null
)
update group_daily_feeds f
set source_id = src.id,
    item_count = 1,
    enabled = false
from unresolved
join catalog_sources src
  on src.group_id = unresolved.group_id
 and src.name = 'Migrated Source ' || left(unresolved.id::text, 8)
where f.id = unresolved.id;

update group_daily_feeds
set item_count = coalesce(item_count, 1)
where kind = 'catalog_daily';

insert into catalog_source_fields (
	source_id,
	key,
	label,
	value_type,
	is_array,
	display_order
)
select distinct
	f.source_id,
	'rating',
	'Rating',
	'number',
	false,
	10
from group_daily_feeds f
cross join lateral (
	select block
	from jsonb_array_elements(coalesce(f.rules->'blocks', '[]'::jsonb)) with ordinality as b(block, ordinality)
	order by ordinality
	limit 1
) block
where f.kind = 'catalog_daily'
  and f.source_id is not null
  and block->'filters' ? 'rating'
on conflict do nothing;

insert into catalog_source_fields (
	source_id,
	key,
	label,
	value_type,
	is_array,
	display_order
)
select distinct
	f.source_id,
	'tags',
	'Tags',
	'string',
	true,
	20
from group_daily_feeds f
cross join lateral (
	select block
	from jsonb_array_elements(coalesce(f.rules->'blocks', '[]'::jsonb)) with ordinality as b(block, ordinality)
	order by ordinality
	limit 1
) block
where f.kind = 'catalog_daily'
  and f.source_id is not null
  and block->'filters' ? 'tags'
on conflict do nothing;

create unique index group_daily_feeds_id_source_id_unique
	on group_daily_feeds (id, source_id);

alter table group_daily_feeds
	add constraint group_daily_feeds_source_group_fk
		foreign key (source_id, group_id)
		references catalog_sources (id, group_id)
		on delete restrict;

create table feed_rule_filters (
	id uuid primary key default gen_random_uuid(),
	feed_id uuid not null,
	source_id uuid not null,
	field_id uuid not null,
	position integer not null,
	op text not null,
	text_values text[],
	number_values numeric[],
	created_at timestamptz not null default now(),
	updated_at timestamptz not null default now(),
	unique (feed_id, position),
	foreign key (feed_id, source_id)
		references group_daily_feeds (id, source_id)
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

create trigger feed_rule_filters_set_updated_at
before update on feed_rule_filters
for each row execute function set_updated_at();

with first_blocks as (
	select
		f.id as feed_id,
		f.source_id,
		block
	from group_daily_feeds f
	cross join lateral (
		select block
		from jsonb_array_elements(coalesce(f.rules->'blocks', '[]'::jsonb)) with ordinality as b(block, ordinality)
		order by ordinality
		limit 1
	) block
	where f.kind = 'catalog_daily'
	  and f.source_id is not null
),
rating_filters as (
	select
		feed_id,
		source_id,
		case
			when block #> '{filters,rating,min}' is not null and block #> '{filters,rating,max}' is not null then 'between'
			when block #> '{filters,rating,min}' is not null then 'gte'
			when block #> '{filters,rating,max}' is not null then 'lte'
		end as op,
		case
			when block #> '{filters,rating,min}' is not null and block #> '{filters,rating,max}' is not null
				then array[(block #>> '{filters,rating,min}')::numeric, (block #>> '{filters,rating,max}')::numeric]
			when block #> '{filters,rating,min}' is not null
				then array[(block #>> '{filters,rating,min}')::numeric]
			when block #> '{filters,rating,max}' is not null
				then array[(block #>> '{filters,rating,max}')::numeric]
		end as number_values
	from first_blocks
	where block #> '{filters,rating}' is not null
	  and (
		block #> '{filters,rating,min}' is not null
		or block #> '{filters,rating,max}' is not null
	  )
),
tag_filters as (
	select
		feed_id,
		source_id,
		'contains_any' as op,
		array(
			select value
			from jsonb_array_elements_text(coalesce(block #> '{filters,tags,include_any}', '[]'::jsonb)) as values(value)
			where btrim(value) <> ''
		) as text_values
	from first_blocks
	where jsonb_array_length(coalesce(block #> '{filters,tags,include_any}', '[]'::jsonb)) > 0
),
combined as (
	select
		feed_id,
		source_id,
		'rating' as key,
		op,
		null::text[] as text_values,
		number_values
	from rating_filters
	where op is not null
	union all
	select
		feed_id,
		source_id,
		'tags' as key,
		op,
		text_values,
		null::numeric[] as number_values
	from tag_filters
	where cardinality(text_values) > 0
),
positioned as (
	select
		combined.*,
		row_number() over (partition by feed_id order by case key when 'rating' then 0 else 1 end) - 1 as position
	from combined
)
insert into feed_rule_filters (
	feed_id,
	source_id,
	field_id,
	position,
	op,
	text_values,
	number_values
)
select
	positioned.feed_id,
	positioned.source_id,
	fields.id,
	positioned.position,
	positioned.op,
	positioned.text_values,
	positioned.number_values
from positioned
join catalog_source_fields fields
  on fields.source_id = positioned.source_id
 and fields.key = positioned.key;

update catalog_sources
set template = replace(template, '{title}', '{name}')
where template like '%{title}%';

update catalog_items
set data = jsonb_set(data, '{name}', to_jsonb(title), true)
where not (data ? 'name');

alter table catalog_items
	drop column title;

alter table group_daily_feeds
	alter column schedule_starts_at set not null,
	alter column schedule_timezone set not null,
	alter column schedule_interval_seconds set not null,
	drop column audience,
	drop column schedule,
	drop column rules_schema_version,
	drop column rules,
	add constraint group_daily_feeds_schedule_timezone_check
		check (schedule_timezone <> ''),
	add constraint group_daily_feeds_schedule_interval_seconds_check
		check (schedule_interval_seconds > 0),
	add constraint group_daily_feeds_kind_source_check
		check (
			(kind = 'daily_thread' and source_id is null and item_count is null)
			or
			(kind = 'catalog_daily' and source_id is not null and item_count > 0)
		);
