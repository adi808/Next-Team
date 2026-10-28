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
