-- Next Team: a join request names the staff type asked for (coach or team manager), and the people who decide
-- a join request also get it by email. Notifications marked email = true are posted to the send-email Edge
-- Function, which sends them through Brevo. One-time setup per project (the URL is project specific), in the
-- SQL editor:
--   select vault.create_secret('https://<project>.supabase.co/functions/v1/send-email', 'email_hook_url');
-- The hook reuses push_hook_secret (0025). The function needs the secrets BREVO_API_KEY, MAIL_FROM (a sender
-- verified in Brevo) and APP_URL (the site, for the link in the email). Without them notifications stay in-app.

alter table join_requests add column staff_role_id uuid references lookups (id);
alter table notifications add column email boolean not null default false;

drop function notify(uuid[], text, text, text);
create function notify(p_users uuid[], p_title text, p_body text, p_url text, p_email boolean default false)
returns void
language sql security definer set search_path = public as $$
  insert into notifications (user_id, title, body, url, email)
  select distinct u, p_title, coalesce(p_body, ''), coalesce(p_url, '/'), coalesce(p_email, false)
  from unnest(p_users) u where u is not null
$$;

-- p_staff_role: for a staff request, the staff type asked for (list staff_role, e.g. head coach, team manager).
drop function submit_join_request(text, text, text, text, jsonb);
create function submit_join_request(p_code text, p_role text, p_full_name text, p_phone text default null,
  p_children jsonb default '[]', p_staff_role uuid default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := require_auth();
  v_team uuid;
  v_children jsonb := '[]';
  v_phone text := norm_phone(p_phone);
  c jsonb;
  v_birth date;
  v_id uuid;
  v_as text;
begin
  select l.team_id into v_team from join_links l where l.code = p_code and l.active;
  if v_team is null then raise exception 'this link is no longer active' using errcode = 'P0002'; end if;
  if p_role not in ('coach', 'parent') then raise exception 'role must be coach or parent' using errcode = '22023'; end if;
  if length(btrim(coalesce(p_full_name, ''))) = 0 then raise exception 'a name is required' using errcode = '22023'; end if;
  if can_manage_team(v_team) then raise exception 'you are already on the team staff' using errcode = '22023'; end if;
  if p_role = 'coach' and is_team_member(v_team) then
    raise exception 'you are already on this team' using errcode = '22023';
  end if;
  if p_role = 'coach' and p_staff_role is not null and not lookup_in_domain(p_staff_role, 'staff_role') then
    raise exception 'unknown staff type' using errcode = '22023';
  end if;
  if exists (select 1 from join_requests where team_id = v_team and user_id = v_uid and status = 'pending') then
    raise exception 'a request is already waiting for approval' using errcode = '22023';
  end if;
  if v_phone is not null and exists (select 1 from profiles where phone = v_phone and id <> v_uid) then
    raise exception 'this phone number belongs to another account' using errcode = '23505';
  end if;

  if p_role = 'parent' then
    if jsonb_typeof(p_children) <> 'array' or jsonb_array_length(p_children) not between 1 and 6 then
      raise exception 'list one to six children' using errcode = '22023';
    end if;
    for c in select * from jsonb_array_elements(p_children) loop
      if length(btrim(coalesce(c ->> 'full_name', ''))) = 0 then
        raise exception 'every child needs a name' using errcode = '22023';
      end if;
      begin
        v_birth := (c ->> 'birth_date')::date;
      exception when others then
        raise exception 'invalid birth date' using errcode = '22023';
      end;
      if v_birth is null or v_birth > current_date or v_birth < current_date - interval '25 years' then
        raise exception 'invalid birth date' using errcode = '22023';
      end if;
      if nullif(btrim(coalesce(c ->> 'email', '')), '') is not null and norm_email(c ->> 'email') is null then
        raise exception 'invalid child email' using errcode = '22023';
      end if;
      if norm_email(c ->> 'email') = (select email from profiles where id = v_uid) then
        raise exception 'a child needs their own email, not the parent''s' using errcode = '22023';
      end if;
      v_children := v_children || jsonb_build_object(
        'full_name', btrim(c ->> 'full_name'), 'birth_date', v_birth,
        'email', norm_email(c ->> 'email'), 'phone', norm_phone(c ->> 'phone'));
    end loop;
  end if;

  update profiles set full_name = btrim(p_full_name), phone = coalesce(v_phone, phone) where id = v_uid;
  insert into join_requests (team_id, user_id, role, full_name, phone, children, staff_role_id)
  values (v_team, v_uid, p_role, btrim(p_full_name), v_phone, v_children,
          case when p_role = 'coach' then p_staff_role end)
  returning id into v_id;

  v_as := case when p_role = 'parent' then 'הורה'
               else coalesce((select name_he from lookups where id = p_staff_role), 'מאמן') end;
  perform notify(join_deciders(v_team, p_role), 'בקשת הצטרפות חדשה',
    btrim(p_full_name) || ' מבקש/ת להצטרף כ' || v_as || ' לקבוצה ' || (select name from teams where id = v_team),
    '/requests', true);
  return v_id;
end $$;

-- As in 0023; an approved staff member gets the staff type they asked for unless the decider picks another.
create or replace function decide_join_request(p_request uuid, p_approve boolean, p_matches jsonb default '{}',
  p_staff_role uuid default null) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := require_auth();
  r join_requests;
  v_club uuid;
  c jsonb;
  i int := 0;
  v_player uuid;
  v_staff uuid;
begin
  select * into r from join_requests where id = p_request for update;
  if not found or r.status <> 'pending' then raise exception 'no pending request' using errcode = 'P0002'; end if;
  if not can_decide_join(r.team_id, r.role) then raise exception 'not allowed' using errcode = '42501'; end if;
  select club_id into v_club from teams where id = r.team_id;

  if p_approve then
    if r.role = 'coach' then
      v_staff := coalesce(p_staff_role, r.staff_role_id);
      if v_staff is not null and not lookup_in_domain(v_staff, 'staff_role') then
        raise exception 'unknown staff type' using errcode = '22023';
      end if;
      insert into memberships (user_id, club_id, team_id, role, staff_role_id)
      values (r.user_id, v_club, r.team_id, 'coach', v_staff) on conflict do nothing;
    else
      for c in select * from jsonb_array_elements(r.children) loop
        v_player := nullif(coalesce(p_matches, '{}') ->> i::text, '')::uuid;
        if v_player is not null then
          if not exists (select 1 from team_players where team_id = r.team_id and player_id = v_player) then
            raise exception 'matched player is not on this team' using errcode = '22023';
          end if;
        else
          insert into players (club_id, full_name, birth_date, phone, created_by)
          values (v_club, c ->> 'full_name', (c ->> 'birth_date')::date, c ->> 'phone', v_uid)
          returning id into v_player;
          insert into team_players (team_id, player_id) values (r.team_id, v_player);
        end if;
        insert into guardianships (parent_id, player_id, requested_by, status, approved_by)
        values (r.user_id, v_player, r.user_id, 'approved', v_uid)
        on conflict (parent_id, player_id) do update set status = 'approved', approved_by = v_uid;
        if c ->> 'email' is not null
           and not exists (select 1 from players where id = v_player and user_id is not null) then
          begin
            perform link_player_email(v_player, c ->> 'email');
          exception when unique_violation then null;
          end;
        end if;
        i := i + 1;
      end loop;
    end if;
  end if;

  update join_requests set status = case when p_approve then 'approved' else 'rejected' end,
         decided_by = v_uid, decided_at = now()
   where id = p_request;

  perform notify(array[r.user_id],
    case when p_approve then 'הבקשה שלך אושרה' else 'הבקשה שלך נדחתה' end,
    case when p_approve then 'אפשר להיכנס לקבוצה ' else 'הבקשה להצטרף לקבוצה ' end
      || (select name from teams where id = r.team_id) || case when p_approve then '' else ' לא אושרה' end,
    '/', true);
end $$;

drop function pending_join_requests();
create function pending_join_requests()
returns table (id uuid, team_id uuid, team_name text, role text, staff_role_id uuid, full_name text, email text,
               phone text, avatar_path text, children jsonb, created_at timestamptz)
language sql stable security definer set search_path = public as $$
  select r.id, r.team_id, t.name, r.role, r.staff_role_id, r.full_name, pr.email, r.phone, pr.avatar_path,
         r.children, r.created_at
  from join_requests r join teams t on t.id = r.team_id join profiles pr on pr.id = r.user_id
  where r.status = 'pending' and can_decide_join(r.team_id, r.role)
  order by r.created_at
$$;

create function email_notification() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_url text; v_secret text;
begin
  if to_regnamespace('net') is null or to_regclass('vault.decrypted_secrets') is null then return new; end if;
  execute 'select max(decrypted_secret) filter (where name = ''email_hook_url''),
                  max(decrypted_secret) filter (where name = ''push_hook_secret'')
             from vault.decrypted_secrets where name in (''email_hook_url'', ''push_hook_secret'')'
    into v_url, v_secret;
  if v_url is null or v_secret is null then return new; end if;
  execute 'select net.http_post(url := $1, body := $2, headers := $3)'
    using v_url, jsonb_build_object('id', new.id),
          jsonb_build_object('Content-Type', 'application/json', 'x-hook-secret', v_secret);
  return new;
exception when others then
  raise warning 'email hook failed: %', sqlerrm;
  return new;
end $$;
create trigger notifications_email after insert on notifications
  for each row when (new.email) execute function email_notification();

-- For the send-email function only (service role): the notification, its recipient's address and the hook secret.
create function notification_email(p_id uuid)
returns table (email text, full_name text, title text, body text, url text, hook_secret text)
language plpgsql stable security definer set search_path = public as $$
begin
  return query
  select pr.email, pr.full_name, n.title, n.body, n.url, (select hook_secret from push_config())
  from notifications n join profiles pr on pr.id = n.user_id
  where n.id = p_id and n.email;
end $$;

revoke execute on function notify(uuid[], text, text, text, boolean),
  submit_join_request(text, text, text, text, jsonb, uuid), pending_join_requests(), email_notification(),
  notification_email(uuid)
from public, anon;
grant execute on function submit_join_request(text, text, text, text, jsonb, uuid), pending_join_requests()
to authenticated;
revoke execute on function notify(uuid[], text, text, text, boolean), email_notification(), notification_email(uuid)
from authenticated;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function notification_email(uuid) to service_role;
  end if;
end $$;

-- A notification to yourself, to try push (and email) on this device.
create function send_test_notification() returns void
language plpgsql security definer set search_path = public as $$
declare v_uid uuid := require_auth();
begin
  perform notify(array[v_uid], 'התראת ניסיון', 'אם אתם רואים את זה, ההתראות עובדות במכשיר הזה.', '/', false);
end $$;
revoke execute on function send_test_notification() from public, anon;
grant execute on function send_test_notification() to authenticated;
