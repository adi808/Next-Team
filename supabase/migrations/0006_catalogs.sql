-- Next Team: one generic catalog table for every "choose from a list" value.
-- Domains seeded below: event_type, absence_reason, match_format, formation, stat_type.
-- New lists (or new values) need no code change: add rows. parent_id supports dependent lists
-- (formation depends on match_format). sport_id/club_id scope a value to a sport or a club.

create table lookups (
  id uuid primary key default gen_random_uuid(),
  domain text not null check (domain ~ '^[a-z0-9_]+$'),
  slug text not null check (slug ~ '^[a-z0-9_-]+$'),
  name_he text not null,
  icon_path text,
  parent_id uuid references lookups (id) on delete cascade,
  sport_id uuid references sports (id) on delete cascade,
  club_id uuid references clubs (id) on delete cascade,
  sort_order int not null default 0,
  meta jsonb not null default '{}',
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create unique index lookups_unique_idx on lookups (
  domain, slug,
  coalesce(club_id, '00000000-0000-0000-0000-000000000000'),
  coalesce(sport_id, '00000000-0000-0000-0000-000000000000'));
create index lookups_domain_idx on lookups (domain);

alter table lookups enable row level security;
create policy lookups_select on lookups for select to authenticated
  using (club_id is null or is_club_member(club_id));

-- System admin: any value. Club admin: values of their own club only.
create function upsert_lookup(
  p_id uuid, p_domain text, p_slug text, p_name_he text,
  p_icon_path text default null, p_parent uuid default null, p_sport uuid default null,
  p_club uuid default null, p_sort int default 0, p_meta jsonb default '{}',
  p_active boolean default true) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  perform require_auth();
  if not (is_system_admin() or (p_club is not null and is_club_admin_strict(p_club))) then
    raise exception 'not allowed to manage this list' using errcode = '42501';
  end if;
  if p_id is null then
    insert into lookups (domain, slug, name_he, icon_path, parent_id, sport_id, club_id, sort_order, meta, active)
    values (p_domain, p_slug, p_name_he, p_icon_path, p_parent, p_sport, p_club, p_sort, p_meta, p_active)
    returning id into v_id;
  else
    update lookups set slug = p_slug, name_he = p_name_he, icon_path = p_icon_path,
           parent_id = p_parent, sport_id = p_sport, sort_order = p_sort, meta = p_meta, active = p_active
     where id = p_id
       and (is_system_admin() or club_id = p_club)
    returning id into v_id;
    if v_id is null then raise exception 'value not found or not yours' using errcode = 'P0002'; end if;
  end if;
  return v_id;
end $$;

-- ------------------------------------------------------------------ seeds
insert into lookups (domain, slug, name_he, sort_order, meta) values
  ('event_type', 'training', 'אימון', 1, '{}'),
  ('event_type', 'match', 'משחק', 2, '{"is_match": true}'),
  ('event_type', 'team_building', 'גיבוש', 3, '{}'),
  ('absence_reason', 'illness', 'מחלה', 1, '{}'),
  ('absence_reason', 'injury', 'פציעה', 2, '{}'),
  ('absence_reason', 'vacation', 'חופשה', 3, '{}'),
  ('absence_reason', 'school', 'לימודים', 4, '{}'),
  ('absence_reason', 'family', 'אירוע משפחתי', 5, '{}'),
  ('absence_reason', 'other', 'אחר', 6, '{"note_required": true}');

-- match formats (players on the field), per sport
insert into lookups (domain, slug, name_he, sport_id, sort_order)
select 'match_format', v.slug, v.name_he, s.id, v.sort_order
from (values
  ('football', 'football_11', '11 על 11', 1), ('football', 'football_9', '9 על 9', 2),
  ('football', 'football_7', '7 על 7', 3), ('football', 'football_5', '5 על 5', 4),
  ('basketball', 'basketball_5', '5 על 5', 1), ('basketball', 'basketball_3', '3 על 3', 2)
) as v(sport, slug, name_he, sort_order)
join sports s on s.slug = v.sport;

-- formations, children of a match format
insert into lookups (domain, slug, name_he, parent_id, sport_id, sort_order)
select 'formation', 'f_' || replace(v.name_he, '-', '_') || '_' || v.parent_slug, v.name_he, p.id, p.sport_id, v.sort_order
from (values
  ('football_11', '4-3-3', 1), ('football_11', '4-4-2', 2), ('football_11', '3-5-2', 3), ('football_11', '4-2-3-1', 4),
  ('football_9', '3-3-2', 1), ('football_9', '3-2-3', 2), ('football_9', '2-3-3', 3),
  ('football_7', '2-3-1', 1), ('football_7', '3-2-1', 2), ('football_7', '2-2-2', 3),
  ('football_5', '2-2', 1), ('football_5', '1-2-1', 2)
) as v(parent_slug, name_he, sort_order)
join lookups p on p.domain = 'match_format' and p.slug = v.parent_slug;

-- statistics recorded in a match, per sport
insert into lookups (domain, slug, name_he, sport_id, sort_order, meta)
select 'stat_type', v.slug, v.name_he, s.id, v.sort_order, v.meta::jsonb
from (values
  ('football', 'goal', 'שער', 1, '{"scores": 1}'),
  ('football', 'assist', 'בישול', 2, '{}'),
  ('football', 'yellow_card', 'כרטיס צהוב', 3, '{"card": "yellow"}'),
  ('football', 'red_card', 'כרטיס אדום', 4, '{"card": "red"}'),
  ('basketball', 'points_1', 'זריקה חופשית', 1, '{"scores": 1}'),
  ('basketball', 'points_2', 'סל 2 נקודות', 2, '{"scores": 2}'),
  ('basketball', 'points_3', 'סל 3 נקודות', 3, '{"scores": 3}'),
  ('basketball', 'rebound', 'ריבאונד', 4, '{}'),
  ('basketball', 'assist', 'בישול', 5, '{}'),
  ('basketball', 'foul', 'עבירה', 6, '{}')
) as v(sport, slug, name_he, sort_order, meta)
join sports s on s.slug = v.sport;
