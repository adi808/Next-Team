-- Next Team: what to bring to an event (several items from a list), and more player parameters:
-- field player or goalkeeper, a default position, and the strong foot.

-- Items to bring: a regular list (lookups domain "equipment"), so clubs add or retire items without code.
insert into lookups (domain, slug, name_he, sort_order) values
  ('equipment', 'water', 'בקבוק מים', 1),
  ('equipment', 'boots', 'נעלי כדורגל', 2),
  ('equipment', 'shin_guards', 'מגני שוקיים', 3),
  ('equipment', 'sport_shoes', 'נעלי ספורט', 4),
  ('equipment', 'ball', 'כדור', 5),
  ('equipment', 'towel', 'מגבת', 6),
  ('equipment', 'snack', 'כריך / פרי', 7),
  ('equipment', 'goalkeeper_gloves', 'כפפות שוער', 8);

alter table events add column equipment uuid[] not null default '{}';

-- Replaces the items to bring for an event; each one must be on the equipment list.
create function set_event_equipment(p_event uuid, p_items uuid[]) returns void
language plpgsql security definer set search_path = public as $$
declare v_team uuid := event_team(p_event);
begin
  perform require_auth();
  if v_team is null or not can_manage_team(v_team) then raise exception 'not allowed' using errcode = '42501'; end if;
  if exists (select 1 from unnest(coalesce(p_items, '{}')) i where not lookup_in_domain(i, 'equipment')) then
    raise exception 'unknown item' using errcode = '22023';
  end if;
  update events set equipment = (select coalesce(array_agg(distinct i), '{}') from unnest(coalesce(p_items, '{}')) i)
   where id = p_event;
end $$;

revoke execute on function set_event_equipment(uuid, uuid[]) from public, anon;
grant execute on function set_event_equipment(uuid, uuid[]) to authenticated;

-- Field player or goalkeeper (a list, so the goalkeeper flag lives in meta), for football.
insert into lookups (domain, slug, name_he, sport_id, sort_order, meta)
select 'player_kind', v.slug, v.name_he, s.id, v.sort_order, v.meta::jsonb
from (values ('field', 'שחקן שדה', 1, '{}'), ('goalkeeper', 'שוער', 2, '{"goalkeeper": true}')) as v(slug, name_he, sort_order, meta)
join sports s on s.slug = 'football';

insert into attribute_defs (scope, key, label_he, data_type, config, visible_to, editable_by, sport_id, sort_order)
select 'player', v.key, v.label_he, v.data_type, v.config::jsonb,
       array['system_admin','club_admin','coach','parent','player'], array['system_admin','club_admin','coach'], s.id, v.sort_order
from (values
  ('player_kind', 'שחקן שדה / שוער', 'lookup', '{"domain": "player_kind"}', -2),
  ('strong_foot', 'רגל חזקה', 'select', '{"options": ["ימין", "שמאל"]}', 1)
) as v(key, label_he, data_type, config, sort_order)
join sports s on s.slug = 'football';

-- The position parameter is the player's default role.
update attribute_defs set label_he = 'תפקיד ברירת מחדל', sort_order = -1
 where scope = 'player' and key = 'position' and club_id is null and team_id is null;
