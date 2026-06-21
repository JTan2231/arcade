alter table users
	add column if not exists email text,
	add column if not exists password_hash text;

update users
set email = lower(btrim(email))
where email is not null;

update users
set email = 'user-' || replace(id::text, '-', '') || '@local.arcade.invalid'
where email is null or btrim(email) = '';

update users
set password_hash = 'disabled'
where password_hash is null or password_hash = '';

alter table users
	alter column email set not null,
	alter column password_hash set not null;

create unique index if not exists users_email_unique
	on users (lower(email));

create table if not exists user_sessions (
	id uuid primary key default gen_random_uuid(),
	user_id uuid not null references users(id) on delete cascade,
	token_hash bytea unique not null,
	remember_me boolean not null default false,
	user_agent text,
	ip_address inet,
	last_seen_at timestamptz not null default now(),
	expires_at timestamptz not null,
	revoked_at timestamptz,
	created_at timestamptz not null default now()
);

create index if not exists user_sessions_user_id_idx on user_sessions (user_id);
create index if not exists user_sessions_expires_at_idx on user_sessions (expires_at);
