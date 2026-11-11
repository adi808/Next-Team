-- Removes the demo data added to "טרום ב צו פיוס" on 2026-11-11 (7 children with their parents, parameters,
-- task assignments; one survey; two tasks). Run once in Supabase > SQL Editor. Events are not touched.
begin;
delete from storage.objects where bucket_id = 'player-photos' and name like any (array['a0cca793-3873-42b3-804a-82f9717becfd/%','af18fc10-d70d-4abd-8da0-9c9c3d0c96ed/%','9e81531d-580f-4479-8784-d53f6894dec2/%','75f008c9-2f55-43d8-9363-e7458535f6cf/%','d7ca4e27-47d5-4b66-a323-91704e520a77/%','4c7b1a97-ff91-492a-b17b-bed9ff5ddc2c/%','e31b90ad-313c-496a-acda-679ab992a7d0/%']);
delete from attribute_values where entity_id in ('a0cca793-3873-42b3-804a-82f9717becfd','af18fc10-d70d-4abd-8da0-9c9c3d0c96ed','9e81531d-580f-4479-8784-d53f6894dec2','75f008c9-2f55-43d8-9363-e7458535f6cf','d7ca4e27-47d5-4b66-a323-91704e520a77','4c7b1a97-ff91-492a-b17b-bed9ff5ddc2c','e31b90ad-313c-496a-acda-679ab992a7d0');
delete from surveys where id = '3e9260af-62f1-4115-9dc0-7c5db113af3c';
delete from tasks where id in ('8e42ca47-54da-4ab4-9d0e-82ac0bb4ed1a', 'e74f2621-b669-4d13-ab94-3dc25e2f8cf6');
delete from players where id in ('a0cca793-3873-42b3-804a-82f9717becfd','af18fc10-d70d-4abd-8da0-9c9c3d0c96ed','9e81531d-580f-4479-8784-d53f6894dec2','75f008c9-2f55-43d8-9363-e7458535f6cf','d7ca4e27-47d5-4b66-a323-91704e520a77','4c7b1a97-ff91-492a-b17b-bed9ff5ddc2c','e31b90ad-313c-496a-acda-679ab992a7d0');  -- also removes their team link and parent contacts
commit;
