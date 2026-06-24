alter table group_daily_feeds
	add column kind text;

update group_daily_feeds
set kind = 'catalog_daily'
where kind is null;

alter table group_daily_feeds
	alter column kind set default 'catalog_daily',
	alter column kind set not null,
	add constraint group_daily_feeds_kind_check
		check (kind in ('catalog_daily', 'daily_thread'));

with groups_needing_thread as (
	select
		g.id,
		g.created_by_user_id,
		case
			when exists (
				select 1
				from group_daily_feeds f
				where f.group_id = g.id and f.slug = 'daily-thread'
			) then 'daily-thread-' || left(g.id::text, 8)
			else 'daily-thread'
		end as slug
	from groups g
	where not exists (
		select 1
		from group_daily_feeds f
		where f.group_id = g.id and f.kind = 'daily_thread'
	)
)
insert into group_daily_feeds (
	group_id,
	name,
	slug,
	kind,
	enabled,
	audience,
	schedule,
	rules_schema_version,
	rules,
	created_by_user_id
)
select
	id,
	'Daily Thread',
	slug,
	'daily_thread',
	true,
	'{"type":"all_group_members"}'::jsonb,
	'{"cadence":"daily","timezone":"UTC"}'::jsonb,
	1,
	'{}'::jsonb,
	created_by_user_id
from groups_needing_thread
on conflict do nothing;

create unique index group_daily_feeds_one_daily_thread_per_group
	on group_daily_feeds (group_id)
	where kind = 'daily_thread';
