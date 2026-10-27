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
