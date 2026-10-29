-- Next Team: both parents of a child, and the roster table for club admins and coaches.
-- A child's second parent (or any guardian) can be added with a name, relation, phone and email, by a parent of
-- the child or the child's staff, also in the join form. Without an account the guardian is kept as a contact
-- (guardian_contacts); with an email, signing in with it later turns the contact into a linked parent of the
-- child. If the email already has an account, the parent is linked at once.
-- The roster (club_roster) lists every child with their parents and contact details: the whole club for its
-- admins, their own teams for coaches. From it they edit a child and its parents, unlink a parent from a child,
-- and a club admin deletes a child from the club.

create table guardian_contacts (
  id uuid primary key default gen_random_uuid(),
  player_id uuid not null references players (id) on delete cascade,
  full_name text not null check (length(btrim(full_name)) > 0),
  relation_id uuid references lookups (id),
  phone text,
  email text,
  created_by uuid references profiles (id) on delete set null,
  created_at timestamptz not null default now()
);
create index guardian_contacts_player_idx on guardian_contacts (player_id);
create unique index guardian_contacts_email_uq on guardian_contacts (player_id, email) where email is not null;
alter table guardian_contacts enable row level security;
-- Read and written only through the functions below.
create policy guardian_contacts_no_direct_access on guardian_contacts for all using (false) with check (false);

alter table join_requests add column relation_id uuid references lookups (id), add column other_parent jsonb;

-- Turns a contact whose email has an account into an approved parent of the child (relation and phone carried
-- over; the account's own phone wins).
create function resolve_guardian_contact(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare c guardian_contacts; v_parent uuid;
begin
  select * into c from guardian_contacts where id = p_id;
  if not found or c.email is null then return; end if;
  select id into v_parent from profiles where email = c.email;
  if v_parent is null then return; end if;
  insert into guardianships (parent_id, player_id, requested_by, status, approved_by, relation_id)
  values (v_parent, c.player_id, coalesce(c.created_by, v_parent), 'approved', c.created_by, c.relation_id)
  on conflict (parent_id, player_id) do update
    set status = 'approved', relation_id = coalesce(guardianships.relation_id, excluded.relation_id);
  update profiles set phone = c.phone
   where id = v_parent and phone is null and c.phone is not null
     and not exists (select 1 from profiles where phone = c.phone);
  update profiles set full_name = c.full_name where id = v_parent and full_name = '';
  delete from guardian_contacts where id = p_id;
end $$;

-- Checks and stores a guardian for a child; internal (the caller's rights are checked by the callers).
create function attach_guardian(p_player uuid, p_full_name text, p_relation uuid, p_phone text, p_email text,
  p_by uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_email text := norm_email(p_email); v_id uuid;
begin
  if length(btrim(coalesce(p_full_name, ''))) = 0 then raise exception 'a name is required' using errcode = '22023'; end if;
  if nullif(btrim(coalesce(p_email, '')), '') is not null and v_email is null then
    raise exception 'invalid email' using errcode = '22023';
  end if;
  if p_relation is not null and not lookup_in_domain(p_relation, 'guardian_relation') then
    raise exception 'unknown relation' using errcode = '22023';
  end if;
  if v_email is not null and v_email = (select pr.email from players p join profiles pr on pr.id = p.user_id where p.id = p_player) then
    raise exception 'this is the child''s own email' using errcode = '22023';
  end if;
  if v_email is not null and exists (select 1 from guardianships g join profiles pr on pr.id = g.parent_id
      where g.player_id = p_player and g.status = 'approved' and pr.email = v_email) then
    raise exception 'this parent is already linked to the child' using errcode = '23505';
  end if;
  insert into guardian_contacts (player_id, full_name, relation_id, phone, email, created_by)
  values (p_player, btrim(p_full_name), p_relation, norm_phone(p_phone), v_email, p_by)
  returning id into v_id;
  perform resolve_guardian_contact(v_id);
  return v_id;
end $$;

-- A parent of the child or the child's staff adds a guardian (usually the second parent).
create function add_guardian(p_player uuid, p_full_name text, p_relation uuid default null, p_phone text default null,
  p_email text default null) returns void
language plpgsql security definer set search_path = public as $$
declare v_uid uuid := require_auth();
begin
  if not (can_manage_player(p_player) or is_parent_of(p_player)) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  perform attach_guardian(p_player, p_full_name, p_relation, p_phone, p_email, v_uid);
end $$;

create function update_guardian_contact(p_id uuid, p_full_name text, p_relation uuid, p_phone text, p_email text)
returns void
language plpgsql security definer set search_path = public as $$
declare v_player uuid; v_email text := norm_email(p_email);
begin
  perform require_auth();
  select player_id into v_player from guardian_contacts where id = p_id;
  if v_player is null then raise exception 'not found' using errcode = 'P0002'; end if;
  if not (can_manage_player(v_player) or is_parent_of(v_player)) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if length(btrim(coalesce(p_full_name, ''))) = 0 then raise exception 'a name is required' using errcode = '22023'; end if;
  if nullif(btrim(coalesce(p_email, '')), '') is not null and v_email is null then
    raise exception 'invalid email' using errcode = '22023';
  end if;
  if p_relation is not null and not lookup_in_domain(p_relation, 'guardian_relation') then
    raise exception 'unknown relation' using errcode = '22023';
  end if;
  update guardian_contacts set full_name = btrim(p_full_name), relation_id = p_relation,
         phone = norm_phone(p_phone), email = v_email
   where id = p_id;
  perform resolve_guardian_contact(p_id);
end $$;

create function remove_guardian_contact(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_player uuid;
begin
  perform require_auth();
  select player_id into v_player from guardian_contacts where id = p_id;
  if v_player is null then raise exception 'not found' using errcode = 'P0002'; end if;
  if not (can_manage_player(v_player) or is_parent_of(v_player)) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  delete from guardian_contacts where id = p_id;
end $$;

-- Staff unlink a parent account from a child (the account stays). Pending invites for that pair go too.
create function unlink_guardian(p_player uuid, p_parent uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform require_auth();
  if not can_manage_player(p_player) then raise exception 'not allowed' using errcode = '42501'; end if;
  delete from guardianships where player_id = p_player and parent_id = p_parent;
  if not found then raise exception 'no such parent' using errcode = 'P0002'; end if;
end $$;

-- Staff of one of the parent's children correct the parent's name and phone (the email is the login, unchanged).
create function update_parent_profile(p_parent uuid, p_full_name text, p_phone text) returns void
language plpgsql security definer set search_path = public as $$
declare v_phone text := norm_phone(p_phone);
begin
  perform require_auth();
  if not exists (select 1 from guardianships where parent_id = p_parent and status = 'approved'
                 and can_manage_player(player_id)) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if v_phone is not null and exists (select 1 from profiles where phone = v_phone and id <> p_parent) then
    raise exception 'this phone number belongs to another account' using errcode = '23505';
  end if;
  update profiles set full_name = coalesce(nullif(btrim(p_full_name), ''), full_name), phone = v_phone
   where id = p_parent;
end $$;

-- A club admin deletes a child from the club, with everything recorded about them.
create function delete_player(p_player uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_club uuid;
begin
  perform require_auth();
  select club_id into v_club from players where id = p_player;
  if v_club is null then raise exception 'not found' using errcode = 'P0002'; end if;
  if not is_club_admin(v_club) then raise exception 'not allowed' using errcode = '42501'; end if;
  delete from attribute_values where entity_id = p_player;
  delete from players where id = p_player;
end $$;

-- A child's parents: linked accounts (kind 'account', id = the profile) and contacts (kind 'contact', id = the
-- contact row), for whoever may see the child's parents.
create function player_parents(p_player uuid)
returns table (kind text, id uuid, full_name text, avatar_path text, relation_id uuid, phone text, email text)
language sql stable security definer set search_path = public as $$
  select * from (
    select 'account'::text, g.parent_id, coalesce(nullif(pr.full_name, ''), pr.email, ''), pr.avatar_path,
           g.relation_id, pr.phone, pr.email
      from guardianships g join profiles pr on pr.id = g.parent_id
     where g.player_id = p_player and g.status = 'approved'
    union all
    select 'contact', c.id, c.full_name, null, c.relation_id, c.phone, c.email
      from guardian_contacts c where c.player_id = p_player
  ) x
  where can_manage_player(p_player) or is_parent_of(p_player) or is_self_player(p_player)
  order by 1, 3
$$;

-- The roster: one row per child with teams and parents (jsonb array in the shape of player_parents).
-- Club admins see the whole club, coaches the children of the teams they coach. p_team narrows it.
create function club_roster(p_club uuid, p_team uuid default null)
returns table (player_id uuid, full_name text, birth_date date, phone text, email text, team_ids uuid[],
               team_names text, parents jsonb)
language sql stable security definer set search_path = public as $$
  select p.id, p.full_name, p.birth_date, p.phone,
         (select email from profiles where id = p.user_id),
         coalesce((select array_agg(t.id order by t.name) from team_players tp join teams t on t.id = tp.team_id
                    where tp.player_id = p.id), '{}'),
         coalesce((select string_agg(t.name, ', ' order by t.name) from team_players tp join teams t on t.id = tp.team_id
                    where tp.player_id = p.id), ''),
         coalesce((select jsonb_agg(jsonb_build_object('kind', x.kind, 'id', x.id, 'full_name', x.full_name,
                    'relation_id', x.relation_id, 'phone', x.phone, 'email', x.email) order by x.kind, x.full_name)
                    from player_parents(p.id) x), '[]')
    from players p
   where p.club_id = p_club
     and (is_club_admin(p_club) or coaches_player(p.id))
     and (p_team is null or exists (select 1 from team_players where team_id = p_team and player_id = p.id))
   order by p.full_name
$$;

-- Team contacts (0027) also list guardians kept as contacts.
create or replace function team_contacts(p_team uuid)
returns table (kind text, person_id uuid, full_name text, avatar_path text, email text, phone text,
               staff_role_id uuid, note text)
language sql stable security definer set search_path = public as $$
  with t as (select id, club_id from teams where id = p_team and is_team_member(p_team))
  select 'admin', pr.id, coalesce(nullif(pr.full_name, ''), pr.email, ''), pr.avatar_path, pr.email, pr.phone,
         null::uuid, null::text
    from t join memberships m on m.club_id = t.club_id and m.role = 'club_admin' and m.team_id is null
    join profiles pr on pr.id = m.user_id
  union all
  select 'staff', pr.id, coalesce(nullif(pr.full_name, ''), pr.email, ''), pr.avatar_path, pr.email, pr.phone,
         m.staff_role_id, null
    from t join memberships m on m.team_id = t.id and m.role = 'coach'
    join profiles pr on pr.id = m.user_id
  union all
  select 'parent', pr.id, coalesce(nullif(pr.full_name, ''), pr.email, ''), pr.avatar_path, pr.email, pr.phone,
         null, string_agg(p.full_name, ', ' order by p.full_name)
    from t join team_players tp on tp.team_id = t.id
    join guardianships g on g.player_id = tp.player_id and g.status = 'approved'
    join players p on p.id = tp.player_id
    join profiles pr on pr.id = g.parent_id
   group by pr.id
  union all
  select 'parent', c.id, c.full_name, null, c.email, c.phone, null, p.full_name
    from t join team_players tp on tp.team_id = t.id
    join guardian_contacts c on c.player_id = tp.player_id
    join players p on p.id = tp.player_id
  union all
  select 'player', p.id, p.full_name, null, (select email from profiles where id = p.user_id), p.phone, null, null
    from t join team_players tp on tp.team_id = t.id join players p on p.id = tp.player_id
  order by 1, 3
$$;

-- Signing in with an email that a guardian contact carries links the new account to the child.
create or replace function handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_email text := norm_email(new.email); v_id uuid;
begin
  insert into profiles (id, phone, email, full_name)
  values (new.id, norm_phone(new.phone), v_email,
          coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name', ''));
  if v_email is not null then
    perform claim_invites(new.id, v_email);
    for v_id in select id from guardian_contacts where email = v_email loop
      perform resolve_guardian_contact(v_id);
    end loop;
  end if;
  return new;
end $$;

-- Join form: the parent's own relation to the children, and optionally the other parent
-- (p_other_parent: {"full_name", "relation_id"?, "phone"?, "email"?}), added to every child on approval.
drop function submit_join_request(text, text, text, text, jsonb, uuid);
create function submit_join_request(p_code text, p_role text, p_full_name text, p_phone text default null,
  p_children jsonb default '[]', p_staff_role uuid default null, p_relation uuid default null,
  p_other_parent jsonb default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := require_auth();
  v_team uuid;
  v_children jsonb := '[]';
  v_phone text := norm_phone(p_phone);
  v_other jsonb;
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
    if p_relation is not null and not lookup_in_domain(p_relation, 'guardian_relation') then
      raise exception 'unknown relation' using errcode = '22023';
    end if;
    if p_other_parent is not null and length(btrim(coalesce(p_other_parent ->> 'full_name', ''))) > 0 then
      if nullif(btrim(coalesce(p_other_parent ->> 'email', '')), '') is not null
         and norm_email(p_other_parent ->> 'email') is null then
        raise exception 'invalid email of the other parent' using errcode = '22023';
      end if;
      if norm_email(p_other_parent ->> 'email') = (select email from profiles where id = v_uid) then
        raise exception 'the other parent needs their own email' using errcode = '22023';
      end if;
      if nullif(p_other_parent ->> 'relation_id', '') is not null
         and not lookup_in_domain((p_other_parent ->> 'relation_id')::uuid, 'guardian_relation') then
        raise exception 'unknown relation' using errcode = '22023';
      end if;
      v_other := jsonb_build_object('full_name', btrim(p_other_parent ->> 'full_name'),
        'relation_id', nullif(p_other_parent ->> 'relation_id', ''),
        'phone', norm_phone(p_other_parent ->> 'phone'), 'email', norm_email(p_other_parent ->> 'email'));
    end if;
  end if;

  update profiles set full_name = btrim(p_full_name), phone = coalesce(v_phone, phone) where id = v_uid;
  insert into join_requests (team_id, user_id, role, full_name, phone, children, staff_role_id, relation_id, other_parent)
  values (v_team, v_uid, p_role, btrim(p_full_name), v_phone, v_children,
          case when p_role = 'coach' then p_staff_role end,
          case when p_role = 'parent' then p_relation end, v_other)
  returning id into v_id;

  v_as := case when p_role = 'parent' then 'הורה'
               else coalesce((select name_he from lookups where id = p_staff_role), 'מאמן') end;
  perform notify(join_deciders(v_team, p_role), 'בקשת הצטרפות חדשה',
    btrim(p_full_name) || ' מבקש/ת להצטרף כ' || v_as || ' לקבוצה ' || (select name from teams where id = v_team),
    '/requests', true);
  return v_id;
end $$;

-- As in 0026; an approved parent gets the relation they gave, and the other parent is added to every child.
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
        insert into guardianships (parent_id, player_id, requested_by, status, approved_by, relation_id)
        values (r.user_id, v_player, r.user_id, 'approved', v_uid, r.relation_id)
        on conflict (parent_id, player_id) do update
          set status = 'approved', approved_by = v_uid, relation_id = coalesce(excluded.relation_id, guardianships.relation_id);
        if c ->> 'email' is not null
           and not exists (select 1 from players where id = v_player and user_id is not null) then
          begin
            perform link_player_email(v_player, c ->> 'email');
          exception when unique_violation then null;
          end;
        end if;
        if r.other_parent is not null then
          begin
            perform attach_guardian(v_player, r.other_parent ->> 'full_name', (r.other_parent ->> 'relation_id')::uuid,
              r.other_parent ->> 'phone', r.other_parent ->> 'email', r.user_id);
          exception when unique_violation then null;  -- already a parent of a matched child
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
               phone text, avatar_path text, children jsonb, created_at timestamptz, relation_id uuid,
               other_parent jsonb)
language sql stable security definer set search_path = public as $$
  select r.id, r.team_id, t.name, r.role, r.staff_role_id, r.full_name, pr.email, r.phone, pr.avatar_path,
         r.children, r.created_at, r.relation_id, r.other_parent
  from join_requests r join teams t on t.id = r.team_id join profiles pr on pr.id = r.user_id
  where r.status = 'pending' and can_decide_join(r.team_id, r.role)
  order by r.created_at
$$;

revoke execute on function resolve_guardian_contact(uuid), attach_guardian(uuid, text, uuid, text, text, uuid)
  from public, anon, authenticated;
revoke execute on function add_guardian(uuid, text, uuid, text, text), update_guardian_contact(uuid, text, uuid, text, text),
  remove_guardian_contact(uuid), unlink_guardian(uuid, uuid), update_parent_profile(uuid, text, text),
  delete_player(uuid), player_parents(uuid), club_roster(uuid, uuid),
  submit_join_request(text, text, text, text, jsonb, uuid, uuid, jsonb), pending_join_requests()
from public, anon;
grant execute on function add_guardian(uuid, text, uuid, text, text), update_guardian_contact(uuid, text, uuid, text, text),
  remove_guardian_contact(uuid), unlink_guardian(uuid, uuid), update_parent_profile(uuid, text, text),
  delete_player(uuid), player_parents(uuid), club_roster(uuid, uuid),
  submit_join_request(text, text, text, text, jsonb, uuid, uuid, jsonb), pending_join_requests()
to authenticated;
