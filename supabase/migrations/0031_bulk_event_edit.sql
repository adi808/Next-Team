-- Edit many recurring events at once: the chosen event and every later event of the same team, type and weekday
-- (Israel time). p_changes holds only the fields to change:
--   {"start": "18:00", "duration_min": 90, "location": "...", "notes": "...", "kit": "<uuid>" | null}
-- Past events are not touched. One notification goes to the staff, players and parents of the team.

create function update_events_bulk(p_event uuid, p_changes jsonb, p_notify boolean default true) returns int
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := require_auth();
  b events;
  v_dow int;
  v_start time;
  v_dur int;
  v_kit uuid;
  v_has_start boolean;
  v_has_dur boolean;
  v_has_kit boolean;
  v_n int;
  v_what text[] := '{}';
  v_users uuid[];
  v_days text[] := array['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];
begin
  select * into b from events where id = p_event;
  if not found then raise exception 'event not found' using errcode = 'P0002'; end if;
  if not can_manage_team(b.team_id) then raise exception 'not allowed' using errcode = '42501'; end if;
  if p_changes is null or jsonb_typeof(p_changes) <> 'object' or p_changes = '{}'::jsonb then
    raise exception 'nothing to change' using errcode = '22023';
  end if;

  v_has_start := p_changes ? 'start';
  v_has_dur := p_changes ? 'duration_min';
  v_has_kit := p_changes ? 'kit';
  if v_has_start then
    begin v_start := (p_changes ->> 'start')::time; exception when others then v_start := null; end;
    if v_start is null then raise exception 'invalid time' using errcode = '22023'; end if;
    v_what := v_what || 'השעה';
  end if;
  if v_has_dur then
    begin v_dur := (p_changes ->> 'duration_min')::int; exception when others then v_dur := null; end;
    if v_dur is null or v_dur < 0 or v_dur > 1440 then raise exception 'invalid duration' using errcode = '22023'; end if;
    v_what := v_what || 'משך האימון';
  end if;
  if v_has_kit then
    v_kit := nullif(p_changes ->> 'kit', '')::uuid;
    if v_kit is not null and not exists (select 1 from team_kits where id = v_kit and team_id = b.team_id and active) then
      raise exception 'unknown kit' using errcode = '22023';
    end if;
    v_what := v_what || 'התלבושת';
  end if;
  if p_changes ? 'location' then v_what := v_what || 'המיקום'; end if;
  if p_changes ? 'notes' then v_what := v_what || 'ההערות'; end if;

  v_dow := extract(dow from b.starts_at at time zone 'Asia/Jerusalem')::int;
  select count(*) into v_n from events e
   where e.team_id = b.team_id and e.type_id = b.type_id and e.starts_at >= b.starts_at
     and extract(dow from e.starts_at at time zone 'Asia/Jerusalem')::int = v_dow;
  if v_n > 200 then raise exception 'too many events (at most 200 at once)' using errcode = '22023'; end if;

  update events e set
    starts_at = case when v_has_start then t.ns else e.starts_at end,
    ends_at = case
      when v_has_dur then (case when v_has_start then t.ns else e.starts_at end) + make_interval(mins => v_dur)
      when v_has_start and e.ends_at is not null then t.ns + (e.ends_at - e.starts_at)
      else e.ends_at end,
    location = case when p_changes ? 'location' then coalesce(btrim(p_changes ->> 'location'), '') else e.location end,
    notes = case when p_changes ? 'notes' then coalesce(p_changes ->> 'notes', '') else e.notes end,
    kit_id = case when v_has_kit then v_kit else e.kit_id end
  from (
    select x.id, ((date_trunc('day', x.starts_at at time zone 'Asia/Jerusalem') + coalesce(v_start, '00:00'::time))
                  at time zone 'Asia/Jerusalem') as ns
    from events x
    where x.team_id = b.team_id and x.type_id = b.type_id and x.starts_at >= b.starts_at
      and extract(dow from x.starts_at at time zone 'Asia/Jerusalem')::int = v_dow
  ) t
  where e.id = t.id;

  if coalesce(p_notify, false) and v_n > 0 then
    select coalesce(array_agg(distinct s.u), '{}') into v_users from (
      select m.user_id as u from memberships m where m.team_id = b.team_id
      union
      select p.user_id from team_players tp join players p on p.id = tp.player_id
       where tp.team_id = b.team_id and p.user_id is not null
      union
      select g.parent_id from team_players tp join guardianships g on g.player_id = tp.player_id and g.status = 'approved'
       where tp.team_id = b.team_id
    ) s where s.u is not null and s.u <> v_uid;
    perform notify(v_users, 'עדכון ב' || coalesce((select name_he from lookups where id = b.type_id), 'אירועים'),
      'בקבוצה ' || (select name from teams where id = b.team_id) || ' עודכנו ' || array_to_string(v_what, ', ')
        || ' בכל האירועים בימי ' || v_days[v_dow + 1] || ' מ־' || to_char(b.starts_at at time zone 'Asia/Jerusalem', 'DD.MM'),
      '/', false);
  end if;
  return v_n;
end $$;

revoke execute on function update_events_bulk(uuid, jsonb, boolean) from public, anon;
grant execute on function update_events_bulk(uuid, jsonb, boolean) to authenticated;
