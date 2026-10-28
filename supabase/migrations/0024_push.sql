-- Next Team: free Web Push. Each device that allows notifications saves its subscription here; every new row
-- in notifications (0023) is posted to the send-push Edge Function, which delivers it to the recipient's devices.
-- Configuration lives in Vault: push_hook_url and push_hook_secret (read by the trigger), vapid_public_key,
-- vapid_private_key and vapid_subject (read by the function through push_config()). Without them notifications
-- stay in-app only.

do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_net') then
    create extension if not exists pg_net with schema extensions;
  else
    raise notice 'pg_net not available; push hook disabled';
  end if;
end $$;

create table push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles (id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  created_at timestamptz not null default now()
);
create index push_subscriptions_user_idx on push_subscriptions (user_id);
alter table push_subscriptions enable row level security;
create policy push_subscriptions_select on push_subscriptions for select using (user_id = auth.uid());
grant select on push_subscriptions to authenticated;

-- The Edge Function reads with the service role.
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant select on notifications to service_role;
    grant select, delete on push_subscriptions to service_role;
  end if;
end $$;

create function save_push_subscription(p_endpoint text, p_p256dh text, p_auth text) returns void
language plpgsql security definer set search_path = public as $$
declare v_uid uuid := require_auth();
begin
  if coalesce(p_endpoint, '') !~ '^https://' or coalesce(p_p256dh, '') = '' or coalesce(p_auth, '') = '' then
    raise exception 'invalid subscription' using errcode = '22023';
  end if;
  insert into push_subscriptions (user_id, endpoint, p256dh, auth) values (v_uid, p_endpoint, p_p256dh, p_auth)
  on conflict (endpoint) do update set user_id = v_uid, p256dh = excluded.p256dh, auth = excluded.auth;
end $$;

create function delete_push_subscription(p_endpoint text) returns void
language sql security definer set search_path = public as $$
  delete from push_subscriptions where endpoint = p_endpoint and user_id = auth.uid()
$$;

create function push_notification() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_url text; v_secret text;
begin
  if to_regnamespace('net') is null or to_regclass('vault.decrypted_secrets') is null then return new; end if;
  execute 'select max(decrypted_secret) filter (where name = ''push_hook_url''),
                  max(decrypted_secret) filter (where name = ''push_hook_secret'')
             from vault.decrypted_secrets where name in (''push_hook_url'', ''push_hook_secret'')'
    into v_url, v_secret;
  if v_url is null or v_secret is null then return new; end if;
  execute 'select net.http_post(url := $1, body := $2, headers := $3)'
    using v_url, jsonb_build_object('id', new.id),
          jsonb_build_object('Content-Type', 'application/json', 'x-hook-secret', v_secret);
  return new;
exception when others then
  raise warning 'push hook failed: %', sqlerrm;
  return new;
end $$;
create trigger notifications_push after insert on notifications
  for each row execute function push_notification();

-- For the send-push function only (service role): the hook secret and the VAPID keys.
create function push_config()
returns table (hook_secret text, vapid_public_key text, vapid_private_key text, vapid_subject text)
language plpgsql stable security definer set search_path = public as $$
begin
  if to_regclass('vault.decrypted_secrets') is null then return; end if;
  return query execute
    'select max(decrypted_secret) filter (where name = ''push_hook_secret''),
            max(decrypted_secret) filter (where name = ''vapid_public_key''),
            max(decrypted_secret) filter (where name = ''vapid_private_key''),
            max(decrypted_secret) filter (where name = ''vapid_subject'')
       from vault.decrypted_secrets';
end $$;

revoke execute on function save_push_subscription(text, text, text), delete_push_subscription(text),
  push_notification(), push_config() from public, anon;
revoke execute on function push_config(), push_notification() from authenticated;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function push_config() to service_role;
  end if;
end $$;
grant execute on function save_push_subscription(text, text, text), delete_push_subscription(text) to authenticated;
