-- Next Team: events (type from catalog), attendance answers, match statistics.

create table events (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references teams (id) on delete cascade,
  type_id uuid not null references lookups (id),
  title text not null default '',
  starts_at timestamptz not null,
  ends_at timestamptz,
  location text not null default '',
  notes text not null default '',
  opponent text,
  our_score int check (our_score >= 0),
  their_score int check (their_score >= 0),
  created_by uuid references profiles (id),
  created_at timestamptz not null default now(),
  check (ends_at is null or ends_at >= starts_at)
);
create index events_team_idx on events (team_id, starts_at);

create table event_responses (
  event_id uuid not null references events (id) on delete cascade,
  player_id uuid not null references players (id) on delete cascade,
  status text not null check (status in ('attending', 'not_attending')),
  reason_id uuid references lookups (id),
  note text not null default '',
  responded_by uuid not null references profiles (id),
  responded_at timestamptz not null default now(),
  primary key (event_id, player_id),
  check (status = 'attending' or reason_id is not null)
);

create table event_stats (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references events (id) on delete cascade,
  player_id uuid not null references players (id) on delete cascade,
  stat_type_id uuid not null references lookups (id),
  minute int check (minute between 0 and 200),
  note text not null default '',
  recorded_by uuid references profiles (id),
  created_at timestamptz not null default now()
);
create index event_stats_event_idx on event_stats (event_id);
create index event_stats_player_idx on event_stats (player_id);

create function event_team(p_event uuid) returns uuid
language sql stable security definer set search_path = public as $$
  select team_id from events where id = p_event
$$;

create function lookup_in_domain(p_id uuid, p_domain text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from lookups where id = p_id and domain = p_domain)
$$;

create function event_is_match(p_event uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select (l.meta ->> 'is_match')::boolean
                   from events e join lookups l on l.id = e.type_id where e.id = p_event), false)
$$;

alter table events enable row level security;
alter table event_responses enable row level security;
alter table event_stats enable row level security;

create policy events_select on events for select using (is_team_member(team_id));
-- Staff and the player's own family see the answer (with reason and note); others do not.
create policy responses_select on event_responses for select using (
  can_manage_team(event_team(event_id)) or is_parent_of(player_id) or is_self_player(player_id));
create policy stats_select on event_stats for select using (is_team_member(event_team(event_id)));

create function create_event(p_team uuid, p_type uuid, p_title text, p_starts timestamptz,
  p_ends timestamptz default null, p_location text default '', p_notes text default '',
  p_opponent text default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_uid uuid := require_auth(); v_id uuid;
begin
  if not can_manage_team(p_team) then
    raise exception 'only the coach or club admin can create events' using errcode = '42501';
  end if;
  if not lookup_in_domain(p_type, 'event_type') then
    raise exception 'unknown event type' using errcode = '22023';
  end if;
  insert into events (team_id, type_id, title, starts_at, ends_at, location, notes, opponent, created_by)
  values (p_team, p_type, coalesce(p_title, ''), p_starts, p_ends, coalesce(p_location, ''),
          coalesce(p_notes, ''), p_opponent, v_uid)
  returning id into v_id;
  return v_id;
end $$;

create function update_event(p_event uuid, p_title text default null, p_starts timestamptz default null,
  p_ends timestamptz default null, p_location text default null, p_notes text default null,
  p_opponent text default null, p_our_score int default null, p_their_score int default null)
returns void
language plpgsql security definer set search_path = public as $$
begin
  perform require_auth();
  if not can_manage_team(event_team(p_event)) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  update events set
    title = coalesce(p_title, title), starts_at = coalesce(p_starts, starts_at),
    ends_at = coalesce(p_ends, ends_at), location = coalesce(p_location, location),
    notes = coalesce(p_notes, notes), opponent = coalesce(p_opponent, opponent),
    our_score = coalesce(p_our_score, our_score), their_score = coalesce(p_their_score, their_score)
  where id = p_event;
end $$;

create function delete_event(p_event uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform require_auth();
  if not can_manage_team(event_team(p_event)) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  delete from events where id = p_event;
end $$;

-- Attendance. A parent may always answer for their child; the child may answer only when the team
-- allows it and the child is at least the team's minimum age (team parameters, see 0008).
-- The last answer wins and can be changed at any time.
create function respond_event(p_event uuid, p_player uuid, p_status text,
  p_reason uuid default null, p_note text default null) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := require_auth();
  v_team uuid := event_team(p_event);
  v_allowed boolean := false;
begin
  if v_team is null then raise exception 'event not found' using errcode = 'P0002'; end if;
  if not exists (select 1 from team_players where team_id = v_team and player_id = p_player) then
    raise exception 'player is not on this team' using errcode = '22023';
  end if;
  if is_parent_of(p_player) then
    v_allowed := true;
  elsif is_self_player(p_player) then
    v_allowed := coalesce((team_param(v_team, 'players_can_respond'))::boolean, false)
             and player_age(p_player) >= coalesce((team_param(v_team, 'min_response_age'))::int, 0);
  end if;
  if not v_allowed then
    raise exception 'not allowed to answer for this player' using errcode = '42501';
  end if;
  if p_status = 'not_attending' and (p_reason is null or not lookup_in_domain(p_reason, 'absence_reason')) then
    raise exception 'a reason is required when not attending' using errcode = '22023';
  end if;
  insert into event_responses (event_id, player_id, status, reason_id, note, responded_by)
  values (p_event, p_player, p_status,
          case when p_status = 'attending' then null else p_reason end,
          case when p_status = 'attending' then '' else coalesce(p_note, '') end, v_uid)
  on conflict (event_id, player_id) do update
    set status = excluded.status, reason_id = excluded.reason_id, note = excluded.note,
        responded_by = excluded.responded_by, responded_at = now();
end $$;

create function record_stat(p_event uuid, p_player uuid, p_stat_type uuid,
  p_minute int default null, p_note text default '') returns uuid
language plpgsql security definer set search_path = public as $$
declare v_uid uuid := require_auth(); v_team uuid := event_team(p_event); v_id uuid;
begin
  if v_team is null or not can_manage_team(v_team) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if not event_is_match(p_event) then
    raise exception 'statistics can only be recorded on a match' using errcode = '22023';
  end if;
  if not exists (select 1 from team_players where team_id = v_team and player_id = p_player) then
    raise exception 'player is not on this team' using errcode = '22023';
  end if;
  if not lookup_in_domain(p_stat_type, 'stat_type') then
    raise exception 'unknown statistic' using errcode = '22023';
  end if;
  insert into event_stats (event_id, player_id, stat_type_id, minute, note, recorded_by)
  values (p_event, p_player, p_stat_type, p_minute, coalesce(p_note, ''), v_uid) returning id into v_id;
  return v_id;
end $$;

create function delete_stat(p_stat uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_event uuid;
begin
  perform require_auth();
  select event_id into v_event from event_stats where id = p_stat;
  if v_event is null or not can_manage_team(event_team(v_event)) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  delete from event_stats where id = p_stat;
end $$;
