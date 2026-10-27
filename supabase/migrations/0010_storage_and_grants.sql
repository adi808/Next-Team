-- Next Team: player photo storage (Supabase only) and function privileges.

create function can_see_photo(p_player uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select can_view_player(p_player)
     and (can_manage_player(p_player) or is_parent_of(p_player) or is_self_player(p_player)
          or coalesce((select photo_consent from players where id = p_player), false))
$$;

-- Bucket "player-photos": objects live under "<player_id>/<file>". Skipped where Supabase Storage
-- is absent (plain Postgres), and never fails the migration.
do $$
begin
  if to_regclass('storage.objects') is null then
    raise notice 'storage schema not found; skipping photo bucket';
    return;
  end if;
  begin
    insert into storage.buckets (id, name, public) values ('player-photos', 'player-photos', false)
    on conflict (id) do nothing;
    execute $p$create policy player_photos_read on storage.objects for select to authenticated
      using (bucket_id = 'player-photos' and can_see_photo(((storage.foldername(name))[1])::uuid))$p$;
    execute $p$create policy player_photos_write on storage.objects for insert to authenticated
      with check (bucket_id = 'player-photos'
        and (can_manage_player(((storage.foldername(name))[1])::uuid) or is_parent_of(((storage.foldername(name))[1])::uuid)))$p$;
    execute $p$create policy player_photos_update on storage.objects for update to authenticated
      using (bucket_id = 'player-photos'
        and (can_manage_player(((storage.foldername(name))[1])::uuid) or is_parent_of(((storage.foldername(name))[1])::uuid)))$p$;
    execute $p$create policy player_photos_delete on storage.objects for delete to authenticated
      using (bucket_id = 'player-photos'
        and (can_manage_player(((storage.foldername(name))[1])::uuid) or is_parent_of(((storage.foldername(name))[1])::uuid)))$p$;
  exception when others then
    raise warning 'could not create player photo storage policies: %', sqlerrm;
  end;
end $$;

-- Every function is callable by signed-in users (policies need the helpers), except the internal ones.
revoke execute on all functions in schema public from public, anon;
grant execute on all functions in schema public to authenticated;
revoke execute on function claim_invites(uuid, text), handle_new_user(), cleanup_attribute_values(),
  team_players_same_club() from authenticated;
