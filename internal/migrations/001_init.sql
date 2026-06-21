create extension if not exists pgcrypto;

create function set_updated_at()
returns trigger
language plpgsql
as $$
begin
	new.updated_at = now();
	return new;
end;
$$;

create table users (
	id uuid primary key default gen_random_uuid(),
	username text unique not null,
	display_name text not null,
	avatar_url text,
	created_at timestamptz not null default now(),
	updated_at timestamptz not null default now()
);

create table problem_sources (
	id uuid primary key default gen_random_uuid(),
	slug text unique not null,
	name text not null,
	base_url text not null,
	supports_submissions boolean not null default true,
	supports_problem_ratings boolean not null default false,
	supports_tags boolean not null default false,
	created_at timestamptz not null default now(),
	updated_at timestamptz not null default now()
);

create table scoring_rules (
	id uuid primary key default gen_random_uuid(),
	name text not null,
	slug text unique not null,
	description text,
	rule_type text not null check (rule_type in ('contest', 'daily', 'streak')),
	accepted_points integer not null default 1,
	use_daily_item_points boolean not null default false,
	wrong_submission_penalty_minutes integer not null default 0,
	all_solved_bonus_points integer not null default 0,
	rank_primary text not null check (rank_primary in ('points_desc', 'solves_desc', 'rating_gain_desc', 'streak_desc')),
	rank_secondary text check (rank_secondary in ('penalty_asc', 'finished_at_asc', 'none')),
	created_at timestamptz not null default now(),
	updated_at timestamptz not null default now()
);

create table external_accounts (
	id uuid primary key default gen_random_uuid(),
	user_id uuid not null references users(id) on delete cascade,
	source_id uuid not null references problem_sources(id),
	external_handle text not null,
	external_user_id text,
	verified_at timestamptz,
	last_synced_at timestamptz,
	sync_status text not null default 'pending' check (sync_status in ('pending', 'syncing', 'synced', 'failed', 'disabled')),
	created_at timestamptz not null default now(),
	updated_at timestamptz not null default now(),
	unique (source_id, external_handle)
);

create table groups (
	id uuid primary key default gen_random_uuid(),
	name text not null,
	slug text unique not null,
	description text,
	visibility text not null check (visibility in ('public', 'invite_only', 'private')),
	created_by_user_id uuid not null references users(id),
	created_at timestamptz not null default now(),
	updated_at timestamptz not null default now()
);

create table group_memberships (
	id uuid primary key default gen_random_uuid(),
	group_id uuid not null references groups(id) on delete cascade,
	user_id uuid not null references users(id) on delete cascade,
	role text not null check (role in ('owner', 'admin', 'member')),
	status text not null check (status in ('invited', 'active', 'removed', 'left')),
	joined_at timestamptz,
	created_at timestamptz not null default now(),
	updated_at timestamptz not null default now(),
	unique (group_id, user_id)
);

create table problems (
	id uuid primary key default gen_random_uuid(),
	source_id uuid not null references problem_sources(id),
	external_id text not null,
	title text not null,
	url text not null,
	contest_id text,
	problem_index text,
	rating integer,
	difficulty_label text,
	published_at timestamptz,
	created_at timestamptz not null default now(),
	updated_at timestamptz not null default now(),
	unique (source_id, external_id)
);

create table problem_tags (
	id uuid primary key default gen_random_uuid(),
	problem_id uuid not null references problems(id) on delete cascade,
	tag text not null,
	source text not null check (source in ('provider', 'arcade', 'user', 'model')),
	confidence numeric,
	created_at timestamptz not null default now(),
	unique (problem_id, tag, source)
);

create table user_preferences (
	id uuid primary key default gen_random_uuid(),
	user_id uuid not null references users(id) on delete cascade,
	source_id uuid references problem_sources(id),
	target_difficulty_delta integer not null default 100,
	daily_problem_count integer not null default 3,
	include_solved boolean not null default false,
	created_at timestamptz not null default now(),
	updated_at timestamptz not null default now()
);

create unique index user_preferences_user_source_unique
	on user_preferences (user_id, source_id)
	where source_id is not null;

create unique index user_preferences_user_global_unique
	on user_preferences (user_id)
	where source_id is null;

create table user_preference_tags (
	id uuid primary key default gen_random_uuid(),
	user_preference_id uuid not null references user_preferences(id) on delete cascade,
	tag text not null,
	preference text not null check (preference in ('preferred', 'blocked')),
	weight numeric not null default 1,
	created_at timestamptz not null default now(),
	unique (user_preference_id, tag, preference)
);

create table divisions (
	id uuid primary key default gen_random_uuid(),
	group_id uuid references groups(id) on delete cascade,
	name text not null,
	slug text not null,
	description text,
	created_by_user_id uuid references users(id),
	created_at timestamptz not null default now(),
	updated_at timestamptz not null default now(),
	unique (group_id, slug)
);

create unique index divisions_global_slug_unique
	on divisions (slug)
	where group_id is null;

create table division_rules (
	id uuid primary key default gen_random_uuid(),
	division_id uuid not null references divisions(id) on delete cascade,
	source_id uuid references problem_sources(id),
	min_user_rating integer,
	max_user_rating integer,
	min_problem_rating integer,
	max_problem_rating integer,
	problem_count integer,
	created_at timestamptz not null default now(),
	updated_at timestamptz not null default now()
);

create table division_rule_tags (
	id uuid primary key default gen_random_uuid(),
	division_rule_id uuid not null references division_rules(id) on delete cascade,
	tag text not null,
	constraint_type text not null check (constraint_type in ('required', 'excluded')),
	created_at timestamptz not null default now(),
	unique (division_rule_id, tag, constraint_type)
);

create table daily_sets (
	id uuid primary key default gen_random_uuid(),
	scope_type text not null check (scope_type in ('user', 'group', 'division', 'group_division', 'global')),
	scope_id uuid,
	group_id uuid references groups(id) on delete cascade,
	division_id uuid references divisions(id) on delete cascade,
	user_id uuid references users(id) on delete cascade,
	date date not null,
	title text,
	generation_reason text,
	generator_version text,
	created_at timestamptz not null default now(),
	unique (scope_type, scope_id, date)
);

create unique index daily_sets_scope_null_date_unique
	on daily_sets (scope_type, date)
	where scope_id is null;

create table daily_set_items (
	id uuid primary key default gen_random_uuid(),
	daily_set_id uuid not null references daily_sets(id) on delete cascade,
	problem_id uuid not null references problems(id),
	position integer not null,
	role text not null check (role in ('warmup', 'target', 'stretch', 'bonus')),
	points integer not null default 1,
	recommendation_reason text,
	created_at timestamptz not null default now(),
	unique (daily_set_id, problem_id),
	unique (daily_set_id, position)
);

create table virtual_sessions (
	id uuid primary key default gen_random_uuid(),
	group_id uuid references groups(id) on delete cascade,
	host_user_id uuid not null references users(id),
	source_id uuid references problem_sources(id),
	daily_set_id uuid references daily_sets(id),
	external_contest_id text,
	title text not null,
	mode text not null check (mode in ('virtual_contest', 'practice_set', 'aoc_replay')),
	status text not null check (status in ('scheduled', 'live', 'finished', 'cancelled')),
	starts_at timestamptz,
	duration_minutes integer,
	scoring_rule_id uuid references scoring_rules(id),
	created_at timestamptz not null default now(),
	updated_at timestamptz not null default now()
);

create table session_participants (
	id uuid primary key default gen_random_uuid(),
	session_id uuid not null references virtual_sessions(id) on delete cascade,
	user_id uuid not null references users(id) on delete cascade,
	status text not null check (status in ('joined', 'active', 'finished', 'abandoned')),
	joined_at timestamptz not null default now(),
	started_at timestamptz,
	finished_at timestamptz,
	unique (session_id, user_id)
);

create table submissions (
	id uuid primary key default gen_random_uuid(),
	user_id uuid not null references users(id) on delete cascade,
	problem_id uuid not null references problems(id),
	source_id uuid not null references problem_sources(id),
	external_submission_id text,
	external_account_id uuid references external_accounts(id),
	session_id uuid references virtual_sessions(id) on delete set null,
	daily_set_id uuid references daily_sets(id) on delete set null,
	verdict text not null check (verdict in ('accepted', 'wrong_answer', 'time_limit_exceeded', 'memory_limit_exceeded', 'runtime_error', 'compile_error', 'partial', 'completed', 'manual_solve')),
	language text,
	submitted_at timestamptz not null,
	runtime_ms integer,
	memory_bytes integer,
	created_at timestamptz not null default now(),
	unique (source_id, external_submission_id)
);

create table leaderboard_snapshots (
	id uuid primary key default gen_random_uuid(),
	scope_type text not null check (scope_type in ('global', 'group', 'session', 'daily', 'division')),
	scope_id uuid,
	period text not null check (period in ('all_time', 'yearly', 'monthly', 'weekly', 'daily', 'session')),
	metric text not null check (metric in ('points', 'solves', 'rating_gain', 'streak')),
	scoring_rule_id uuid references scoring_rules(id),
	computed_at timestamptz not null,
	unique (scope_type, scope_id, period, metric, computed_at)
);

create unique index leaderboard_snapshots_scope_null_unique
	on leaderboard_snapshots (scope_type, period, metric, computed_at)
	where scope_id is null;

create table leaderboard_snapshot_rows (
	id uuid primary key default gen_random_uuid(),
	snapshot_id uuid not null references leaderboard_snapshots(id) on delete cascade,
	rank integer not null,
	user_id uuid not null references users(id),
	display_name text not null,
	points numeric not null default 0,
	solves integer not null default 0,
	penalty_seconds integer,
	rating_gain numeric,
	streak_count integer,
	tie_breaker_value numeric,
	created_at timestamptz not null default now(),
	unique (snapshot_id, rank),
	unique (snapshot_id, user_id)
);

create index external_accounts_user_id_idx on external_accounts (user_id);
create index group_memberships_user_id_idx on group_memberships (user_id);
create index group_memberships_group_status_idx on group_memberships (group_id, status);
create index problems_source_rating_idx on problems (source_id, rating);
create index problem_tags_tag_idx on problem_tags (tag);
create index daily_sets_user_date_idx on daily_sets (user_id, date desc);
create index daily_sets_group_date_idx on daily_sets (group_id, date desc);
create index virtual_sessions_group_status_idx on virtual_sessions (group_id, status);
create index submissions_user_submitted_idx on submissions (user_id, submitted_at desc);
create index submissions_session_idx on submissions (session_id);
create index submissions_daily_set_idx on submissions (daily_set_id);

create trigger users_set_updated_at
before update on users
for each row execute function set_updated_at();

create trigger problem_sources_set_updated_at
before update on problem_sources
for each row execute function set_updated_at();

create trigger scoring_rules_set_updated_at
before update on scoring_rules
for each row execute function set_updated_at();

create trigger external_accounts_set_updated_at
before update on external_accounts
for each row execute function set_updated_at();

create trigger groups_set_updated_at
before update on groups
for each row execute function set_updated_at();

create trigger group_memberships_set_updated_at
before update on group_memberships
for each row execute function set_updated_at();

create trigger problems_set_updated_at
before update on problems
for each row execute function set_updated_at();

create trigger user_preferences_set_updated_at
before update on user_preferences
for each row execute function set_updated_at();

create trigger divisions_set_updated_at
before update on divisions
for each row execute function set_updated_at();

create trigger division_rules_set_updated_at
before update on division_rules
for each row execute function set_updated_at();

create trigger virtual_sessions_set_updated_at
before update on virtual_sessions
for each row execute function set_updated_at();

insert into problem_sources (slug, name, base_url, supports_submissions, supports_problem_ratings, supports_tags)
values
	('codeforces', 'Codeforces', 'https://codeforces.com', true, true, true),
	('atcoder', 'AtCoder', 'https://atcoder.jp', true, false, true),
	('advent-of-code', 'Advent of Code', 'https://adventofcode.com', false, false, false)
on conflict (slug) do update set
	name = excluded.name,
	base_url = excluded.base_url,
	supports_submissions = excluded.supports_submissions,
	supports_problem_ratings = excluded.supports_problem_ratings,
	supports_tags = excluded.supports_tags;

insert into scoring_rules (
	name,
	slug,
	description,
	rule_type,
	accepted_points,
	use_daily_item_points,
	wrong_submission_penalty_minutes,
	all_solved_bonus_points,
	rank_primary,
	rank_secondary
)
values
	('Contest Standard', 'contest_standard', 'Solve count first, then penalty.', 'contest', 1, false, 20, 0, 'solves_desc', 'penalty_asc'),
	('Daily Standard', 'daily_standard', 'Daily item points with a small all-solved bonus.', 'daily', 1, true, 0, 2, 'points_desc', 'finished_at_asc')
on conflict (slug) do update set
	name = excluded.name,
	description = excluded.description,
	rule_type = excluded.rule_type,
	accepted_points = excluded.accepted_points,
	use_daily_item_points = excluded.use_daily_item_points,
	wrong_submission_penalty_minutes = excluded.wrong_submission_penalty_minutes,
	all_solved_bonus_points = excluded.all_solved_bonus_points,
	rank_primary = excluded.rank_primary,
	rank_secondary = excluded.rank_secondary;

with rows (external_id, title, url, contest_id, problem_index, rating, difficulty_label) as (
	values
		('4A', 'Watermelon', 'https://codeforces.com/problemset/problem/4/A', '4', 'A', 800, 'easy'),
		('71A', 'Way Too Long Words', 'https://codeforces.com/problemset/problem/71/A', '71', 'A', 800, 'easy'),
		('231A', 'Team', 'https://codeforces.com/problemset/problem/231/A', '231', 'A', 800, 'easy'),
		('158A', 'Next Round', 'https://codeforces.com/problemset/problem/158/A', '158', 'A', 800, 'easy'),
		('50A', 'Domino Piling', 'https://codeforces.com/problemset/problem/50/A', '50', 'A', 800, 'easy'),
		('263A', 'Beautiful Matrix', 'https://codeforces.com/problemset/problem/263/A', '263', 'A', 800, 'easy'),
		('282A', 'Bit++', 'https://codeforces.com/problemset/problem/282/A', '282', 'A', 800, 'easy'),
		('339A', 'Helpful Maths', 'https://codeforces.com/problemset/problem/339/A', '339', 'A', 800, 'easy'),
		('977A', 'Wrong Subtraction', 'https://codeforces.com/problemset/problem/977/A', '977', 'A', 800, 'easy'),
		('734A', 'Anton and Danik', 'https://codeforces.com/problemset/problem/734/A', '734', 'A', 800, 'easy'),
		('469A', 'I Wanna Be the Guy', 'https://codeforces.com/problemset/problem/469/A', '469', 'A', 800, 'easy'),
		('579A', 'Raising Bacteria', 'https://codeforces.com/problemset/problem/579/A', '579', 'A', 1000, 'medium'),
		('545C', 'Woodcutters', 'https://codeforces.com/problemset/problem/545/C', '545', 'C', 1500, 'medium'),
		('455A', 'Boredom', 'https://codeforces.com/problemset/problem/455/A', '455', 'A', 1500, 'medium'),
		('580C', 'Kefa and Park', 'https://codeforces.com/problemset/problem/580/C', '580', 'C', 1500, 'medium'),
		('466C', 'Number of Ways', 'https://codeforces.com/problemset/problem/466/C', '466', 'C', 1700, 'medium'),
		('489C', 'Given Length and Sum of Digits...', 'https://codeforces.com/problemset/problem/489/C', '489', 'C', 1400, 'medium'),
		('337C', 'Quiz', 'https://codeforces.com/problemset/problem/337/C', '337', 'C', 1700, 'medium'),
		('1200E', 'Compress Words', 'https://codeforces.com/problemset/problem/1200/E', '1200', 'E', 1900, 'hard'),
		('295B', 'Greg and Graph', 'https://codeforces.com/problemset/problem/295/B', '295', 'B', 1800, 'hard')
)
insert into problems (source_id, external_id, title, url, contest_id, problem_index, rating, difficulty_label)
select ps.id, rows.external_id, rows.title, rows.url, rows.contest_id, rows.problem_index, rows.rating, rows.difficulty_label
from rows
join problem_sources ps on ps.slug = 'codeforces'
on conflict (source_id, external_id) do update set
	title = excluded.title,
	url = excluded.url,
	contest_id = excluded.contest_id,
	problem_index = excluded.problem_index,
	rating = excluded.rating,
	difficulty_label = excluded.difficulty_label;

with tag_rows (external_id, tag) as (
	values
		('4A', 'math'),
		('4A', 'greedy'),
		('71A', 'strings'),
		('231A', 'greedy'),
		('158A', 'implementation'),
		('50A', 'math'),
		('263A', 'implementation'),
		('282A', 'implementation'),
		('339A', 'strings'),
		('339A', 'sortings'),
		('977A', 'math'),
		('734A', 'implementation'),
		('469A', 'implementation'),
		('579A', 'bitmasks'),
		('579A', 'math'),
		('545C', 'dp'),
		('545C', 'greedy'),
		('455A', 'dp'),
		('580C', 'graphs'),
		('580C', 'dfs'),
		('466C', 'dp'),
		('466C', 'two pointers'),
		('489C', 'greedy'),
		('489C', 'math'),
		('337C', 'math'),
		('337C', 'binary search'),
		('1200E', 'strings'),
		('1200E', 'hashing'),
		('295B', 'graphs'),
		('295B', 'shortest paths')
)
insert into problem_tags (problem_id, tag, source, confidence)
select p.id, tag_rows.tag, 'provider', 1
from tag_rows
join problem_sources ps on ps.slug = 'codeforces'
join problems p on p.source_id = ps.id and p.external_id = tag_rows.external_id
on conflict (problem_id, tag, source) do nothing;
