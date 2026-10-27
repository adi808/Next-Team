-- Next Team C1: RPCs (all writes to clubs/teams/memberships/invites/guardianships go through here)

create function require_auth() returns uuid
language plpgsql stable as $$
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  return auth.uid();
end $$;

-- System admin creates a club and may assign its first club admin by phone.
create function create_club(p_name text, p_admin_phone text default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_uid uuid := require_auth(); v_club uuid;
begin
  if not is_system_admin() then
    raise exception 'only a system admin can create clubs' using errcode = '42501';
  end if;
  insert into clubs (name, created_by) values (btrim(p_name), v_uid) returning id into v_club;
  if p_admin_phone is not null then
    perform invite_by_phone(p_admin_phone, v_club, null, 'club_admin');
  end if;
  return v_club;
end $$;

create function create_team(p_club uuid, p_name text) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_team uuid;
begin
  perform require_auth();
  if not is_club_admin(p_club) then
    raise exception 'only a club admin can create teams' using errcode = '42501';
  end if;
  insert into teams (club_id, name) values (p_club, btrim(p_name)) returning id into v_team;
  return v_team;
end $$;

-- Club admin: any role in the club. Coach: players/parents of own team only.
create function invite_by_phone(p_phone text, p_club uuid, p_team uuid, p_role app_role)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := require_auth();
  v_phone text := norm_phone(p_phone);
  v_target uuid;
  v_invite uuid;
begin
  if v_phone is null then
    raise exception 'invalid phone' using errcode = '22023';
  end if;
  if p_role = 'club_admin' then
    if p_team is not null then raise exception 'club_admin has no team' using errcode = '22023'; end if;
  else
    if p_team is null or not exists (select 1 from teams where id = p_team and club_id = p_club) then
      raise exception 'team does not belong to club' using errcode = '22023';
    end if;
  end if;

  if not is_club_admin(p_club)
     and not (p_role in ('player', 'parent') and is_team_coach(p_team)) then
    raise exception 'not allowed to invite this role' using errcode = '42501';
  end if;

  insert into invites (phone, club_id, team_id, role, invited_by)
  values (v_phone, p_club, p_team, p_role, v_uid) returning id into v_invite;

  -- Existing user: grant immediately.
  select id into v_target from profiles where phone = v_phone;
  if v_target is not null then
    insert into memberships (user_id, club_id, team_id, role)
    values (v_target, p_club, p_team, p_role) on conflict do nothing;
    update invites set status = 'claimed' where id = v_invite;
  end if;
  return v_invite;
end $$;

-- Either side starts the link by the other's phone; p_as_parent says what the caller is.
create function request_guardianship(p_other_phone text, p_as_parent boolean) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := require_auth();
  v_other uuid;
  v_id uuid;
begin
  select id into v_other from profiles where phone = norm_phone(p_other_phone);
  if v_other is null then
    raise exception 'no user with this phone' using errcode = 'P0002';
  end if;
  if v_other = v_uid then
    raise exception 'cannot link to yourself' using errcode = '22023';
  end if;
  insert into guardianships (parent_id, child_id, requested_by)
  values (case when p_as_parent then v_uid else v_other end,
          case when p_as_parent then v_other else v_uid end, v_uid)
  returning id into v_id;
  return v_id;
end $$;

-- Only a coach of the child's team approves or rejects.
create function respond_guardianship(p_id uuid, p_approve boolean) returns void
language plpgsql security definer set search_path = public as $$
declare v_uid uuid := require_auth(); v_child uuid;
begin
  select child_id into v_child from guardianships where id = p_id and status = 'pending';
  if v_child is null then
    raise exception 'no pending request' using errcode = 'P0002';
  end if;
  if not coaches_child(v_child) then
    raise exception 'only the child''s coach can respond' using errcode = '42501';
  end if;
  update guardianships
     set status = case when p_approve then 'approved'::link_status else 'rejected'::link_status end,
         approved_by = v_uid
   where id = p_id;
end $$;

-- security invoker: the messages RLS insert policy does the permission check.
create function post_message(p_team uuid, p_body text) returns uuid
language plpgsql security invoker set search_path = public as $$
declare v_id uuid;
begin
  insert into messages (team_id, author_id, body) values (p_team, auth.uid(), p_body)
  returning id into v_id;
  return v_id;
end $$;

revoke execute on all functions in schema public from public, anon;
grant execute on function
  is_system_admin(), is_club_admin(uuid), is_club_member(uuid), is_team_coach(uuid),
  is_team_member(uuid), coaches_child(uuid), shares_club(uuid), norm_phone(text),
  create_club(text, text), create_team(uuid, text),
  invite_by_phone(text, uuid, uuid, app_role),
  request_guardianship(text, boolean), respond_guardianship(uuid, boolean),
  post_message(uuid, text)
to authenticated;
