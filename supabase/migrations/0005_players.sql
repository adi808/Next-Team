-- Next Team: players as first-class entities.
-- A player may have no phone/account (a young child): then the parent manages the profile.
-- Staff (club admin, coach) stay in `memberships`; players and parents are derived from
-- team_players, players.user_id and guardianships.

create table players (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references clubs (id) on delete cascade,
  full_name text not null check (length(btrim(full_name)) > 0),
  birth_date date not null check (birth_date > date '1900-01-01' and birth_date <= current_date),
  photo_path text,
  photo_consent boolean not null default false,
  photo_consent_by uuid references profiles (id),
  photo_consent_at timestamptz,
  user_id uuid unique references profiles (id) on delete set null,
  created_by uuid references profiles (id),
  created_at timestamptz not null default now()
);
create index players_club_idx on players (club_id);

create table team_players (
  team_id uuid not null references teams (id) on delete cascade,
  player_id uuid not null references players (id) on delete cascade,
  joined_at timestamptz not null default now(),
  primary key (team_id, player_id)
);
create index team_players_player_idx on team_players (player_id);

create function team_players_same_club() returns trigger
language plpgsql as $$
begin
  if (select club_id from teams where id = new.team_id)
     is distinct from (select club_id from players where id = new.player_id) then
    raise exception 'player and team belong to different clubs' using errcode = '22023';
  end if;
  return new;
end $$;
create trigger team_players_same_club before insert on team_players
  for each row execute function team_players_same_club();

-- Reads go through v_players (hides birth date / photo from non-family); writes through RPCs.
alter table players enable row level security;
revoke all on players from authenticated, anon;

-- guardianship now links a parent profile to a player (who may have no account).
drop policy profiles_select on profiles;
drop policy guardianships_select on guardianships;
alter table guardianships drop column child_id;
alter table guardianships add column player_id uuid not null references players (id) on delete cascade;
alter table guardianships add unique (parent_id, player_id);
drop function coaches_child(uuid);

-- invites can now target a player (own login) or a parent of a player.
alter table invites add column player_id uuid references players (id) on delete cascade;
alter table invites drop constraint invites_check;
alter table invites add check (
  (role = 'club_admin' and team_id is null and player_id is null)
  or (role = 'coach' and team_id is not null)
  or (role in ('player', 'parent') and player_id is not null));

-- ---------------------------------------------------------------- helpers

create function is_club_admin_strict(p_club uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from memberships
                 where user_id = auth.uid() and club_id = p_club and role = 'club_admin')
$$;

create function can_manage_team(p_team uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select is_team_coach(p_team)
      or is_club_admin((select club_id from teams where id = p_team))
$$;

create function is_parent_of(p_player uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from guardianships
                 where parent_id = auth.uid() and player_id = p_player and status = 'approved')
$$;

create function is_self_player(p_player uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from players where id = p_player and user_id = auth.uid())
$$;

create function coaches_player(p_player uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from team_players tp join memberships m on m.team_id = tp.team_id
    where tp.player_id = p_player and m.user_id = auth.uid() and m.role = 'coach')
$$;

create function can_manage_player(p_player uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select is_system_admin()
      or coaches_player(p_player)
      or is_club_admin((select club_id from players where id = p_player))
$$;

create function is_team_parent(p_team uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from team_players tp join guardianships g on g.player_id = tp.player_id
                 where tp.team_id = p_team and g.parent_id = auth.uid() and g.status = 'approved')
$$;

create function is_team_player(p_team uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from team_players tp join players p on p.id = tp.player_id
                 where tp.team_id = p_team and p.user_id = auth.uid())
$$;

create or replace function is_team_member(p_team uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select is_system_admin()
      or exists (select 1 from memberships where user_id = auth.uid() and team_id = p_team)
      or is_club_admin_strict((select club_id from teams where id = p_team))
      or is_team_player(p_team)
      or is_team_parent(p_team)
$$;

-- Parents and players with accounts belong to the club of their player.
create or replace function is_club_member(p_club uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select is_system_admin()
      or exists (select 1 from memberships where user_id = auth.uid() and club_id = p_club)
      or exists (select 1 from players where user_id = auth.uid() and club_id = p_club)
      or exists (select 1 from guardianships g join players p on p.id = g.player_id
                 where g.parent_id = auth.uid() and g.status = 'approved' and p.club_id = p_club)
$$;

create function can_post_team(p_team uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select can_manage_team(p_team) or is_team_parent(p_team)
$$;

create function can_view_player(p_player uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select can_manage_player(p_player) or is_parent_of(p_player) or is_self_player(p_player)
      or exists (select 1 from team_players tp
                 where tp.player_id = p_player and is_team_member(tp.team_id))
$$;

create function player_age(p_player uuid) returns int
language sql stable security definer set search_path = public as $$
  select extract(year from age(birth_date))::int from players where id = p_player
$$;

-- who is in which team (as an account), for name visibility
create view team_people as
  select team_id, user_id as profile_id from memberships where team_id is not null
  union
  select tp.team_id, g.parent_id from team_players tp
    join guardianships g on g.player_id = tp.player_id and g.status = 'approved'
  union
  select tp.team_id, p.user_id from team_players tp
    join players p on p.id = tp.player_id where p.user_id is not null;
revoke all on team_people from authenticated, anon;

create function profile_visible(p_other uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select shares_club(p_other)
      or exists (select 1 from team_people a join team_people b on a.team_id = b.team_id
                 where a.profile_id = auth.uid() and b.profile_id = p_other)
      or exists (select 1 from team_people tp join teams t on t.id = tp.team_id
                 where tp.profile_id = p_other and is_club_admin(t.club_id))
      or exists (select 1 from guardianships g join players p on p.id = g.player_id
                 where (g.parent_id = auth.uid() and p.user_id = p_other)
                    or (p.user_id = auth.uid() and g.parent_id = p_other))
      or exists (select 1 from guardianships g
                 where g.status = 'pending' and g.parent_id = p_other and coaches_player(g.player_id))
$$;

create policy profiles_select on profiles for select using (
  id = auth.uid() or is_system_admin() or profile_visible(id));

-- ---------------------------------------------------------------- views and policies

create view v_players as
  select p.id, p.club_id, p.full_name,
         case when can_manage_player(p.id) or is_parent_of(p.id) or is_self_player(p.id)
              then p.birth_date end as birth_date,
         case when p.photo_consent or can_manage_player(p.id) or is_parent_of(p.id) or is_self_player(p.id)
              then p.photo_path end as photo_path,
         p.photo_consent,
         (p.user_id is not null) as has_account,
         (p.user_id = auth.uid()) as is_me
  from players p
  where can_view_player(p.id);
grant select on v_players to authenticated;

alter table team_players enable row level security;
create policy team_players_select on team_players for select using (is_team_member(team_id));

create policy guardianships_select on guardianships for select using (
  parent_id = auth.uid() or is_self_player(player_id)
  or coaches_player(player_id) or is_system_admin());

-- messages: parents may now write in the team channel (players still only read).
drop policy messages_insert on messages;
create policy messages_insert on messages for insert with check (
  author_id = auth.uid() and can_post_team(team_id));

-- ---------------------------------------------------------------- invites / claim

create or replace function claim_invites(p_user uuid, p_phone text) returns void
language plpgsql security definer set search_path = public as $$
declare r invites;
begin
  for r in select * from invites where phone = p_phone and status = 'pending' loop
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

-- Staff invitations only (club_admin / coach). Players and parents have their own RPCs below.
create or replace function invite_by_phone(p_phone text, p_club uuid, p_team uuid, p_role app_role)
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

  insert into invites (phone, club_id, team_id, role, invited_by)
  values (v_phone, p_club, p_team, p_role, v_uid) returning id into v_invite;

  select id into v_target from profiles where phone = v_phone;
  if v_target is not null then
    insert into memberships (user_id, club_id, team_id, role)
    values (v_target, p_club, p_team, p_role) on conflict do nothing;
    update invites set status = 'claimed' where id = v_invite;
  end if;
  return v_invite;
end $$;

-- ---------------------------------------------------------------- player RPCs

-- Give an existing player their own login (by phone). Parent or staff.
create function link_player_phone(p_player uuid, p_phone text) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := require_auth();
  v_phone text := norm_phone(p_phone);
  v_target uuid;
  v_club uuid;
begin
  if v_phone is null then raise exception 'invalid phone' using errcode = '22023'; end if;
  if not (can_manage_player(p_player) or is_parent_of(p_player)) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  select club_id into v_club from players where id = p_player;
  select id into v_target from profiles where phone = v_phone;
  if v_target is not null then
    if exists (select 1 from players where user_id = v_target and id <> p_player) then
      raise exception 'this phone already belongs to another player' using errcode = '23505';
    end if;
    update players set user_id = v_target where id = p_player;
  else
    insert into invites (phone, club_id, role, invited_by, player_id)
    values (v_phone, v_club, 'player', v_uid, p_player);
  end if;
end $$;

-- Staff connect a parent directly: the link is approved at once (the coach is the approver).
create function invite_parent(p_player uuid, p_phone text) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := require_auth();
  v_phone text := norm_phone(p_phone);
  v_target uuid;
begin
  if v_phone is null then raise exception 'invalid phone' using errcode = '22023'; end if;
  if not can_manage_player(p_player) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  select id into v_target from profiles where phone = v_phone;
  if v_target is not null then
    insert into guardianships (parent_id, player_id, requested_by, status, approved_by)
    values (v_target, p_player, v_uid, 'approved', v_uid)
    on conflict (parent_id, player_id) do update set status = 'approved', approved_by = v_uid;
  else
    insert into invites (phone, club_id, role, invited_by, player_id)
    select v_phone, club_id, 'parent', v_uid, p_player from players where id = p_player;
  end if;
end $$;

create function add_player(p_team uuid, p_full_name text, p_birth_date date,
                           p_phone text default null, p_parent_phone text default null)
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
  if p_phone is not null and btrim(p_phone) <> '' then perform link_player_phone(v_player, p_phone); end if;
  if p_parent_phone is not null and btrim(p_parent_phone) <> '' then perform invite_parent(v_player, p_parent_phone); end if;
  return v_player;
end $$;

create function add_player_to_team(p_team uuid, p_player uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform require_auth();
  if not can_manage_team(p_team) then raise exception 'not allowed' using errcode = '42501'; end if;
  insert into team_players (team_id, player_id) values (p_team, p_player) on conflict do nothing;
end $$;

create function remove_player_from_team(p_team uuid, p_player uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform require_auth();
  if not can_manage_team(p_team) then raise exception 'not allowed' using errcode = '42501'; end if;
  delete from team_players where team_id = p_team and player_id = p_player;
end $$;

create function update_player(p_player uuid, p_full_name text default null,
                              p_birth_date date default null, p_photo_path text default null)
returns void
language plpgsql security definer set search_path = public as $$
begin
  perform require_auth();
  if not (can_manage_player(p_player) or is_parent_of(p_player)) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  update players set
    full_name = coalesce(nullif(btrim(p_full_name), ''), full_name),
    birth_date = coalesce(p_birth_date, birth_date),
    photo_path = coalesce(p_photo_path, photo_path)
  where id = p_player;
end $$;

-- Only a parent can consent to showing the child's photo to the team.
create function set_photo_consent(p_player uuid, p_consent boolean) returns void
language plpgsql security definer set search_path = public as $$
declare v_uid uuid := require_auth();
begin
  if not is_parent_of(p_player) then
    raise exception 'only a parent can set photo consent' using errcode = '42501';
  end if;
  update players set photo_consent = p_consent,
         photo_consent_by = v_uid, photo_consent_at = now()
   where id = p_player;
end $$;

-- A parent or the child asks to be linked by the other side's phone; the coach approves.
create or replace function request_guardianship(p_other_phone text, p_as_parent boolean)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := require_auth();
  v_other uuid;
  v_player uuid;
  v_parent uuid;
  v_id uuid;
begin
  select id into v_other from profiles where phone = norm_phone(p_other_phone);
  if v_other is null then raise exception 'no user with this phone' using errcode = 'P0002'; end if;
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

create or replace function respond_guardianship(p_id uuid, p_approve boolean) returns void
language plpgsql security definer set search_path = public as $$
declare v_uid uuid := require_auth(); v_player uuid;
begin
  select player_id into v_player from guardianships where id = p_id and status = 'pending';
  if v_player is null then raise exception 'no pending request' using errcode = 'P0002'; end if;
  if not coaches_player(v_player) then
    raise exception 'only the player''s coach can respond' using errcode = '42501';
  end if;
  update guardianships
     set status = case when p_approve then 'approved'::link_status else 'rejected'::link_status end,
         approved_by = v_uid
   where id = p_id;
end $$;
