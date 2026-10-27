-- Next Team: coach tasks, surveys, personal chat.

-- ---------------------------------------------------------------- tasks
create table tasks (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references teams (id) on delete cascade,
  title text not null check (length(btrim(title)) > 0),
  description text not null default '',
  due_at timestamptz,
  created_by uuid references profiles (id),
  created_at timestamptz not null default now()
);
create index tasks_team_idx on tasks (team_id);

-- One row per assignee: the player themself ('player') or the player's parents ('parent').
create table task_assignments (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references tasks (id) on delete cascade,
  player_id uuid not null references players (id) on delete cascade,
  kind text not null check (kind in ('player', 'parent')),
  done_at timestamptz,
  done_by uuid references profiles (id),
  unique (task_id, player_id, kind)
);
create index task_assignments_player_idx on task_assignments (player_id);

create function task_team(p_task uuid) returns uuid
language sql stable security definer set search_path = public as $$
  select team_id from tasks where id = p_task
$$;

create function player_has_account(p_player uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from players where id = p_player and user_id is not null)
$$;

-- Everyone sees only what is assigned to them. A parent also sees (and can tick) a task of a
-- child who has no account of their own, since the parent manages that profile.
create function can_see_assignment(p_task uuid, p_player uuid, p_kind text) returns boolean
language sql stable security definer set search_path = public as $$
  select can_manage_team(task_team(p_task))
      or (p_kind = 'player' and (is_self_player(p_player)
            or (is_parent_of(p_player) and not player_has_account(p_player))))
      or (p_kind = 'parent' and is_parent_of(p_player))
$$;

alter table tasks enable row level security;
alter table task_assignments enable row level security;
create policy tasks_select on tasks for select using (
  can_manage_team(team_id) or exists (select 1 from task_assignments a where a.task_id = tasks.id));
create policy assignments_select on task_assignments for select using (
  can_see_assignment(task_id, player_id, kind));

-- p_player_ids null = the whole squad.
create function create_task(p_team uuid, p_title text, p_description text default '',
  p_due timestamptz default null, p_player_ids uuid[] default null,
  p_for_players boolean default true, p_for_parents boolean default false) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_uid uuid := require_auth(); v_task uuid; v_players uuid[];
begin
  if not can_manage_team(p_team) then
    raise exception 'only the coach or club admin can create tasks' using errcode = '42501';
  end if;
  select coalesce(array_agg(player_id), '{}') into v_players from team_players
   where team_id = p_team and (p_player_ids is null or player_id = any (p_player_ids));
  if cardinality(v_players) = 0 then
    raise exception 'no players selected' using errcode = '22023';
  end if;
  insert into tasks (team_id, title, description, due_at, created_by)
  values (p_team, btrim(p_title), coalesce(p_description, ''), p_due, v_uid) returning id into v_task;
  if p_for_players then
    insert into task_assignments (task_id, player_id, kind)
    select v_task, unnest(v_players), 'player';
  end if;
  if p_for_parents then
    insert into task_assignments (task_id, player_id, kind)
    select v_task, unnest(v_players), 'parent';
  end if;
  return v_task;
end $$;

create function delete_task(p_task uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform require_auth();
  if not can_manage_team(task_team(p_task)) then raise exception 'not allowed' using errcode = '42501'; end if;
  delete from tasks where id = p_task;
end $$;

-- The assignee ticks or unticks their own item.
create function complete_assignment(p_assignment uuid, p_done boolean) returns void
language plpgsql security definer set search_path = public as $$
declare v_uid uuid := require_auth(); a task_assignments;
begin
  select * into a from task_assignments where id = p_assignment;
  if not found then raise exception 'not found' using errcode = 'P0002'; end if;
  if not ((a.kind = 'player' and (is_self_player(a.player_id)
             or (is_parent_of(a.player_id) and not player_has_account(a.player_id))))
          or (a.kind = 'parent' and is_parent_of(a.player_id))) then
    raise exception 'not your task' using errcode = '42501';
  end if;
  update task_assignments set done_at = case when p_done then now() end,
         done_by = case when p_done then v_uid end where id = p_assignment;
end $$;

-- ---------------------------------------------------------------- surveys
create table surveys (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references teams (id) on delete cascade,
  title text not null check (length(btrim(title)) > 0),
  description text not null default '',
  closes_at timestamptz,
  created_by uuid references profiles (id),
  created_at timestamptz not null default now()
);
create table survey_questions (
  id uuid primary key default gen_random_uuid(),
  survey_id uuid not null references surveys (id) on delete cascade,
  text text not null,
  kind text not null check (kind in ('single', 'multi', 'text')),
  position int not null default 0
);
create table survey_options (
  id uuid primary key default gen_random_uuid(),
  question_id uuid not null references survey_questions (id) on delete cascade,
  label text not null,
  position int not null default 0
);
create table survey_answers (
  id uuid primary key default gen_random_uuid(),
  question_id uuid not null references survey_questions (id) on delete cascade,
  respondent_id uuid not null references profiles (id) on delete cascade,
  option_id uuid references survey_options (id) on delete cascade,
  text_answer text,
  answered_at timestamptz not null default now(),
  check ((option_id is null) <> (text_answer is null))
);
create index survey_answers_question_idx on survey_answers (question_id, respondent_id);

create function survey_team(p_survey uuid) returns uuid
language sql stable security definer set search_path = public as $$
  select team_id from surveys where id = p_survey
$$;
create function question_team(p_question uuid) returns uuid
language sql stable security definer set search_path = public as $$
  select s.team_id from survey_questions q join surveys s on s.id = q.survey_id where q.id = p_question
$$;

alter table surveys enable row level security;
alter table survey_questions enable row level security;
alter table survey_options enable row level security;
alter table survey_answers enable row level security;
create policy surveys_select on surveys for select using (is_team_member(team_id));
create policy questions_select on survey_questions for select using (is_team_member(survey_team(survey_id)));
create policy options_select on survey_options for select using (is_team_member(question_team(question_id)));
create policy answers_select on survey_answers for select using (
  respondent_id = auth.uid() or can_manage_team(question_team(question_id)));

-- p_questions: [{"text": "...", "kind": "single|multi|text", "options": ["a", "b"]}]
create function create_survey(p_team uuid, p_title text, p_description text default '',
  p_closes timestamptz default null, p_questions jsonb default '[]') returns uuid
language plpgsql security definer set search_path = public as $$
declare v_uid uuid := require_auth(); v_survey uuid; v_q uuid; q jsonb; o jsonb; i int := 0; j int;
begin
  if not can_manage_team(p_team) then
    raise exception 'only the coach or club admin can create surveys' using errcode = '42501';
  end if;
  if jsonb_typeof(p_questions) <> 'array' or jsonb_array_length(p_questions) = 0 then
    raise exception 'a survey needs at least one question' using errcode = '22023';
  end if;
  insert into surveys (team_id, title, description, closes_at, created_by)
  values (p_team, btrim(p_title), coalesce(p_description, ''), p_closes, v_uid) returning id into v_survey;
  for q in select * from jsonb_array_elements(p_questions) loop
    i := i + 1;
    insert into survey_questions (survey_id, text, kind, position)
    values (v_survey, q ->> 'text', coalesce(q ->> 'kind', 'single'), i) returning id into v_q;
    j := 0;
    if coalesce(q ->> 'kind', 'single') <> 'text' then
      if jsonb_array_length(coalesce(q -> 'options', '[]')) < 2 then
        raise exception 'a choice question needs at least two options' using errcode = '22023';
      end if;
      for o in select * from jsonb_array_elements(q -> 'options') loop
        j := j + 1;
        insert into survey_options (question_id, label, position) values (v_q, o #>> '{}', j);
      end loop;
    end if;
  end loop;
  return v_survey;
end $$;

create function delete_survey(p_survey uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform require_auth();
  if not can_manage_team(survey_team(p_survey)) then raise exception 'not allowed' using errcode = '42501'; end if;
  delete from surveys where id = p_survey;
end $$;

-- p_answers: [{"question_id": "...", "option_ids": ["..."], "text": "..."}]. Replaces earlier answers.
create function submit_survey(p_survey uuid, p_answers jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare v_uid uuid := require_auth(); v_team uuid := survey_team(p_survey); a jsonb; v_q survey_questions; v_opt text; v_closes timestamptz;
begin
  if v_team is null or not is_team_member(v_team) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  select closes_at into v_closes from surveys where id = p_survey;
  if v_closes is not null and v_closes < now() then
    raise exception 'the survey is closed' using errcode = '22023';
  end if;
  delete from survey_answers where respondent_id = v_uid
     and question_id in (select id from survey_questions where survey_id = p_survey);
  for a in select * from jsonb_array_elements(p_answers) loop
    select * into v_q from survey_questions where id = (a ->> 'question_id')::uuid and survey_id = p_survey;
    if not found then raise exception 'unknown question' using errcode = '22023'; end if;
    if v_q.kind = 'text' then
      if coalesce(btrim(a ->> 'text'), '') <> '' then
        insert into survey_answers (question_id, respondent_id, text_answer) values (v_q.id, v_uid, a ->> 'text');
      end if;
    else
      if v_q.kind = 'single' and jsonb_array_length(coalesce(a -> 'option_ids', '[]')) > 1 then
        raise exception 'only one option allowed' using errcode = '22023';
      end if;
      for v_opt in select jsonb_array_elements_text(coalesce(a -> 'option_ids', '[]')) loop
        if not exists (select 1 from survey_options where id = v_opt::uuid and question_id = v_q.id) then
          raise exception 'unknown option' using errcode = '22023';
        end if;
        insert into survey_answers (question_id, respondent_id, option_id) values (v_q.id, v_uid, v_opt::uuid);
      end loop;
    end if;
  end loop;
end $$;

-- ---------------------------------------------------------------- personal chat
-- Coach <-> player conversation. The player's parents see and may write in every conversation
-- about their child. Club admins do NOT see personal conversations.
create table conversations (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references teams (id) on delete cascade,
  player_id uuid not null references players (id) on delete cascade,
  coach_id uuid not null references profiles (id),
  created_at timestamptz not null default now(),
  unique (team_id, player_id, coach_id)
);
create table direct_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references conversations (id) on delete cascade,
  author_id uuid not null references profiles (id),
  body text not null check (length(btrim(body)) between 1 and 2000),
  created_at timestamptz not null default now()
);
create index direct_messages_conv_idx on direct_messages (conversation_id, created_at desc);

create function can_access_conversation(p_conv uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from conversations c
                 where c.id = p_conv
                   and (c.coach_id = auth.uid() or is_parent_of(c.player_id) or is_self_player(c.player_id)))
$$;

alter table conversations enable row level security;
alter table direct_messages enable row level security;
create policy conversations_select on conversations for select using (can_access_conversation(id));
create policy dm_select on direct_messages for select using (can_access_conversation(conversation_id));
create policy dm_insert on direct_messages for insert with check (
  author_id = auth.uid() and can_access_conversation(conversation_id));

create function start_conversation(p_team uuid, p_player uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_uid uuid := require_auth(); v_id uuid;
begin
  if not is_team_coach(p_team) then
    raise exception 'only the team coach can start a personal conversation' using errcode = '42501';
  end if;
  if not exists (select 1 from team_players where team_id = p_team and player_id = p_player) then
    raise exception 'player is not on this team' using errcode = '22023';
  end if;
  insert into conversations (team_id, player_id, coach_id) values (p_team, p_player, v_uid)
  on conflict (team_id, player_id, coach_id) do update set team_id = excluded.team_id
  returning id into v_id;
  return v_id;
end $$;

create function post_direct_message(p_conversation uuid, p_body text) returns uuid
language plpgsql security invoker set search_path = public as $$
declare v_id uuid;
begin
  insert into direct_messages (conversation_id, author_id, body) values (p_conversation, auth.uid(), p_body)
  returning id into v_id;
  return v_id;
end $$;
