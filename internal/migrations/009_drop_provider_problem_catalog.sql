-- Remove the provider-backed problem catalog and features that depended on it.
-- Current practice feeds use group-owned catalog_sources/catalog_items instead.
drop table if exists leaderboard_snapshot_rows;
drop table if exists leaderboard_snapshots;
drop table if exists submissions;
drop table if exists daily_set_items;
drop table if exists daily_sets;
drop table if exists user_preference_tags;
drop table if exists user_preferences;
drop table if exists external_accounts;
drop table if exists division_rule_tags;

alter table if exists division_rules
	drop column if exists source_id,
	drop column if exists min_problem_rating,
	drop column if exists max_problem_rating,
	drop column if exists problem_count;

drop table if exists legacy_catalog_items;
drop table if exists legacy_item_sources;
drop table if exists problem_tags;
drop table if exists problems;
drop table if exists problem_sources;
