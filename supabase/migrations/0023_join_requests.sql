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
