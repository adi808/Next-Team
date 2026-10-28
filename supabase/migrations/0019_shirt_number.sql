-- Next Team: the player's shirt number (1-99), a regular player parameter for every sport.
insert into attribute_defs (scope, key, label_he, data_type, config, visible_to, editable_by, sort_order) values
  ('player', 'shirt_number', 'מספר חולצה', 'number', '{"min": 1, "max": 99}',
   array['system_admin','club_admin','coach','parent','player'], array['system_admin','club_admin','coach'], -3);
