alter table users
	add column theme_preference text not null default 'dark'
		check (theme_preference in ('system', 'dark', 'light'));

alter table users
	alter column theme_preference set default 'system';

create table group_post_card_palettes (
	id uuid primary key default gen_random_uuid(),
	group_id uuid not null references groups(id) on delete cascade,
	system_key text,
	name text not null,
	material_model text not null default 'arcade-pigment-v1',
	surface_hue integer not null,
	surface_colorfulness integer not null,
	accent_hue integer,
	accent_colorfulness integer,
	archived_at timestamptz,
	revision bigint not null default 1,
	created_by_user_id uuid references users(id) on delete set null,
	updated_by_user_id uuid references users(id) on delete set null,
	created_at timestamptz not null default now(),
	updated_at timestamptz not null default now(),
	unique (id, group_id),
	check (system_key is null or system_key = 'chalkboard'),
	check (system_key is null or archived_at is null),
	check (length(btrim(name)) > 0 and length(name) <= 48),
	check (material_model = 'arcade-pigment-v1'),
	check (surface_hue between 0 and 359),
	check (surface_colorfulness between 0 and 100),
	check (accent_hue is null or accent_hue between 0 and 359),
	check (accent_colorfulness is null or accent_colorfulness between 0 and 100),
	check ((accent_hue is null) = (accent_colorfulness is null)),
	check (revision > 0)
);

create unique index group_post_card_palettes_system_key_unique
	on group_post_card_palettes (group_id, system_key)
	where system_key is not null;

create unique index group_post_card_palettes_active_name_unique
	on group_post_card_palettes (group_id, lower(name))
	where archived_at is null;

create index group_post_card_palettes_active_idx
	on group_post_card_palettes (group_id, lower(name), id)
	where archived_at is null;

create trigger group_post_card_palettes_set_updated_at
before update on group_post_card_palettes
for each row execute function set_updated_at();

insert into group_post_card_palettes (
	group_id,
	system_key,
	name,
	material_model,
	surface_hue,
	surface_colorfulness,
	accent_hue,
	accent_colorfulness,
	created_by_user_id,
	updated_by_user_id
)
select
	id,
	'chalkboard',
	'Chalkboard',
	'arcade-pigment-v1',
	167,
	95,
	173,
	74,
	created_by_user_id,
	created_by_user_id
from groups;

alter table group_evidence_formats
	add column content_typeface text not null default 'monospace'
		check (content_typeface in ('monospace', 'serif')),
	add column content_card_palette_id uuid;

alter table group_evidence_formats
	disable trigger group_evidence_formats_set_updated_at;

update group_evidence_formats fmt
set content_card_palette_id = palette.id
from group_post_card_palettes palette
where palette.group_id = fmt.group_id
	and palette.system_key = 'chalkboard';

alter table group_evidence_formats
	enable trigger group_evidence_formats_set_updated_at;

alter table group_evidence_formats
	alter column content_card_palette_id set not null,
	add constraint group_evidence_formats_content_card_palette_fk
		foreign key (content_card_palette_id, group_id)
		references group_post_card_palettes (id, group_id);

create index group_evidence_formats_content_card_palette_idx
	on group_evidence_formats (group_id, content_card_palette_id);
