drop index if exists group_daily_feeds_public_lookup_idx;
drop index if exists group_feed_posts_public_lookup_idx;
drop index if exists group_feed_posts_public_instance_idx;

alter table groups
	alter column visibility set default 'public';

alter table group_daily_feeds
	drop constraint if exists group_daily_feeds_visibility_check,
	drop constraint if exists group_daily_feeds_default_post_visibility_check,
	drop column if exists visibility,
	drop column if exists default_post_visibility;

alter table group_feed_posts
	drop constraint if exists group_feed_posts_visibility_check,
	drop column if exists visibility;
