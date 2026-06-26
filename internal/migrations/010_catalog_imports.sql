alter table group_daily_feeds
	drop constraint group_daily_feeds_source_group_fk;

alter table catalog_sources
	add column slug text,
	add column scope text not null default 'group';

update catalog_sources
set slug = coalesce(
	nullif(
		trim(both '-' from lower(regexp_replace(btrim(name), '[^a-z0-9]+', '-', 'g'))),
		''
	),
	'source'
) || '-' || left(id::text, 8)
where slug is null;

alter table catalog_sources
	alter column slug set not null,
	alter column group_id drop not null,
	add constraint catalog_sources_slug_check
		check (slug ~ '^[a-z0-9][a-z0-9-]*[a-z0-9]$'),
	add constraint catalog_sources_scope_check
		check (scope in ('group', 'global')),
	add constraint catalog_sources_scope_group_check
		check (
			(scope = 'group' and group_id is not null)
			or
			(scope = 'global' and group_id is null)
		);

create unique index catalog_sources_group_slug_unique
	on catalog_sources (group_id, slug)
	where scope = 'group';

create unique index catalog_sources_global_slug_unique
	on catalog_sources (slug)
	where scope = 'global';

alter table catalog_items
	add column external_id text;

update catalog_items
set external_id = nullif(data->>'external_id', '')
where external_id is null
  and data ? 'external_id';

create unique index catalog_items_source_external_id_unique
	on catalog_items (source_id, external_id)
	where external_id is not null;

alter table group_daily_feeds
	add constraint group_daily_feeds_source_fk
		foreign key (source_id)
		references catalog_sources (id)
		on delete restrict;
