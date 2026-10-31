-- A player's login email that has no account yet is kept as a pending invite. Linking a new email replaces the
-- old pending invite (a mistyped address no longer stays waiting), and managers/parents can see and cancel it.

create or replace function link_player_email(p_player uuid, p_email text) returns void
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
  end if;
  delete from invites where player_id = p_player and role = 'player' and status = 'pending';
  if v_target is not null then
    update players set user_id = v_target where id = p_player;
  else
    insert into invites (email, club_id, role, invited_by, player_id)
    values (v_email, v_club, 'player', v_uid, p_player);
  end if;
end $$;

-- The email waiting for the player to sign in, for staff and the player's parents.
create function player_email_invite(p_player uuid) returns text
language sql stable security definer set search_path = public as $$
  select i.email from invites i
  where i.player_id = p_player and i.role = 'player' and i.status = 'pending'
    and (can_manage_player(p_player) or is_parent_of(p_player))
  order by i.created_at desc limit 1
$$;

create function cancel_player_email_invite(p_player uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform require_auth();
  if not (can_manage_player(p_player) or is_parent_of(p_player)) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  delete from invites where player_id = p_player and role = 'player' and status = 'pending';
end $$;

revoke execute on function player_email_invite(uuid), cancel_player_email_invite(uuid) from public, anon;
grant execute on function player_email_invite(uuid), cancel_player_email_invite(uuid) to authenticated;
