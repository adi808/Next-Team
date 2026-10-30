-- A parent account can exist before it has a child: profiles.is_parent opens the parent mode, where the
-- parent registers a child. Staff of a team register the child directly (add_my_child); anyone else uses
-- the team's join link, which the team's staff approve.
-- is_parent is not user-editable (profiles may only update full_name); a system admin sets it.

alter table profiles add column is_parent boolean not null default false;

create function add_my_child(p_team uuid, p_full_name text, p_birth_date date) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_uid uuid := require_auth(); v_club uuid; v_player uuid;
begin
  if not coalesce((select is_parent from profiles where id = v_uid), false) then
    raise exception 'not a parent account' using errcode = '42501';
  end if;
  select club_id into v_club from teams where id = p_team;
  if v_club is null then raise exception 'team not found' using errcode = 'P0002'; end if;
  if not can_manage_team(p_team) then
    raise exception 'only team staff can add a child directly; use the team join link' using errcode = '42501';
  end if;
  if length(btrim(coalesce(p_full_name, ''))) = 0 then raise exception 'a name is required' using errcode = '22023'; end if;
  if p_birth_date is null or p_birth_date > current_date or p_birth_date < current_date - interval '25 years' then
    raise exception 'invalid birth date' using errcode = '22023';
  end if;
  insert into players (club_id, full_name, birth_date, created_by)
  values (v_club, btrim(p_full_name), p_birth_date, v_uid) returning id into v_player;
  insert into team_players (team_id, player_id) values (p_team, v_player);
  insert into guardianships (parent_id, player_id, requested_by, status, approved_by)
  values (v_uid, v_player, v_uid, 'approved', v_uid);
  return v_player;
end $$;

revoke execute on function add_my_child(uuid, text, date) from public, anon;
grant execute on function add_my_child(uuid, text, date) to authenticated;

update profiles set is_parent = true where id = 'a1acbdcf-320e-440f-a45b-87024b93b162';
