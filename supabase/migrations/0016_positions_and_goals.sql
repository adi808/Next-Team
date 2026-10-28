-- Next Team: a playing position for each player and personal goals.
-- Position is a regular player parameter (lookup list "position", per sport), so it is table-driven,
-- keeps history and follows the usual visibility rules; staff set it, everyone on the team sees it.

insert into lookups (domain, slug, name_he, sport_id, sort_order, meta)
select 'position', v.slug, v.name_he, s.id, v.sort_order, v.meta::jsonb
from (values
  ('football', 'goalkeeper', 'שוער', 1, '{"goalkeeper": true}'),
  ('football', 'defender', 'הגנה', 2, '{}'),
  ('football', 'midfielder', 'קישור', 3, '{}'),
  ('football', 'forward', 'התקפה', 4, '{}'),
  ('basketball', 'point_guard', 'רכז', 1, '{}'),
  ('basketball', 'shooting_guard', 'קלע', 2, '{}'),
  ('basketball', 'small_forward', 'פורוורד', 3, '{}'),
  ('basketball', 'center', 'סנטר', 4, '{}')
) as v(sport, slug, name_he, sort_order, meta)
join sports s on s.slug = v.sport;

insert into attribute_defs (scope, key, label_he, data_type, config, visible_to, editable_by, sort_order) values
  ('player', 'position', 'עמדה', 'lookup', '{"domain": "position"}',
   array['system_admin','club_admin','coach','parent','player'], array['system_admin','club_admin','coach'], 0);

-- Personal goals the staff set for a player; done or archived, never removed.
create table player_goals (
  id uuid primary key default gen_random_uuid(),
  player_id uuid not null references players (id) on delete cascade,
  title text not null check (length(btrim(title)) > 0),
  target_date date,
  done_at timestamptz,
  archived boolean not null default false,
  created_by uuid references profiles (id),
  created_at timestamptz not null default now()
);
create index player_goals_player_idx on player_goals (player_id);
alter table player_goals enable row level security;
create policy player_goals_select on player_goals for select using (
  can_manage_player(player_id) or is_parent_of(player_id) or is_self_player(player_id));
grant select on player_goals to authenticated;

-- Adds a goal (p_id null) or edits one: title, target date, done, archived.
create function save_player_goal(p_id uuid, p_player uuid, p_title text, p_target date default null,
  p_done boolean default false, p_archived boolean default false) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_uid uuid := require_auth(); v_id uuid;
begin
  if not can_manage_player(p_player) then raise exception 'not allowed' using errcode = '42501'; end if;
  if p_id is null then
    insert into player_goals (player_id, title, target_date, created_by)
    values (p_player, btrim(p_title), p_target, v_uid) returning id into v_id;
  else
    update player_goals set title = btrim(p_title), target_date = p_target, archived = p_archived,
           done_at = case when p_done then coalesce(done_at, now()) end
     where id = p_id and player_id = p_player
    returning id into v_id;
    if v_id is null then raise exception 'goal not found' using errcode = 'P0002'; end if;
  end if;
  return v_id;
end $$;

revoke execute on function save_player_goal(uuid, uuid, text, date, boolean, boolean) from public, anon;
grant execute on function save_player_goal(uuid, uuid, text, date, boolean, boolean) to authenticated;
