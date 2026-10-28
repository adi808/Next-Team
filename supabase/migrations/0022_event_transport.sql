-- Transport (הסעה) on events. The coach or club admin turns it on for an event; then a parent sets how many
-- seats their child needs (the child plus anyone travelling with them, 0 for no ride), and staff set seats for
-- themselves. Staff can also set or correct any row. Players cannot set seats themselves.

alter table events add column has_transport boolean not null default false;

create table event_transport (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references events (id) on delete cascade,
  player_id uuid references players (id) on delete cascade,
  profile_id uuid references profiles (id) on delete cascade,
  seats int not null check (seats between 0 and 20),
  set_by uuid not null references profiles (id),
  updated_at timestamptz not null default now(),
  check ((player_id is null) <> (profile_id is null))
);
create unique index event_transport_player_uq on event_transport (event_id, player_id) where player_id is not null;
create unique index event_transport_staff_uq on event_transport (event_id, profile_id) where profile_id is not null;

-- Coach of the team or club admin of its club: the staff who may have a transport row.
create function is_team_staff(p_team uuid, p_profile uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from memberships m
                 where m.user_id = p_profile
                   and ((m.team_id = p_team and m.role = 'coach')
                     or (m.role = 'club_admin' and m.club_id = (select club_id from teams where id = p_team))))
$$;

alter table event_transport enable row level security;
create policy transport_select on event_transport for select using (is_team_member(event_team(event_id)));
grant select on event_transport to authenticated;

create function set_event_transport(p_event uuid, p_enabled boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform require_auth();
  if not can_manage_team(event_team(p_event)) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  update events set has_transport = coalesce(p_enabled, false) where id = p_event;
end $$;

create function set_transport_seats(p_event uuid, p_seats int, p_player uuid default null,
  p_profile uuid default null) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := require_auth();
  v_team uuid := event_team(p_event);
begin
  if v_team is null then raise exception 'event not found' using errcode = 'P0002'; end if;
  if not (select has_transport from events where id = p_event) then
    raise exception 'this event has no transport' using errcode = '22023';
  end if;
  if (p_player is null) = (p_profile is null) then
    raise exception 'give either a player or a staff member' using errcode = '22023';
  end if;
  if p_seats is null or p_seats < 0 or p_seats > 20 then
    raise exception 'seats must be between 0 and 20' using errcode = '22023';
  end if;

  if p_player is not null then
    if not exists (select 1 from team_players where team_id = v_team and player_id = p_player) then
      raise exception 'player is not on this team' using errcode = '22023';
    end if;
    if not (is_parent_of(p_player) or can_manage_team(v_team)) then
      raise exception 'only a parent or staff can set transport for a player' using errcode = '42501';
    end if;
    if p_seats > 0 and exists (select 1 from event_responses
                               where event_id = p_event and player_id = p_player and status = 'not_attending') then
      raise exception 'player is not attending this event' using errcode = '22023';
    end if;
    insert into event_transport (event_id, player_id, seats, set_by)
    values (p_event, p_player, p_seats, v_uid)
    on conflict (event_id, player_id) where player_id is not null do update
      set seats = excluded.seats, set_by = excluded.set_by, updated_at = now();
  else
    if not is_team_staff(v_team, p_profile) then
      raise exception 'not a staff member of this team' using errcode = '22023';
    end if;
    if not (p_profile = v_uid or can_manage_team(v_team)) then
      raise exception 'not allowed' using errcode = '42501';
    end if;
    insert into event_transport (event_id, profile_id, seats, set_by)
    values (p_event, p_profile, p_seats, v_uid)
    on conflict (event_id, profile_id) where profile_id is not null do update
      set seats = excluded.seats, set_by = excluded.set_by, updated_at = now();
  end if;
end $$;

-- Breakdown for the event: one row per player or staff member who answered, still on the team.
-- Players marked not attending are left out (their row is cleared anyway, see the trigger below).
-- staff_label is the staff type on the team membership (e.g. מנהל קבוצה, see 0020d/0021), if one is set.
create function event_transport_list(p_event uuid)
returns table (player_id uuid, profile_id uuid, name text, role text, staff_label text, seats int)
language sql stable security definer set search_path = public as $$
  select t.player_id, null::uuid, p.full_name, 'player', null::text, t.seats
  from event_transport t
  join events e on e.id = t.event_id
  join players p on p.id = t.player_id
  join team_players tp on tp.team_id = e.team_id and tp.player_id = t.player_id
  where t.event_id = p_event and is_team_member(e.team_id)
    and not exists (select 1 from event_responses r
                    where r.event_id = t.event_id and r.player_id = t.player_id and r.status = 'not_attending')
  union all
  select null::uuid, t.profile_id, coalesce(nullif(pr.full_name, ''), pr.email, ''),
         case when tm.id is not null then 'coach' else 'club_admin' end, l.name_he, t.seats
  from event_transport t
  join events e on e.id = t.event_id
  join profiles pr on pr.id = t.profile_id
  left join memberships tm on tm.user_id = t.profile_id and tm.team_id = e.team_id and tm.role = 'coach'
  left join lookups l on l.id = tm.staff_role_id
  where t.event_id = p_event and is_team_member(e.team_id) and is_team_staff(e.team_id, t.profile_id)
  order by 4 desc, 3
$$;

create function event_transport_total(p_event uuid) returns int
language sql stable security definer set search_path = public as $$
  select coalesce(sum(seats), 0)::int from event_transport_list(p_event)
$$;

-- A player who answers "not attending" no longer needs a seat.
create function clear_transport_on_absence() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'not_attending' then
    delete from event_transport where event_id = new.event_id and player_id = new.player_id;
  end if;
  return new;
end $$;
create trigger event_responses_clear_transport after insert or update of status on event_responses
  for each row execute function clear_transport_on_absence();

revoke execute on function is_team_staff(uuid, uuid), set_event_transport(uuid, boolean),
  set_transport_seats(uuid, int, uuid, uuid), event_transport_list(uuid), event_transport_total(uuid),
  clear_transport_on_absence() from public, anon;
grant execute on function set_event_transport(uuid, boolean), set_transport_seats(uuid, int, uuid, uuid),
  event_transport_list(uuid), event_transport_total(uuid) to authenticated;
-- Supabase also grants new functions to authenticated directly; these are internal.
revoke execute on function is_team_staff(uuid, uuid), clear_transport_on_absence() from authenticated;
