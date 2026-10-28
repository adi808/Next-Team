-- Role-by-role scenario for the whole system. Run on a fresh database after the migrations:
--   psql -f stub_auth.sql ; psql -f ../migrations/*.sql ; psql -f scenario.sql
-- Every check prints PASS or FAIL; the last line summarizes.
\set ON_ERROR_STOP on
\set QUIET on
set client_min_messages = notice;

create schema t;
create table t.ctx (k text primary key, v uuid);
create table t.res (label text, ok boolean);
grant usage on schema t to authenticated;
grant all on all tables in schema t to authenticated;

create function t.id(n text) returns uuid language sql stable as $$ select v from t.ctx where k = n $$;
create function t.as_user(n text) returns void language plpgsql as $$
begin perform set_config('request.uid', coalesce(t.id(n)::text, ''), false); end $$;
create function t.check(label text, ok boolean) returns void language plpgsql as $$
begin
  insert into t.res values (label, coalesce(ok, false));
  raise notice '% %', case when coalesce(ok, false) then 'PASS' else 'FAIL' end, label;
end $$;
create function t.denied(label text, q text) returns void language plpgsql as $$
begin
  begin execute q; perform t.check(label || ' (should be denied)', false);
  exception when others then perform t.check(label || ' -> denied', true); end;
end $$;
create function t.reg(n text, p_email text) returns void language plpgsql as $$
begin insert into t.ctx select n, id from profiles where profiles.email = norm_email(p_email); end $$;
create function t.lk(d text, s text) returns uuid language sql stable as
  $$ select id from lookups where domain = d and slug = s order by sport_id nulls first limit 1 $$;
create function t.lkn(d text, s text) returns uuid language sql stable as
  $$ select id from lookups where domain = d and name_he = s limit 1 $$;
grant execute on all functions in schema t to authenticated;

-- ---------------------------------------------------------------- users
insert into auth.users (email) values ('u01@test.io'), ('u03@test.io'), ('u04@test.io'), ('u08@test.io');
select t.reg('S', 'u01@test.io'), t.reg('C', 'u03@test.io'), t.reg('C2', 'u04@test.io'), t.reg('O', 'u08@test.io');
update profiles set is_system_admin = true where id = t.id('S');

set role authenticated;
select t.as_user('S');
select t.check('system admin creates a club and names its admin by email',
  (select create_club('מועדון א', ' U02@Test.IO ')) is not null);
insert into t.ctx select 'club', id from clubs limit 1;
select t.denied('non system admin cannot create a club', $$select create_club('x')$$) from (select t.as_user('C')) _;

reset role;
insert into auth.users (email) values ('u02@test.io');             -- the club admin signs up
select t.reg('A', 'u02@test.io');
insert into auth.users (email, raw_user_meta_data) values ('g@test.io', '{"full_name": "גוגל משתמש"}');
select t.check('a Google sign-in fills the profile name and email',
  exists (select 1 from profiles where email = 'g@test.io' and full_name = 'גוגל משתמש'));
select t.check('club admin invite is claimed at signup',
  exists (select 1 from memberships where user_id = t.id('A') and role = 'club_admin'));

set role authenticated;
select t.as_user('A');
insert into t.ctx select 'T1', create_team(t.id('club'), 'ילדים א', (select id from sports where slug = 'football'));
insert into t.ctx select 'T2', create_team(t.id('club'), 'נוער כדורסל', (select id from sports where slug = 'basketball'));
select invite_by_email('u03@test.io', t.id('club'), t.id('T1'), 'coach');
select invite_by_email('u04@test.io', t.id('club'), t.id('T2'), 'coach');
select t.check('coaches are attached to their teams',
  (select count(*) from memberships where role = 'coach') = 2);
select t.denied('an invalid email is rejected',
  $$select invite_by_email('not-an-email', t.id('club'), t.id('T1'), 'coach')$$);

-- ---------------------------------------------------------------- players
select t.as_user('C');
insert into t.ctx select 'K1', add_player(t.id('T1'), 'דני כהן', '2014-05-01', null, 'u05@test.io');
insert into t.ctx select 'K2', add_player(t.id('T1'), 'רוני לוי', '2008-03-02', 'u06@test.io', 'u07@test.io');
select t.denied('coach of another team cannot add a player to T1',
  $$select add_player(t.id('T1'), 'x', '2010-01-01')$$) from (select t.as_user('C2')) _;
select t.denied('birth date is mandatory', $$select add_player(t.id('T1'), 'x', null)$$) from (select t.as_user('C')) _;

reset role;
insert into auth.users (email) values ('u05@test.io'), ('u06@test.io'), ('u07@test.io'), ('u09@test.io');
select t.reg('P1', 'u05@test.io'), t.reg('U2', 'u06@test.io'), t.reg('P2', 'u07@test.io'), t.reg('P3', 'u09@test.io');
select t.check('parent invite becomes an approved link at signup',
  exists (select 1 from guardianships where parent_id = t.id('P1') and player_id = t.id('K1') and status = 'approved'));
select t.check('player invite links the account to the player',
  (select user_id from players where id = t.id('K2')) = t.id('U2'));

set role authenticated;
select t.as_user('P1');
select t.check('parent sees own child with birth date',
  (select birth_date from v_players where id = t.id('K1')) = date '2014-05-01');
select t.check('parent sees a teammate by name but without birth date',
  (select full_name is not null and birth_date is null from v_players where id = t.id('K2')));
select t.check('parent sees teammate photo only with consent (none yet)',
  (select photo_path from v_players where id = t.id('K2')) is null);
select t.check('parent can read the base table? no (revoked)', not has_table_privilege('authenticated', 'players', 'select'));
select update_player(t.id('K1'), null, null, 'photo-k1.jpg');
select t.as_user('P2');
select t.check('teammate does not see the photo before consent',
  (select photo_path from v_players where id = t.id('K1')) is null);
select t.denied('another parent cannot set photo consent', $$select set_photo_consent(t.id('K1'), true)$$);
select t.as_user('P1');
select set_photo_consent(t.id('K1'), true);
select t.as_user('P2');
select t.check('teammate sees the photo after the parent consented',
  (select photo_path from v_players where id = t.id('K1')) = 'photo-k1.jpg');
select t.as_user('O');
select t.check('outsider sees no players', (select count(*) from v_players) = 0);
select t.check('outsider sees no profiles but own', (select count(*) from profiles) = 1);
select t.as_user('P2');
select t.check('parent sees the coach name (same team)', exists (select 1 from profiles where id = t.id('C')));
select t.check('parent does not see unrelated profiles', not exists (select 1 from profiles where id = t.id('O')));

-- ---------------------------------------------------------------- events + attendance
select t.as_user('C');
insert into t.ctx select 'E_train', create_event(t.id('T1'), t.lk('event_type', 'training'), 'אימון שני', now() + interval '2 days', null, 'מגרש 3');
insert into t.ctx select 'E_match', create_event(t.id('T1'), t.lk('event_type', 'match'), 'משחק ליגה', now() + interval '5 days', null, 'אצטדיון', '', 'הפועל');
select t.denied('coach of another team cannot create an event for T1',
  $$select create_event(t.id('T1'), t.lk('event_type','training'), 'x', now())$$) from (select t.as_user('C2')) _;
select t.denied('event type must come from the catalog',
  $$select create_event(t.id('T1'), t.lk('absence_reason','illness'), 'x', now())$$) from (select t.as_user('C')) _;
select t.denied('a parent cannot create events',
  $$select create_event(t.id('T1'), t.lk('event_type','training'), 'x', now())$$) from (select t.as_user('P1')) _;

select t.as_user('P1');
select respond_event(t.id('E_train'), t.id('K1'), 'attending');
select t.denied('not attending needs a reason', $$select respond_event(t.id('E_train'), t.id('K1'), 'not_attending')$$);
select respond_event(t.id('E_train'), t.id('K1'), 'not_attending', t.lk('absence_reason', 'illness'), 'חום');
select t.check('last answer wins (changed to not attending)',
  (select status from event_responses where event_id = t.id('E_train') and player_id = t.id('K1')) = 'not_attending');
select respond_event(t.id('E_train'), t.id('K1'), 'attending');
select t.check('answer can be changed back at any time and clears the reason',
  (select status = 'attending' and reason_id is null from event_responses where player_id = t.id('K1') and event_id = t.id('E_train')));
select t.denied('parent cannot answer for another child', $$select respond_event(t.id('E_train'), t.id('K2'), 'attending')$$);
select respond_event(t.id('E_train'), t.id('K1'), 'not_attending', t.lk('absence_reason', 'vacation'), 'חופשה משפחתית');

select t.as_user('U2');
select t.denied('player cannot answer while the team does not allow it', $$select respond_event(t.id('E_train'), t.id('K2'), 'attending')$$);
select t.as_user('C');
select set_attribute((select id from attribute_defs where scope='team' and key='players_can_respond'), t.id('T1'), 'true'::jsonb);
select set_attribute((select id from attribute_defs where scope='team' and key='min_response_age'), t.id('T1'), '20'::jsonb);
select t.as_user('U2');
select t.denied('player below the team minimum age cannot answer (age 18 < 20)', $$select respond_event(t.id('E_train'), t.id('K2'), 'attending')$$);
select t.as_user('C');
select set_attribute((select id from attribute_defs where scope='team' and key='min_response_age'), t.id('T1'), '12'::jsonb);
select t.as_user('U2');
select respond_event(t.id('E_train'), t.id('K2'), 'attending');
select t.check('player may answer once the team allows it and age is enough',
  exists (select 1 from event_responses where player_id = t.id('K2') and event_id = t.id('E_train')));

select t.as_user('C');
select t.check('coach sees every answer with the reason and note',
  (select count(*) from event_responses where event_id = t.id('E_train')) = 2
  and (select note from event_responses where player_id = t.id('K1') and event_id = t.id('E_train')) = 'חופשה משפחתית');
select t.as_user('A');
select t.check('club admin sees the answers too', (select count(*) from event_responses) = 2);
select t.as_user('P2');
select t.check('other parents do not see answers about someone else''s child',
  (select count(*) from event_responses where player_id = t.id('K1')) = 0);
select t.as_user('O');
select t.check('outsider sees no events', (select count(*) from events) = 0);
select t.as_user('C2');
select t.check('coach of another team sees no T1 events or answers',
  (select count(*) from events) = 0 and (select count(*) from event_responses) = 0);

-- ---------------------------------------------------------------- match statistics
select t.as_user('C');
select record_stat(t.id('E_match'), t.id('K1'), t.lk('stat_type', 'goal'), 12);
select record_stat(t.id('E_match'), t.id('K1'), t.lk('stat_type', 'yellow_card'), 40);
select record_stat(t.id('E_match'), t.id('K2'), t.lk('stat_type', 'assist'), 12);
select t.denied('statistics only on a match event', $$select record_stat(t.id('E_train'), t.id('K1'), t.lk('stat_type','goal'))$$);
select update_event(t.id('E_match'), p_our_score => 1, p_their_score => 0);
select t.as_user('P2');
select t.check('team members see the statistics and the result',
  (select count(*) from event_stats where event_id = t.id('E_match')) = 3
  and (select our_score from events where id = t.id('E_match')) = 1);
select t.denied('a parent cannot record statistics', $$select record_stat(t.id('E_match'), t.id('K2'), t.lk('stat_type','goal'))$$);
select t.as_user('O');
select t.check('outsider sees no statistics', (select count(*) from event_stats) = 0);

-- ---------------------------------------------------------------- dynamic attributes
select t.as_user('C');
insert into t.ctx select 'D_ball', create_attribute_def('player', 'ball_control', 'שליטה בכדור', 'scale', '{"min":1,"max":10}',
  array['system_admin','club_admin','coach','parent','player'], array['coach'], null, t.id('T1'));
select set_attribute(t.id('D_ball'), t.id('K1'), '7'::jsonb);
select set_attribute(t.id('D_ball'), t.id('K1'), '8'::jsonb);
select t.denied('rating above the scale is rejected', $$select set_attribute(t.id('D_ball'), t.id('K1'), '11'::jsonb)$$);
select t.denied('rating must be a whole number', $$select set_attribute(t.id('D_ball'), t.id('K1'), '7.5'::jsonb)$$);
select t.as_user('C2');
select t.denied('coach of another team cannot define or set parameters on T1 players',
  $$select create_attribute_def('player','x','x','text','{}',array['coach'],array['coach'],null,t.id('T1'))$$);
select t.as_user('P1');
select t.check('parent sees the current rating and the history of own child',
  (select (value)::int from attribute_current where def_id = t.id('D_ball') and entity_id = t.id('K1')) = 8
  and (select count(*) from attribute_values where def_id = t.id('D_ball') and entity_id = t.id('K1')) = 2);
select t.denied('a parent cannot edit ratings', $$select set_attribute(t.id('D_ball'), t.id('K1'), '10'::jsonb)$$);
select t.as_user('P2');
select t.check('another parent sees nothing of this child''s ratings',
  (select count(*) from attribute_values where entity_id = t.id('K1')) = 0);
select t.as_user('C');
select set_attribute(t.id('D_ball'), t.id('K2'), '5'::jsonb);
select t.as_user('U2');
select t.check('a player sees own rating', (select count(*) from attribute_values where entity_id = t.id('K2') and def_id = t.id('D_ball')) = 1);

-- medical information
select t.as_user('P1');
select set_attribute((select id from attribute_defs where key = 'medical_allergy'), t.id('K1'), '"בוטנים"'::jsonb);
select t.as_user('P2');
select set_attribute((select id from attribute_defs where key = 'medical_condition'), t.id('K2'), '"אסתמה"'::jsonb);
select t.as_user('C');
select t.check('coach sees medical info of own players', (select count(*) from attribute_values av
  join attribute_defs d on d.id = av.def_id where d.key like 'medical%') = 2);
select t.as_user('U2');
select t.check('a player does not see own medical info (not in the visibility list)',
  (select count(*) from attribute_values av join attribute_defs d on d.id = av.def_id where d.key like 'medical%') = 0);
select t.as_user('A');
select t.check('club admin sees medical info', (select count(*) from attribute_values av
  join attribute_defs d on d.id = av.def_id where d.key like 'medical%') = 2);
select t.as_user('S');
select t.check('system admin sees medical info and ratings', (select count(*) from attribute_values av join attribute_defs d on d.id = av.def_id where d.scope = 'player') = 5);
select t.as_user('C2');
select t.check('coach of another team sees none of the player values', (select count(*) from attribute_values av join attribute_defs d on d.id = av.def_id where d.scope = 'player') = 0);
select t.as_user('P2');
select t.check('parent sees only own child''s medical info', (select count(*) from attribute_values av
  join attribute_defs d on d.id = av.def_id where d.key like 'medical%') = 1);

-- team and event settings, dependent lists
select t.as_user('C');
select set_attribute((select id from attribute_defs where scope='team' and key='default_match_format'), t.id('T1'), to_jsonb(t.lk('match_format','football_11')::text));
select t.denied('a team setting must come from its list',
  $$select set_attribute((select id from attribute_defs where scope='team' and key='default_match_format'), t.id('T1'), to_jsonb(t.lk('event_type','match')::text))$$);
select set_attribute((select id from attribute_defs where scope='event' and key='match_format'), t.id('E_match'), to_jsonb(t.lk('match_format','football_11')::text));
select set_attribute((select id from attribute_defs where scope='event' and key='formation'), t.id('E_match'), to_jsonb(t.lkn('formation','4-3-3')::text));
select t.check('event stores a format and a formation chosen from lists',
  (select count(*) from attribute_current where entity_id = t.id('E_match')) = 2);
select t.check('formation list depends on the format (4-3-3 belongs to 11-a-side)',
  (select parent_id from lookups where id = t.lkn('formation','4-3-3')) = t.lk('match_format','football_11'));
select t.as_user('P1');
select t.check('parents see event settings', (select count(*) from attribute_current where entity_id = t.id('E_match')) = 2);
select t.as_user('C');
select t.check('team_param returns the saved value', team_param(t.id('T1'), 'min_response_age') = '12'::jsonb);
select t.check('team_param falls back to the default', team_param(t.id('T2'), 'min_response_age') is null);   -- C is not in T2
select t.as_user('C2');
select t.check('team_param falls back to the default for a member', team_param(t.id('T2'), 'min_response_age') = '12'::jsonb);

-- ---------------------------------------------------------------- tasks
select t.as_user('C');
insert into t.ctx select 'TASK', create_task(t.id('T1'), '100 הרמות כדור', 'עד יום שישי', now() + interval '3 days', null, true, true);
select t.as_user('P1');
select t.check('parent of a child without an account sees both the child task and the parent task',
  (select count(*) from task_assignments) = 2);
select t.as_user('P2');
select t.check('parent of a child with an account sees only the parent task', (select count(*) from task_assignments where kind = 'parent') = 1
  and (select count(*) from task_assignments) = 1);
select t.as_user('U2');
select t.check('player sees only own task', (select count(*) from task_assignments) = 1);
select t.as_user('O');
select t.check('outsider sees no tasks', (select count(*) from tasks) = 0);
select t.as_user('P2');
select complete_assignment((select id from task_assignments where kind = 'parent'), true);
select t.as_user('U2');
select complete_assignment((select id from task_assignments), true);
select t.as_user('P2');
select t.denied('parent cannot tick the task of a child who has an account',
  $$select complete_assignment((select id from task_assignments where kind='player' and player_id = t.id('K2')), true)$$);
select t.as_user('C');
select t.check('coach sees all four items and who finished', (select count(*) from task_assignments) = 4
  and (select count(*) from task_assignments where done_at is not null) = 2);
select t.as_user('C');
insert into t.ctx select 'TASK2', create_task(t.id('T1'), 'מתיחות', '', null, array[t.id('K1')], true, false);
select t.as_user('U2');
select t.check('a task for one player is invisible to the others', (select count(*) from tasks where id = t.id('TASK2')) = 0);

-- ---------------------------------------------------------------- surveys
select t.as_user('C');
insert into t.ctx select 'SV', create_survey(t.id('T1'), 'מי מגיע לטורניר?', 'סוף החודש', null,
  '[{"text":"האם תגיעו?","kind":"single","options":["כן","לא"]},{"text":"הערות","kind":"text"}]'::jsonb);
select t.denied('a survey needs two options for a choice question',
  $$select create_survey(t.id('T1'), 'x', '', null, '[{"text":"q","kind":"single","options":["a"]}]'::jsonb)$$);
select t.as_user('P1');
select submit_survey(t.id('SV'), jsonb_build_array(
  jsonb_build_object('question_id', (select id from survey_questions where kind='single'), 'option_ids', jsonb_build_array((select id from survey_options where label='כן'))),
  jsonb_build_object('question_id', (select id from survey_questions where kind='text'), 'text', 'נגיע')));
select submit_survey(t.id('SV'), jsonb_build_array(
  jsonb_build_object('question_id', (select id from survey_questions where kind='single'), 'option_ids', jsonb_build_array((select id from survey_options where label='לא')))));
select t.check('answering again replaces the earlier answers',
  (select count(*) from survey_answers) = 1 and (select label from survey_options where id = (select option_id from survey_answers)) = 'לא');
select t.as_user('P2');
select submit_survey(t.id('SV'), jsonb_build_array(
  jsonb_build_object('question_id', (select id from survey_questions where kind='single'), 'option_ids', jsonb_build_array((select id from survey_options where label='כן')))));
select t.check('a respondent sees only their own answers', (select count(*) from survey_answers) = 1);
select t.as_user('C');
select t.check('coach sees all answers', (select count(*) from survey_answers) = 2);
select t.as_user('O');
select t.denied('outsider cannot answer', $$select submit_survey(t.id('SV'), '[]'::jsonb)$$);
select t.check('outsider sees no surveys', (select count(*) from surveys) = 0);

-- ---------------------------------------------------------------- chat
select t.as_user('P1');
select post_message(t.id('T1'), 'מי מסיע בשבת?');
select t.as_user('U2');
select t.denied('a player cannot write in the team channel', $$select post_message(t.id('T1'), 'hi')$$);
select t.as_user('A');
select post_message(t.id('T1'), 'ברוכים הבאים');
select t.as_user('P2');
select t.check('parents read the team channel', (select count(*) from messages) = 2);
select t.as_user('O');
select t.check('outsider reads nothing', (select count(*) from messages) = 0);

select t.as_user('C');
insert into t.ctx select 'CONV', start_conversation(t.id('T1'), t.id('K1'));
select post_direct_message(t.id('CONV'), 'כל הכבוד על האימון');
select t.as_user('P1');
select post_direct_message(t.id('CONV'), 'תודה מאמן');
select t.check('the parent sees the whole personal conversation about the child', (select count(*) from direct_messages) = 2);
select t.as_user('A');
select t.check('club admin does NOT see personal conversations',
  (select count(*) from conversations) = 0 and (select count(*) from direct_messages) = 0);
select t.as_user('S');
select t.check('system admin does not see personal conversations either', (select count(*) from direct_messages) = 0);
select t.as_user('P2');
select t.check('another parent does not see it', (select count(*) from direct_messages) = 0);
select t.as_user('C2');
select t.denied('another coach cannot start one', $$select start_conversation(t.id('T1'), t.id('K1'))$$);
select t.as_user('C');
insert into t.ctx select 'CONV2', start_conversation(t.id('T1'), t.id('K2'));
select t.as_user('U2');
select post_direct_message(t.id('CONV2'), 'שלום מאמן');
select t.check('the player can write in their own conversation', (select count(*) from direct_messages) = 1);
select t.as_user('P1');
select t.denied('a parent cannot write in a conversation about a different child', $$select post_direct_message(t.id('CONV2'), 'x')$$);

-- ---------------------------------------------------------------- guardianship request flow
select t.as_user('U2');
select request_guardianship('u09@test.io', false);                       -- the child asks P3 to be linked
select t.as_user('P3');
select t.check('a pending request grants no access yet', (select count(*) from v_players) = 0);
select t.denied('the requesting parent cannot approve', $$select respond_guardianship((select id from guardianships where parent_id = t.id('P3')), true)$$);
select t.as_user('C2');
select t.denied('a coach of another team cannot approve', $$select respond_guardianship((select id from guardianships where parent_id = t.id('P3')), true)$$);
select t.as_user('C');
select t.check('the coach sees the requesting parent name', exists (select 1 from profiles where id = t.id('P3')));
select respond_guardianship((select id from guardianships where parent_id = t.id('P3')), true);
select t.as_user('P3');
select t.check('after approval the parent sees the child and the team', (select count(*) from v_players) >= 2
  and (select count(*) from events) = 2);

-- ---------------------------------------------------------------- linking to yourself (testers only)
select t.as_user('U2');
select t.denied('a user cannot link to themselves', $$select request_guardianship('u06@test.io', false)$$);
reset role;
update players set user_id = t.id('S') where id = t.id('K1');            -- the system admin also has a player profile
set role authenticated;
select t.as_user('S');
select request_guardianship('u01@test.io', true);
select t.check('a system admin may link to themselves for testing',
  exists (select 1 from guardianships where parent_id = t.id('S') and player_id = t.id('K1') and status = 'pending'));
reset role;
update players set user_id = null where id = t.id('K1');
delete from guardianships where parent_id = t.id('S');
set role authenticated;

-- ---------------------------------------------------------------- catalogs
select t.as_user('A');
select upsert_lookup(null, 'absence_reason', 'exam', 'מבחן', null, null, null, t.id('club'), 7);
select t.check('club admin adds a value to a list for their club',
  exists (select 1 from lookups where domain = 'absence_reason' and slug = 'exam'));
select t.denied('club admin cannot edit a global list value',
  $$select upsert_lookup((select id from lookups where slug='illness'), 'absence_reason', 'illness', 'x', null, null, null, t.id('club'), 1)$$);
select t.as_user('C');
select t.denied('a coach cannot manage lists', $$select upsert_lookup(null, 'absence_reason', 'x', 'x', null, null, null, t.id('club'), 1)$$);
select t.as_user('O');
select t.check('lookups outside own club are hidden, global ones visible',
  not exists (select 1 from lookups where slug = 'exam') and exists (select 1 from lookups where slug = 'illness'));

-- ---------------------------------------------------------------- pictures for clubs, teams and accounts
set role authenticated;
select t.as_user('C');
select set_team_photo(t.id('T1'), 'teams/' || t.id('T1') || '/1.jpg');
select t.check('the coach sets the team picture', (select photo_path from teams where id = t.id('T1')) like 'teams/%/1.jpg');
select t.denied('a team picture must sit in that team''s folder', $$select set_team_photo(t.id('T1'), 'teams/' || t.id('T2') || '/x.jpg')$$);
select t.denied('a coach of another team cannot set its picture', $$select set_team_photo(t.id('T2'), 'teams/' || t.id('T2') || '/x.jpg')$$);
select t.denied('a coach cannot set the club logo', $$select set_club_logo(t.id('club'), 'clubs/' || t.id('club') || '/x.png')$$);
select set_my_avatar(t.id('C') || '/me.jpg');
select t.check('anyone sets their own avatar', (select avatar_path from profiles where id = t.id('C')) = t.id('C') || '/me.jpg');
select t.denied('an avatar must sit in your own folder', $$select set_my_avatar(t.id('A') || '/me.jpg')$$);
select t.as_user('A');
select set_club_logo(t.id('club'), 'clubs/' || t.id('club') || '/logo.png');
select t.check('club admin sets the club logo', (select logo_path from clubs where id = t.id('club')) like 'clubs/%/logo.png');

-- ---------------------------------------------------------------- positions and goals
set role authenticated;
select t.as_user('C');
select set_attribute((select id from attribute_defs where key = 'position'), t.id('K1'), to_jsonb(t.lk('position', 'goalkeeper')::text));
select t.check('the coach sets a player position', exists (select 1 from attribute_current
  where def_id = (select id from attribute_defs where key = 'position') and entity_id = t.id('K1')));
insert into t.ctx select 'GOAL', save_player_goal(null, t.id('K1'), 'לשפר בעיטה ברגל שמאל', '2026-12-31');
select save_player_goal(t.id('GOAL'), t.id('K1'), 'לשפר בעיטה ברגל שמאל', '2026-12-31', true);
select t.check('the coach adds and completes a goal', exists (select 1 from player_goals where id = t.id('GOAL') and done_at is not null));
select t.as_user('P1');
select t.check('the parent sees the goal and the position',
  exists (select 1 from player_goals where id = t.id('GOAL'))
  and exists (select 1 from attribute_current where entity_id = t.id('K1') and def_id = (select id from attribute_defs where key = 'position')));
select t.denied('a parent cannot add goals', $$select save_player_goal(null, t.id('K1'), 'x')$$);
select t.denied('a parent cannot set the position', $$select set_attribute((select id from attribute_defs where key = 'position'), t.id('K1'), to_jsonb(t.lk('position', 'forward')::text))$$);
select t.as_user('O');
select t.check('an outsider does not see goals', not exists (select 1 from player_goals));

-- ---------------------------------------------------------------- what to bring, player kind and strong foot
set role authenticated;
select t.as_user('C');
select set_event_equipment((select id from events where team_id = t.id('T1') limit 1),
  array[t.lk('equipment', 'water'), t.lk('equipment', 'boots'), t.lk('equipment', 'water')]);
select t.check('the coach picks several items to bring (no duplicates)',
  (select cardinality(equipment) from events where team_id = t.id('T1') and cardinality(equipment) > 0 limit 1) = 2);
select t.denied('only items from the equipment list', $$select set_event_equipment((select id from events where team_id = t.id('T1') limit 1), array[t.lk('event_type', 'training')])$$);
select set_attribute((select id from attribute_defs where key = 'player_kind'), t.id('K1'), to_jsonb(t.lk('player_kind', 'goalkeeper')::text));
select set_attribute((select id from attribute_defs where key = 'strong_foot'), t.id('K1'), '"שמאל"');
select t.check('the coach sets goalkeeper and strong foot',
  (select count(*) from attribute_current where entity_id = t.id('K1')
     and def_id in (select id from attribute_defs where key in ('player_kind', 'strong_foot'))) = 2);
select t.denied('strong foot is right or left only', $$select set_attribute((select id from attribute_defs where key = 'strong_foot'), t.id('K1'), '"שתיים"')$$);
select t.as_user('P1');
select t.denied('a parent cannot choose what to bring', $$select set_event_equipment((select id from events where team_id = t.id('T1') limit 1), '{}')$$);
select t.check('the parent sees what to bring', exists (select 1 from events where cardinality(equipment) = 2));

-- ---------------------------------------------------------------- kits and recurring events
set role authenticated;
select t.as_user('C');
insert into t.ctx select 'KIT', save_team_kit(null, t.id('T1'), 'בית', '#1d4ed8', '#ffffff', '#1d4ed8');
select t.check('the coach adds a kit', exists (select 1 from team_kits where id = t.id('KIT') and active));
select t.denied('a kit colour must be #rrggbb', $$select save_team_kit(null, t.id('T1'), 'x', 'blue', '#ffffff', '#ffffff')$$);
select save_team_kit(t.id('KIT'), t.id('T1'), 'בית', '#1d4ed8', '#ffffff', '#1d4ed8', false);
select t.check('a kit is archived, not removed', exists (select 1 from team_kits where id = t.id('KIT') and not active));
select save_team_kit(t.id('KIT'), t.id('T1'), 'בית', '#1d4ed8', '#ffffff', '#1d4ed8', true);
select t.as_user('C2');
select t.denied('a coach of another team cannot add a kit', $$select save_team_kit(null, t.id('T1'), 'x', '#000000', '#000000', '#000000')$$);
select t.as_user('P1');
select t.check('a parent on the team sees its kits', exists (select 1 from team_kits where id = t.id('KIT')));
select t.as_user('C');
-- Sun, Mon, Wed from Sunday 2026-11-01 to Saturday 2026-11-14: 6 trainings at 17:30 Israel time.
select t.check('a recurring series creates one event per chosen weekday',
  create_event_series(t.id('T1'), t.lk('event_type', 'training'), 'אימון', array[0, 1, 3], '17:30', 90,
    '2026-11-01', '2026-11-14', 'מגרש 3', '', t.id('KIT')) = 6);
select t.check('series events are on the chosen days at the local time, with the kit',
  (select count(*) from events where series_id is not null
     and extract(dow from starts_at at time zone 'Asia/Jerusalem') in (0, 1, 3)
     and to_char(starts_at at time zone 'Asia/Jerusalem', 'HH24:MI') = '17:30'
     and ends_at = starts_at + interval '90 minutes' and kit_id = t.id('KIT')) = 6);
select t.denied('a series needs at least one weekday', $$select create_event_series(t.id('T1'), t.lk('event_type', 'training'), 'x', '{}', '17:00', 60, '2026-11-01', '2026-11-30')$$);
select t.denied('a series is capped at a year', $$select create_event_series(t.id('T1'), t.lk('event_type', 'training'), 'x', array[1], '17:00', 60, '2026-11-01', '2028-11-30')$$);
select set_event_kit((select id from events where series_id is not null limit 1), null);
select t.check('the coach clears an event kit', exists (select 1 from events where series_id is not null and kit_id is null));
select t.as_user('P1');
select t.denied('a parent cannot create a series', $$select create_event_series(t.id('T1'), t.lk('event_type', 'training'), 'x', array[1], '17:00', 60, '2026-11-01', '2026-11-30')$$);

-- ---------------------------------------------------------------- 0020: editing, lineup, relations, staff types
set role authenticated;
select t.as_user('C');
select save_event_details(t.id('E_match'), t.lk('event_type', 'match'), 'משחק גביע', now() + interval '6 days',
  now() + interval '6 days 2 hours', 'אצטדיון ב', 'להגיע מוקדם', '  מכבי  ', 2, 1);
select t.check('coach edits every event field (type, end, opponent trimmed, score)',
  (select title = 'משחק גביע' and ends_at is not null and opponent = 'מכבי' and our_score = 2 and notes = 'להגיע מוקדם'
     from events where id = t.id('E_match')));
select save_event_details(t.id('E_match'), t.lk('event_type', 'match'), 'משחק גביע', now() + interval '6 days', null, '', '', null, null, null);
select t.check('save_event_details clears fields', (select ends_at is null and opponent is null and our_score is null and location = ''
  from events where id = t.id('E_match')));
select t.denied('the end cannot be before the start',
  $$select save_event_details(t.id('E_match'), t.lk('event_type', 'match'), 'x', now(), now() - interval '1 hour')$$);
select t.denied('a parent cannot edit an event',
  $$select save_event_details(t.id('E_match'), t.lk('event_type', 'match'), 'x', now())$$) from (select t.as_user('P1')) _;

select t.as_user('C');
select set_event_lineup(t.id('E_match'), array[t.id('K1'), null, t.id('K2')]);
select t.check('coach saves a lineup (slots 0 and 2)',
  (select array_agg(slot order by slot) from event_lineups where event_id = t.id('E_match')) = array[0, 2]);
select t.denied('the same player cannot stand in two slots', $$select set_event_lineup(t.id('E_match'), array[t.id('K1'), t.id('K1')])$$);
select t.as_user('P1');
select t.check('a parent does not see the lineup', not exists (select 1 from event_lineups));
select t.denied('a parent cannot set the lineup', $$select set_event_lineup(t.id('E_match'), array[t.id('K1')])$$);

select set_guardian_relation(t.id('K1'), t.id('P1'), t.lk('guardian_relation', 'mother'));
select t.check('a parent sets their relation (mom)',
  (select relation_id from player_guardians(t.id('K1')) where parent_id = t.id('P1')) = t.lk('guardian_relation', 'mother'));
select t.denied('a parent cannot set another parent''s relation', $$select set_guardian_relation(t.id('K2'), t.id('P2'), t.lk('guardian_relation', 'father'))$$);
select t.as_user('C');
select set_guardian_relation(t.id('K2'), t.id('P2'), t.lk('guardian_relation', 'father'));
select t.check('the coach sets a parent''s relation (dad)',
  (select relation_id from player_guardians(t.id('K2')) where parent_id = t.id('P2')) = t.lk('guardian_relation', 'father'));
select t.as_user('O');
select t.check('an outsider sees no guardians', not exists (select 1 from player_guardians(t.id('K1'))));

select t.as_user('C');
select set_staff_role((select id from memberships where user_id = t.id('C') and team_id = t.id('T1')), t.lk('staff_role', 'head_coach'));
select t.denied('a coach cannot set the type of another team''s coach',
  $$select set_staff_role((select id from memberships where user_id = t.id('C2')), t.lk('staff_role', 'medic'))$$);
select t.as_user('P1');
select t.check('a parent sees the team staff with types',
  (select staff_role_id from team_staff(t.id('T1')) where user_id = t.id('C')) = t.lk('staff_role', 'head_coach'));
select t.check('a parent does not see another team''s staff', not exists (select 1 from team_staff(t.id('T2'))));
select t.as_user('A');
select set_staff_role((select id from memberships where user_id = t.id('C2')), t.lk('staff_role', 'fitness_coach'));
select t.check('the club admin sets any staff type',
  (select staff_role_id from memberships where user_id = t.id('C2')) = t.lk('staff_role', 'fitness_coach'));

-- ---------------------------------------------------------------- edit / delete clubs and teams (RLS, no RPC)
set role authenticated;
select t.as_user('C');
with u as (update clubs set name = 'x' where id = t.id('club') returning 1)
select t.check('a coach cannot rename the club', count(*) = 0) from u;
with d as (delete from teams where id = t.id('T1') returning 1)
select t.check('a coach cannot delete a team', count(*) = 0) from d;
select t.as_user('A');
select t.denied('a team cannot be moved to another club', $$update teams set club_id = gen_random_uuid() where id = t.id('T2')$$);
with u as (update clubs set name = 'מועדון א מחודש' where id = t.id('club') returning 1)
select t.check('club admin renames the club', count(*) = 1) from u;
with u as (update teams set name = 'נוער כדורסל ב', sport_id = (select id from sports where slug = 'football') where id = t.id('T2') returning 1)
select t.check('club admin edits a team name and sport', count(*) = 1) from u;
with d as (delete from clubs where id = t.id('club') returning 1)
select t.check('a club admin cannot delete the club', count(*) = 0) from d;
with d as (delete from teams where id = t.id('T2') returning 1)
select t.check('club admin deletes a team', count(*) = 1) from d;
select t.as_user('S');
with d as (delete from clubs where id = t.id('club') returning 1)
select t.check('system admin deletes the club', count(*) = 1) from d;
reset role;
select t.check('deleting the club removed its teams and players',
  not exists (select 1 from teams where club_id = t.id('club')) and not exists (select 1 from players where club_id = t.id('club')));

-- ---------------------------------------------------------------- join link with a staff type, transport
reset role;
insert into auth.users (email) values ('j01@test.io'), ('j02@test.io'), ('j03@test.io'), ('j04@test.io');
select t.reg('JA', 'j01@test.io'), t.reg('JM', 'j02@test.io'), t.reg('JP', 'j03@test.io'), t.reg('JO', 'j04@test.io');
set role authenticated;
select t.as_user('S');
insert into t.ctx select 'jclub', create_club('מועדון הצטרפות', 'j01@test.io');
select t.as_user('JA');
insert into t.ctx select 'JT', create_team(t.id('jclub'), 'ילדים ג', (select id from sports where slug = 'football'));
create temp table jl as select create_join_link(t.id('JT')) as code;
select t.as_user('JM');
select t.check('a stranger sees the team behind the link', (select my_status from join_link_info((select code from jl))) = 'none');
select t.denied('an unknown staff type is refused',
  $$select submit_join_request((select code from jl), 'coach', 'מנהל', null, '[]', t.lk('absence_reason', 'illness'))$$);
insert into t.ctx select 'jreq', submit_join_request((select code from jl), 'coach', 'מנהלת קבוצה', null, '[]', t.lk('staff_role', 'team_manager'));
select t.check('the link now says the request is pending', (select my_status from join_link_info((select code from jl))) = 'pending');
reset role;
select t.check('the club admin is told by email', exists (select 1 from notifications
  where user_id = t.id('JA') and email and body like '%מנהל קבוצה%'));
set role authenticated;
select t.as_user('JA');
select t.check('the club admin sees the staff type asked for',
  (select staff_role_id from pending_join_requests() where id = t.id('jreq')) = t.lk('staff_role', 'team_manager'));
select decide_join_request(t.id('jreq'), true);
reset role;
select t.check('approved as team manager', exists (select 1 from memberships where user_id = t.id('JM')
  and team_id = t.id('JT') and role = 'coach' and staff_role_id = t.lk('staff_role', 'team_manager')));
select t.check('the requester is told by email', exists (select 1 from notifications where user_id = t.id('JM') and email));
set role authenticated;
select t.as_user('JP');
insert into t.ctx select 'jreq2', submit_join_request((select code from jl), 'parent', 'הורה', null,
  '[{"full_name": "ילד", "birth_date": "2016-05-01"}]');
reset role;
select t.check('the team manager is told of a parent request', exists (select 1 from notifications
  where user_id = t.id('JM') and email and title = 'בקשת הצטרפות חדשה'));
set role authenticated;
select t.as_user('JM');
select decide_join_request(t.id('jreq2'), true);
insert into t.ctx select 'jkid', (select player_id from team_players where team_id = t.id('JT') limit 1);
insert into t.ctx select 'jev', create_event(t.id('JT'), t.lk('event_type', 'match'), 'משחק', now() + interval '2 days');
select set_event_transport(t.id('jev'), true);
select t.as_user('JP');
select set_transport_seats(t.id('jev'), 0, t.id('jkid'));
select t.check('a parent says "not interested" (0 seats)', (select seats from event_transport_list(t.id('jev')) where player_id = t.id('jkid')) = 0);
select set_transport_seats(t.id('jev'), 3, t.id('jkid'));
select t.check('a parent sets the number of passengers', event_transport_total(t.id('jev')) = 3);
select t.as_user('JO');
select t.denied('an outsider cannot set seats', $$select set_transport_seats(t.id('jev'), 1, t.id('jkid'))$$);
reset role;

-- ---------------------------------------------------------------- summary
reset role;
select case when count(*) filter (where not ok) = 0
            then 'ALL ' || count(*) || ' CHECKS PASSED'
            else count(*) filter (where not ok) || ' OF ' || count(*) || ' CHECKS FAILED' end as summary
from t.res;
select label as failed from t.res where not ok;
