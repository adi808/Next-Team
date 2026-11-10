-- Next Team: a choice question can also offer "other" with free text.
-- The answer is a survey_answers row with no option and the text (the table already allows that shape).

alter table survey_questions add column allow_other boolean not null default false;

-- p_questions: [{"text": "...", "kind": "single|multi|text", "options": ["a", "b"], "allow_other": true}]
create or replace function create_survey(p_team uuid, p_title text, p_description text default '',
  p_closes timestamptz default null, p_questions jsonb default '[]') returns uuid
language plpgsql security definer set search_path = public as $$
declare v_uid uuid := require_auth(); v_survey uuid; v_q uuid; q jsonb; o jsonb; i int := 0; j int; v_kind text;
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
    v_kind := coalesce(q ->> 'kind', 'single');
    insert into survey_questions (survey_id, text, kind, position, allow_other)
    values (v_survey, q ->> 'text', v_kind, i, v_kind <> 'text' and coalesce((q ->> 'allow_other')::boolean, false))
    returning id into v_q;
    j := 0;
    if v_kind <> 'text' then
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

-- p_answers: [{"question_id": "...", "option_ids": ["..."], "other": "...", "text": "..."}]. Replaces earlier answers.
-- "other" is the free text of a choice question that allows it; on a single-choice question it replaces an option.
create or replace function submit_survey(p_survey uuid, p_answers jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare v_uid uuid := require_auth(); v_team uuid := survey_team(p_survey); a jsonb; v_q survey_questions; v_opt text;
  v_closes timestamptz; v_other text; v_count int;
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
      v_other := nullif(btrim(coalesce(a ->> 'other', '')), '');
      if v_other is not null and not v_q.allow_other then
        raise exception 'this question has no "other" answer' using errcode = '22023';
      end if;
      v_count := jsonb_array_length(coalesce(a -> 'option_ids', '[]')) + (v_other is not null)::int;
      if v_q.kind = 'single' and v_count > 1 then
        raise exception 'only one option allowed' using errcode = '22023';
      end if;
      for v_opt in select jsonb_array_elements_text(coalesce(a -> 'option_ids', '[]')) loop
        if not exists (select 1 from survey_options where id = v_opt::uuid and question_id = v_q.id) then
          raise exception 'unknown option' using errcode = '22023';
        end if;
        insert into survey_answers (question_id, respondent_id, option_id) values (v_q.id, v_uid, v_opt::uuid);
      end loop;
      if v_other is not null then
        insert into survey_answers (question_id, respondent_id, text_answer) values (v_q.id, v_uid, v_other);
      end if;
    end if;
  end loop;
end $$;
