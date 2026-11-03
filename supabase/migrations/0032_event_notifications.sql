-- Event notifications: cancel / restore an event (it stays on the board, marked), a notice when a future
-- event's time or place changes, an automatic reminder to whoever has not answered, and email for people
-- who never turned on push.

alter table events add column cancelled_at timestamptz;
alter table events add column cancel_reason_id uuid references lookups (id);
alter table events add column cancel_note text not null default '';
alter table events add column reminder_sent_at timestamptz;

-- Cancel reasons: a list like any other (Lists screen), not hard-coded.
insert into lookups (domain, slug, name_he, sort_order, meta) values
  ('cancel_reason', 'weather', 'מזג אוויר', 1, '{}'),
  ('cancel_reason', 'field', 'המגרש לא זמין', 2, '{}'),
  ('cancel_reason', 'players', 'אין מספיק שחקנים', 3, '{}'),
  ('cancel_reason', 'coach', 'המאמן לא זמין', 4, '{}'),
  ('cancel_reason', 'other', 'אחר', 5, '{"note_required": true}')
on conflict do nothing;

-- Team setting: how many hours before an event the reminder goes out (0 = no reminder).
insert into attribute_defs (scope, key, label_he, data_type, config, visible_to, editable_by, sort_order) values
  ('team', 'reminder_hours', 'תזכורת אישור הגעה: כמה שעות לפני האירוע (0 = בלי תזכורת)', 'number',
   '{"min": 0, "max": 168, "default": 24}',
   array['system_admin','club_admin','coach'], array['system_admin','club_admin','coach'], 5)
on conflict do nothing;

-- Sends to users with push as in-app + push, and to users without any push subscription also by email.
create function notify_fallback(p_users uuid[], p_title text, p_body text, p_url text) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform notify(array(select u from unnest(p_users) u where exists (select 1 from push_subscriptions s where s.user_id = u)),
                 p_title, p_body, p_url, false);
  perform notify(array(select u from unnest(p_users) u where not exists (select 1 from push_subscriptions s where s.user_id = u)),
                 p_title, p_body, p_url, true);
end $$;

-- "אימון – בוגרים א׳, יום ג׳ 12.11 בשעה 18:00"
create function event_label(p_event uuid) returns text
language sql stable security definer set search_path = public as $$
  select coalesce(nullif(e.title, ''), l.name_he, 'אירוע') || ' – ' || t.name
         || coalesce(' נגד ' || nullif(e.opponent, ''), '') || ', '
         || to_char(e.starts_at at time zone 'Asia/Jerusalem', 'DD.MM') || ' בשעה '
         || to_char(e.starts_at at time zone 'Asia/Jerusalem', 'HH24:MI')
  from events e join teams t on t.id = e.team_id left join lookups l on l.id = e.type_id
  where e.id = p_event
$$;

-- Everyone on the event's team, each with a link into the mode they would open it in: staff (coach),
-- parents of the team's children, and players with an account. A user in two groups is told once.
create function notify_team_event(p_event uuid, p_title text, p_body text, p_exclude uuid default null) returns void
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
  perform notify_fallback(v_staff, p_title, p_body, '/m/coach/event/' || p_event);
  perform notify_fallback(v_parents, p_title, p_body, '/m/parent/event/' || p_event);
  perform notify_fallback(v_players, p_title, p_body, '/m/player/event/' || p_event);
end $$;

-- ---------------------------------------------------------------- cancel / restore
create function cancel_event(p_event uuid, p_reason uuid, p_note text default '') returns void
language plpgsql security definer set search_path = public as $$
declare v_uid uuid := require_auth(); e events; v_reason text;
begin
  select * into e from events where id = p_event;
  if not found then raise exception 'event not found' using errcode = 'P0002'; end if;
  if not can_manage_team(e.team_id) then raise exception 'not allowed' using errcode = '42501'; end if;
  if e.cancelled_at is not null then raise exception 'already cancelled' using errcode = '22023'; end if;
  if p_reason is null or not lookup_in_domain(p_reason, 'cancel_reason') then
    raise exception 'a cancel reason is required' using errcode = '22023';
  end if;
  update events set cancelled_at = now(), cancel_reason_id = p_reason, cancel_note = coalesce(btrim(p_note), '')
   where id = p_event;
  if e.starts_at > now() then
    select name_he into v_reason from lookups where id = p_reason;
    perform notify_team_event(p_event, '❌ בוטל: ' || event_label(p_event),
      'סיבה: ' || v_reason || coalesce(nullif(' – ' || btrim(p_note), ' – '), ''), v_uid);
  end if;
end $$;

create function restore_event(p_event uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_uid uuid := require_auth(); e events;
begin
  select * into e from events where id = p_event;
  if not found then raise exception 'event not found' using errcode = 'P0002'; end if;
  if not can_manage_team(e.team_id) then raise exception 'not allowed' using errcode = '42501'; end if;
  if e.cancelled_at is null then return; end if;
  update events set cancelled_at = null, cancel_reason_id = null, cancel_note = '', reminder_sent_at = null
   where id = p_event;
  if e.starts_at > now() then
    perform notify_team_event(p_event, '✅ מתקיים בכל זאת: ' || event_label(p_event), 'האירוע חזר ללוח. אשרו הגעה באפליקציה.', v_uid);
  end if;
end $$;

-- A changed time or place of a future, not cancelled event: tell the team, and let the reminder go out
-- again for the new time.
create function event_changed(p_event uuid, p_old_start timestamptz, p_old_location text, p_by uuid) returns void
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
  perform notify_team_event(p_event, '🔄 שינוי: ' || event_label(p_event), array_to_string(v_what, ' · '), p_by);
end $$;

create or replace function update_event(p_event uuid, p_title text default null, p_starts timestamptz default null,
  p_ends timestamptz default null, p_location text default null, p_notes text default null,
  p_opponent text default null, p_our_score int default null, p_their_score int default null)
returns void
language plpgsql security definer set search_path = public as $$
declare v_uid uuid := require_auth(); o events;
begin
  if not can_manage_team(event_team(p_event)) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  select * into o from events where id = p_event;
  update events set
    title = coalesce(p_title, title), starts_at = coalesce(p_starts, starts_at),
    ends_at = coalesce(p_ends, ends_at), location = coalesce(p_location, location),
    notes = coalesce(p_notes, notes), opponent = coalesce(p_opponent, opponent),
    our_score = coalesce(p_our_score, our_score), their_score = coalesce(p_their_score, their_score)
  where id = p_event;
  perform event_changed(p_event, o.starts_at, o.location, v_uid);
end $$;

create or replace function save_event_details(p_event uuid, p_type uuid, p_title text, p_starts timestamptz,
  p_ends timestamptz default null, p_location text default '', p_notes text default '',
  p_opponent text default null, p_our_score int default null, p_their_score int default null) returns void
language plpgsql security definer set search_path = public as $$
declare v_uid uuid := require_auth(); o events;
begin
  if not can_manage_team(event_team(p_event)) then raise exception 'not allowed' using errcode = '42501'; end if;
  if not lookup_in_domain(p_type, 'event_type') then raise exception 'unknown event type' using errcode = '22023'; end if;
  if p_starts is null then raise exception 'a start time is required' using errcode = '22023'; end if;
  if p_ends is not null and p_ends < p_starts then
    raise exception 'the end must be after the start' using errcode = '22023';
  end if;
  select * into o from events where id = p_event;
  update events set type_id = p_type, title = coalesce(btrim(p_title), ''), starts_at = p_starts, ends_at = p_ends,
         location = coalesce(btrim(p_location), ''), notes = coalesce(p_notes, ''),
         opponent = nullif(btrim(p_opponent), ''), our_score = p_our_score, their_score = p_their_score
   where id = p_event;
  perform event_changed(p_event, o.starts_at, o.location, v_uid);
end $$;

-- No answers on a cancelled event.
create or replace function respond_event(p_event uuid, p_player uuid, p_status text,
  p_reason uuid default null, p_note text default null) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := require_auth();
  v_team uuid := event_team(p_event);
  v_allowed boolean := false;
begin
  if v_team is null then raise exception 'event not found' using errcode = 'P0002'; end if;
  if exists (select 1 from events where id = p_event and cancelled_at is not null) then
    raise exception 'the event was cancelled' using errcode = '22023';
  end if;
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

-- ---------------------------------------------------------------- reminders
-- Runs every 15 minutes (pg_cron). For each future, not cancelled event whose reminder time has come:
-- the parents of every child with no answer (and the child, when the team lets that child answer) get a
-- reminder; the staff get a summary of how many answers are missing. Each event is reminded once
-- (a new time resets it). Returns the number of events handled.
create function send_event_reminders() returns int
language plpgsql security definer set search_path = public as $$
declare e record; r record; v_n int := 0; v_missing int; v_label text; v_staff uuid[];
begin
  for e in
    select ev.id, ev.team_id, ev.starts_at, coalesce((team_param(ev.team_id, 'reminder_hours'))::numeric, 24) as h
    from events ev
    where ev.cancelled_at is null and ev.reminder_sent_at is null and ev.starts_at > now()
      and ev.starts_at <= now() + interval '7 days'
    for update skip locked
  loop
    continue when e.h <= 0 or e.starts_at - make_interval(secs => (e.h * 3600)::double precision) > now();
    v_label := event_label(e.id);

    -- parents: one notification each, naming their children who have no answer
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
        'עוד לא עניתם אם ' || r.kids || ' מגיעים. לחצו כדי לענות.', '/m/parent/event/' || e.id);
    end loop;

    -- players who answer for themselves
    perform notify_fallback(array(
        select p.user_id from team_players tp join players p on p.id = tp.player_id
        where tp.team_id = e.team_id and p.user_id is not null
          and coalesce((team_param(e.team_id, 'players_can_respond'))::boolean, false)
          and player_age(p.id) >= coalesce((team_param(e.team_id, 'min_response_age'))::int, 0)
          and not exists (select 1 from event_responses x where x.event_id = e.id and x.player_id = tp.player_id)),
      '⏰ אישור הגעה: ' || v_label, 'עוד לא ענית אם אתה מגיע. לחץ כדי לענות.', '/m/player/event/' || e.id);

    -- staff summary
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

-- update_events_bulk (0031): moving a series' time lets reminders go out again, and people without push
-- get the notice by email.
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
      '/');
  end if;
  return v_n;
end $$;

revoke execute on function notify_fallback(uuid[], text, text, text), notify_team_event(uuid, text, text, uuid),
  event_changed(uuid, timestamptz, text, uuid), send_event_reminders(), event_label(uuid)
  from public, anon, authenticated;
revoke execute on function cancel_event(uuid, uuid, text), restore_event(uuid) from public, anon;
grant execute on function cancel_event(uuid, uuid, text), restore_event(uuid) to authenticated;

-- Schedule the reminders where pg_cron is available (Supabase: Database ← Extensions ← pg_cron).
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron;
    perform cron.unschedule(jobid) from cron.job where jobname = 'event-reminders';
    perform cron.schedule('event-reminders', '*/15 * * * *', 'select public.send_event_reminders()');
  end if;
end $$;
