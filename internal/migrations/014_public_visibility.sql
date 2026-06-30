update groups
set visibility = 'public'
where visibility = 'invite_only';

alter table groups
	drop constraint groups_visibility_check,
	add constraint groups_visibility_check
		check (visibility in ('public', 'private'));

alter table group_daily_feeds
	add column visibility text not null default 'private',
	add column default_post_visibility text not null default 'private',
	add constraint group_daily_feeds_visibility_check
		check (visibility in ('public', 'private')),
	add constraint group_daily_feeds_default_post_visibility_check
		check (default_post_visibility in ('public', 'private'));

alter table group_feed_posts
	add column visibility text not null default 'private',
	add constraint group_feed_posts_visibility_check
		check (visibility in ('public', 'private'));

create index group_daily_feeds_public_lookup_idx
	on group_daily_feeds (id)
	where visibility = 'public' and enabled;

create index group_feed_posts_public_lookup_idx
	on group_feed_posts (id)
	where visibility = 'public' and deleted_at is null;

create index group_feed_posts_public_instance_idx
	on group_feed_posts (feed_instance_id, created_at desc)
	where visibility = 'public' and deleted_at is null;
