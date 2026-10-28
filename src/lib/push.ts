import { supabase } from './supabase';

export type PushState = 'unsupported' | 'denied' | 'off' | 'on';

// The public half of the Web Push key pair, kept in Vault by the send-push function (0025).
let publicKey: Promise<string | null> | null = null;
function vapidKey(): Promise<string | null> {
  publicKey ??= Promise.resolve(supabase.rpc('push_public_key')).then(({ data }) => (data as string | null) ?? null);
  return publicKey;
}

// On iPhone, push works only in the app added to the home screen (iOS 16.4+), where PushManager exists.
async function pushSupported(): Promise<boolean> {
  return (
    'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window && Boolean(await vapidKey())
  );
}

export async function pushState(): Promise<PushState> {
  if (!(await pushSupported())) return 'unsupported';
  if (Notification.permission === 'denied') return 'denied';
  const reg = await navigator.serviceWorker.getRegistration();
  const sub = await reg?.pushManager.getSubscription();
  return sub ? 'on' : 'off';
}

function keyBytes(base64url: string): Uint8Array<ArrayBuffer> {
  const pad = '='.repeat((4 - (base64url.length % 4)) % 4);
  const raw = atob((base64url + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

export async function enablePush(): Promise<PushState> {
  if (!(await pushSupported())) return 'unsupported';
  if ((await Notification.requestPermission()) !== 'granted') return 'denied';
  const reg = await navigator.serviceWorker.ready;
  const sub =
    (await reg.pushManager.getSubscription()) ??
    (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes((await vapidKey())!) }));
  const json = sub.toJSON();
  const { error } = await supabase.rpc('save_push_subscription', {
    p_endpoint: sub.endpoint,
    p_p256dh: json.keys?.p256dh,
    p_auth: json.keys?.auth,
  });
  if (error) throw error;
  return 'on';
}

export async function disablePush(): Promise<PushState> {
  const reg = await navigator.serviceWorker.getRegistration();
  const sub = await reg?.pushManager.getSubscription();
  if (sub) {
    await supabase.rpc('delete_push_subscription', { p_endpoint: sub.endpoint });
    await sub.unsubscribe();
  }
  return 'off';
}
