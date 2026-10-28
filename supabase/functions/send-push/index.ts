// Delivers one notification (0023) to every device its recipient subscribed (0024).
// Called by the notifications_push trigger through pg_net, authenticated by the shared x-hook-secret header,
// so deploy with verify_jwt = false. The hook secret and VAPID keys live in Vault (push_config(), 0024);
// the first call makes the key pair if there is none yet (0025), so a plain GET sets push up.
import webpush from 'npm:web-push@3.6.7';
import { createClient } from 'npm:@supabase/supabase-js@2.45.4';

interface Config {
  hook_secret: string | null;
  vapid_public_key: string | null;
  vapid_private_key: string | null;
  vapid_subject: string | null;
}

const env = (name: string) => {
  const v = Deno.env.get(name);
  if (!v) throw new Error(`missing ${name}`);
  return v;
};

Deno.serve(async (req) => {
  const db = createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'), {
    auth: { persistSession: false },
  });
  const config = async () => (await db.rpc('push_config').single()).data as Config | null;

  let cfg = await config();
  if (!cfg?.vapid_public_key) {
    const keys = webpush.generateVAPIDKeys();
    await db.rpc('push_store_vapid', {
      p_public: keys.publicKey,
      p_private: keys.privateKey,
      p_subject: 'https://next-team.pages.dev',
    });
    cfg = await config();
  }
  if (req.method === 'GET') return new Response(cfg?.vapid_public_key ? 'push keys ready' : 'push keys missing');

  if (!cfg?.hook_secret || !cfg.vapid_public_key || !cfg.vapid_private_key || !cfg.vapid_subject) {
    return new Response('push is not configured', { status: 503 });
  }
  if (req.method !== 'POST' || req.headers.get('x-hook-secret') !== cfg.hook_secret) {
    return new Response('forbidden', { status: 403 });
  }
  const { id } = await req.json().catch(() => ({ id: null }));
  if (typeof id !== 'string') return new Response('bad request', { status: 400 });
  const { data: n } = await db.from('notifications').select('user_id, title, body, url').eq('id', id).single();
  if (!n) return new Response('not found', { status: 404 });
  const { data: subs } = await db
    .from('push_subscriptions')
    .select('id, endpoint, p256dh, auth')
    .eq('user_id', n.user_id);

  webpush.setVapidDetails(cfg.vapid_subject, cfg.vapid_public_key, cfg.vapid_private_key);
  const payload = JSON.stringify({ title: n.title, body: n.body, url: n.url });
  let sent = 0;
  for (const s of subs ?? []) {
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload);
      sent++;
    } catch (e) {
      const status = (e as { statusCode?: number }).statusCode;
      // The browser dropped this subscription; forget it.
      if (status === 404 || status === 410) await db.from('push_subscriptions').delete().eq('id', s.id);
      else console.error('push failed', status, (e as Error).message);
    }
  }
  return Response.json({ sent });
});
