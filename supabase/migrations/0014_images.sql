-- Next Team: a picture for each club (logo), team and account (avatar).
-- Files live in private buckets and are read through signed URLs, so storage policies decide who sees them:
--   club-media/clubs/<club_id>/...   club members read, club admins upload
--   club-media/teams/<team_id>/...   club members read, the team's coach or club admin upload
--   avatars/<user_id>/...            whoever may see the profile reads, only the owner uploads
-- Every upload gets a new file name, so the only write policy is insert.

alter table clubs add column logo_path text;
alter table teams add column photo_path text;
alter table profiles add column avatar_path text;

do $$
begin
  if to_regclass('storage.objects') is null then
    raise notice 'storage schema not found; skipping image buckets';
    return;
  end if;
  execute $p$insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
  ('club-media', 'club-media', false, 2097152, array['image/jpeg', 'image/png', 'image/webp']),
  ('avatars', 'avatars', false, 2097152, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing$p$;
  execute $p$create policy club_media_read on storage.objects for select to authenticated using (
  bucket_id = 'club-media' and case (storage.foldername(name))[1]
    when 'clubs' then is_club_member(((storage.foldername(name))[2])::uuid)
    when 'teams' then is_club_member((select club_id from teams where id = ((storage.foldername(name))[2])::uuid))
    else false end)$p$;
  execute $p$create policy club_media_upload on storage.objects for insert to authenticated with check (
  bucket_id = 'club-media' and case (storage.foldername(name))[1]
    when 'clubs' then is_club_admin(((storage.foldername(name))[2])::uuid)
    when 'teams' then can_manage_team(((storage.foldername(name))[2])::uuid)
    else false end)$p$;
  execute $p$create policy avatars_read on storage.objects for select to authenticated using (
  bucket_id = 'avatars' and ((storage.foldername(name))[1] = auth.uid()::text
    or profile_visible(((storage.foldername(name))[1])::uuid)))$p$;
  execute $p$create policy avatars_upload on storage.objects for insert to authenticated with check (
  bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text)$p$;
end $$;

-- Point a club, team or account at an uploaded picture (null clears it). The path must sit in that entity's folder.
create function set_club_logo(p_club uuid, p_path text) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform require_auth();
  if not is_club_admin(p_club) then raise exception 'not allowed' using errcode = '42501'; end if;
  if p_path is not null and p_path not like 'clubs/' || p_club || '/%' then
    raise exception 'invalid path' using errcode = '22023';
  end if;
  update clubs set logo_path = p_path where id = p_club;
end $$;

create function set_team_photo(p_team uuid, p_path text) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform require_auth();
  if not can_manage_team(p_team) then raise exception 'not allowed' using errcode = '42501'; end if;
  if p_path is not null and p_path not like 'teams/' || p_team || '/%' then
    raise exception 'invalid path' using errcode = '22023';
  end if;
  update teams set photo_path = p_path where id = p_team;
end $$;

create function set_my_avatar(p_path text) returns void
language plpgsql security definer set search_path = public as $$
declare v_uid uuid := require_auth();
begin
  if p_path is not null and p_path not like v_uid || '/%' then
    raise exception 'invalid path' using errcode = '22023';
  end if;
  update profiles set avatar_path = p_path where id = v_uid;
end $$;

revoke execute on function set_club_logo(uuid, text), set_team_photo(uuid, text), set_my_avatar(text) from public, anon;
grant execute on function set_club_logo(uuid, text), set_team_photo(uuid, text), set_my_avatar(text) to authenticated;
