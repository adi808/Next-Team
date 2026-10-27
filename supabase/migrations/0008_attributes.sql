-- Next Team: generic, dynamic attributes with history and per-role visibility.
--
-- One mechanism serves: player ratings (scale 1-10), medical info, team settings (minimum age to
-- answer, default match format...), event settings (match format and formation) and anything added later.
--   attribute_defs   what can be recorded: scope (player/team/event), type, config, who sees it,
--                    who may edit it, and optional owner (club / team) and sport.
--   attribute_values append-only: every save adds a row, so the history of a value is kept.
-- Types: text, number, scale, boolean, date, select (config.options), lookup (config.domain).

create table attribute_defs (
  id uuid primary key default gen_random_uuid(),
  scope text not null check (scope in ('player', 'team', 'event')),
  key text not null check (key ~ '^[a-z0-9_]+$'),
  label_he text not null,
  data_type text not null check (data_type in ('text', 'number', 'scale', 'boolean', 'date', 'select', 'lookup')),
  config jsonb not null default '{}',
  visible_to text[] not null,
  editable_by text[] not null,
  club_id uuid references clubs (id) on delete cascade,
  team_id uuid references teams (id) on delete cascade,
  sport_id uuid references sports (id) on delete cascade,
  sort_order int not null default 0,
  active boolean not null default true,
  created_by uuid references profiles (id),
  created_at timestamptz not null default now(),
  check (visible_to <@ array['system_admin', 'club_admin', 'coach', 'parent', 'player']),
  check (editable_by <@ array['system_admin', 'club_admin', 'coach', 'parent', 'player'])
);
create unique index attribute_defs_key_idx on attribute_defs (
  scope, key,
  coalesce(club_id, '00000000-0000-0000-0000-000000000000'),
  coalesce(team_id, '00000000-0000-0000-0000-000000000000'));

create table attribute_values (
  id uuid primary key default gen_random_uuid(),
  seq bigint generated always as identity,
  def_id uuid not null references attribute_defs (id) on delete cascade,
  entity_id uuid not null,
  value jsonb not null,
  recorded_by uuid references profiles (id),
  recorded_at timestamptz not null default now()
);
create index attribute_values_entity_idx on attribute_values (entity_id, def_id, seq desc);

create function cleanup_attribute_values() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  delete from attribute_values where entity_id = old.id;
  return old;
end $$;
create trigger players_cleanup_attrs after delete on players for each row execute function cleanup_attribute_values();
create trigger teams_cleanup_attrs after delete on teams for each row execute function cleanup_attribute_values();
create trigger events_cleanup_attrs after delete on events for each row execute function cleanup_attribute_values();

-- ---------------------------------------------------------------- entity helpers

create function entity_club(p_scope text, p_id uuid) returns uuid
language plpgsql stable security definer set search_path = public as $$
begin
  return case p_scope
    when 'player' then (select club_id from players where id = p_id)
    when 'team' then (select club_id from teams where id = p_id)
    when 'event' then (select t.club_id from events e join teams t on t.id = e.team_id where e.id = p_id)
  end;
end $$;

create function entity_teams(p_scope text, p_id uuid) returns uuid[]
language plpgsql stable security definer set search_path = public as $$
begin
  return coalesce(case p_scope
    when 'player' then (select array_agg(team_id) from team_players where player_id = p_id)
    when 'team' then array[p_id]
    when 'event' then (select array[team_id] from events where id = p_id)
  end, '{}');
end $$;

-- the roles the caller holds in relation to this entity
create function entity_roles(p_scope text, p_id uuid) returns text[]
language plpgsql stable security definer set search_path = public as $$
declare r text[] := '{}'; v_club uuid := entity_club(p_scope, p_id); v_team uuid;
begin
  if is_system_admin() then r := array_append(r, 'system_admin'); end if;
  if v_club is not null and is_club_admin_strict(v_club) then r := array_append(r, 'club_admin'); end if;
  if p_scope = 'player' then
    if coaches_player(p_id) then r := array_append(r, 'coach'); end if;
    if is_parent_of(p_id) then r := array_append(r, 'parent'); end if;
    if is_self_player(p_id) then r := array_append(r, 'player'); end if;
  else
    foreach v_team in array entity_teams(p_scope, p_id) loop
      if is_team_coach(v_team) and not ('coach' = any (r)) then r := array_append(r, 'coach'); end if;
      if is_team_parent(v_team) and not ('parent' = any (r)) then r := array_append(r, 'parent'); end if;
      if is_team_player(v_team) and not ('player' = any (r)) then r := array_append(r, 'player'); end if;
    end loop;
  end if;
  return r;
end $$;

create function attr_can_read(p_def uuid, p_entity uuid) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare d attribute_defs;
begin
  select * into d from attribute_defs where id = p_def;
  return found and entity_roles(d.scope, p_entity) && d.visible_to;
end $$;

create function attr_can_write(p_def uuid, p_entity uuid) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare d attribute_defs;
begin
  select * into d from attribute_defs where id = p_def;
  return found and entity_roles(d.scope, p_entity) && d.editable_by;
end $$;

-- is this definition meant for this entity (club / team / sport scoping)?
create function attr_applies(p_def uuid, p_entity uuid) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare d attribute_defs; v_club uuid; v_teams uuid[];
begin
  select * into d from attribute_defs where id = p_def;
  if not found then return false; end if;
  v_club := entity_club(d.scope, p_entity);
  v_teams := entity_teams(d.scope, p_entity);
  return v_club is not null
     and (d.club_id is null or d.club_id = v_club)
     and (d.team_id is null or d.team_id = any (v_teams))
     and (d.sport_id is null or exists (select 1 from teams t where t.id = any (v_teams) and t.sport_id = d.sport_id));
end $$;

create function validate_attr_value(d attribute_defs, v jsonb) returns void
language plpgsql stable security definer set search_path = public as $$
declare n numeric;
begin
  if v = 'null'::jsonb then return; end if;                 -- clears the value
  case d.data_type
    when 'text' then
      if jsonb_typeof(v) <> 'string' then raise exception 'text expected' using errcode = '22023'; end if;
    when 'boolean' then
      if jsonb_typeof(v) <> 'boolean' then raise exception 'boolean expected' using errcode = '22023'; end if;
    when 'date' then
      if jsonb_typeof(v) <> 'string' then raise exception 'date expected' using errcode = '22023'; end if;
      perform (v #>> '{}')::date;
    when 'number', 'scale' then
      if jsonb_typeof(v) <> 'number' then raise exception 'number expected' using errcode = '22023'; end if;
      n := (v #>> '{}')::numeric;
      if d.data_type = 'scale' then
        if n <> trunc(n) then raise exception 'whole number expected' using errcode = '22023'; end if;
        if n < coalesce((d.config ->> 'min')::numeric, 1) or n > coalesce((d.config ->> 'max')::numeric, 10) then
          raise exception 'value out of range' using errcode = '22003';
        end if;
      else
        if d.config ? 'min' and n < (d.config ->> 'min')::numeric then raise exception 'value out of range' using errcode = '22003'; end if;
        if d.config ? 'max' and n > (d.config ->> 'max')::numeric then raise exception 'value out of range' using errcode = '22003'; end if;
      end if;
    when 'select' then
      if jsonb_typeof(v) <> 'string' or not (d.config -> 'options') ? (v #>> '{}') then
        raise exception 'value is not one of the options' using errcode = '22023';
      end if;
    when 'lookup' then
      if jsonb_typeof(v) <> 'string' or not lookup_in_domain((v #>> '{}')::uuid, d.config ->> 'domain') then
        raise exception 'value is not in the list' using errcode = '22023';
      end if;
  end case;
end $$;

-- ---------------------------------------------------------------- RLS

alter table attribute_defs enable row level security;
alter table attribute_values enable row level security;

create policy attribute_defs_select on attribute_defs for select using (
  (club_id is null or is_club_member(club_id))
  and (team_id is null or is_team_member(team_id)));
create policy attribute_values_select on attribute_values for select using (attr_can_read(def_id, entity_id));

-- latest value per (definition, entity); RLS of attribute_values applies to the caller
create view attribute_current with (security_invoker = true) as
  select distinct on (def_id, entity_id) id, def_id, entity_id, value, recorded_by, recorded_at
  from attribute_values order by def_id, entity_id, seq desc;
grant select on attribute_current to authenticated;

-- ---------------------------------------------------------------- RPCs

create function can_manage_def(p_club uuid, p_team uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select is_system_admin()
      or (p_club is not null and is_club_admin_strict(p_club))
      or (p_team is not null and is_team_coach(p_team))
$$;

create function create_attribute_def(
  p_scope text, p_key text, p_label text, p_type text, p_config jsonb,
  p_visible_to text[], p_editable_by text[],
  p_club uuid default null, p_team uuid default null, p_sport uuid default null,
  p_sort int default 0) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_uid uuid := require_auth(); v_club uuid := p_club; v_id uuid;
begin
  if p_team is not null then
    v_club := (select club_id from teams where id = p_team);
    if v_club is null then raise exception 'team not found' using errcode = 'P0002'; end if;
    if p_club is not null and p_club <> v_club then
      raise exception 'team does not belong to club' using errcode = '22023';
    end if;
  end if;
  if not can_manage_def(v_club, p_team) then
    raise exception 'not allowed to define parameters here' using errcode = '42501';
  end if;
  insert into attribute_defs (scope, key, label_he, data_type, config, visible_to, editable_by,
                              club_id, team_id, sport_id, sort_order, created_by)
  values (p_scope, p_key, p_label, p_type, coalesce(p_config, '{}'), p_visible_to, p_editable_by,
          v_club, p_team, p_sport, p_sort, v_uid)
  returning id into v_id;
  return v_id;
end $$;

create function update_attribute_def(p_def uuid, p_label text default null, p_config jsonb default null,
  p_visible_to text[] default null, p_editable_by text[] default null,
  p_active boolean default null, p_sort int default null) returns void
language plpgsql security definer set search_path = public as $$
declare d attribute_defs;
begin
  perform require_auth();
  select * into d from attribute_defs where id = p_def;
  if not found or not can_manage_def(d.club_id, d.team_id) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  update attribute_defs set
    label_he = coalesce(p_label, label_he), config = coalesce(p_config, config),
    visible_to = coalesce(p_visible_to, visible_to), editable_by = coalesce(p_editable_by, editable_by),
    active = coalesce(p_active, active), sort_order = coalesce(p_sort, sort_order)
  where id = p_def;
end $$;

-- Saves a new value (history is kept). Pass JSON null to clear.
create function set_attribute(p_def uuid, p_entity uuid, p_value jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_uid uuid := require_auth(); d attribute_defs; v_id uuid;
begin
  select * into d from attribute_defs where id = p_def;
  if not found or not d.active then raise exception 'unknown parameter' using errcode = 'P0002'; end if;
  if not attr_applies(p_def, p_entity) then
    raise exception 'this parameter does not apply to this record' using errcode = '22023';
  end if;
  if not attr_can_write(p_def, p_entity) then
    raise exception 'not allowed to edit this parameter' using errcode = '42501';
  end if;
  perform validate_attr_value(d, p_value);
  insert into attribute_values (def_id, entity_id, value, recorded_by)
  values (p_def, p_entity, p_value, v_uid) returning id into v_id;
  return v_id;
end $$;

-- effective team setting: latest value, else the definition's default
create function team_param(p_team uuid, p_key text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v jsonb; d attribute_defs;
begin
  if not is_team_member(p_team) then return null; end if;
  select * into d from attribute_defs
   where scope = 'team' and key = p_key and active
     and (team_id is null or team_id = p_team)
   order by (team_id is not null) desc, (club_id is not null) desc limit 1;
  if not found then return null; end if;
  select av.value into v from attribute_values av
   where av.def_id = d.id and av.entity_id = p_team order by av.seq desc limit 1;
  if v is null or v = 'null'::jsonb then v := d.config -> 'default'; end if;
  return v;
end $$;

-- ---------------------------------------------------------------- seeds (global definitions)
insert into attribute_defs (scope, key, label_he, data_type, config, visible_to, editable_by, sort_order) values
  -- medical: parent, coach, club admin and system admin see it; parent and coach edit it
  ('player', 'medical_allergy', 'אלרגיה', 'text', '{}',
     array['system_admin','club_admin','coach','parent'], array['coach','parent'], 10),
  ('player', 'medical_condition', 'בעיה רפואית', 'text', '{}',
     array['system_admin','club_admin','coach','parent'], array['coach','parent'], 11),
  -- team settings
  ('team', 'min_response_age', 'גיל מינימלי שבו שחקן עונה בעצמו', 'number', '{"min": 0, "max": 21, "default": 12}',
     array['system_admin','club_admin','coach','parent','player'], array['system_admin','club_admin','coach'], 1),
  ('team', 'players_can_respond', 'פרופיל שחקן רשאי לאשר הגעה', 'boolean', '{"default": false}',
     array['system_admin','club_admin','coach','parent','player'], array['system_admin','club_admin','coach'], 2),
  ('team', 'default_match_format', 'מספר שחקנים במגרש (ברירת מחדל)', 'lookup', '{"domain": "match_format"}',
     array['system_admin','club_admin','coach','parent','player'], array['system_admin','club_admin','coach'], 3),
  ('team', 'default_formation', 'מערך (ברירת מחדל)', 'lookup', '{"domain": "formation", "depends_on": "default_match_format"}',
     array['system_admin','club_admin','coach','parent','player'], array['system_admin','club_admin','coach'], 4),
  -- event settings: formation belongs to the event, defaulting from the team
  ('event', 'match_format', 'מספר שחקנים במגרש', 'lookup', '{"domain": "match_format", "default_from_team": "default_match_format"}',
     array['system_admin','club_admin','coach','parent','player'], array['system_admin','club_admin','coach'], 1),
  ('event', 'formation', 'מערך', 'lookup', '{"domain": "formation", "depends_on": "match_format", "default_from_team": "default_formation"}',
     array['system_admin','club_admin','coach','parent','player'], array['system_admin','club_admin','coach'], 2);
