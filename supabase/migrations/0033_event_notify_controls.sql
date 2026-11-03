-- Who decides which events earn a reminder and an email: the event type (Lists screen, meta of event_type:
-- {"remind": true|false, "email": true|false}) and, for one event, a switch the staff set on it.
-- A training is routine (reminder by push only); a match or a team building also goes by email to whoever
-- has no push. A cancellation is always sent by email to people without push, whatever the settings.

update lookups set meta = meta || '{"remind": true, "email": false}'::jsonb where domain = 'event_type' and slug = 'training';
update lookups set meta = meta || '{"remind": true, "email": true}'::jsonb where domain = 'event_type' and slug in ('match', 'team_building');

-- null = as the event type says; true / false = this event only.
alter table events add column send_email boolean;

create function event_wants_email(p_event uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(e.send_email, (l.meta ->> 'email')::boolean, false)
  from events e left join lookups l on l.id = e.type_id where e.id = p_event
$$;

create function event_wants_reminder(p_event uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((l.meta ->> 'remind')::boolean, true)
  from events e left join lookups l on l.id = e.type_id where e.id = p_event
$$;

-- Staff: this event's email switch (null = back to the event type's setting).
create function set_event_email(p_event uuid, p_send boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform require_auth();
  if not can_manage_team(event_team(p_event)) then raise exception 'not allowed' using errcode = '42501'; end if;
  update events set send_email = p_send where id = p_event;
end $$;

-- notify_fallback / notify_team_event gain p_email: false keeps everything in-app and push.
drop function notify_team_event(uuid, text, text, uuid);
drop function notify_fallback(uuid[], text, text, text);

create function notify_fallback(p_users uuid[], p_title text, p_body text, p_url text, p_email boolean default true)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if not coalesce(p_email, true) then
    perform notify(p_users, p_title, p_body, p_url, false);
    return;
  end if;
  perform notify(array(select u from unnest(p_users) u where exists (select 1 from push_subscriptions s where s.user_id = u)),
                 p_title, p_body, p_url, false);
  perform notify(array(select u from unnest(p_users) u where not exists (select 1 from push_subscriptions s where s.user_id = u)),
                 p_title, p_body, p_url, true);
end $$;

create function notify_team_event(p_event uuid, p_title text, p_body text, p_exclude uuid default null,
  p_email boolean default true) returns void
language plpgsql security definer set search_path = public as $$
declare v_team uuid := event_team(p_event); v_staff uuid[]; v_parents uuid[]; v_players uuid[];
begin
  select coalesce(array_agg(distinct m.user_id), '{}') into v_staff
    from memberships m where m.team_id = v_team and m.user_id is distinct from p_exclude;
  select coalesce(array_agg(distinct g.parent_id), '{}') into v_parents
    from team_players tp join guardianships g on g.player_id = tp.player_id and g.status = 'approved'
   where tp.team_id = v_team and g.parent_id is distinct from p_exclude and g.parent_id <> all (v_staff);
  select coalesce(array_agg(distinct p.user_id), '{}') into v_players
    from team_players tp join players p on p.id = tp.player_id
   where tp.team_id = v_team and p.user_id is not null and p.user_id is distinct from p_exclude
     and p.user_id <> all (v_staff) and p.user_id <> all (v_parents);
  perform notify_fallback(v_staff, p_title, p_body, '/m/coach/event/' || p_event, p_email);
  perform notify_fallback(v_parents, p_title, p_body, '/m/parent/event/' || p_event, p_email);
  perform notify_fallback(v_players, p_title, p_body, '/m/player/event/' || p_event, p_email);
end $$;

-- A change of time or place: by email only when the event (or its type) asks for email.
create or replace function event_changed(p_event uuid, p_old_start timestamptz, p_old_location text, p_by uuid) returns void
language plpgsql security definer set search_path = public as $$
declare e events; v_what text[] := '{}';
begin
  select * into e from events where id = p_event;
  if not found or e.cancelled_at is not null or greatest(e.starts_at, p_old_start) <= now() then return; end if;
  if e.starts_at is distinct from p_old_start then
    v_what := v_what || ('השעה: ' || to_char(p_old_start at time zone 'Asia/Jerusalem', 'DD.MM HH24:MI') || ' ← '
                          || to_char(e.starts_at at time zone 'Asia/Jerusalem', 'DD.MM HH24:MI'));
    update events set reminder_sent_at = null where id = p_event;
  end if;
  if coalesce(e.location, '') is distinct from coalesce(p_old_location, '') then
    v_what := v_what || ('המקום: ' || coalesce(nullif(e.location, ''), 'לא צוין'));
  end if;
  if cardinality(v_what) = 0 then return; end if;
  perform notify_team_event(p_event, '🔄 שינוי: ' || event_label(p_event), array_to_string(v_what, ' · '), p_by,
                            event_wants_email(p_event));
end $$;

-- Reminders: only for event types that want one; by email only when the event asks for email.
create or replace function send_event_reminders() returns int
language plpgsql security definer set search_path = public as $$
declare e record; r record; v_n int := 0; v_missing int; v_label text; v_staff uuid[]; v_email boolean;
begin
  for e in
    select ev.id, ev.team_id, ev.starts_at, coalesce((team_param(ev.team_id, 'reminder_hours'))::numeric, 24) as h
    from events ev
    where ev.cancelled_at is null and ev.reminder_sent_at is null and ev.starts_at > now()
      and ev.starts_at <= now() + interval '7 days'
    for update skip locked
  loop
    continue when e.h <= 0 or e.starts_at - make_interval(secs => (e.h * 3600)::double precision) > now();
    if not event_wants_reminder(e.id) then
      update events set reminder_sent_at = now() where id = e.id;
      continue;
    end if;
    v_label := event_label(e.id);
    v_email := event_wants_email(e.id);

    for r in
      select g.parent_id as u, string_agg(split_part(p.full_name, ' ', 1), ', ' order by p.full_name) as kids
      from team_players tp
      join players p on p.id = tp.player_id
      join guardianships g on g.player_id = tp.player_id and g.status = 'approved'
      where tp.team_id = e.team_id
        and not exists (select 1 from event_responses x where x.event_id = e.id and x.player_id = tp.player_id)
      group by g.parent_id
    loop
      perform notify_fallback(array[r.u], '⏰ אישור הגעה: ' || v_label,
        'עוד לא עניתם אם ' || r.kids || ' מגיעים. לחצו כדי לענות.', '/m/parent/event/' || e.id, v_email);
    end loop;

    perform notify_fallback(array(
        select p.user_id from team_players tp join players p on p.id = tp.player_id
        where tp.team_id = e.team_id and p.user_id is not null
          and coalesce((team_param(e.team_id, 'players_can_respond'))::boolean, false)
          and player_age(p.id) >= coalesce((team_param(e.team_id, 'min_response_age'))::int, 0)
          and not exists (select 1 from event_responses x where x.event_id = e.id and x.player_id = tp.player_id)),
      '⏰ אישור הגעה: ' || v_label, 'עוד לא ענית אם אתה מגיע. לחץ כדי לענות.', '/m/player/event/' || e.id, v_email);

    select count(*) into v_missing from team_players tp
     where tp.team_id = e.team_id
       and not exists (select 1 from event_responses x where x.event_id = e.id and x.player_id = tp.player_id);
    if v_missing > 0 then
      select coalesce(array_agg(distinct m.user_id), '{}') into v_staff from memberships m where m.team_id = e.team_id;
      perform notify(v_staff, '⏰ ' || v_label,
        case when v_missing = 1 then 'חסרה תשובה אחת. שלחנו תזכורת להורים.'
             else 'חסרות ' || v_missing || ' תשובות. שלחנו תזכורת להורים.' end,
        '/m/coach/event/' || e.id, false);
    end if;

    update events set reminder_sent_at = now() where id = e.id;
    v_n := v_n + 1;
  end loop;
  return v_n;
end $$;

-- update_events_bulk (0031/0032): the notice follows the event type's email setting.
create or replace function update_events_bulk(p_event uuid, p_changes jsonb, p_notify boolean default true) returns int
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
    kit_id = case when v_has_kit then v_kit else e.kit_id end,
    reminder_sent_at = case when v_has_start and t.ns is distinct from e.starts_at then null else e.reminder_sent_at end
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
    perform notify_fallback(v_users, 'עדכון ב' || coalesce((select name_he from lookups where id = b.type_id), 'אירועים'),
      'בקבוצה ' || (select name from teams where id = b.team_id) || ' עודכנו ' || array_to_string(v_what, ', ')
        || ' בכל האירועים בימי ' || v_days[v_dow + 1] || ' מ־' || to_char(b.starts_at at time zone 'Asia/Jerusalem', 'DD.MM'),
      '/', event_wants_email(b.id));
  end if;
  return v_n;
end $$;

revoke execute on function notify_fallback(uuid[], text, text, text, boolean),
  notify_team_event(uuid, text, text, uuid, boolean), event_wants_email(uuid), event_wants_reminder(uuid)
  from public, anon, authenticated;
revoke execute on function set_event_email(uuid, boolean) from public, anon;
grant execute on function set_event_email(uuid, boolean) to authenticated;
