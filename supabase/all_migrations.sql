-- Next Team: all migrations in one script (generated from supabase/migrations by scripts/combine-migrations.sh).
-- Paste into Supabase > SQL Editor > New query > Run, once, on a new project.

-- ===== 0001_schema.sql =====
-- Next Team C1: schema

create type app_role as enum ('club_admin', 'coach', 'player', 'parent');
create type link_status as enum ('pending', 'approved', 'rejected');
create type invite_status as enum ('pending', 'claimed', 'cancelled');

-- E.164 with leading '+'; auth.users stores the phone without it.
-- A local Israeli number (leading 0) is converted to +972.
create function norm_phone(p text) returns text
language sql immutable as $$
  select case
    when regexp_replace(coalesce(p, ''), '\D', '', 'g') = '' then null
    when btrim(p) like '+%' then '+' || regexp_replace(p, '\D', '', 'g')
    when regexp_replace(p, '\D', '', 'g') like '0%'
      then '+972' || substr(regexp_replace(p, '\D', '', 'g'), 2)
    else '+' || regexp_replace(p, '\D', '', 'g')
  end
$$;

create table profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  phone text unique,
  full_name text not null default '',
  is_system_admin boolean not null default false,
  created_at timestamptz not null default now()
);

create table clubs (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_by uuid references profiles (id),
  created_at timestamptz not null default now()
);

create table teams (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references clubs (id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now()
);
create index teams_club_idx on teams (club_id);

-- team_id is null for club-level roles (club_admin).
create table memberships (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles (id) on delete cascade,
  club_id uuid not null references clubs (id) on delete cascade,
  team_id uuid references teams (id) on delete cascade,
  role app_role not null,
  created_at timestamptz not null default now(),
  check ((role = 'club_admin') = (team_id is null))
);
create unique index memberships_unique_idx
  on memberships (user_id, club_id, coalesce(team_id, '00000000-0000-0000-0000-000000000000'), role);
create index memberships_team_idx on memberships (team_id);
create index memberships_user_idx on memberships (user_id);

create table invites (
  id uuid primary key default gen_random_uuid(),
  phone text not null,
  club_id uuid not null references clubs (id) on delete cascade,
  team_id uuid references teams (id) on delete cascade,
  role app_role not null,
  invited_by uuid not null references profiles (id),
  status invite_status not null default 'pending',
  created_at timestamptz not null default now(),
  check ((role = 'club_admin') = (team_id is null))
);
create index invites_phone_idx on invites (phone) where status = 'pending';

create table guardianships (
  id uuid primary key default gen_random_uuid(),
  parent_id uuid not null references profiles (id) on delete cascade,
  child_id uuid not null references profiles (id) on delete cascade,
  requested_by uuid not null references profiles (id),
  status link_status not null default 'pending',
  approved_by uuid references profiles (id),
  created_at timestamptz not null default now(),
  unique (parent_id, child_id),
  check (parent_id <> child_id)
);

-- One channel per team (v1).
create table messages (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references teams (id) on delete cascade,
  author_id uuid not null references profiles (id),
  body text not null check (length(btrim(body)) between 1 and 2000),
  created_at timestamptz not null default now()
);
create index messages_team_idx on messages (team_id, created_at desc);

-- Claim pending invites for a user by phone.
create function claim_invites(p_user uuid, p_phone text) returns void
language plpgsql security definer set search_path = public as $$
begin
  insert into memberships (user_id, club_id, team_id, role)
  select p_user, club_id, team_id, role from invites
  where phone = p_phone and status = 'pending'
  on conflict do nothing;
  update invites set status = 'claimed' where phone = p_phone and status = 'pending';
end $$;

-- New auth user -> profile -> claim invites.
create function handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_phone text := norm_phone(new.phone);
begin
  insert into profiles (id, phone) values (new.id, v_phone);
  if v_phone is not null then
    perform claim_invites(new.id, v_phone);
  end if;
  return new;
end $$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();

-- ===== 0002_rls.sql =====
-- Next Team C1: row level security

-- Helpers are security definer so policies can consult memberships without recursion.
create function is_system_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select is_system_admin from profiles where id = auth.uid()), false)
$$;

create function is_club_admin(p_club uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select is_system_admin() or exists (
    select 1 from memberships
    where user_id = auth.uid() and club_id = p_club and role = 'club_admin')
$$;

create function is_club_member(p_club uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select is_system_admin() or exists (
    select 1 from memberships where user_id = auth.uid() and club_id = p_club)
$$;

create function is_team_coach(p_team uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from memberships
    where user_id = auth.uid() and team_id = p_team and role = 'coach')
$$;

-- Members of the team, its club admins, and parents of an approved child on the team.
create function is_team_member(p_team uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select is_system_admin()
    or exists (select 1 from memberships
               where user_id = auth.uid() and team_id = p_team)
    or exists (select 1 from teams t join memberships m
               on m.club_id = t.club_id and m.role = 'club_admin'
               where t.id = p_team and m.user_id = auth.uid())
    or exists (select 1 from guardianships g join memberships c on c.user_id = g.child_id
               where g.parent_id = auth.uid() and g.status = 'approved' and c.team_id = p_team)
$$;

-- True if the caller coaches a team that the given child plays in.
create function coaches_child(p_child uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from memberships c join memberships k on k.team_id = c.team_id
    where c.user_id = auth.uid() and c.role = 'coach' and k.user_id = p_child)
$$;

create function shares_club(p_other uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from memberships a join memberships b on a.club_id = b.club_id
    where a.user_id = auth.uid() and b.user_id = p_other)
$$;

alter table profiles enable row level security;
alter table clubs enable row level security;
alter table teams enable row level security;
alter table memberships enable row level security;
alter table invites enable row level security;
alter table guardianships enable row level security;
alter table messages enable row level security;

-- profiles: users may only edit their own display name.
create policy profiles_select on profiles for select using (
  id = auth.uid() or is_system_admin() or shares_club(id)
  or exists (select 1 from guardianships g
             where (g.parent_id = auth.uid() and g.child_id = profiles.id)
                or (g.child_id = auth.uid() and g.parent_id = profiles.id)));
create policy profiles_update on profiles for update
  using (id = auth.uid()) with check (id = auth.uid());
revoke update on profiles from authenticated, anon;
grant update (full_name) on profiles to authenticated;

-- clubs / teams: read for members; writes via RPC (create) or club admin (edit/delete).
create policy clubs_select on clubs for select using (is_club_member(id));
create policy clubs_update on clubs for update using (is_club_admin(id)) with check (is_club_admin(id));
create policy clubs_delete on clubs for delete using (is_system_admin());

create policy teams_select on teams for select using (is_club_member(club_id));
create policy teams_update on teams for update using (is_club_admin(club_id)) with check (is_club_admin(club_id));
create policy teams_delete on teams for delete using (is_club_admin(club_id));

-- memberships: inserts only through RPCs.
create policy memberships_select on memberships for select using (
  user_id = auth.uid() or is_club_admin(club_id)
  or (team_id is not null and is_team_coach(team_id)));
create policy memberships_delete on memberships for delete using (is_club_admin(club_id));

create policy invites_select on invites for select using (
  invited_by = auth.uid() or is_club_admin(club_id));
create policy invites_update on invites for update
  using (invited_by = auth.uid() or is_club_admin(club_id))
  with check (status = 'cancelled');

create policy guardianships_select on guardianships for select using (
  parent_id = auth.uid() or child_id = auth.uid()
  or coaches_child(child_id) or is_system_admin());

-- messages: team members read; only coaches and club admins post.
create policy messages_select on messages for select using (is_team_member(team_id));
create policy messages_insert on messages for insert with check (
  author_id = auth.uid()
  and (is_team_coach(team_id)
       or is_club_admin((select club_id from teams where id = team_id))));

-- ===== 0003_rpcs.sql =====
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

-- ===== 0004_sports.sql =====
-- Next Team: sports list as a table, each sport with its own icon.
-- icon_path is SVG path data on a 24x24 grid, drawn as an outline (stroke), so the client
-- never injects markup from the database.

create table sports (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9_]+$'),
  name_he text not null,
  icon_path text not null,
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);

alter table sports enable row level security;
create policy sports_select on sports for select to authenticated using (true);
create policy sports_admin on sports for all to authenticated
  using (is_system_admin()) with check (is_system_admin());

insert into sports (slug, name_he, icon_path, sort_order) values
  ('football', 'כדורגל',
   'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zM12 8l3.5 2.5-1.3 4H9.8l-1.3-4zM12 8V2M15.5 10.5l5-1.5M14.2 14.5l3 4M9.8 14.5l-3 4M8.5 10.5l-5-1.5', 1),
  ('basketball', 'כדורסל',
   'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zM12 2v20M2 12h20M5 5c3 3 3 11 0 14M19 5c-3 3-3 11 0 14', 2);

-- Sport belongs to the team (one club can run several sports).
alter table teams add column sport_id uuid references sports (id);
update teams set sport_id = (select id from sports where slug = 'football');
alter table teams alter column sport_id set not null;
create index teams_sport_idx on teams (sport_id);

drop function create_team(uuid, text);
create function create_team(p_club uuid, p_name text, p_sport uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_team uuid;
begin
  perform require_auth();
  if not is_club_admin(p_club) then
    raise exception 'only a club admin can create teams' using errcode = '42501';
  end if;
  insert into teams (club_id, name, sport_id) values (p_club, btrim(p_name), p_sport)
  returning id into v_team;
  return v_team;
end $$;

revoke execute on function create_team(uuid, text, uuid) from public, anon;
grant execute on function create_team(uuid, text, uuid) to authenticated;

-- ===== 0005_players.sql =====
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

-- ===== 0006_catalogs.sql =====
-- Next Team: one generic catalog table for every "choose from a list" value.
-- Domains seeded below: event_type, absence_reason, match_format, formation, stat_type.
-- New lists (or new values) need no code change: add rows. parent_id supports dependent lists
-- (formation depends on match_format). sport_id/club_id scope a value to a sport or a club.

create table lookups (
  id uuid primary key default gen_random_uuid(),
  domain text not null check (domain ~ '^[a-z0-9_]+$'),
  slug text not null check (slug ~ '^[a-z0-9_-]+$'),
  name_he text not null,
  icon_path text,
  parent_id uuid references lookups (id) on delete cascade,
  sport_id uuid references sports (id) on delete cascade,
  club_id uuid references clubs (id) on delete cascade,
  sort_order int not null default 0,
  meta jsonb not null default '{}',
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create unique index lookups_unique_idx on lookups (
  domain, slug,
  coalesce(club_id, '00000000-0000-0000-0000-000000000000'),
  coalesce(sport_id, '00000000-0000-0000-0000-000000000000'));
create index lookups_domain_idx on lookups (domain);

alter table lookups enable row level security;
create policy lookups_select on lookups for select to authenticated
  using (club_id is null or is_club_member(club_id));

-- System admin: any value. Club admin: values of their own club only.
create function upsert_lookup(
  p_id uuid, p_domain text, p_slug text, p_name_he text,
  p_icon_path text default null, p_parent uuid default null, p_sport uuid default null,
  p_club uuid default null, p_sort int default 0, p_meta jsonb default '{}',
  p_active boolean default true) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  perform require_auth();
  if not (is_system_admin() or (p_club is not null and is_club_admin_strict(p_club))) then
    raise exception 'not allowed to manage this list' using errcode = '42501';
  end if;
  if p_id is null then
    insert into lookups (domain, slug, name_he, icon_path, parent_id, sport_id, club_id, sort_order, meta, active)
    values (p_domain, p_slug, p_name_he, p_icon_path, p_parent, p_sport, p_club, p_sort, p_meta, p_active)
    returning id into v_id;
  else
    update lookups set slug = p_slug, name_he = p_name_he, icon_path = p_icon_path,
           parent_id = p_parent, sport_id = p_sport, sort_order = p_sort, meta = p_meta, active = p_active
     where id = p_id
       and (is_system_admin() or club_id = p_club)
    returning id into v_id;
    if v_id is null then raise exception 'value not found or not yours' using errcode = 'P0002'; end if;
  end if;
  return v_id;
end $$;

-- ------------------------------------------------------------------ seeds
insert into lookups (domain, slug, name_he, sort_order, meta) values
  ('event_type', 'training', 'אימון', 1, '{}'),
  ('event_type', 'match', 'משחק', 2, '{"is_match": true}'),
  ('event_type', 'team_building', 'גיבוש', 3, '{}'),
  ('absence_reason', 'illness', 'מחלה', 1, '{}'),
  ('absence_reason', 'injury', 'פציעה', 2, '{}'),
  ('absence_reason', 'vacation', 'חופשה', 3, '{}'),
  ('absence_reason', 'school', 'לימודים', 4, '{}'),
  ('absence_reason', 'family', 'אירוע משפחתי', 5, '{}'),
  ('absence_reason', 'other', 'אחר', 6, '{"note_required": true}');

-- match formats (players on the field), per sport
insert into lookups (domain, slug, name_he, sport_id, sort_order)
select 'match_format', v.slug, v.name_he, s.id, v.sort_order
from (values
  ('football', 'football_11', '11 על 11', 1), ('football', 'football_9', '9 על 9', 2),
  ('football', 'football_7', '7 על 7', 3), ('football', 'football_5', '5 על 5', 4),
  ('basketball', 'basketball_5', '5 על 5', 1), ('basketball', 'basketball_3', '3 על 3', 2)
) as v(sport, slug, name_he, sort_order)
join sports s on s.slug = v.sport;

-- formations, children of a match format
insert into lookups (domain, slug, name_he, parent_id, sport_id, sort_order)
select 'formation', 'f_' || replace(v.name_he, '-', '_') || '_' || v.parent_slug, v.name_he, p.id, p.sport_id, v.sort_order
from (values
  ('football_11', '4-3-3', 1), ('football_11', '4-4-2', 2), ('football_11', '3-5-2', 3), ('football_11', '4-2-3-1', 4),
  ('football_9', '3-3-2', 1), ('football_9', '3-2-3', 2), ('football_9', '2-3-3', 3),
  ('football_7', '2-3-1', 1), ('football_7', '3-2-1', 2), ('football_7', '2-2-2', 3),
  ('football_5', '2-2', 1), ('football_5', '1-2-1', 2)
) as v(parent_slug, name_he, sort_order)
join lookups p on p.domain = 'match_format' and p.slug = v.parent_slug;

-- statistics recorded in a match, per sport
insert into lookups (domain, slug, name_he, sport_id, sort_order, meta)
select 'stat_type', v.slug, v.name_he, s.id, v.sort_order, v.meta::jsonb
from (values
  ('football', 'goal', 'שער', 1, '{"scores": 1}'),
  ('football', 'assist', 'בישול', 2, '{}'),
  ('football', 'yellow_card', 'כרטיס צהוב', 3, '{"card": "yellow"}'),
  ('football', 'red_card', 'כרטיס אדום', 4, '{"card": "red"}'),
  ('basketball', 'points_1', 'זריקה חופשית', 1, '{"scores": 1}'),
  ('basketball', 'points_2', 'סל 2 נקודות', 2, '{"scores": 2}'),
  ('basketball', 'points_3', 'סל 3 נקודות', 3, '{"scores": 3}'),
  ('basketball', 'rebound', 'ריבאונד', 4, '{}'),
  ('basketball', 'assist', 'בישול', 5, '{}'),
  ('basketball', 'foul', 'עבירה', 6, '{}')
) as v(sport, slug, name_he, sort_order, meta)
join sports s on s.slug = v.sport;

-- ===== 0007_events.sql =====
-- Next Team: events (type from catalog), attendance answers, match statistics.

create table events (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references teams (id) on delete cascade,
  type_id uuid not null references lookups (id),
  title text not null default '',
  starts_at timestamptz not null,
  ends_at timestamptz,
  location text not null default '',
  notes text not null default '',
  opponent text,
  our_score int check (our_score >= 0),
  their_score int check (their_score >= 0),
  created_by uuid references profiles (id),
  created_at timestamptz not null default now(),
  check (ends_at is null or ends_at >= starts_at)
);
create index events_team_idx on events (team_id, starts_at);

create table event_responses (
  event_id uuid not null references events (id) on delete cascade,
  player_id uuid not null references players (id) on delete cascade,
  status text not null check (status in ('attending', 'not_attending')),
  reason_id uuid references lookups (id),
  note text not null default '',
  responded_by uuid not null references profiles (id),
  responded_at timestamptz not null default now(),
  primary key (event_id, player_id),
  check (status = 'attending' or reason_id is not null)
);

create table event_stats (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references events (id) on delete cascade,
  player_id uuid not null references players (id) on delete cascade,
  stat_type_id uuid not null references lookups (id),
  minute int check (minute between 0 and 200),
  note text not null default '',
  recorded_by uuid references profiles (id),
  created_at timestamptz not null default now()
);
create index event_stats_event_idx on event_stats (event_id);
create index event_stats_player_idx on event_stats (player_id);

create function event_team(p_event uuid) returns uuid
language sql stable security definer set search_path = public as $$
  select team_id from events where id = p_event
$$;

create function lookup_in_domain(p_id uuid, p_domain text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from lookups where id = p_id and domain = p_domain)
$$;

create function event_is_match(p_event uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select (l.meta ->> 'is_match')::boolean
                   from events e join lookups l on l.id = e.type_id where e.id = p_event), false)
$$;

alter table events enable row level security;
alter table event_responses enable row level security;
alter table event_stats enable row level security;

create policy events_select on events for select using (is_team_member(team_id));
-- Staff and the player's own family see the answer (with reason and note); others do not.
create policy responses_select on event_responses for select using (
  can_manage_team(event_team(event_id)) or is_parent_of(player_id) or is_self_player(player_id));
create policy stats_select on event_stats for select using (is_team_member(event_team(event_id)));

create function create_event(p_team uuid, p_type uuid, p_title text, p_starts timestamptz,
  p_ends timestamptz default null, p_location text default '', p_notes text default '',
  p_opponent text default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_uid uuid := require_auth(); v_id uuid;
begin
  if not can_manage_team(p_team) then
    raise exception 'only the coach or club admin can create events' using errcode = '42501';
  end if;
  if not lookup_in_domain(p_type, 'event_type') then
    raise exception 'unknown event type' using errcode = '22023';
  end if;
  insert into events (team_id, type_id, title, starts_at, ends_at, location, notes, opponent, created_by)
  values (p_team, p_type, coalesce(p_title, ''), p_starts, p_ends, coalesce(p_location, ''),
          coalesce(p_notes, ''), p_opponent, v_uid)
  returning id into v_id;
  return v_id;
end $$;

create function update_event(p_event uuid, p_title text default null, p_starts timestamptz default null,
  p_ends timestamptz default null, p_location text default null, p_notes text default null,
  p_opponent text default null, p_our_score int default null, p_their_score int default null)
returns void
language plpgsql security definer set search_path = public as $$
begin
  perform require_auth();
  if not can_manage_team(event_team(p_event)) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  update events set
    title = coalesce(p_title, title), starts_at = coalesce(p_starts, starts_at),
    ends_at = coalesce(p_ends, ends_at), location = coalesce(p_location, location),
    notes = coalesce(p_notes, notes), opponent = coalesce(p_opponent, opponent),
    our_score = coalesce(p_our_score, our_score), their_score = coalesce(p_their_score, their_score)
  where id = p_event;
end $$;

create function delete_event(p_event uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform require_auth();
  if not can_manage_team(event_team(p_event)) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  delete from events where id = p_event;
end $$;

-- Attendance. A parent may always answer for their child; the child may answer only when the team
-- allows it and the child is at least the team's minimum age (team parameters, see 0008).
-- The last answer wins and can be changed at any time.
create function respond_event(p_event uuid, p_player uuid, p_status text,
  p_reason uuid default null, p_note text default null) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := require_auth();
  v_team uuid := event_team(p_event);
  v_allowed boolean := false;
begin
  if v_team is null then raise exception 'event not found' using errcode = 'P0002'; end if;
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

create function record_stat(p_event uuid, p_player uuid, p_stat_type uuid,
  p_minute int default null, p_note text default '') returns uuid
language plpgsql security definer set search_path = public as $$
declare v_uid uuid := require_auth(); v_team uuid := event_team(p_event); v_id uuid;
begin
  if v_team is null or not can_manage_team(v_team) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if not event_is_match(p_event) then
    raise exception 'statistics can only be recorded on a match' using errcode = '22023';
  end if;
  if not exists (select 1 from team_players where team_id = v_team and player_id = p_player) then
    raise exception 'player is not on this team' using errcode = '22023';
  end if;
  if not lookup_in_domain(p_stat_type, 'stat_type') then
    raise exception 'unknown statistic' using errcode = '22023';
  end if;
  insert into event_stats (event_id, player_id, stat_type_id, minute, note, recorded_by)
  values (p_event, p_player, p_stat_type, p_minute, coalesce(p_note, ''), v_uid) returning id into v_id;
  return v_id;
end $$;

create function delete_stat(p_stat uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_event uuid;
begin
  perform require_auth();
  select event_id into v_event from event_stats where id = p_stat;
  if v_event is null or not can_manage_team(event_team(v_event)) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  delete from event_stats where id = p_stat;
end $$;

-- ===== 0008_attributes.sql =====
-- Next Team: generic, dynamic attributes with history and per-role visibility.
--
-- One mechanism serves: player ratings (scale 1-10), medical info, team settings (minimum age to
-- answer, default match format...), event settings (match format and formation) and anything added later.
--   attribute_defs   what can be recorded: scope (player/team/event), type, config, who sees it,
--                    who may edit it, and optional owner (club / team) and sport.
--   attribute_values append-only: every save adds a row, so the history of a value is kept.
-- Types: text, number, scale, boolean, date, select (config.options), lookup (config.domain).

create table attribute_defs (
  id uuid primary key default gen_random_uuid(),
  scope text not null check (scope in ('player', 'team', 'event')),
  key text not null check (key ~ '^[a-z0-9_]+$'),
  label_he text not null,
  data_type text not null check (data_type in ('text', 'number', 'scale', 'boolean', 'date', 'select', 'lookup')),
  config jsonb not null default '{}',
  visible_to text[] not null,
  editable_by text[] not null,
  club_id uuid references clubs (id) on delete cascade,
  team_id uuid references teams (id) on delete cascade,
  sport_id uuid references sports (id) on delete cascade,
  sort_order int not null default 0,
  active boolean not null default true,
  created_by uuid references profiles (id),
  created_at timestamptz not null default now(),
  check (visible_to <@ array['system_admin', 'club_admin', 'coach', 'parent', 'player']),
  check (editable_by <@ array['system_admin', 'club_admin', 'coach', 'parent', 'player'])
);
create unique index attribute_defs_key_idx on attribute_defs (
  scope, key,
  coalesce(club_id, '00000000-0000-0000-0000-000000000000'),
  coalesce(team_id, '00000000-0000-0000-0000-000000000000'));

create table attribute_values (
  id uuid primary key default gen_random_uuid(),
  seq bigint generated always as identity,
  def_id uuid not null references attribute_defs (id) on delete cascade,
  entity_id uuid not null,
  value jsonb not null,
  recorded_by uuid references profiles (id),
  recorded_at timestamptz not null default now()
);
create index attribute_values_entity_idx on attribute_values (entity_id, def_id, seq desc);

create function cleanup_attribute_values() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  delete from attribute_values where entity_id = old.id;
  return old;
end $$;
create trigger players_cleanup_attrs after delete on players for each row execute function cleanup_attribute_values();
create trigger teams_cleanup_attrs after delete on teams for each row execute function cleanup_attribute_values();
create trigger events_cleanup_attrs after delete on events for each row execute function cleanup_attribute_values();

-- ---------------------------------------------------------------- entity helpers

create function entity_club(p_scope text, p_id uuid) returns uuid
language plpgsql stable security definer set search_path = public as $$
begin
  return case p_scope
    when 'player' then (select club_id from players where id = p_id)
    when 'team' then (select club_id from teams where id = p_id)
    when 'event' then (select t.club_id from events e join teams t on t.id = e.team_id where e.id = p_id)
  end;
end $$;

create function entity_teams(p_scope text, p_id uuid) returns uuid[]
language plpgsql stable security definer set search_path = public as $$
begin
  return coalesce(case p_scope
    when 'player' then (select array_agg(team_id) from team_players where player_id = p_id)
    when 'team' then array[p_id]
    when 'event' then (select array[team_id] from events where id = p_id)
  end, '{}');
end $$;

-- the roles the caller holds in relation to this entity
create function entity_roles(p_scope text, p_id uuid) returns text[]
language plpgsql stable security definer set search_path = public as $$
declare r text[] := '{}'; v_club uuid := entity_club(p_scope, p_id); v_team uuid;
begin
  if is_system_admin() then r := array_append(r, 'system_admin'); end if;
  if v_club is not null and is_club_admin_strict(v_club) then r := array_append(r, 'club_admin'); end if;
  if p_scope = 'player' then
    if coaches_player(p_id) then r := array_append(r, 'coach'); end if;
    if is_parent_of(p_id) then r := array_append(r, 'parent'); end if;
    if is_self_player(p_id) then r := array_append(r, 'player'); end if;
  else
    foreach v_team in array entity_teams(p_scope, p_id) loop
      if is_team_coach(v_team) and not ('coach' = any (r)) then r := array_append(r, 'coach'); end if;
      if is_team_parent(v_team) and not ('parent' = any (r)) then r := array_append(r, 'parent'); end if;
      if is_team_player(v_team) and not ('player' = any (r)) then r := array_append(r, 'player'); end if;
    end loop;
  end if;
  return r;
end $$;

create function attr_can_read(p_def uuid, p_entity uuid) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare d attribute_defs;
begin
  select * into d from attribute_defs where id = p_def;
  return found and entity_roles(d.scope, p_entity) && d.visible_to;
end $$;

create function attr_can_write(p_def uuid, p_entity uuid) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare d attribute_defs;
begin
  select * into d from attribute_defs where id = p_def;
  return found and entity_roles(d.scope, p_entity) && d.editable_by;
end $$;

-- is this definition meant for this entity (club / team / sport scoping)?
create function attr_applies(p_def uuid, p_entity uuid) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare d attribute_defs; v_club uuid; v_teams uuid[];
begin
  select * into d from attribute_defs where id = p_def;
  if not found then return false; end if;
  v_club := entity_club(d.scope, p_entity);
  v_teams := entity_teams(d.scope, p_entity);
  return v_club is not null
     and (d.club_id is null or d.club_id = v_club)
     and (d.team_id is null or d.team_id = any (v_teams))
     and (d.sport_id is null or exists (select 1 from teams t where t.id = any (v_teams) and t.sport_id = d.sport_id));
end $$;

create function validate_attr_value(d attribute_defs, v jsonb) returns void
language plpgsql stable security definer set search_path = public as $$
declare n numeric;
begin
  if v = 'null'::jsonb then return; end if;                 -- clears the value
  case d.data_type
    when 'text' then
      if jsonb_typeof(v) <> 'string' then raise exception 'text expected' using errcode = '22023'; end if;
    when 'boolean' then
      if jsonb_typeof(v) <> 'boolean' then raise exception 'boolean expected' using errcode = '22023'; end if;
    when 'date' then
      if jsonb_typeof(v) <> 'string' then raise exception 'date expected' using errcode = '22023'; end if;
      perform (v #>> '{}')::date;
    when 'number', 'scale' then
      if jsonb_typeof(v) <> 'number' then raise exception 'number expected' using errcode = '22023'; end if;
      n := (v #>> '{}')::numeric;
      if d.data_type = 'scale' then
        if n <> trunc(n) then raise exception 'whole number expected' using errcode = '22023'; end if;
        if n < coalesce((d.config ->> 'min')::numeric, 1) or n > coalesce((d.config ->> 'max')::numeric, 10) then
          raise exception 'value out of range' using errcode = '22003';
        end if;
      else
        if d.config ? 'min' and n < (d.config ->> 'min')::numeric then raise exception 'value out of range' using errcode = '22003'; end if;
        if d.config ? 'max' and n > (d.config ->> 'max')::numeric then raise exception 'value out of range' using errcode = '22003'; end if;
      end if;
    when 'select' then
      if jsonb_typeof(v) <> 'string' or not (d.config -> 'options') ? (v #>> '{}') then
        raise exception 'value is not one of the options' using errcode = '22023';
      end if;
    when 'lookup' then
      if jsonb_typeof(v) <> 'string' or not lookup_in_domain((v #>> '{}')::uuid, d.config ->> 'domain') then
        raise exception 'value is not in the list' using errcode = '22023';
      end if;
  end case;
end $$;

-- ---------------------------------------------------------------- RLS

alter table attribute_defs enable row level security;
alter table attribute_values enable row level security;

create policy attribute_defs_select on attribute_defs for select using (
  (club_id is null or is_club_member(club_id))
  and (team_id is null or is_team_member(team_id)));
create policy attribute_values_select on attribute_values for select using (attr_can_read(def_id, entity_id));

-- latest value per (definition, entity); RLS of attribute_values applies to the caller
create view attribute_current with (security_invoker = true) as
  select distinct on (def_id, entity_id) id, def_id, entity_id, value, recorded_by, recorded_at
  from attribute_values order by def_id, entity_id, seq desc;
grant select on attribute_current to authenticated;

-- ---------------------------------------------------------------- RPCs

create function can_manage_def(p_club uuid, p_team uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select is_system_admin()
      or (p_club is not null and is_club_admin_strict(p_club))
      or (p_team is not null and is_team_coach(p_team))
$$;

create function create_attribute_def(
  p_scope text, p_key text, p_label text, p_type text, p_config jsonb,
  p_visible_to text[], p_editable_by text[],
  p_club uuid default null, p_team uuid default null, p_sport uuid default null,
  p_sort int default 0) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_uid uuid := require_auth(); v_club uuid := p_club; v_id uuid;
begin
  if p_team is not null then
    v_club := (select club_id from teams where id = p_team);
    if v_club is null then raise exception 'team not found' using errcode = 'P0002'; end if;
    if p_club is not null and p_club <> v_club then
      raise exception 'team does not belong to club' using errcode = '22023';
    end if;
  end if;
  if not can_manage_def(v_club, p_team) then
    raise exception 'not allowed to define parameters here' using errcode = '42501';
  end if;
  insert into attribute_defs (scope, key, label_he, data_type, config, visible_to, editable_by,
                              club_id, team_id, sport_id, sort_order, created_by)
  values (p_scope, p_key, p_label, p_type, coalesce(p_config, '{}'), p_visible_to, p_editable_by,
          v_club, p_team, p_sport, p_sort, v_uid)
  returning id into v_id;
  return v_id;
end $$;

create function update_attribute_def(p_def uuid, p_label text default null, p_config jsonb default null,
  p_visible_to text[] default null, p_editable_by text[] default null,
  p_active boolean default null, p_sort int default null) returns void
language plpgsql security definer set search_path = public as $$
declare d attribute_defs;
begin
  perform require_auth();
  select * into d from attribute_defs where id = p_def;
  if not found or not can_manage_def(d.club_id, d.team_id) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  update attribute_defs set
    label_he = coalesce(p_label, label_he), config = coalesce(p_config, config),
    visible_to = coalesce(p_visible_to, visible_to), editable_by = coalesce(p_editable_by, editable_by),
    active = coalesce(p_active, active), sort_order = coalesce(p_sort, sort_order)
  where id = p_def;
end $$;

-- Saves a new value (history is kept). Pass JSON null to clear.
create function set_attribute(p_def uuid, p_entity uuid, p_value jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_uid uuid := require_auth(); d attribute_defs; v_id uuid;
begin
  select * into d from attribute_defs where id = p_def;
  if not found or not d.active then raise exception 'unknown parameter' using errcode = 'P0002'; end if;
  if not attr_applies(p_def, p_entity) then
    raise exception 'this parameter does not apply to this record' using errcode = '22023';
  end if;
  if not attr_can_write(p_def, p_entity) then
    raise exception 'not allowed to edit this parameter' using errcode = '42501';
  end if;
  perform validate_attr_value(d, p_value);
  insert into attribute_values (def_id, entity_id, value, recorded_by)
  values (p_def, p_entity, p_value, v_uid) returning id into v_id;
  return v_id;
end $$;

-- effective team setting: latest value, else the definition's default
create function team_param(p_team uuid, p_key text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v jsonb; d attribute_defs;
begin
  if not is_team_member(p_team) then return null; end if;
  select * into d from attribute_defs
   where scope = 'team' and key = p_key and active
     and (team_id is null or team_id = p_team)
   order by (team_id is not null) desc, (club_id is not null) desc limit 1;
  if not found then return null; end if;
  select av.value into v from attribute_values av
   where av.def_id = d.id and av.entity_id = p_team order by av.seq desc limit 1;
  if v is null or v = 'null'::jsonb then v := d.config -> 'default'; end if;
  return v;
end $$;

-- ---------------------------------------------------------------- seeds (global definitions)
insert into attribute_defs (scope, key, label_he, data_type, config, visible_to, editable_by, sort_order) values
  -- medical: parent, coach, club admin and system admin see it; parent and coach edit it
  ('player', 'medical_allergy', 'אלרגיה', 'text', '{}',
     array['system_admin','club_admin','coach','parent'], array['coach','parent'], 10),
  ('player', 'medical_condition', 'בעיה רפואית', 'text', '{}',
     array['system_admin','club_admin','coach','parent'], array['coach','parent'], 11),
  -- team settings
  ('team', 'min_response_age', 'גיל מינימלי שבו שחקן עונה בעצמו', 'number', '{"min": 0, "max": 21, "default": 12}',
     array['system_admin','club_admin','coach','parent','player'], array['system_admin','club_admin','coach'], 1),
  ('team', 'players_can_respond', 'פרופיל שחקן רשאי לאשר הגעה', 'boolean', '{"default": false}',
     array['system_admin','club_admin','coach','parent','player'], array['system_admin','club_admin','coach'], 2),
  ('team', 'default_match_format', 'מספר שחקנים במגרש (ברירת מחדל)', 'lookup', '{"domain": "match_format"}',
     array['system_admin','club_admin','coach','parent','player'], array['system_admin','club_admin','coach'], 3),
  ('team', 'default_formation', 'מערך (ברירת מחדל)', 'lookup', '{"domain": "formation", "depends_on": "default_match_format"}',
     array['system_admin','club_admin','coach','parent','player'], array['system_admin','club_admin','coach'], 4),
  -- event settings: formation belongs to the event, defaulting from the team
  ('event', 'match_format', 'מספר שחקנים במגרש', 'lookup', '{"domain": "match_format", "default_from_team": "default_match_format"}',
     array['system_admin','club_admin','coach','parent','player'], array['system_admin','club_admin','coach'], 1),
  ('event', 'formation', 'מערך', 'lookup', '{"domain": "formation", "depends_on": "match_format", "default_from_team": "default_formation"}',
     array['system_admin','club_admin','coach','parent','player'], array['system_admin','club_admin','coach'], 2);

-- ===== 0009_work.sql =====
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

-- ===== 0010_storage_and_grants.sql =====
-- Next Team: player photo storage (Supabase only) and function privileges.

create function can_see_photo(p_player uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select can_view_player(p_player)
     and (can_manage_player(p_player) or is_parent_of(p_player) or is_self_player(p_player)
          or coalesce((select photo_consent from players where id = p_player), false))
$$;

-- Bucket "player-photos": objects live under "<player_id>/<file>". Skipped where Supabase Storage
-- is absent (plain Postgres), and never fails the migration.
do $$
begin
  if to_regclass('storage.objects') is null then
    raise notice 'storage schema not found; skipping photo bucket';
    return;
  end if;
  begin
    insert into storage.buckets (id, name, public) values ('player-photos', 'player-photos', false)
    on conflict (id) do nothing;
    execute $p$create policy player_photos_read on storage.objects for select to authenticated
      using (bucket_id = 'player-photos' and can_see_photo(((storage.foldername(name))[1])::uuid))$p$;
    execute $p$create policy player_photos_write on storage.objects for insert to authenticated
      with check (bucket_id = 'player-photos'
        and (can_manage_player(((storage.foldername(name))[1])::uuid) or is_parent_of(((storage.foldername(name))[1])::uuid)))$p$;
    execute $p$create policy player_photos_update on storage.objects for update to authenticated
      using (bucket_id = 'player-photos'
        and (can_manage_player(((storage.foldername(name))[1])::uuid) or is_parent_of(((storage.foldername(name))[1])::uuid)))$p$;
    execute $p$create policy player_photos_delete on storage.objects for delete to authenticated
      using (bucket_id = 'player-photos'
        and (can_manage_player(((storage.foldername(name))[1])::uuid) or is_parent_of(((storage.foldername(name))[1])::uuid)))$p$;
  exception when others then
    raise warning 'could not create player photo storage policies: %', sqlerrm;
  end;
end $$;

-- Every function is callable by signed-in users (policies need the helpers), except the internal ones.
revoke execute on all functions in schema public from public, anon;
grant execute on all functions in schema public to authenticated;
revoke execute on function claim_invites(uuid, text), handle_new_user(), cleanup_attribute_values(),
  team_players_same_club() from authenticated;

-- ===== 0011_security_hardening.sql =====
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

-- ===== 0012_email_login.sql =====
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

-- ===== 0013_tester_self_link.sql =====
-- Next Team: a system admin may link to themselves (be their own player's parent), so one account can
-- test the player, parent and coach sides of the guardianship flow. Everyone else is still refused.

create or replace function request_guardianship(p_other_email text, p_as_parent boolean)
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
  if v_other = v_uid and not is_system_admin() then
    raise exception 'cannot link to yourself' using errcode = '22023';
  end if;
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

-- ===== 0014_images.sql =====
-- Next Team: a picture for each club (logo), team and account (avatar).
-- Files live in private buckets and are read through signed URLs, so storage policies decide who sees them:
--   club-media/clubs/<club_id>/...   club members read, club admins upload
--   club-media/teams/<team_id>/...   club members read, the team's coach or club admin upload
--   avatars/<user_id>/...            whoever may see the profile reads, only the owner uploads
-- Every upload gets a new file name, so the only write policy is insert.

alter table clubs add column logo_path text;
alter table teams add column photo_path text;
alter table profiles add column avatar_path text;

do $$
begin
  if to_regclass('storage.objects') is null then
    raise notice 'storage schema not found; skipping image buckets';
    return;
  end if;
  execute $p$insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
  ('club-media', 'club-media', false, 2097152, array['image/jpeg', 'image/png', 'image/webp']),
  ('avatars', 'avatars', false, 2097152, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing$p$;
  execute $p$create policy club_media_read on storage.objects for select to authenticated using (
  bucket_id = 'club-media' and case (storage.foldername(name))[1]
    when 'clubs' then is_club_member(((storage.foldername(name))[2])::uuid)
    when 'teams' then is_club_member((select club_id from teams where id = ((storage.foldername(name))[2])::uuid))
    else false end)$p$;
  execute $p$create policy club_media_upload on storage.objects for insert to authenticated with check (
  bucket_id = 'club-media' and case (storage.foldername(name))[1]
    when 'clubs' then is_club_admin(((storage.foldername(name))[2])::uuid)
    when 'teams' then can_manage_team(((storage.foldername(name))[2])::uuid)
    else false end)$p$;
  execute $p$create policy avatars_read on storage.objects for select to authenticated using (
  bucket_id = 'avatars' and ((storage.foldername(name))[1] = auth.uid()::text
    or profile_visible(((storage.foldername(name))[1])::uuid)))$p$;
  execute $p$create policy avatars_upload on storage.objects for insert to authenticated with check (
  bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text)$p$;
end $$;

-- Point a club, team or account at an uploaded picture (null clears it). The path must sit in that entity's folder.
create function set_club_logo(p_club uuid, p_path text) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform require_auth();
  if not is_club_admin(p_club) then raise exception 'not allowed' using errcode = '42501'; end if;
  if p_path is not null and p_path not like 'clubs/' || p_club || '/%' then
    raise exception 'invalid path' using errcode = '22023';
  end if;
  update clubs set logo_path = p_path where id = p_club;
end $$;

create function set_team_photo(p_team uuid, p_path text) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform require_auth();
  if not can_manage_team(p_team) then raise exception 'not allowed' using errcode = '42501'; end if;
  if p_path is not null and p_path not like 'teams/' || p_team || '/%' then
    raise exception 'invalid path' using errcode = '22023';
  end if;
  update teams set photo_path = p_path where id = p_team;
end $$;

create function set_my_avatar(p_path text) returns void
language plpgsql security definer set search_path = public as $$
declare v_uid uuid := require_auth();
begin
  if p_path is not null and p_path not like v_uid || '/%' then
    raise exception 'invalid path' using errcode = '22023';
  end if;
  update profiles set avatar_path = p_path where id = v_uid;
end $$;

revoke execute on function set_club_logo(uuid, text), set_team_photo(uuid, text), set_my_avatar(text) from public, anon;
grant execute on function set_club_logo(uuid, text), set_team_photo(uuid, text), set_my_avatar(text) to authenticated;

-- ===== 0015_kits_and_series.sql =====
-- Next Team: team kits (any number of colour sets per team), a kit per event, and recurring events.

-- A kit is a named set of colours (shirt, shorts, socks), drawn as a kid wearing it.
-- Kits are archived (active = false), never removed, so past events keep their kit.
create table team_kits (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references teams (id) on delete cascade,
  name text not null check (length(btrim(name)) > 0),
  shirt text not null check (shirt ~ '^#[0-9a-fA-F]{6}$'),
  shorts text not null check (shorts ~ '^#[0-9a-fA-F]{6}$'),
  socks text not null check (socks ~ '^#[0-9a-fA-F]{6}$'),
  sort_order int not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create index team_kits_team_idx on team_kits (team_id);
alter table team_kits enable row level security;
create policy team_kits_select on team_kits for select using (is_team_member(team_id));
grant select on team_kits to authenticated;

alter table events add column kit_id uuid references team_kits (id);
-- Events created together by create_event_series share a series id.
alter table events add column series_id uuid;
create index events_series_idx on events (series_id);

-- Adds a kit (p_id null) or edits one; p_active = false archives it.
create function save_team_kit(p_id uuid, p_team uuid, p_name text, p_shirt text, p_shorts text, p_socks text,
  p_active boolean default true) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  perform require_auth();
  if not can_manage_team(p_team) then raise exception 'not allowed' using errcode = '42501'; end if;
  if p_id is null then
    insert into team_kits (team_id, name, shirt, shorts, socks, sort_order)
    values (p_team, btrim(p_name), p_shirt, p_shorts, p_socks,
            coalesce((select max(sort_order) + 1 from team_kits where team_id = p_team), 0))
    returning id into v_id;
  else
    update team_kits set name = btrim(p_name), shirt = p_shirt, shorts = p_shorts, socks = p_socks, active = p_active
     where id = p_id and team_id = p_team
    returning id into v_id;
    if v_id is null then raise exception 'kit not found' using errcode = 'P0002'; end if;
  end if;
  return v_id;
end $$;

create function set_event_kit(p_event uuid, p_kit uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_team uuid := event_team(p_event);
begin
  perform require_auth();
  if v_team is null or not can_manage_team(v_team) then raise exception 'not allowed' using errcode = '42501'; end if;
  if p_kit is not null and not exists (select 1 from team_kits where id = p_kit and team_id = v_team) then
    raise exception 'kit belongs to another team' using errcode = '22023';
  end if;
  update events set kit_id = p_kit where id = p_event;
end $$;

-- Creates one event on each chosen weekday (0 = Sunday ... 6 = Saturday) between two dates, at a local
-- (Israel) start time. Returns how many were created. Capped at 100 events and one year.
create function create_event_series(p_team uuid, p_type uuid, p_title text, p_days int[], p_start time,
  p_duration_min int, p_from date, p_until date, p_location text default '', p_notes text default '',
  p_kit uuid default null) returns int
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := require_auth();
  v_series uuid := gen_random_uuid();
  v_day date;
  v_starts timestamptz;
  v_count int := 0;
begin
  if not can_manage_team(p_team) then
    raise exception 'only the coach or club admin can create events' using errcode = '42501';
  end if;
  if not lookup_in_domain(p_type, 'event_type') then raise exception 'unknown event type' using errcode = '22023'; end if;
  if p_days is null or cardinality(p_days) = 0 or not (p_days <@ array[0, 1, 2, 3, 4, 5, 6]) then
    raise exception 'choose at least one weekday' using errcode = '22023';
  end if;
  if p_until < p_from or p_until > p_from + 366 then
    raise exception 'the end date must be after the start date and within a year' using errcode = '22023';
  end if;
  if p_duration_min is not null and (p_duration_min < 0 or p_duration_min > 24 * 60) then
    raise exception 'invalid duration' using errcode = '22023';
  end if;
  if p_kit is not null and not exists (select 1 from team_kits where id = p_kit and team_id = p_team) then
    raise exception 'kit belongs to another team' using errcode = '22023';
  end if;
  for v_day in select d::date from generate_series(p_from, p_until, interval '1 day') d loop
    continue when not (extract(dow from v_day)::int = any (p_days));
    v_count := v_count + 1;
    if v_count > 100 then raise exception 'too many events (at most 100 at once)' using errcode = '22023'; end if;
    v_starts := (v_day + p_start) at time zone 'Asia/Jerusalem';
    insert into events (team_id, type_id, title, starts_at, ends_at, location, notes, created_by, kit_id, series_id)
    values (p_team, p_type, coalesce(p_title, ''), v_starts,
            case when p_duration_min is null then null else v_starts + make_interval(mins => p_duration_min) end,
            coalesce(p_location, ''), coalesce(p_notes, ''), v_uid, p_kit, v_series);
  end loop;
  return v_count;
end $$;

revoke execute on function save_team_kit(uuid, uuid, text, text, text, text, boolean), set_event_kit(uuid, uuid),
  create_event_series(uuid, uuid, text, int[], time, int, date, date, text, text, uuid) from public, anon;
grant execute on function save_team_kit(uuid, uuid, text, text, text, text, boolean), set_event_kit(uuid, uuid),
  create_event_series(uuid, uuid, text, int[], time, int, date, date, text, text, uuid) to authenticated;

-- ===== 0016_positions_and_goals.sql =====
-- Next Team: a playing position for each player and personal goals.
-- Position is a regular player parameter (lookup list "position", per sport), so it is table-driven,
-- keeps history and follows the usual visibility rules; staff set it, everyone on the team sees it.

insert into lookups (domain, slug, name_he, sport_id, sort_order, meta)
select 'position', v.slug, v.name_he, s.id, v.sort_order, v.meta::jsonb
from (values
  ('football', 'goalkeeper', 'שוער', 1, '{"goalkeeper": true}'),
  ('football', 'defender', 'הגנה', 2, '{}'),
  ('football', 'midfielder', 'קישור', 3, '{}'),
  ('football', 'forward', 'התקפה', 4, '{}'),
  ('basketball', 'point_guard', 'רכז', 1, '{}'),
  ('basketball', 'shooting_guard', 'קלע', 2, '{}'),
  ('basketball', 'small_forward', 'פורוורד', 3, '{}'),
  ('basketball', 'center', 'סנטר', 4, '{}')
) as v(sport, slug, name_he, sort_order, meta)
join sports s on s.slug = v.sport;

insert into attribute_defs (scope, key, label_he, data_type, config, visible_to, editable_by, sort_order) values
  ('player', 'position', 'עמדה', 'lookup', '{"domain": "position"}',
   array['system_admin','club_admin','coach','parent','player'], array['system_admin','club_admin','coach'], 0);

-- Personal goals the staff set for a player; done or archived, never removed.
create table player_goals (
  id uuid primary key default gen_random_uuid(),
  player_id uuid not null references players (id) on delete cascade,
  title text not null check (length(btrim(title)) > 0),
  target_date date,
  done_at timestamptz,
  archived boolean not null default false,
  created_by uuid references profiles (id),
  created_at timestamptz not null default now()
);
create index player_goals_player_idx on player_goals (player_id);
alter table player_goals enable row level security;
create policy player_goals_select on player_goals for select using (
  can_manage_player(player_id) or is_parent_of(player_id) or is_self_player(player_id));
grant select on player_goals to authenticated;

-- Adds a goal (p_id null) or edits one: title, target date, done, archived.
create function save_player_goal(p_id uuid, p_player uuid, p_title text, p_target date default null,
  p_done boolean default false, p_archived boolean default false) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_uid uuid := require_auth(); v_id uuid;
begin
  if not can_manage_player(p_player) then raise exception 'not allowed' using errcode = '42501'; end if;
  if p_id is null then
    insert into player_goals (player_id, title, target_date, created_by)
    values (p_player, btrim(p_title), p_target, v_uid) returning id into v_id;
  else
    update player_goals set title = btrim(p_title), target_date = p_target, archived = p_archived,
           done_at = case when p_done then coalesce(done_at, now()) end
     where id = p_id and player_id = p_player
    returning id into v_id;
    if v_id is null then raise exception 'goal not found' using errcode = 'P0002'; end if;
  end if;
  return v_id;
end $$;

revoke execute on function save_player_goal(uuid, uuid, text, date, boolean, boolean) from public, anon;
grant execute on function save_player_goal(uuid, uuid, text, date, boolean, boolean) to authenticated;

-- ===== 0017_default_ratings.sql =====
-- Next Team: default professional ratings (1-10) for each sport, so a new team can rate players right away.
-- Like any parameter they are rows in attribute_defs: a club or team adds its own, and staff see the history.
-- Keys carry the sport (football_speed) because a key is unique per scope, club and team.
insert into attribute_defs (scope, key, label_he, data_type, config, visible_to, editable_by, sport_id, sort_order)
select 'player', v.sport || '_' || v.key, v.label_he, 'scale', '{"min": 1, "max": 10}',
       array['system_admin','club_admin','coach','parent','player'], array['system_admin','club_admin','coach'], s.id, v.sort_order
from (values
  ('football', 'technique', 'טכניקה', 1),
  ('football', 'speed', 'מהירות', 2),
  ('football', 'game_sense', 'הבנת משחק', 3),
  ('football', 'teamwork', 'עבודת צוות', 4),
  ('football', 'fitness', 'כושר גופני', 5),
  ('basketball', 'shooting', 'קליעה', 1),
  ('basketball', 'dribbling', 'כדרור', 2),
  ('basketball', 'defense', 'הגנה', 3),
  ('basketball', 'teamwork', 'עבודת צוות', 4),
  ('basketball', 'fitness', 'כושר גופני', 5)
) as v(sport, key, label_he, sort_order)
join sports s on s.slug = v.sport;

-- ===== 0018_equipment_and_player_profile.sql =====
-- Next Team: what to bring to an event (several items from a list), and more player parameters:
-- field player or goalkeeper, a default position, and the strong foot.

-- Items to bring: a regular list (lookups domain "equipment"), so clubs add or retire items without code.
insert into lookups (domain, slug, name_he, sort_order) values
  ('equipment', 'water', 'בקבוק מים', 1),
  ('equipment', 'boots', 'נעלי כדורגל', 2),
  ('equipment', 'shin_guards', 'מגני שוקיים', 3),
  ('equipment', 'sport_shoes', 'נעלי ספורט', 4),
  ('equipment', 'ball', 'כדור', 5),
  ('equipment', 'towel', 'מגבת', 6),
  ('equipment', 'snack', 'כריך / פרי', 7),
  ('equipment', 'goalkeeper_gloves', 'כפפות שוער', 8);

alter table events add column equipment uuid[] not null default '{}';

-- Replaces the items to bring for an event; each one must be on the equipment list.
create function set_event_equipment(p_event uuid, p_items uuid[]) returns void
language plpgsql security definer set search_path = public as $$
declare v_team uuid := event_team(p_event);
begin
  perform require_auth();
  if v_team is null or not can_manage_team(v_team) then raise exception 'not allowed' using errcode = '42501'; end if;
  if exists (select 1 from unnest(coalesce(p_items, '{}')) i where not lookup_in_domain(i, 'equipment')) then
    raise exception 'unknown item' using errcode = '22023';
  end if;
  update events set equipment = (select coalesce(array_agg(distinct i), '{}') from unnest(coalesce(p_items, '{}')) i)
   where id = p_event;
end $$;

revoke execute on function set_event_equipment(uuid, uuid[]) from public, anon;
grant execute on function set_event_equipment(uuid, uuid[]) to authenticated;

-- Field player or goalkeeper (a list, so the goalkeeper flag lives in meta), for football.
insert into lookups (domain, slug, name_he, sport_id, sort_order, meta)
select 'player_kind', v.slug, v.name_he, s.id, v.sort_order, v.meta::jsonb
from (values ('field', 'שחקן שדה', 1, '{}'), ('goalkeeper', 'שוער', 2, '{"goalkeeper": true}')) as v(slug, name_he, sort_order, meta)
join sports s on s.slug = 'football';

insert into attribute_defs (scope, key, label_he, data_type, config, visible_to, editable_by, sport_id, sort_order)
select 'player', v.key, v.label_he, v.data_type, v.config::jsonb,
       array['system_admin','club_admin','coach','parent','player'], array['system_admin','club_admin','coach'], s.id, v.sort_order
from (values
  ('player_kind', 'שחקן שדה / שוער', 'lookup', '{"domain": "player_kind"}', -2),
  ('strong_foot', 'רגל חזקה', 'select', '{"options": ["ימין", "שמאל"]}', 1)
) as v(key, label_he, data_type, config, sort_order)
join sports s on s.slug = 'football';

-- The position parameter is the player's default role.
update attribute_defs set label_he = 'תפקיד ברירת מחדל', sort_order = -1
 where scope = 'player' and key = 'position' and club_id is null and team_id is null;

-- ===== 0019_shirt_number.sql =====
-- Next Team: the player's shirt number (1-99), a regular player parameter for every sport.
insert into attribute_defs (scope, key, label_he, data_type, config, visible_to, editable_by, sort_order) values
  ('player', 'shirt_number', 'מספר חולצה', 'number', '{"min": 1, "max": 99}',
   array['system_admin','club_admin','coach','parent','player'], array['system_admin','club_admin','coach'], -3);

-- ===== 0020_lineups_relations_staff_league.sql =====
-- Next Team: full event editing, a saved match lineup, the parent's relation to the child (mom / dad),
-- staff types (head coach, assistant, ...) and a link to the team's league page.

-- ---- Event editing: every field, including the type and the end time, and clearing a field.
-- update_event keeps a field when its argument is null, so it cannot clear one; this one replaces them all.
create function save_event_details(p_event uuid, p_type uuid, p_title text, p_starts timestamptz,
  p_ends timestamptz default null, p_location text default '', p_notes text default '',
  p_opponent text default null, p_our_score int default null, p_their_score int default null) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform require_auth();
  if not can_manage_team(event_team(p_event)) then raise exception 'not allowed' using errcode = '42501'; end if;
  if not lookup_in_domain(p_type, 'event_type') then raise exception 'unknown event type' using errcode = '22023'; end if;
  if p_starts is null then raise exception 'a start time is required' using errcode = '22023'; end if;
  if p_ends is not null and p_ends < p_starts then
    raise exception 'the end must be after the start' using errcode = '22023';
  end if;
  update events set type_id = p_type, title = coalesce(btrim(p_title), ''), starts_at = p_starts, ends_at = p_ends,
         location = coalesce(btrim(p_location), ''), notes = coalesce(p_notes, ''),
         opponent = nullif(btrim(p_opponent), ''), our_score = p_our_score, their_score = p_their_score
   where id = p_event;
end $$;

-- ---- Match lineup: which player stands in which slot of the formation (0 = goalkeeper, then the rows
-- from defence to attack). Staff only.
create table event_lineups (
  event_id uuid not null references events (id) on delete cascade,
  slot int not null check (slot between 0 and 30),
  player_id uuid not null references players (id) on delete cascade,
  primary key (event_id, slot),
  unique (event_id, player_id)
);
alter table event_lineups enable row level security;
create policy event_lineups_select on event_lineups for select using (can_manage_team(event_team(event_id)));
grant select on event_lineups to authenticated;

-- Replaces the lineup: p_players[i] stands in slot i - 1; a null leaves the slot empty.
create function set_event_lineup(p_event uuid, p_players uuid[]) returns void
language plpgsql security definer set search_path = public as $$
declare v_team uuid := event_team(p_event);
begin
  perform require_auth();
  if v_team is null or not can_manage_team(v_team) then raise exception 'not allowed' using errcode = '42501'; end if;
  if coalesce(cardinality(p_players), 0) > 31 then raise exception 'too many slots' using errcode = '22023'; end if;
  if exists (select 1 from unnest(coalesce(p_players, '{}')) p
             where p is not null and not exists (select 1 from team_players where team_id = v_team and player_id = p)) then
    raise exception 'player is not on this team' using errcode = '22023';
  end if;
  delete from event_lineups where event_id = p_event;
  insert into event_lineups (event_id, slot, player_id)
  select p_event, i - 1, p_players[i] from generate_subscripts(coalesce(p_players, '{}'), 1) i
   where p_players[i] is not null;
end $$;

-- ---- The parent's relation to the child (a list, so it is table-driven).
insert into lookups (domain, slug, name_he, sort_order) values
  ('guardian_relation', 'mother', 'אמא', 1),
  ('guardian_relation', 'father', 'אבא', 2),
  ('guardian_relation', 'guardian', 'אפוטרופוס', 3);

alter table guardianships add column relation_id uuid references lookups (id);

-- The parent sets their own relation; the child's staff may set any parent's.
create function set_guardian_relation(p_player uuid, p_parent uuid, p_relation uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_uid uuid := require_auth(); v_id uuid;
begin
  if not ((p_parent = v_uid and is_parent_of(p_player)) or can_manage_player(p_player)) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if p_relation is not null and not lookup_in_domain(p_relation, 'guardian_relation') then
    raise exception 'unknown relation' using errcode = '22023';
  end if;
  update guardianships set relation_id = p_relation
   where player_id = p_player and parent_id = p_parent and status = 'approved'
  returning id into v_id;
  if v_id is null then raise exception 'no such parent' using errcode = 'P0002'; end if;
end $$;

-- Approved parents of a player with their relation, for anyone who may see the player's parents
-- (the guardianships policy shows a parent only their own row).
create function player_guardians(p_player uuid)
returns table (parent_id uuid, full_name text, avatar_path text, relation_id uuid)
language sql stable security definer set search_path = public as $$
  select g.parent_id, coalesce(nullif(pr.full_name, ''), pr.email, ''), pr.avatar_path, g.relation_id
    from guardianships g join profiles pr on pr.id = g.parent_id
   where g.player_id = p_player and g.status = 'approved'
     and (can_manage_player(p_player) or is_parent_of(p_player) or is_self_player(p_player))
   order by 2
$$;

-- ---- Staff types.
insert into lookups (domain, slug, name_he, sort_order) values
  ('staff_role', 'head_coach', 'מאמן ראשי', 1),
  ('staff_role', 'assistant_coach', 'עוזר מאמן', 2),
  ('staff_role', 'fitness_coach', 'מנהל כושר', 3),
  ('staff_role', 'secretary', 'מזכירה', 4),
  ('staff_role', 'medic', 'חובש', 5);

alter table memberships add column staff_role_id uuid references lookups (id);

-- The club admin sets anyone's type; a coach sets the types of their own team's staff.
create function set_staff_role(p_membership uuid, p_role uuid) returns void
language plpgsql security definer set search_path = public as $$
declare m memberships;
begin
  perform require_auth();
  select * into m from memberships where id = p_membership;
  if not found then raise exception 'not found' using errcode = 'P0002'; end if;
  if not (is_club_admin(m.club_id) or (m.team_id is not null and is_team_coach(m.team_id))) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if p_role is not null and not lookup_in_domain(p_role, 'staff_role') then
    raise exception 'unknown staff type' using errcode = '22023';
  end if;
  update memberships set staff_role_id = p_role where id = p_membership;
end $$;

-- The team's staff with their types, for everyone on the team (parents and players included).
create function team_staff(p_team uuid)
returns table (membership_id uuid, user_id uuid, full_name text, avatar_path text, staff_role_id uuid)
language sql stable security definer set search_path = public as $$
  select m.id, m.user_id, coalesce(nullif(pr.full_name, ''), pr.email, ''), pr.avatar_path, m.staff_role_id
    from memberships m join profiles pr on pr.id = m.user_id
    left join lookups l on l.id = m.staff_role_id
   where m.team_id = p_team and m.role = 'coach' and is_team_member(p_team)
   order by coalesce(l.sort_order, 99), 3
$$;

-- ---- League: the team's page on the football association site (shown in the team's "league" tab).
insert into attribute_defs (scope, key, label_he, data_type, config, visible_to, editable_by, sort_order) values
  ('team', 'league_url', 'קישור לדף הקבוצה באתר ההתאחדות (טבלת ליגה)', 'text', '{"placeholder": "https://www.football.org.il/team-details/?team_id=...&season_id=..."}',
   array['system_admin','club_admin','coach','parent','player'], array['system_admin','club_admin','coach'], 5);

revoke execute on function
  save_event_details(uuid, uuid, text, timestamptz, timestamptz, text, text, text, int, int),
  set_event_lineup(uuid, uuid[]), set_guardian_relation(uuid, uuid, uuid), player_guardians(uuid),
  set_staff_role(uuid, uuid), team_staff(uuid)
from public, anon;
grant execute on function
  save_event_details(uuid, uuid, text, timestamptz, timestamptz, text, text, text, int, int),
  set_event_lineup(uuid, uuid[]), set_guardian_relation(uuid, uuid, uuid), player_guardians(uuid),
  set_staff_role(uuid, uuid), team_staff(uuid)
to authenticated;

-- ===== 0021_team_manager_staff_type.sql =====
-- Next Team: "team manager" as a staff type. Like every staff type it is a label on a team staff
-- membership (role coach), so a team manager has the coach's permissions on that team.
insert into lookups (domain, slug, name_he, sort_order) values ('staff_role', 'team_manager', 'מנהל קבוצה', 0);

-- ===== 0022_event_transport.sql =====
-- Transport (הסעה) on events. The coach or club admin turns it on for an event; then a parent sets how many
-- seats their child needs (the child plus anyone travelling with them, 0 for no ride), and staff set seats for
-- themselves. Staff can also set or correct any row. Players cannot set seats themselves.

alter table events add column has_transport boolean not null default false;

create table event_transport (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references events (id) on delete cascade,
  player_id uuid references players (id) on delete cascade,
  profile_id uuid references profiles (id) on delete cascade,
  seats int not null check (seats between 0 and 20),
  set_by uuid not null references profiles (id),
  updated_at timestamptz not null default now(),
  check ((player_id is null) <> (profile_id is null))
);
create unique index event_transport_player_uq on event_transport (event_id, player_id) where player_id is not null;
create unique index event_transport_staff_uq on event_transport (event_id, profile_id) where profile_id is not null;

-- Coach of the team or club admin of its club: the staff who may have a transport row.
create function is_team_staff(p_team uuid, p_profile uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from memberships m
                 where m.user_id = p_profile
                   and ((m.team_id = p_team and m.role = 'coach')
                     or (m.role = 'club_admin' and m.club_id = (select club_id from teams where id = p_team))))
$$;

alter table event_transport enable row level security;
create policy transport_select on event_transport for select using (is_team_member(event_team(event_id)));
grant select on event_transport to authenticated;

create function set_event_transport(p_event uuid, p_enabled boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform require_auth();
  if not can_manage_team(event_team(p_event)) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  update events set has_transport = coalesce(p_enabled, false) where id = p_event;
end $$;

create function set_transport_seats(p_event uuid, p_seats int, p_player uuid default null,
  p_profile uuid default null) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := require_auth();
  v_team uuid := event_team(p_event);
begin
  if v_team is null then raise exception 'event not found' using errcode = 'P0002'; end if;
  if not (select has_transport from events where id = p_event) then
    raise exception 'this event has no transport' using errcode = '22023';
  end if;
  if (p_player is null) = (p_profile is null) then
    raise exception 'give either a player or a staff member' using errcode = '22023';
  end if;
  if p_seats is null or p_seats < 0 or p_seats > 20 then
    raise exception 'seats must be between 0 and 20' using errcode = '22023';
  end if;

  if p_player is not null then
    if not exists (select 1 from team_players where team_id = v_team and player_id = p_player) then
      raise exception 'player is not on this team' using errcode = '22023';
    end if;
    if not (is_parent_of(p_player) or can_manage_team(v_team)) then
      raise exception 'only a parent or staff can set transport for a player' using errcode = '42501';
    end if;
    if p_seats > 0 and exists (select 1 from event_responses
                               where event_id = p_event and player_id = p_player and status = 'not_attending') then
      raise exception 'player is not attending this event' using errcode = '22023';
    end if;
    insert into event_transport (event_id, player_id, seats, set_by)
    values (p_event, p_player, p_seats, v_uid)
    on conflict (event_id, player_id) where player_id is not null do update
      set seats = excluded.seats, set_by = excluded.set_by, updated_at = now();
  else
    if not is_team_staff(v_team, p_profile) then
      raise exception 'not a staff member of this team' using errcode = '22023';
    end if;
    if not (p_profile = v_uid or can_manage_team(v_team)) then
      raise exception 'not allowed' using errcode = '42501';
    end if;
    insert into event_transport (event_id, profile_id, seats, set_by)
    values (p_event, p_profile, p_seats, v_uid)
    on conflict (event_id, profile_id) where profile_id is not null do update
      set seats = excluded.seats, set_by = excluded.set_by, updated_at = now();
  end if;
end $$;

-- Breakdown for the event: one row per player or staff member who answered, still on the team.
-- Players marked not attending are left out (their row is cleared anyway, see the trigger below).
-- staff_label is the staff type on the team membership (e.g. מנהל קבוצה, see 0020d/0021), if one is set.
create function event_transport_list(p_event uuid)
returns table (player_id uuid, profile_id uuid, name text, role text, staff_label text, seats int)
language sql stable security definer set search_path = public as $$
  select t.player_id, null::uuid, p.full_name, 'player', null::text, t.seats
  from event_transport t
  join events e on e.id = t.event_id
  join players p on p.id = t.player_id
  join team_players tp on tp.team_id = e.team_id and tp.player_id = t.player_id
  where t.event_id = p_event and is_team_member(e.team_id)
    and not exists (select 1 from event_responses r
                    where r.event_id = t.event_id and r.player_id = t.player_id and r.status = 'not_attending')
  union all
  select null::uuid, t.profile_id, coalesce(nullif(pr.full_name, ''), pr.email, ''),
         case when tm.id is not null then 'coach' else 'club_admin' end, l.name_he, t.seats
  from event_transport t
  join events e on e.id = t.event_id
  join profiles pr on pr.id = t.profile_id
  left join memberships tm on tm.user_id = t.profile_id and tm.team_id = e.team_id and tm.role = 'coach'
  left join lookups l on l.id = tm.staff_role_id
  where t.event_id = p_event and is_team_member(e.team_id) and is_team_staff(e.team_id, t.profile_id)
  order by 4 desc, 3
$$;

create function event_transport_total(p_event uuid) returns int
language sql stable security definer set search_path = public as $$
  select coalesce(sum(seats), 0)::int from event_transport_list(p_event)
$$;

-- A player who answers "not attending" no longer needs a seat.
create function clear_transport_on_absence() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'not_attending' then
    delete from event_transport where event_id = new.event_id and player_id = new.player_id;
  end if;
  return new;
end $$;
create trigger event_responses_clear_transport after insert or update of status on event_responses
  for each row execute function clear_transport_on_absence();

revoke execute on function is_team_staff(uuid, uuid), set_event_transport(uuid, boolean),
  set_transport_seats(uuid, int, uuid, uuid), event_transport_list(uuid), event_transport_total(uuid),
  clear_transport_on_absence() from public, anon;
grant execute on function set_event_transport(uuid, boolean), set_transport_seats(uuid, int, uuid, uuid),
  event_transport_list(uuid), event_transport_total(uuid) to authenticated;
-- Supabase also grants new functions to authenticated directly; these are internal.
revoke execute on function is_team_staff(uuid, uuid), clear_transport_on_absence() from authenticated;

-- ===== 0023_join_requests.sql =====
-- Next Team: joining a team by link, with approval.
-- Staff share a team's join link. Whoever opens it signs in, then asks to join as a coach or as a parent;
-- a parent lists their children (name, birth date, optional email and phone). Club admins decide coach
-- requests; the team's staff (coach, team manager) and club admins decide parent requests. Approving a parent
-- creates each child as a player on the team (or links an existing one) with the parent approved.
-- Players never register themselves: a child's email is linked to the player (link_player_email).
-- Also: contact fields (phone on players, club details, "can drive" for parents), more parameters, and an
-- in-app notification list that the push hook (0024) delivers to devices.

-- Contact fields. Phone is never required.
alter table players add column phone text;
alter table clubs add column phone text, add column address text not null default '', add column website text not null default '';
alter table profiles add column can_drive boolean not null default false;

-- More parameters, table-driven like the rest (0008).
insert into attribute_defs (scope, key, label_he, data_type, config, visible_to, editable_by, sort_order) values
  ('player', 'emergency_contact_name', 'איש קשר לחירום', 'text', '{}',
   array['system_admin','club_admin','coach','parent'], array['club_admin','coach','parent'], 12),
  ('player', 'emergency_contact_phone', 'טלפון לחירום', 'text', '{}',
   array['system_admin','club_admin','coach','parent'], array['club_admin','coach','parent'], 13),
  ('player', 'medical_cert_expiry', 'תוקף אישור רפואי', 'date', '{}',
   array['system_admin','club_admin','coach','parent'], array['club_admin','coach','parent'], 14),
  ('player', 'shirt_size', 'מידת חולצה', 'select',
   '{"options": ["6", "8", "10", "12", "14", "16", "XS", "S", "M", "L", "XL"]}',
   array['system_admin','club_admin','coach','parent','player'], array['club_admin','coach','parent'], 15),
  ('player', 'federation_id', 'מספר כרטיס שחקן / ת"ז להתאחדות', 'text', '{}',
   array['system_admin','club_admin','coach'], array['club_admin','coach'], 16),
  ('team', 'season', 'עונה', 'text', '{"placeholder": "2026/27"}',
   array['system_admin','club_admin','coach','parent','player'], array['system_admin','club_admin','coach'], 6),
  ('team', 'age_group', 'שנתון / קבוצת גיל', 'text', '{}',
   array['system_admin','club_admin','coach','parent','player'], array['system_admin','club_admin','coach'], 7),
  ('team', 'home_field_address', 'כתובת מגרש הבית', 'text', '{}',
   array['system_admin','club_admin','coach','parent','player'], array['system_admin','club_admin','coach'], 8);

-- Every parameter of a record that applies to it and that the caller may read, with its current value.
create function entity_attributes(p_scope text, p_entity uuid)
returns table (def_id uuid, key text, label_he text, data_type text, config jsonb, value jsonb, can_write boolean)
language sql stable security definer set search_path = public as $$
  select d.id, d.key, d.label_he, d.data_type, d.config,
         (select av.value from attribute_values av where av.def_id = d.id and av.entity_id = p_entity
           order by av.seq desc limit 1),
         attr_can_write(d.id, p_entity)
  from attribute_defs d
  where d.scope = p_scope and d.active and attr_applies(d.id, p_entity) and attr_can_read(d.id, p_entity)
  order by d.sort_order, d.label_he
$$;

-- In-app notifications; 0024 pushes each new row to the recipient's devices.
create table notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles (id) on delete cascade,
  title text not null,
  body text not null default '',
  url text not null default '/',
  created_at timestamptz not null default now(),
  read_at timestamptz
);
create index notifications_user_idx on notifications (user_id, created_at desc);
alter table notifications enable row level security;
create policy notifications_select on notifications for select using (user_id = auth.uid());
grant select on notifications to authenticated;

create function notify(p_users uuid[], p_title text, p_body text, p_url text) returns void
language sql security definer set search_path = public as $$
  insert into notifications (user_id, title, body, url)
  select distinct u, p_title, coalesce(p_body, ''), coalesce(p_url, '/') from unnest(p_users) u where u is not null
$$;

create function mark_notifications_read() returns void
language sql security definer set search_path = public as $$
  update notifications set read_at = now() where user_id = auth.uid() and read_at is null
$$;

-- One active join link per team; making a new one retires the old.
create table join_links (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references teams (id) on delete cascade,
  code text not null unique check (code ~ '^[A-Za-z0-9]{8,}$'),
  active boolean not null default true,
  created_by uuid references profiles (id),
  created_at timestamptz not null default now()
);
create unique index join_links_active_uq on join_links (team_id) where active;
alter table join_links enable row level security;
create policy join_links_select on join_links for select using (can_manage_team(team_id));
grant select on join_links to authenticated;

create table join_requests (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references teams (id) on delete cascade,
  user_id uuid not null references profiles (id) on delete cascade,
  role text not null check (role in ('coach', 'parent')),
  full_name text not null check (length(btrim(full_name)) > 0),
  phone text,
  children jsonb not null default '[]' check (jsonb_typeof(children) = 'array'),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  decided_by uuid references profiles (id),
  decided_at timestamptz,
  created_at timestamptz not null default now()
);
create unique index join_requests_pending_uq on join_requests (team_id, user_id) where status = 'pending';

-- Who decides a request: club admins for coaches; the team's staff and club admins for parents.
create function can_decide_join(p_team uuid, p_role text) returns boolean
language sql stable security definer set search_path = public as $$
  select case when p_role = 'coach' then is_club_admin((select club_id from teams where id = p_team))
              else can_manage_team(p_team) end
$$;

create function join_deciders(p_team uuid, p_role text) returns uuid[]
language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(distinct m.user_id), '{}')
  from memberships m join teams t on t.id = p_team
  where (m.role = 'club_admin' and m.club_id = t.club_id)
     or (p_role = 'parent' and m.role = 'coach' and m.team_id = p_team)
$$;

alter table join_requests enable row level security;
create policy join_requests_select on join_requests for select using (
  user_id = auth.uid() or can_decide_join(team_id, role));
grant select on join_requests to authenticated;

create function create_join_link(p_team uuid) returns text
language plpgsql security definer set search_path = public as $$
declare v_uid uuid := require_auth(); v_code text;
begin
  if not can_manage_team(p_team) then raise exception 'not allowed' using errcode = '42501'; end if;
  update join_links set active = false where team_id = p_team and active;
  loop
    v_code := substr(replace(gen_random_uuid()::text, '-', ''), 1, 10);
    exit when not exists (select 1 from join_links where code = v_code);
  end loop;
  insert into join_links (team_id, code, created_by) values (p_team, v_code, v_uid);
  return v_code;
end $$;

create function disable_join_link(p_team uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform require_auth();
  if not can_manage_team(p_team) then raise exception 'not allowed' using errcode = '42501'; end if;
  update join_links set active = false where team_id = p_team and active;
end $$;

-- What a join link points to, for the person who opened it. my_status: member, coach (already staff),
-- pending (a request is waiting) or none.
create function join_link_info(p_code text)
returns table (team_id uuid, team_name text, club_name text, sport_name text, my_status text)
language plpgsql stable security definer set search_path = public as $$
declare v_uid uuid := require_auth(); v_team uuid;
begin
  select l.team_id into v_team from join_links l where l.code = p_code and l.active;
  if v_team is null then raise exception 'this link is no longer active' using errcode = 'P0002'; end if;
  return query
  select t.id, t.name, c.name, s.name_he,
         case when can_manage_team(t.id) then 'coach'
              when exists (select 1 from join_requests r where r.team_id = t.id and r.user_id = v_uid and r.status = 'pending')
                then 'pending'
              when is_team_member(t.id) then 'member'
              else 'none' end
  from teams t join clubs c on c.id = t.club_id left join sports s on s.id = t.sport_id
  where t.id = v_team;
end $$;

-- p_children: [{"full_name", "birth_date" (YYYY-MM-DD), "email"?, "phone"?}], 1 to 6 children, parents only.
-- A parent already on the team may send another request to add more children.
create function submit_join_request(p_code text, p_role text, p_full_name text, p_phone text default null,
  p_children jsonb default '[]') returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := require_auth();
  v_team uuid;
  v_children jsonb := '[]';
  v_phone text := norm_phone(p_phone);
  c jsonb;
  v_birth date;
  v_id uuid;
begin
  select l.team_id into v_team from join_links l where l.code = p_code and l.active;
  if v_team is null then raise exception 'this link is no longer active' using errcode = 'P0002'; end if;
  if p_role not in ('coach', 'parent') then raise exception 'role must be coach or parent' using errcode = '22023'; end if;
  if length(btrim(coalesce(p_full_name, ''))) = 0 then raise exception 'a name is required' using errcode = '22023'; end if;
  if can_manage_team(v_team) then raise exception 'you are already on the team staff' using errcode = '22023'; end if;
  if p_role = 'coach' and is_team_member(v_team) then
    raise exception 'you are already on this team' using errcode = '22023';
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
  insert into join_requests (team_id, user_id, role, full_name, phone, children)
  values (v_team, v_uid, p_role, btrim(p_full_name), v_phone, v_children) returning id into v_id;

  perform notify(join_deciders(v_team, p_role), 'בקשת הצטרפות חדשה',
    btrim(p_full_name) || case when p_role = 'coach' then ' מבקש/ת להצטרף כאיש צוות ל' else ' (הורה) מבקש/ת להצטרף ל' end
      || (select name from teams where id = v_team),
    '/requests');
  return v_id;
end $$;

-- p_matches: {"<child index>": "<existing player id on the team>"} to link a child who is already on the roster
-- instead of creating a new player. p_staff_role labels an approved coach (e.g. team manager).
create function decide_join_request(p_request uuid, p_approve boolean, p_matches jsonb default '{}',
  p_staff_role uuid default null) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := require_auth();
  r join_requests;
  v_club uuid;
  c jsonb;
  i int := 0;
  v_player uuid;
begin
  select * into r from join_requests where id = p_request for update;
  if not found or r.status <> 'pending' then raise exception 'no pending request' using errcode = 'P0002'; end if;
  if not can_decide_join(r.team_id, r.role) then raise exception 'not allowed' using errcode = '42501'; end if;
  select club_id into v_club from teams where id = r.team_id;

  if p_approve then
    if r.role = 'coach' then
      if p_staff_role is not null and not lookup_in_domain(p_staff_role, 'staff_role') then
        raise exception 'unknown staff type' using errcode = '22023';
      end if;
      insert into memberships (user_id, club_id, team_id, role, staff_role_id)
      values (r.user_id, v_club, r.team_id, 'coach', p_staff_role) on conflict do nothing;
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
          -- An email already used by another player must not block the approval; staff can fix it later.
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
    case when p_approve then '/' else '/notifications' end);
end $$;

-- Pending requests the caller can decide, with what the decision screen needs.
create function pending_join_requests()
returns table (id uuid, team_id uuid, team_name text, role text, full_name text, email text, phone text,
               avatar_path text, children jsonb, created_at timestamptz)
language sql stable security definer set search_path = public as $$
  select r.id, r.team_id, t.name, r.role, r.full_name, pr.email, r.phone, pr.avatar_path, r.children, r.created_at
  from join_requests r join teams t on t.id = r.team_id join profiles pr on pr.id = r.user_id
  where r.status = 'pending' and can_decide_join(r.team_id, r.role)
  order by r.created_at
$$;

-- Own profile.
create function update_my_profile(p_full_name text, p_phone text default null, p_can_drive boolean default null)
returns void
language plpgsql security definer set search_path = public as $$
declare v_uid uuid := require_auth(); v_phone text := norm_phone(p_phone);
begin
  if v_phone is not null and exists (select 1 from profiles where phone = v_phone and id <> v_uid) then
    raise exception 'this phone number belongs to another account' using errcode = '23505';
  end if;
  update profiles set full_name = coalesce(nullif(btrim(p_full_name), ''), full_name),
         phone = v_phone, can_drive = coalesce(p_can_drive, can_drive)
   where id = v_uid;
end $$;

-- A player's details for staff, their parents and the player: the contact fields v_players leaves out.
create function player_details(p_player uuid)
returns table (id uuid, full_name text, birth_date date, phone text, photo_path text, photo_consent boolean,
               account_email text, invite_email text, can_edit boolean, is_parent boolean)
language sql stable security definer set search_path = public as $$
  select p.id, p.full_name, p.birth_date, p.phone, p.photo_path, p.photo_consent,
         (select email from profiles where id = p.user_id),
         (select i.email from invites i where i.player_id = p.id and i.role = 'player' and i.status = 'pending'
           order by i.created_at desc limit 1),
         can_manage_player(p.id) or is_parent_of(p.id),
         is_parent_of(p.id)
  from players p
  where p.id = p_player and (can_manage_player(p.id) or is_parent_of(p.id) or is_self_player(p.id))
$$;

create function set_player_phone(p_player uuid, p_phone text) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform require_auth();
  if not (can_manage_player(p_player) or is_parent_of(p_player)) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  update players set phone = norm_phone(p_phone) where id = p_player;
end $$;

create function update_club_details(p_club uuid, p_phone text, p_address text, p_website text) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform require_auth();
  if not is_club_admin(p_club) then raise exception 'not allowed' using errcode = '42501'; end if;
  update clubs set phone = norm_phone(p_phone), address = coalesce(btrim(p_address), ''),
         website = coalesce(btrim(p_website), '')
   where id = p_club;
end $$;

revoke execute on function entity_attributes(text, uuid), notify(uuid[], text, text, text), mark_notifications_read(),
  can_decide_join(uuid, text), join_deciders(uuid, text), create_join_link(uuid), disable_join_link(uuid),
  join_link_info(text), submit_join_request(text, text, text, text, jsonb),
  decide_join_request(uuid, boolean, jsonb, uuid), pending_join_requests(),
  update_my_profile(text, text, boolean), player_details(uuid), set_player_phone(uuid, text),
  update_club_details(uuid, text, text, text)
from public, anon;
grant execute on function entity_attributes(text, uuid), mark_notifications_read(), can_decide_join(uuid, text),
  create_join_link(uuid), disable_join_link(uuid), join_link_info(text),
  submit_join_request(text, text, text, text, jsonb), decide_join_request(uuid, boolean, jsonb, uuid),
  pending_join_requests(), update_my_profile(text, text, boolean), player_details(uuid),
  set_player_phone(uuid, text), update_club_details(uuid, text, text, text)
to authenticated;
-- Supabase also grants new functions to authenticated directly; these are internal (notify would let anyone
-- message anyone).
revoke execute on function notify(uuid[], text, text, text), join_deciders(uuid, text) from authenticated;

-- ===== 0024_push.sql =====
-- Next Team: free Web Push. Each device that allows notifications saves its subscription here; every new row
-- in notifications (0023) is posted to the send-push Edge Function, which delivers it to the recipient's devices.
-- Configuration lives in Vault: push_hook_url and push_hook_secret (read by the trigger), vapid_public_key,
-- vapid_private_key and vapid_subject (read by the function through push_config()). Without them notifications
-- stay in-app only.

do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_net') then
    create extension if not exists pg_net with schema extensions;
  else
    raise notice 'pg_net not available; push hook disabled';
  end if;
end $$;

create table push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles (id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  created_at timestamptz not null default now()
);
create index push_subscriptions_user_idx on push_subscriptions (user_id);
alter table push_subscriptions enable row level security;
create policy push_subscriptions_select on push_subscriptions for select using (user_id = auth.uid());
grant select on push_subscriptions to authenticated;

-- The Edge Function reads with the service role.
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant select on notifications to service_role;
    grant select, delete on push_subscriptions to service_role;
  end if;
end $$;

create function save_push_subscription(p_endpoint text, p_p256dh text, p_auth text) returns void
language plpgsql security definer set search_path = public as $$
declare v_uid uuid := require_auth();
begin
  if coalesce(p_endpoint, '') !~ '^https://' or coalesce(p_p256dh, '') = '' or coalesce(p_auth, '') = '' then
    raise exception 'invalid subscription' using errcode = '22023';
  end if;
  insert into push_subscriptions (user_id, endpoint, p256dh, auth) values (v_uid, p_endpoint, p_p256dh, p_auth)
  on conflict (endpoint) do update set user_id = v_uid, p256dh = excluded.p256dh, auth = excluded.auth;
end $$;

create function delete_push_subscription(p_endpoint text) returns void
language sql security definer set search_path = public as $$
  delete from push_subscriptions where endpoint = p_endpoint and user_id = auth.uid()
$$;

create function push_notification() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_url text; v_secret text;
begin
  if to_regnamespace('net') is null or to_regclass('vault.decrypted_secrets') is null then return new; end if;
  execute 'select max(decrypted_secret) filter (where name = ''push_hook_url''),
                  max(decrypted_secret) filter (where name = ''push_hook_secret'')
             from vault.decrypted_secrets where name in (''push_hook_url'', ''push_hook_secret'')'
    into v_url, v_secret;
  if v_url is null or v_secret is null then return new; end if;
  execute 'select net.http_post(url := $1, body := $2, headers := $3)'
    using v_url, jsonb_build_object('id', new.id),
          jsonb_build_object('Content-Type', 'application/json', 'x-hook-secret', v_secret);
  return new;
exception when others then
  raise warning 'push hook failed: %', sqlerrm;
  return new;
end $$;
create trigger notifications_push after insert on notifications
  for each row execute function push_notification();

-- For the send-push function only (service role): the hook secret and the VAPID keys.
create function push_config()
returns table (hook_secret text, vapid_public_key text, vapid_private_key text, vapid_subject text)
language plpgsql stable security definer set search_path = public as $$
begin
  if to_regclass('vault.decrypted_secrets') is null then return; end if;
  return query execute
    'select max(decrypted_secret) filter (where name = ''push_hook_secret''),
            max(decrypted_secret) filter (where name = ''vapid_public_key''),
            max(decrypted_secret) filter (where name = ''vapid_private_key''),
            max(decrypted_secret) filter (where name = ''vapid_subject'')
       from vault.decrypted_secrets';
end $$;

revoke execute on function save_push_subscription(text, text, text), delete_push_subscription(text),
  push_notification(), push_config() from public, anon;
revoke execute on function push_config(), push_notification() from authenticated;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function push_config() to service_role;
  end if;
end $$;
grant execute on function save_push_subscription(text, text, text), delete_push_subscription(text) to authenticated;

-- ===== 0025_push_keys.sql =====
-- Next Team: the Web Push key pair is made by the send-push function on its first call and kept in Vault, so the
-- private key never leaves the project. The app reads only the public key, at run time.
-- One-time setup per project (not a migration, the URL is project specific), run in the SQL editor:
--   select vault.create_secret('https://<project>.supabase.co/functions/v1/send-push', 'push_hook_url');
--   select vault.create_secret(replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''), 'push_hook_secret');
-- then open https://<project>.supabase.co/functions/v1/send-push once (a GET makes the keys).

-- Stores the key pair unless one is already stored. Service role only.
create function push_store_vapid(p_public text, p_private text, p_subject text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if to_regclass('vault.decrypted_secrets') is null then return; end if;
  if exists (select 1 from vault.secrets where name = 'vapid_public_key') then return; end if;
  perform vault.create_secret(p_public, 'vapid_public_key', 'Web Push public key');
  perform vault.create_secret(p_private, 'vapid_private_key', 'Web Push private key');
  perform vault.create_secret(p_subject, 'vapid_subject', 'Web Push contact');
end $$;

create function push_public_key() returns text
language plpgsql stable security definer set search_path = public as $$
declare v text;
begin
  if to_regclass('vault.decrypted_secrets') is null then return null; end if;
  execute 'select decrypted_secret from vault.decrypted_secrets where name = ''vapid_public_key''' into v;
  return v;
end $$;

revoke execute on function push_store_vapid(text, text, text), push_public_key() from public, anon;
revoke execute on function push_store_vapid(text, text, text) from authenticated;
grant execute on function push_public_key() to authenticated;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function push_store_vapid(text, text, text) to service_role;
  end if;
end $$;

-- ===== 0026_join_roles_and_email.sql =====
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
