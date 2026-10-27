-- Security hardening after the Supabase advisor run.

-- v_players was a SECURITY DEFINER view: it read players with the owner's rights, skipping RLS.
-- The masking and the can_view_player filter move into an explicit security definer function, and the
-- view becomes security invoker, so it no longer bypasses RLS on its own. Same columns, same rows.
create function players_visible()
returns table (id uuid, club_id uuid, full_name text, birth_date date, photo_path text,
               photo_consent boolean, has_account boolean, is_me boolean)
language sql stable security definer set search_path = public as $$
  select p.id, p.club_id, p.full_name,
         case when can_manage_player(p.id) or is_parent_of(p.id) or is_self_player(p.id)
              then p.birth_date end,
         case when p.photo_consent or can_manage_player(p.id) or is_parent_of(p.id) or is_self_player(p.id)
              then p.photo_path end,
         p.photo_consent,
         (p.user_id is not null),
         (p.user_id = auth.uid())
  from players p
  where can_view_player(p.id)
$$;

create or replace view v_players with (security_invoker = true) as
  select * from players_visible();
alter view v_players set (security_invoker = true);

-- players is read only through v_players and written only through RPCs; say so with a policy.
create policy players_no_direct_access on players for all using (false) with check (false);

-- Fixed search_path on the functions that lacked one.
alter function norm_phone(text) set search_path = '';
alter function require_auth() set search_path = '';
alter function team_players_same_club() set search_path = public;

-- Signed-in users only need the RPCs and the helpers that RLS policies call directly.
-- These helpers are used only inside other security definer functions; as RPCs they leaked data
-- (player_age returned any player's age, defeating the birth_date masking in v_players).
revoke execute on function
  attr_applies(uuid, uuid), attr_can_write(uuid, uuid), can_manage_def(uuid, uuid),
  can_view_player(uuid), entity_club(text, uuid), entity_roles(text, uuid), entity_teams(text, uuid),
  event_is_match(uuid), is_club_admin_strict(uuid), is_team_parent(uuid), is_team_player(uuid),
  lookup_in_domain(uuid, text), player_age(uuid), player_has_account(uuid), shares_club(uuid),
  task_team(uuid), validate_attr_value(attribute_defs, jsonb), require_auth()
from authenticated;
revoke execute on function players_visible() from public, anon;
grant execute on function players_visible() to authenticated;

-- Table privileges. New Supabase projects no longer grant select/insert/update/delete on new tables to
-- anon and authenticated, but do grant truncate, references and trigger (truncate ignores RLS).
-- Grant exactly what the RLS policies are written for; nothing for anon.
revoke all on all tables in schema public from anon;
revoke truncate, references, trigger on all tables in schema public from authenticated;
do $$
begin
  if current_setting('server_version_num')::int >= 170000 then
    execute 'revoke maintain on all tables in schema public from anon, authenticated';
  end if;
end $$;

grant select on
  profiles, clubs, teams, memberships, invites, guardianships, messages, sports, team_players, lookups,
  events, event_responses, event_stats, attribute_defs, attribute_values, tasks, task_assignments,
  surveys, survey_questions, survey_options, survey_answers, conversations, direct_messages
to authenticated;
grant insert on messages, direct_messages to authenticated;
grant update (full_name) on profiles to authenticated;
grant update (name) on clubs to authenticated;
grant update (name, sport_id) on teams to authenticated;
grant update (status) on invites to authenticated;
grant delete on clubs, teams, memberships to authenticated;
grant insert, update, delete on sports to authenticated;
