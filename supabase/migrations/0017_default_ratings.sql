-- Next Team: default professional ratings (1-10) for each sport, so a new team can rate players right away.
-- Like any parameter they are rows in attribute_defs: a club or team adds its own, and staff see the history.
-- Keys carry the sport (football_speed) because a key is unique per scope, club and team.
insert into attribute_defs (scope, key, label_he, data_type, config, visible_to, editable_by, sport_id, sort_order)
select 'player', v.sport || '_' || v.key, v.label_he, 'scale', '{"min": 1, "max": 10}',
       array['system_admin','club_admin','coach','parent','player'], array['system_admin','club_admin','coach'], s.id, v.sort_order
from (values
  ('football', 'technique', 'טכניקה', 1),
  ('football', 'speed', 'מהירות', 2),
  ('football', 'game_sense', 'הבנת משחק', 3),
  ('football', 'teamwork', 'עבודת צוות', 4),
  ('football', 'fitness', 'כושר גופני', 5),
  ('basketball', 'shooting', 'קליעה', 1),
  ('basketball', 'dribbling', 'כדרור', 2),
  ('basketball', 'defense', 'הגנה', 3),
  ('basketball', 'teamwork', 'עבודת צוות', 4),
  ('basketball', 'fitness', 'כושר גופני', 5)
) as v(sport, key, label_he, sort_order)
join sports s on s.slug = v.sport;
