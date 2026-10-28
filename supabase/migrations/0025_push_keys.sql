-- Next Team: the Web Push key pair is made by the send-push function on its first call and kept in Vault, so the
-- private key never leaves the project. The app reads only the public key, at run time.
-- One-time setup per project (not a migration, the URL is project specific), run in the SQL editor:
--   select vault.create_secret('https://<project>.supabase.co/functions/v1/send-push', 'push_hook_url');
--   select vault.create_secret(replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''), 'push_hook_secret');
-- then open https://<project>.supabase.co/functions/v1/send-push once (a GET makes the keys).

-- Stores the key pair unless one is already stored. Service role only.
create function push_store_vapid(p_public text, p_private text, p_subject text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if to_regclass('vault.decrypted_secrets') is null then return; end if;
  if exists (select 1 from vault.secrets where name = 'vapid_public_key') then return; end if;
  perform vault.create_secret(p_public, 'vapid_public_key', 'Web Push public key');
  perform vault.create_secret(p_private, 'vapid_private_key', 'Web Push private key');
  perform vault.create_secret(p_subject, 'vapid_subject', 'Web Push contact');
end $$;

create function push_public_key() returns text
language plpgsql stable security definer set search_path = public as $$
declare v text;
begin
  if to_regclass('vault.decrypted_secrets') is null then return null; end if;
  execute 'select decrypted_secret from vault.decrypted_secrets where name = ''vapid_public_key''' into v;
  return v;
end $$;

revoke execute on function push_store_vapid(text, text, text), push_public_key() from public, anon;
revoke execute on function push_store_vapid(text, text, text) from authenticated;
grant execute on function push_public_key() to authenticated;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function push_store_vapid(text, text, text) to service_role;
  end if;
end $$;
