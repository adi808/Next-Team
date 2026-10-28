-- Next Team: team kits (any number of colour sets per team), a kit per event, and recurring events.

-- A kit is a named set of colours (shirt, shorts, socks), drawn as a kid wearing it.
-- Kits are archived (active = false), never removed, so past events keep their kit.
create table team_kits (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references teams (id) on delete cascade,
  name text not null check (length(btrim(name)) > 0),
  shirt text not null check (shirt ~ '^#[0-9a-fA-F]{6}$'),
  shorts text not null check (shorts ~ '^#[0-9a-fA-F]{6}$'),
  socks text not null check (socks ~ '^#[0-9a-fA-F]{6}$'),
  sort_order int not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create index team_kits_team_idx on team_kits (team_id);
alter table team_kits enable row level security;
create policy team_kits_select on team_kits for select using (is_team_member(team_id));
grant select on team_kits to authenticated;

alter table events add column kit_id uuid references team_kits (id);
-- Events created together by create_event_series share a series id.
alter table events add column series_id uuid;
create index events_series_idx on events (series_id);

-- Adds a kit (p_id null) or edits one; p_active = false archives it.
create function save_team_kit(p_id uuid, p_team uuid, p_name text, p_shirt text, p_shorts text, p_socks text,
  p_active boolean default true) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  perform require_auth();
  if not can_manage_team(p_team) then raise exception 'not allowed' using errcode = '42501'; end if;
  if p_id is null then
    insert into team_kits (team_id, name, shirt, shorts, socks, sort_order)
    values (p_team, btrim(p_name), p_shirt, p_shorts, p_socks,
            coalesce((select max(sort_order) + 1 from team_kits where team_id = p_team), 0))
    returning id into v_id;
  else
    update team_kits set name = btrim(p_name), shirt = p_shirt, shorts = p_shorts, socks = p_socks, active = p_active
     where id = p_id and team_id = p_team
    returning id into v_id;
    if v_id is null then raise exception 'kit not found' using errcode = 'P0002'; end if;
  end if;
  return v_id;
end $$;

create function set_event_kit(p_event uuid, p_kit uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_team uuid := event_team(p_event);
begin
  perform require_auth();
  if v_team is null or not can_manage_team(v_team) then raise exception 'not allowed' using errcode = '42501'; end if;
  if p_kit is not null and not exists (select 1 from team_kits where id = p_kit and team_id = v_team) then
    raise exception 'kit belongs to another team' using errcode = '22023';
  end if;
  update events set kit_id = p_kit where id = p_event;
end $$;

-- Creates one event on each chosen weekday (0 = Sunday ... 6 = Saturday) between two dates, at a local
-- (Israel) start time. Returns how many were created. Capped at 100 events and one year.
create function create_event_series(p_team uuid, p_type uuid, p_title text, p_days int[], p_start time,
  p_duration_min int, p_from date, p_until date, p_location text default '', p_notes text default '',
  p_kit uuid default null) returns int
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := require_auth();
  v_series uuid := gen_random_uuid();
  v_day date;
  v_starts timestamptz;
  v_count int := 0;
begin
  if not can_manage_team(p_team) then
    raise exception 'only the coach or club admin can create events' using errcode = '42501';
  end if;
  if not lookup_in_domain(p_type, 'event_type') then raise exception 'unknown event type' using errcode = '22023'; end if;
  if p_days is null or cardinality(p_days) = 0 or not (p_days <@ array[0, 1, 2, 3, 4, 5, 6]) then
    raise exception 'choose at least one weekday' using errcode = '22023';
  end if;
  if p_until < p_from or p_until > p_from + 366 then
    raise exception 'the end date must be after the start date and within a year' using errcode = '22023';
  end if;
  if p_duration_min is not null and (p_duration_min < 0 or p_duration_min > 24 * 60) then
    raise exception 'invalid duration' using errcode = '22023';
  end if;
  if p_kit is not null and not exists (select 1 from team_kits where id = p_kit and team_id = p_team) then
    raise exception 'kit belongs to another team' using errcode = '22023';
  end if;
  for v_day in select d::date from generate_series(p_from, p_until, interval '1 day') d loop
    continue when not (extract(dow from v_day)::int = any (p_days));
    v_count := v_count + 1;
    if v_count > 100 then raise exception 'too many events (at most 100 at once)' using errcode = '22023'; end if;
    v_starts := (v_day + p_start) at time zone 'Asia/Jerusalem';
    insert into events (team_id, type_id, title, starts_at, ends_at, location, notes, created_by, kit_id, series_id)
    values (p_team, p_type, coalesce(p_title, ''), v_starts,
            case when p_duration_min is null then null else v_starts + make_interval(mins => p_duration_min) end,
            coalesce(p_location, ''), coalesce(p_notes, ''), v_uid, p_kit, v_series);
  end loop;
  return v_count;
end $$;

revoke execute on function save_team_kit(uuid, uuid, text, text, text, text, boolean), set_event_kit(uuid, uuid),
  create_event_series(uuid, uuid, text, int[], time, int, date, date, text, text, uuid) from public, anon;
grant execute on function save_team_kit(uuid, uuid, text, text, text, text, boolean), set_event_kit(uuid, uuid),
  create_event_series(uuid, uuid, text, int[], time, int, date, date, text, text, uuid) to authenticated;
