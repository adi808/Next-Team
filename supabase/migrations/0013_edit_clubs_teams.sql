-- Next Team: edit and delete clubs and teams from the app.
-- Club admins rename their club and edit or delete its teams; only a system admin deletes a club.
-- Deleting cascades: a team takes its events, tasks, surveys and chats; a club takes its teams and players.

create function update_club(p_club uuid, p_name text) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform require_auth();
  if not is_club_admin(p_club) then raise exception 'not allowed' using errcode = '42501'; end if;
  if coalesce(btrim(p_name), '') = '' then raise exception 'name is required' using errcode = '22023'; end if;
  update clubs set name = btrim(p_name) where id = p_club;
end $$;

create function delete_club(p_club uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform require_auth();
  if not is_system_admin() then raise exception 'only a system admin can delete a club' using errcode = '42501'; end if;
  delete from clubs where id = p_club;
end $$;

create function update_team(p_team uuid, p_name text, p_sport uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform require_auth();
  if not is_club_admin((select club_id from teams where id = p_team)) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if coalesce(btrim(p_name), '') = '' then raise exception 'name is required' using errcode = '22023'; end if;
  update teams set name = btrim(p_name), sport_id = coalesce(p_sport, sport_id) where id = p_team;
end $$;

create function delete_team(p_team uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform require_auth();
  if not is_club_admin((select club_id from teams where id = p_team)) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  delete from teams where id = p_team;
end $$;

revoke execute on function update_club(uuid, text), delete_club(uuid), update_team(uuid, text, uuid), delete_team(uuid)
  from public, anon;
grant execute on function update_club(uuid, text), delete_club(uuid), update_team(uuid, text, uuid), delete_team(uuid)
  to authenticated;
