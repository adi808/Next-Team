-- Next Kick C1: row level security

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
