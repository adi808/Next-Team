-- Next Team: nutrition. A daily suggestion that follows the child's day (match, training or rest), the child's age
-- and allergies, and feedback on "what did you eat today?". The suggestions come from the `nutrition` Edge Function
-- (a language model); what the child wrote and the answers are kept for the child and the parents only: the staff
-- do not see them, like medical information. No weight and no calories, by design. The staff can give the team a
-- tip for a day, which everyone sees and the suggestion follows.

create table nutrition_entries (
  id uuid primary key default gen_random_uuid(),
  player_id uuid not null references players (id) on delete cascade,
  day date not null,
  kind text not null check (kind in ('plan', 'review')),
  input text not null default '' check (length(input) <= 2000),
  output jsonb not null default '{}',
  created_by uuid references profiles (id) on delete set null,
  created_at timestamptz not null default now()
);
create index nutrition_entries_player_day on nutrition_entries (player_id, day);
alter table nutrition_entries enable row level security;
create policy nutrition_entries_select on nutrition_entries for select using (is_parent_of(player_id) or is_self_player(player_id));
grant select on nutrition_entries to authenticated;
revoke all on nutrition_entries from anon;
revoke insert, update, delete, truncate, references, trigger on nutrition_entries from authenticated;

-- Tips the staff give the team for a day ("fruit before training"): the whole team sees them in the nutrition tab,
-- and the suggestion for that day takes them into account.
create table team_nutrition_tips (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references teams (id) on delete cascade,
  day date not null,
  tip text not null check (length(trim(tip)) between 1 and 500),
  created_by uuid references profiles (id) on delete set null,
  created_at timestamptz not null default now()
);
create index team_nutrition_tips_team_day on team_nutrition_tips (team_id, day);
alter table team_nutrition_tips enable row level security;
create policy team_nutrition_tips_select on team_nutrition_tips for select using (is_team_member(team_id));
grant select on team_nutrition_tips to authenticated;
revoke all on team_nutrition_tips from anon;
revoke insert, update, delete, truncate, references, trigger on team_nutrition_tips from authenticated;

create function add_team_nutrition_tip(p_team uuid, p_day date, p_tip text) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_uid uuid := require_auth(); v_id uuid;
begin
  if not can_manage_team(p_team) then raise exception 'not allowed' using errcode = '42501'; end if;
  if p_day not between current_date - 1 and current_date + 60 then raise exception 'day out of range' using errcode = '22023'; end if;
  insert into team_nutrition_tips (team_id, day, tip, created_by) values (p_team, p_day, trim(p_tip), v_uid) returning id into v_id;
  return v_id;
end $$;

create function delete_team_nutrition_tip(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform require_auth();
  if not can_manage_team((select team_id from team_nutrition_tips where id = p_id)) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  delete from team_nutrition_tips where id = p_id;
end $$;

-- What the suggestion needs about the child and the day: first name, age, allergies and the events of that day and
-- the next (a morning match changes the evening before). Only for a parent of the child or the child.
create function nutrition_context(p_player uuid, p_day date) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v jsonb;
begin
  perform require_auth();
  if not (is_parent_of(p_player) or is_self_player(p_player)) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  select jsonb_build_object(
    'first_name', split_part(p.full_name, ' ', 1),
    'age', player_age(p.id),
    'allergies', coalesce((select av.value #>> '{}' from attribute_values av join attribute_defs d on d.id = av.def_id
                           where d.key = 'medical_allergy' and av.entity_id = p.id order by av.seq desc limit 1), ''),
    'events', coalesce((
      select jsonb_agg(jsonb_build_object(
               'day', (e.starts_at at time zone 'Asia/Jerusalem')::date,
               'type', l.name_he, 'slug', l.slug, 'is_match', coalesce((l.meta ->> 'is_match')::boolean, false),
               'starts', to_char(e.starts_at at time zone 'Asia/Jerusalem', 'HH24:MI'),
               'ends', to_char(e.ends_at at time zone 'Asia/Jerusalem', 'HH24:MI'),
               'cancelled', e.cancelled_at is not null) order by e.starts_at)
        from events e
        join team_players tp on tp.team_id = e.team_id and tp.player_id = p.id
        join lookups l on l.id = e.type_id
       where (e.starts_at at time zone 'Asia/Jerusalem')::date between p_day and p_day + 1), '[]'::jsonb),
    'coach_tips', coalesce((
      select jsonb_agg(t.tip order by t.created_at) from team_nutrition_tips t
        join team_players tp on tp.team_id = t.team_id and tp.player_id = p.id
       where t.day = p_day), '[]'::jsonb))
    into v
    from players p where p.id = p_player;
  return v;
end $$;

-- Keeps a suggestion (one per child and day: a new one replaces it) or a feedback on a meal report.
create function save_nutrition_entry(p_player uuid, p_day date, p_kind text, p_input text, p_output jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_uid uuid := require_auth(); v_id uuid;
begin
  if not (is_parent_of(p_player) or is_self_player(p_player)) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if p_kind not in ('plan', 'review') then raise exception 'unknown kind' using errcode = '22023'; end if;
  if p_day not between current_date - 7 and current_date + 7 then raise exception 'day out of range' using errcode = '22023'; end if;
  if p_kind = 'plan' then delete from nutrition_entries where player_id = p_player and day = p_day and kind = 'plan'; end if;
  insert into nutrition_entries (player_id, day, kind, input, output, created_by)
  values (p_player, p_day, p_kind, left(coalesce(p_input, ''), 2000), coalesce(p_output, '{}'), v_uid)
  returning id into v_id;
  return v_id;
end $$;

revoke execute on function nutrition_context(uuid, date), save_nutrition_entry(uuid, date, text, text, jsonb),
  add_team_nutrition_tip(uuid, date, text), delete_team_nutrition_tip(uuid) from public, anon;
grant execute on function nutrition_context(uuid, date), save_nutrition_entry(uuid, date, text, text, jsonb),
  add_team_nutrition_tip(uuid, date, text), delete_team_nutrition_tip(uuid) to authenticated;
