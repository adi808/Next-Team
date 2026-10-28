// Sends one notification (0023) by email through Brevo, for notifications marked email = true (0026), such as a
// new join request to the people who decide it. Called by the notifications_email trigger through pg_net,
// authenticated by the shared x-hook-secret header, so deploy with verify_jwt = false.
// Secrets: BREVO_API_KEY, MAIL_FROM (a sender verified in Brevo), APP_URL (the site, for the link).
// Without BREVO_API_KEY the call does nothing, and the notification stays in-app (and push).
import { createClient } from 'npm:@supabase/supabase-js@2.45.4';

interface Mail {
  email: string | null;
  full_name: string;
  title: string;
  body: string;
  url: string;
  hook_secret: string | null;
}

const env = (name: string) => {
  const v = Deno.env.get(name);
  if (!v) throw new Error(`missing ${name}`);
  return v;
};

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

function html(m: Mail, link: string) {
  return `<div dir="rtl" style="font-family:Arial,sans-serif;font-size:16px;color:#0f172a;max-width:520px">
  <h2 style="color:#0b1f4d;margin:0 0 12px">${esc(m.title)}</h2>
  <p style="margin:0 0 20px">${esc(m.body)}</p>
  <a href="${esc(link)}" style="display:inline-block;padding:12px 22px;border-radius:10px;background:#2563eb;color:#fff;text-decoration:none;font-weight:bold">לפתיחה ב־Next Team</a>
  <p style="color:#64748b;font-size:13px;margin-top:24px">המייל נשלח אוטומטית מ־Next Team.</p>
</div>`;
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response('method not allowed', { status: 405 });
  const { id } = await req.json().catch(() => ({ id: null }));
  if (!id) return new Response('missing id', { status: 400 });

  const db = createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'), { auth: { persistSession: false } });
  const { data } = await db.rpc('notification_email', { p_id: id }).maybeSingle();
  const m = data as Mail | null;
  if (!m?.hook_secret || req.headers.get('x-hook-secret') !== m.hook_secret) {
    return new Response('forbidden', { status: 403 });
  }
  const key = Deno.env.get('BREVO_API_KEY');
  if (!key || !m.email) return new Response('skipped', { status: 200 });

  const app = (Deno.env.get('APP_URL') ?? '').replace(/\/$/, '');
  const link = app + (m.url.startsWith('/') ? m.url : `/${m.url}`);
  const r = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: { 'api-key': key, 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      sender: { name: 'Next Team', email: env('MAIL_FROM') },
      to: [{ email: m.email, ...(m.full_name ? { name: m.full_name } : {}) }],
      subject: m.title,
      htmlContent: html(m, link),
      textContent: `${m.title}\n\n${m.body}\n\n${link}`,
    }),
  });
  if (!r.ok) return new Response(`brevo ${r.status}: ${await r.text()}`, { status: 502 });
  return new Response('sent', { status: 200 });
});
