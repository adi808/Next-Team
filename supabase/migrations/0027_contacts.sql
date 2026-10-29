-- Next Team: contact details (phone and email) for every party, and a team contact list.
-- Profiles (club admin, staff, parents) already carry email (the login) and phone (update_my_profile, 0023);
-- players carry phone (set_player_phone) and the email of their own account; clubs gain an email next to
-- phone, address and website. Phone is never required.
-- Everyone on a team sees everyone's contact details on that team: the club's admins, the staff, the parents
-- (with their children's names) and the players.

alter table clubs add column email text;

drop function update_club_details(uuid, text, text, text);
create function update_club_details(p_club uuid, p_phone text, p_email text, p_address text, p_website text)
returns void
language plpgsql security definer set search_path = public as $$
begin
  perform require_auth();
  if not is_club_admin(p_club) then raise exception 'not allowed' using errcode = '42501'; end if;
  if nullif(btrim(coalesce(p_email, '')), '') is not null and norm_email(p_email) is null then
    raise exception 'invalid email' using errcode = '22023';
  end if;
  update clubs set phone = norm_phone(p_phone), email = norm_email(p_email),
         address = coalesce(btrim(p_address), ''), website = coalesce(btrim(p_website), '')
   where id = p_club;
end $$;

-- The team's people with their contact details, for any member of the team. kind: admin (club admin),
-- staff (team staff; staff_role_id is their type), parent (note lists the children on this team), player.
create function team_contacts(p_team uuid)
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
  select 'player', p.id, p.full_name, null, (select email from profiles where id = p.user_id), p.phone, null, null
    from t join team_players tp on tp.team_id = t.id join players p on p.id = tp.player_id
  order by 1, 3
$$;

revoke execute on function update_club_details(uuid, text, text, text, text), team_contacts(uuid) from public, anon;
grant execute on function update_club_details(uuid, text, text, text, text), team_contacts(uuid) to authenticated;
