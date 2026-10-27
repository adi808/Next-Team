-- Next Team: identity moves from phone to email (login with Google or an emailed code; SMS costs money).
-- Invites, parent links and player accounts are now addressed by email. Phone columns stay, unused for login.

create function norm_email(p text) returns text
language sql immutable set search_path = '' as $$
  select case when btrim(coalesce(p, '')) ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then lower(btrim(p)) end
$$;

alter table profiles add column email text unique;
update profiles p set email = norm_email(u.email) from auth.users u where u.id = p.id;

alter table invites add column email text;
alter table invites alter column phone drop not null;
alter table invites add check (phone is not null or email is not null);
create index invites_email_idx on invites (email) where status = 'pending';

-- Claim pending invites for a new user by email.
drop function claim_invites(uuid, text);
create function claim_invites(p_user uuid, p_email text) returns void
language plpgsql security definer set search_path = public as $$
declare r invites;
begin
  for r in select * from invites where email = p_email and status = 'pending' loop
    if r.role in ('club_admin', 'coach') then
      insert into memberships (user_id, club_id, team_id, role)
      values (p_user, r.club_id, r.team_id, r.role) on conflict do nothing;
    elsif r.role = 'player' then
      update players set user_id = p_user
       where id = r.player_id and user_id is null
         and not exists (select 1 from players where user_id = p_user);
    elsif r.role = 'parent' then
      insert into guardianships (parent_id, player_id, requested_by, status, approved_by)
      values (p_user, r.player_id, r.invited_by, 'approved', r.invited_by)
      on conflict do nothing;
    end if;
    update invites set status = 'claimed' where id = r.id;
  end loop;
end $$;

-- New auth user (Google or email code) -> profile (name from Google when present) -> claim invites.
create or replace function handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_email text := norm_email(new.email);
begin
  insert into profiles (id, phone, email, full_name)
  values (new.id, norm_phone(new.phone), v_email,
          coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name', ''));
  if v_email is not null then
    perform claim_invites(new.id, v_email);
  end if;
  return new;
end $$;

-- Staff invites (club admin / coach) by email.
drop function invite_by_phone(text, uuid, uuid, app_role);
create function invite_by_email(p_email text, p_club uuid, p_team uuid, p_role app_role)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := require_auth();
  v_email text := norm_email(p_email);
  v_target uuid;
  v_invite uuid;
begin
  if v_email is null then
    raise exception 'invalid email' using errcode = '22023';
  end if;
  if p_role not in ('club_admin', 'coach') then
    raise exception 'use add_player / invite_parent for players and parents' using errcode = '22023';
  end if;
  if p_role = 'club_admin' and p_team is not null then
    raise exception 'club_admin has no team' using errcode = '22023';
  end if;
  if p_role = 'coach' and (p_team is null
      or not exists (select 1 from teams where id = p_team and club_id = p_club)) then
    raise exception 'team does not belong to club' using errcode = '22023';
  end if;
  if not is_club_admin(p_club) then
    raise exception 'only a club admin can invite staff' using errcode = '42501';
  end if;

  insert into invites (email, club_id, team_id, role, invited_by)
  values (v_email, p_club, p_team, p_role, v_uid) returning id into v_invite;

  select id into v_target from profiles where email = v_email;
  if v_target is not null then
    insert into memberships (user_id, club_id, team_id, role)
    values (v_target, p_club, p_team, p_role) on conflict do nothing;
    update invites set status = 'claimed' where id = v_invite;
  end if;
  return v_invite;
end $$;

drop function create_club(text, text);
create function create_club(p_name text, p_admin_email text default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_uid uuid := require_auth(); v_club uuid;
begin
  if not is_system_admin() then
    raise exception 'only a system admin can create clubs' using errcode = '42501';
  end if;
  insert into clubs (name, created_by) values (btrim(p_name), v_uid) returning id into v_club;
  if p_admin_email is not null and btrim(p_admin_email) <> '' then
    perform invite_by_email(p_admin_email, v_club, null, 'club_admin');
  end if;
  return v_club;
end $$;

-- Give a player their own account (by email): link now if the user exists, otherwise invite.
drop function link_player_phone(uuid, text);
create function link_player_email(p_player uuid, p_email text) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := require_auth();
  v_email text := norm_email(p_email);
  v_target uuid;
  v_club uuid;
begin
  if v_email is null then raise exception 'invalid email' using errcode = '22023'; end if;
  if not (can_manage_player(p_player) or is_parent_of(p_player)) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  select club_id into v_club from players where id = p_player;
  select id into v_target from profiles where email = v_email;
  if v_target is not null then
    if exists (select 1 from players where user_id = v_target and id <> p_player) then
      raise exception 'this email already belongs to another player' using errcode = '23505';
    end if;
    update players set user_id = v_target where id = p_player;
  else
    insert into invites (email, club_id, role, invited_by, player_id)
    values (v_email, v_club, 'player', v_uid, p_player);
  end if;
end $$;

drop function invite_parent(uuid, text);
create function invite_parent(p_player uuid, p_email text) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := require_auth();
  v_email text := norm_email(p_email);
  v_target uuid;
begin
  if v_email is null then raise exception 'invalid email' using errcode = '22023'; end if;
  if not can_manage_player(p_player) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  select id into v_target from profiles where email = v_email;
  if v_target is not null then
    insert into guardianships (parent_id, player_id, requested_by, status, approved_by)
    values (v_target, p_player, v_uid, 'approved', v_uid)
    on conflict (parent_id, player_id) do update set status = 'approved', approved_by = v_uid;
  else
    insert into invites (email, club_id, role, invited_by, player_id)
    select v_email, club_id, 'parent', v_uid, p_player from players where id = p_player;
  end if;
end $$;

drop function add_player(uuid, text, date, text, text);
create function add_player(p_team uuid, p_full_name text, p_birth_date date,
                           p_email text default null, p_parent_email text default null)
returns uuid
language plpgsql security definer set search_path = public as $$
declare v_uid uuid := require_auth(); v_club uuid; v_player uuid;
begin
  select club_id into v_club from teams where id = p_team;
  if v_club is null then raise exception 'team not found' using errcode = 'P0002'; end if;
  if not can_manage_team(p_team) then
    raise exception 'only the coach or club admin can add players' using errcode = '42501';
  end if;
  insert into players (club_id, full_name, birth_date, created_by)
  values (v_club, btrim(p_full_name), p_birth_date, v_uid) returning id into v_player;
  insert into team_players (team_id, player_id) values (p_team, v_player);
  if p_email is not null and btrim(p_email) <> '' then perform link_player_email(v_player, p_email); end if;
  if p_parent_email is not null and btrim(p_parent_email) <> '' then perform invite_parent(v_player, p_parent_email); end if;
  return v_player;
end $$;

-- Either side starts the parent link by the other's email; the player's coach approves.
drop function request_guardianship(text, boolean);
create function request_guardianship(p_other_email text, p_as_parent boolean)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := require_auth();
  v_other uuid;
  v_player uuid;
  v_parent uuid;
  v_id uuid;
begin
  select id into v_other from profiles where email = norm_email(p_other_email);
  if v_other is null then raise exception 'no user with this email' using errcode = 'P0002'; end if;
  if v_other = v_uid then raise exception 'cannot link to yourself' using errcode = '22023'; end if;
  if p_as_parent then
    v_parent := v_uid;
    select id into v_player from players where user_id = v_other;
  else
    v_parent := v_other;
    select id into v_player from players where user_id = v_uid;
  end if;
  if v_player is null then
    raise exception 'the player side has no player profile' using errcode = 'P0002';
  end if;
  insert into guardianships (parent_id, player_id, requested_by)
  values (v_parent, v_player, v_uid) returning id into v_id;
  return v_id;
end $$;

revoke execute on function
  norm_email(text), claim_invites(uuid, text), invite_by_email(text, uuid, uuid, app_role),
  create_club(text, text), link_player_email(uuid, text), invite_parent(uuid, text),
  add_player(uuid, text, date, text, text), request_guardianship(text, boolean)
from public, anon;
grant execute on function
  norm_email(text), invite_by_email(text, uuid, uuid, app_role), create_club(text, text),
  link_player_email(uuid, text), invite_parent(uuid, text),
  add_player(uuid, text, date, text, text), request_guardianship(text, boolean)
to authenticated;
