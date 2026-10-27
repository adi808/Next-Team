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
