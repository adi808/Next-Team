-- Next Team: the match clock. A stopwatch per player for the minutes played, with goals, assists and cards.
--   * match_periods: when the "match started" switch is on (pausing at half time starts a new period)
--   * play_intervals: when a player is on the pitch; minutes played = the overlap of both
--   * match_operators: parents the staff allow to run the clock for a team (until the staff take it back)
-- Every action carries the time it happened on the device (p_at), so a phone without reception keeps the
-- actions and sends them later; every action is idempotent, so sending one twice changes nothing.

-- ---- team settings
insert into attribute_defs (scope, key, label_he, data_type, config, visible_to, editable_by, sort_order) values
  ('team', 'min_play_minutes', 'מינימום דקות משחק לשחקן (0 = אין)', 'number', '{"min": 0, "max": 120, "default": 0}',
     array['system_admin','club_admin','coach','parent','player'], array['system_admin','club_admin','coach'], 7),
  ('team', 'match_minutes', 'אורך משחק בדקות', 'number', '{"min": 10, "max": 120, "default": 50}',
     array['system_admin','club_admin','coach','parent','player'], array['system_admin','club_admin','coach'], 8),
  ('team', 'min_minutes_alert', 'התראה על מינימום דקות, כמה דקות לפני הסוף', 'number', '{"min": 0, "max": 60, "default": 10}',
     array['system_admin','club_admin','coach'], array['system_admin','club_admin','coach'], 9);

-- ---- who runs the clock
create table match_operators (
  team_id uuid not null references teams (id) on delete cascade,
  parent_id uuid not null references profiles (id) on delete cascade,
  granted_by uuid references profiles (id),
  granted_at timestamptz not null default now(),
  primary key (team_id, parent_id)
);
alter table match_operators enable row level security;
create policy match_operators_select on match_operators for select using (can_manage_team(team_id) or parent_id = auth.uid());
grant select on match_operators to authenticated;

-- Staff, or a parent of a child on the team whom the staff allowed.
create function can_run_match(p_team uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select can_manage_team(p_team)
      or (is_team_parent(p_team) and exists (select 1 from match_operators where team_id = p_team and parent_id = auth.uid()))
$$;
grant execute on function can_run_match(uuid) to authenticated;

-- The team's parents with an account, their children on the team, and whether they run the clock (staff only).
create function team_match_operators(p_team uuid)
returns table (parent_id uuid, full_name text, children text, is_operator boolean)
language plpgsql stable security definer set search_path = public as $$
begin
  if not can_manage_team(p_team) then raise exception 'not allowed' using errcode = '42501'; end if;
  return query
    select pr.id, pr.full_name, string_agg(distinct pl.full_name, ', ' order by pl.full_name),
           exists (select 1 from match_operators mo where mo.team_id = p_team and mo.parent_id = pr.id)
      from team_players tp
      join players pl on pl.id = tp.player_id
      join guardianships g on g.player_id = tp.player_id and g.status = 'approved'
      join profiles pr on pr.id = g.parent_id
     where tp.team_id = p_team
     group by pr.id, pr.full_name
     order by pr.full_name;
end $$;
grant execute on function team_match_operators(uuid) to authenticated;

create function set_match_operator(p_team uuid, p_parent uuid, p_on boolean) returns void
language plpgsql security definer set search_path = public as $$
declare v_uid uuid := require_auth();
begin
  if not can_manage_team(p_team) then raise exception 'not allowed' using errcode = '42501'; end if;
  if p_on then
    if not exists (select 1 from team_players tp join guardianships g on g.player_id = tp.player_id
                   where tp.team_id = p_team and g.parent_id = p_parent and g.status = 'approved') then
      raise exception 'not a parent on this team' using errcode = '22023';
    end if;
    insert into match_operators (team_id, parent_id, granted_by) values (p_team, p_parent, v_uid) on conflict do nothing;
  else
    delete from match_operators where team_id = p_team and parent_id = p_parent;
  end if;
end $$;
grant execute on function set_match_operator(uuid, uuid, boolean) to authenticated;

-- ---- the clock
create table match_periods (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references events (id) on delete cascade,
  started_at timestamptz not null,
  ended_at timestamptz,
  check (ended_at is null or ended_at >= started_at)
);
create index match_periods_event_idx on match_periods (event_id);
create unique index match_periods_one_open on match_periods (event_id) where ended_at is null;

create table play_intervals (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references events (id) on delete cascade,
  player_id uuid not null references players (id) on delete cascade,
  started_at timestamptz not null,
  ended_at timestamptz,
  check (ended_at is null or ended_at >= started_at)
);
create index play_intervals_event_idx on play_intervals (event_id);
create index play_intervals_player_idx on play_intervals (player_id);
create unique index play_intervals_one_open on play_intervals (event_id, player_id) where ended_at is null;

alter table match_periods enable row level security;
alter table play_intervals enable row level security;
-- The clock itself is no secret; the minutes are: those who run the clock see everyone,
-- a parent sees their own child, a player sees themselves.
create policy match_periods_select on match_periods for select using (is_team_member(event_team(event_id)));
create policy play_intervals_select on play_intervals for select
  using (can_run_match(event_team(event_id)) or is_parent_of(player_id) or is_self_player(player_id));
grant select on match_periods, play_intervals to authenticated;

-- An action on the clock: allowed for whoever runs it, on a match, at a time that is not in the future
-- and not long before the match. Returns the team.
create function match_action_check(p_event uuid, p_at timestamptz) returns uuid
language plpgsql stable security definer set search_path = public as $$
declare v_team uuid := event_team(p_event); v_start timestamptz;
begin
  perform require_auth();
  if v_team is null or not can_run_match(v_team) then raise exception 'not allowed' using errcode = '42501'; end if;
  if not event_is_match(p_event) then raise exception 'the clock runs on a match only' using errcode = '22023'; end if;
  select starts_at into v_start from events where id = p_event;
  if p_at is null or p_at > now() + interval '5 minutes' or p_at < v_start - interval '3 hours' then
    raise exception 'the time of the action is outside the match' using errcode = '22023';
  end if;
  return v_team;
end $$;
revoke execute on function match_action_check(uuid, timestamptz) from public;

-- The "match started" switch: on opens a period, off (half time, end) closes it. Repeating is a no-op.
create function set_match_running(p_event uuid, p_on boolean, p_at timestamptz) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform match_action_check(p_event, p_at);
  if p_on then
    if not exists (select 1 from match_periods where event_id = p_event and ended_at is null) then
      insert into match_periods (event_id, started_at) values (p_event, p_at);
    end if;
  else
    update match_periods set ended_at = greatest(p_at, started_at) where event_id = p_event and ended_at is null;
  end if;
end $$;
grant execute on function set_match_running(uuid, boolean, timestamptz) to authenticated;

-- A player goes on (start) or off (stop). Repeating is a no-op.
create function set_player_on(p_event uuid, p_player uuid, p_on boolean, p_at timestamptz) returns void
language plpgsql security definer set search_path = public as $$
declare v_team uuid := match_action_check(p_event, p_at);
begin
  if not exists (select 1 from team_players where team_id = v_team and player_id = p_player) then
    raise exception 'player is not on this team' using errcode = '22023';
  end if;
  if p_on then
    if not exists (select 1 from play_intervals where event_id = p_event and player_id = p_player and ended_at is null) then
      insert into play_intervals (event_id, player_id, started_at) values (p_event, p_player, p_at);
    end if;
  else
    update play_intervals set ended_at = greatest(p_at, started_at)
     where event_id = p_event and player_id = p_player and ended_at is null;
  end if;
end $$;
grant execute on function set_player_on(uuid, uuid, boolean, timestamptz) to authenticated;

-- End of the match: the clock stops and every player goes off.
create function end_match(p_event uuid, p_at timestamptz) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform match_action_check(p_event, p_at);
  update match_periods set ended_at = greatest(p_at, started_at) where event_id = p_event and ended_at is null;
  update play_intervals set ended_at = greatest(p_at, started_at) where event_id = p_event and ended_at is null;
end $$;
grant execute on function end_match(uuid, timestamptz) to authenticated;

-- Match minute at an instant: the time the clock ran before it, rounded up (the first minute is 1).
create function match_minute_at(p_event uuid, p_at timestamptz) returns int
language sql stable security definer set search_path = public as $$
  select ceil(coalesce(sum(extract(epoch from (least(coalesce(ended_at, p_at), p_at) - started_at))), 0) / 60.0)::int
    from match_periods where event_id = p_event and started_at < p_at
$$;

-- Goals, assists and cards from the clock screen. p_client is the id the phone gave the action,
-- so the same action sent twice is recorded once.
alter table event_stats add column client_id uuid unique;

create function record_match_stat(p_event uuid, p_player uuid, p_stat_type uuid, p_at timestamptz, p_client uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_team uuid := match_action_check(p_event, p_at);
begin
  if not exists (select 1 from team_players where team_id = v_team and player_id = p_player) then
    raise exception 'player is not on this team' using errcode = '22023';
  end if;
  if not lookup_in_domain(p_stat_type, 'stat_type') then raise exception 'unknown statistic' using errcode = '22023'; end if;
  insert into event_stats (event_id, player_id, stat_type_id, minute, recorded_by, client_id)
  values (p_event, p_player, p_stat_type, least(200, greatest(0, match_minute_at(p_event, p_at))), auth.uid(), p_client)
  on conflict (client_id) do nothing;
end $$;
grant execute on function record_match_stat(uuid, uuid, uuid, timestamptz, uuid) to authenticated;

-- Removes one statistic of the match, by its id or by the phone's id for it. Already gone is a no-op.
create function delete_match_stat(p_event uuid, p_stat uuid default null, p_client uuid default null) returns void
language plpgsql security definer set search_path = public as $$
declare v_team uuid := event_team(p_event);
begin
  perform require_auth();
  if v_team is null or not can_run_match(v_team) then raise exception 'not allowed' using errcode = '42501'; end if;
  delete from event_stats where event_id = p_event and ((p_stat is not null and id = p_stat) or (p_client is not null and client_id = p_client));
end $$;
grant execute on function delete_match_stat(uuid, uuid, uuid) to authenticated;
