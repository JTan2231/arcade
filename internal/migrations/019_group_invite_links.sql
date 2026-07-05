delete from group_memberships
where status = 'invited';

alter table group_memberships
	drop constraint if exists group_memberships_status_check,
	add constraint group_memberships_status_check
		check (status in ('active', 'removed', 'left'));

create table group_invite_links (
	id uuid primary key default gen_random_uuid(),
	group_id uuid not null references groups(id) on delete cascade,
	token_hash bytea unique not null,
	label text,
	created_by_user_id uuid references users(id) on delete set null,
	expires_at timestamptz not null,
	revoked_at timestamptz,
	max_uses integer check (max_uses is null or max_uses > 0),
	created_at timestamptz not null default now(),
	updated_at timestamptz not null default now(),
	check (expires_at > created_at)
);

create index group_invite_links_group_id_created_at_idx
	on group_invite_links (group_id, created_at desc);

create index group_invite_links_expires_at_idx
	on group_invite_links (expires_at)
	where revoked_at is null;

create trigger group_invite_links_set_updated_at
before update on group_invite_links
for each row execute function set_updated_at();

alter table group_memberships
	add column invite_link_id uuid references group_invite_links(id) on delete set null;

create index group_memberships_invite_link_id_idx
	on group_memberships (invite_link_id)
	where invite_link_id is not null;

create table group_invite_link_redemptions (
	id uuid primary key default gen_random_uuid(),
	invite_link_id uuid references group_invite_links(id) on delete set null,
	group_id uuid not null references groups(id) on delete cascade,
	redeemed_by_user_id uuid not null references users(id) on delete cascade,
	invited_by_user_id uuid references users(id) on delete set null,
	redeemed_at timestamptz not null default now()
);

create index group_invite_link_redemptions_link_id_redeemed_at_idx
	on group_invite_link_redemptions (invite_link_id, redeemed_at desc);

create index group_invite_link_redemptions_group_id_redeemed_at_idx
	on group_invite_link_redemptions (group_id, redeemed_at desc);

drop table if exists user_friendships;

drop index if exists users_friend_code_unique;

alter table users
	drop constraint if exists users_friend_code_check,
	drop column if exists friend_code;
