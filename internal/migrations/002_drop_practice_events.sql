drop index if exists virtual_sessions_group_status_idx;
drop index if exists submissions_session_idx;

alter table if exists submissions
	drop column if exists session_id;

drop table if exists session_participants;
drop table if exists virtual_sessions;

delete from leaderboard_snapshots
where scope_type = 'session' or period = 'session';

alter table if exists leaderboard_snapshots
	drop column if exists scoring_rule_id,
	drop constraint if exists leaderboard_snapshots_scope_type_check,
	drop constraint if exists leaderboard_snapshots_period_check,
	add constraint leaderboard_snapshots_scope_type_check check (scope_type in ('global', 'group', 'daily', 'division')),
	add constraint leaderboard_snapshots_period_check check (period in ('all_time', 'yearly', 'monthly', 'weekly', 'daily'));

alter table if exists leaderboard_snapshot_rows
	drop column if exists penalty_seconds,
	drop column if exists tie_breaker_value;

drop table if exists scoring_rules;
