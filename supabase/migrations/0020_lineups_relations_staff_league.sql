-- Next Team: full event editing, a saved match lineup, the parent's relation to the child (mom / dad),
-- staff types (head coach, assistant, ...) and a link to the team's league page.

-- ---- Event editing: every field, including the type and the end time, and clearing a field.
-- update_event keeps a field when its argument is null, so it cannot clear one; this one replaces them all.
create function save_event_details(p_event uuid, p_type uuid, p_title text, p_starts timestamptz,
  p_ends timestamptz default null, p_location text default '', p_notes text default '',
  p_opponent text default null, p_our_score int default null, p_their_score int default null) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform require_auth();
  if not can_manage_team(event_team(p_event)) then raise exception 'not allowed' using errcode = '42501'; end if;
  if not lookup_in_domain(p_type, 'event_type') then raise exception 'unknown event type' using errcode = '22023'; end if;
  if p_starts is null then raise exception 'a start time is required' using errcode = '22023'; end if;
  if p_ends is not null and p_ends < p_starts then
    raise exception 'the end must be after the start' using errcode = '22023';
  end if;
  update events set type_id = p_type, title = coalesce(btrim(p_title), ''), starts_at = p_starts, ends_at = p_ends,
         location = coalesce(btrim(p_location), ''), notes = coalesce(p_notes, ''),
         opponent = nullif(btrim(p_opponent), ''), our_score = p_our_score, their_score = p_their_score
   where id = p_event;
end $$;

-- ---- Match lineup: which player stands in which slot of the formation (0 = goalkeeper, then the rows
-- from defence to attack). Staff only.
create table event_lineups (
  event_id uuid not null references events (id) on delete cascade,
  slot int not null check (slot between 0 and 30),
  player_id uuid not null references players (id) on delete cascade,
  primary key (event_id, slot),
  unique (event_id, player_id)
);
alter table event_lineups enable row level security;
create policy event_lineups_select on event_lineups for select using (can_manage_team(event_team(event_id)));
grant select on event_lineups to authenticated;

-- Replaces the lineup: p_players[i] stands in slot i - 1; a null leaves the slot empty.
create function set_event_lineup(p_event uuid, p_players uuid[]) returns void
language plpgsql security definer set search_path = public as $$
declare v_team uuid := event_team(p_event);
begin
  perform require_auth();
  if v_team is null or not can_manage_team(v_team) then raise exception 'not allowed' using errcode = '42501'; end if;
  if coalesce(cardinality(p_players), 0) > 31 then raise exception 'too many slots' using errcode = '22023'; end if;
  if exists (select 1 from unnest(coalesce(p_players, '{}')) p
             where p is not null and not exists (select 1 from team_players where team_id = v_team and player_id = p)) then
    raise exception 'player is not on this team' using errcode = '22023';
  end if;
  delete from event_lineups where event_id = p_event;
  insert into event_lineups (event_id, slot, player_id)
  select p_event, i - 1, p_players[i] from generate_subscripts(coalesce(p_players, '{}'), 1) i
   where p_players[i] is not null;
end $$;

-- ---- The parent's relation to the child (a list, so it is table-driven).
insert into lookups (domain, slug, name_he, sort_order) values
  ('guardian_relation', 'mother', 'אמא', 1),
  ('guardian_relation', 'father', 'אבא', 2),
  ('guardian_relation', 'guardian', 'אפוטרופוס', 3);

alter table guardianships add column relation_id uuid references lookups (id);

-- The parent sets their own relation; the child's staff may set any parent's.
create function set_guardian_relation(p_player uuid, p_parent uuid, p_relation uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_uid uuid := require_auth(); v_id uuid;
begin
  if not ((p_parent = v_uid and is_parent_of(p_player)) or can_manage_player(p_player)) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if p_relation is not null and not lookup_in_domain(p_relation, 'guardian_relation') then
    raise exception 'unknown relation' using errcode = '22023';
  end if;
  update guardianships set relation_id = p_relation
   where player_id = p_player and parent_id = p_parent and status = 'approved'
  returning id into v_id;
  if v_id is null then raise exception 'no such parent' using errcode = 'P0002'; end if;
end $$;

-- Approved parents of a player with their relation, for anyone who may see the player's parents
-- (the guardianships policy shows a parent only their own row).
create function player_guardians(p_player uuid)
returns table (parent_id uuid, full_name text, avatar_path text, relation_id uuid)
language sql stable security definer set search_path = public as $$
  select g.parent_id, coalesce(nullif(pr.full_name, ''), pr.email, ''), pr.avatar_path, g.relation_id
    from guardianships g join profiles pr on pr.id = g.parent_id
   where g.player_id = p_player and g.status = 'approved'
     and (can_manage_player(p_player) or is_parent_of(p_player) or is_self_player(p_player))
   order by 2
$$;

-- ---- Staff types.
insert into lookups (domain, slug, name_he, sort_order) values
  ('staff_role', 'head_coach', 'מאמן ראשי', 1),
  ('staff_role', 'assistant_coach', 'עוזר מאמן', 2),
  ('staff_role', 'fitness_coach', 'מנהל כושר', 3),
  ('staff_role', 'secretary', 'מזכירה', 4),
  ('staff_role', 'medic', 'חובש', 5);

alter table memberships add column staff_role_id uuid references lookups (id);

-- The club admin sets anyone's type; a coach sets the types of their own team's staff.
create function set_staff_role(p_membership uuid, p_role uuid) returns void
language plpgsql security definer set search_path = public as $$
declare m memberships;
begin
  perform require_auth();
  select * into m from memberships where id = p_membership;
  if not found then raise exception 'not found' using errcode = 'P0002'; end if;
  if not (is_club_admin(m.club_id) or (m.team_id is not null and is_team_coach(m.team_id))) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if p_role is not null and not lookup_in_domain(p_role, 'staff_role') then
    raise exception 'unknown staff type' using errcode = '22023';
  end if;
  update memberships set staff_role_id = p_role where id = p_membership;
end $$;

-- The team's staff with their types, for everyone on the team (parents and players included).
create function team_staff(p_team uuid)
returns table (membership_id uuid, user_id uuid, full_name text, avatar_path text, staff_role_id uuid)
language sql stable security definer set search_path = public as $$
  select m.id, m.user_id, coalesce(nullif(pr.full_name, ''), pr.email, ''), pr.avatar_path, m.staff_role_id
    from memberships m join profiles pr on pr.id = m.user_id
    left join lookups l on l.id = m.staff_role_id
   where m.team_id = p_team and m.role = 'coach' and is_team_member(p_team)
   order by coalesce(l.sort_order, 99), 3
$$;

-- ---- League: the team's page on the football association site (shown in the team's "league" tab).
insert into attribute_defs (scope, key, label_he, data_type, config, visible_to, editable_by, sort_order) values
  ('team', 'league_url', 'קישור לדף הקבוצה באתר ההתאחדות (טבלת ליגה)', 'text', '{"placeholder": "https://www.football.org.il/team-details/?team_id=...&season_id=..."}',
   array['system_admin','club_admin','coach','parent','player'], array['system_admin','club_admin','coach'], 5);

revoke execute on function
  save_event_details(uuid, uuid, text, timestamptz, timestamptz, text, text, text, int, int),
  set_event_lineup(uuid, uuid[]), set_guardian_relation(uuid, uuid, uuid), player_guardians(uuid),
  set_staff_role(uuid, uuid), team_staff(uuid)
from public, anon;
grant execute on function
  save_event_details(uuid, uuid, text, timestamptz, timestamptz, text, text, text, int, int),
  set_event_lineup(uuid, uuid[]), set_guardian_relation(uuid, uuid, uuid), player_guardians(uuid),
  set_staff_role(uuid, uuid), team_staff(uuid)
to authenticated;
