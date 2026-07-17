alter table groups
	add column join_policy text not null default 'invite_only',
	add constraint groups_join_policy_check
		check (join_policy in ('invite_only', 'open')),
	add constraint groups_open_requires_public_check
		check (join_policy <> 'open' or visibility = 'public');
