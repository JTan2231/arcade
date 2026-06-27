alter table users
	add column friend_code text;

update users
set friend_code = 'ARCD' || upper(left(replace(id::text, '-', ''), 8))
where friend_code is null;

alter table users
	alter column friend_code set not null,
	add constraint users_friend_code_check
		check (friend_code ~ '^[A-Z0-9]+$');

create unique index users_friend_code_unique
	on users (friend_code);

create table user_friendships (
	id uuid primary key default gen_random_uuid(),
	requester_user_id uuid not null references users(id) on delete cascade,
	addressee_user_id uuid not null references users(id) on delete cascade,
	user_low_id uuid not null references users(id) on delete cascade,
	user_high_id uuid not null references users(id) on delete cascade,
	status text not null check (
		status in ('pending', 'accepted', 'declined', 'canceled')
	),
	requested_at timestamptz not null default now(),
	responded_at timestamptz,
	accepted_at timestamptz,
	created_at timestamptz not null default now(),
	updated_at timestamptz not null default now(),

	check (requester_user_id <> addressee_user_id),
	check (user_low_id <> user_high_id),
	unique (user_low_id, user_high_id)
);

create index user_friendships_addressee_pending_idx
	on user_friendships (addressee_user_id, created_at desc)
	where status = 'pending';

create index user_friendships_requester_pending_idx
	on user_friendships (requester_user_id, created_at desc)
	where status = 'pending';

create index user_friendships_user_low_status_idx
	on user_friendships (user_low_id, status);

create index user_friendships_user_high_status_idx
	on user_friendships (user_high_id, status);

create trigger user_friendships_set_updated_at
before update on user_friendships
for each row execute function set_updated_at();

alter table group_memberships
	add column invited_by_user_id uuid references users(id) on delete set null,
	add column invited_at timestamptz;
