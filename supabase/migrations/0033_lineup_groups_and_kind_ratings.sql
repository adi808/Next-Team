-- Next Team: groups that play at the same time in one match (for example two groups of 7 + goalkeeper),
-- a default group (or the bench) for each player, a lineup that is a draft until the coach approves it,
-- and ratings that apply to goalkeepers only or to field players only.

-- ---- Groups: a table-driven list (group 1..4, bench); the group number lives in meta.
insert into lookups (domain, slug, name_he, sort_order, meta) values
  ('lineup_group', 'group_1', 'קבוצה 1', 1, '{"group_no": 1}'),
  ('lineup_group', 'group_2', 'קבוצה 2', 2, '{"group_no": 2}'),
  ('lineup_group', 'group_3', 'קבוצה 3', 3, '{"group_no": 3}'),
  ('lineup_group', 'group_4', 'קבוצה 4', 4, '{"group_no": 4}'),
  ('lineup_group', 'bench', 'ספסל', 9, '{"bench": true}');

-- How many groups play at once: a team setting (for example 2 for the younger ages), a match can override it.
-- The player's default group is staff-only, like the lineup itself.
insert into attribute_defs (scope, key, label_he, data_type, config, visible_to, editable_by, sort_order) values
  ('team', 'parallel_groups', 'מספר קבוצות שמשחקות במקביל', 'number', '{"min": 1, "max": 4, "default": 1}',
     array['system_admin','club_admin','coach','parent','player'], array['system_admin','club_admin','coach'], 6),
  ('event', 'parallel_groups', 'מספר קבוצות במקביל', 'number', '{"min": 1, "max": 4, "default_from_team": "parallel_groups"}',
     array['system_admin','club_admin','coach','parent','player'], array['system_admin','club_admin','coach'], 3),
  ('player', 'default_group', 'קבוצה ברירת מחדל', 'lookup', '{"domain": "lineup_group"}',
     array['system_admin','club_admin','coach'], array['system_admin','club_admin','coach'], -1);

-- ---- The lineup now has a group: slot 0 of each group is its goalkeeper. A player stands in one place only.
alter table event_lineups add column group_no int not null default 1 check (group_no between 1 and 4);
alter table event_lineups drop constraint event_lineups_pkey;
alter table event_lineups add primary key (event_id, group_no, slot);

-- Draft or approved: no row means a draft.
create table event_lineup_state (
  event_id uuid primary key references events (id) on delete cascade,
  approved_at timestamptz not null default now(),
  approved_by uuid references profiles (id)
);
alter table event_lineup_state enable row level security;
create policy event_lineup_state_select on event_lineup_state for select using (can_manage_team(event_team(event_id)));
grant select on event_lineup_state to authenticated;

-- Replaces the lineup of every group: p_groups is [[slot 0 player, slot 1 player, ...], [...]] (null = empty slot).
-- Saving without p_approve keeps (or turns) the lineup into a draft; p_approve marks it approved.
create function save_event_lineup(p_event uuid, p_groups jsonb, p_approve boolean default false) returns void
language plpgsql security definer set search_path = public as $$
declare v_uid uuid := require_auth(); v_team uuid := event_team(p_event); v_ids uuid[];
begin
  if v_team is null or not can_manage_team(v_team) then raise exception 'not allowed' using errcode = '42501'; end if;
  if jsonb_typeof(coalesce(p_groups, '[]')) <> 'array' or jsonb_array_length(coalesce(p_groups, '[]')) > 4 then
    raise exception 'up to 4 groups' using errcode = '22023';
  end if;
  if exists (select 1 from jsonb_array_elements(coalesce(p_groups, '[]')) g
             where jsonb_typeof(g) <> 'array' or jsonb_array_length(g) > 31) then
    raise exception 'too many slots' using errcode = '22023';
  end if;
  select array_agg((p #>> '{}')::uuid) into v_ids
    from jsonb_array_elements(coalesce(p_groups, '[]')) g, jsonb_array_elements(g) p
   where jsonb_typeof(p) = 'string';
  if exists (select 1 from unnest(coalesce(v_ids, '{}')) p
             where not exists (select 1 from team_players where team_id = v_team and player_id = p)) then
    raise exception 'player is not on this team' using errcode = '22023';
  end if;
  if cardinality(coalesce(v_ids, '{}')) <> (select count(distinct p) from unnest(coalesce(v_ids, '{}')) p) then
    raise exception 'a player can stand in one place only' using errcode = '22023';
  end if;
  delete from event_lineups where event_id = p_event;
  insert into event_lineups (event_id, group_no, slot, player_id)
  select p_event, g.n, s.i - 1, (s.p #>> '{}')::uuid
    from jsonb_array_elements(coalesce(p_groups, '[]')) with ordinality g(arr, n),
         jsonb_array_elements(g.arr) with ordinality s(p, i)
   where jsonb_typeof(s.p) = 'string';
  delete from event_lineup_state where event_id = p_event;
  if coalesce(p_approve, false) then
    insert into event_lineup_state (event_id, approved_by) values (p_event, v_uid);
  end if;
end $$;

-- The one-group form is kept for older clients: it saves group 1 as a draft.
create or replace function set_event_lineup(p_event uuid, p_players uuid[]) returns void
language plpgsql security definer set search_path = public as $$
begin
  if coalesce(cardinality(p_players), 0) > 31 then raise exception 'too many slots' using errcode = '22023'; end if;
  perform save_event_lineup(p_event, jsonb_build_array(coalesce(to_jsonb(p_players), '[]')), false);
end $$;

revoke execute on function save_event_lineup(uuid, jsonb, boolean) from public, anon;
grant execute on function save_event_lineup(uuid, jsonb, boolean) to authenticated;

-- ---- Ratings by player kind: config.player_kind = 'goalkeeper' or 'field' (the player_kind list's slugs);
-- no player_kind = the rating applies to everyone. Defaults for football:
insert into attribute_defs (scope, key, label_he, data_type, config, visible_to, editable_by, sport_id, sort_order)
select 'player', 'football_' || v.key, v.label_he, 'scale', jsonb_build_object('min', 1, 'max', 10, 'player_kind', v.kind),
       array['system_admin','club_admin','coach','parent','player'], array['system_admin','club_admin','coach'], s.id, v.sort_order
from (values
  ('kicking', 'בעיטה', 'field', 6),
  ('passing', 'מסירה', 'field', 7),
  ('dribbling', 'כדרור', 'field', 8),
  ('heading', 'משחק ראש', 'field', 9),
  ('gk_reflexes', 'תגובה', 'goalkeeper', 6),
  ('gk_coming_out', 'יציאות', 'goalkeeper', 7),
  ('gk_handling', 'תפיסה', 'goalkeeper', 8),
  ('gk_distribution', 'משחק רגל', 'goalkeeper', 9)
) as v(key, label_he, kind, sort_order)
join sports s on s.slug = 'football';
