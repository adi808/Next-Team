import { supabase } from './supabase';
import { armResume } from './place';

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

const withTimeout = <T,>(p: Promise<T>, ms: number, what: string): Promise<T> =>
  Promise.race([p, new Promise<T>((_, rej) => setTimeout(() => rej(new Error(`${what}: timed out after ${ms / 1000}s`)), ms))]);

/** Turns push on for this device. Each step names itself in the error, so a failure shows where it stopped. */
const WANT = 'wantsPush';
/** True when the user pressed "enable" and the subscription has not been saved yet (the app may have restarted). */
export function wantsPush(): boolean {
  try { return localStorage.getItem(WANT) === '1'; } catch { return false; }
}
function setWant(on: boolean) {
  try { if (on) localStorage.setItem(WANT, '1'); else localStorage.removeItem(WANT); } catch { /* storage may be unavailable */ }
}

export async function enablePush(): Promise<PushState> {
  if (!(await pushSupported())) return 'unsupported';
  setWant(true);
  armResume();
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') { setWant(false); return perm === 'denied' ? 'denied' : 'off'; }
  const reg = await withTimeout(navigator.serviceWorker.ready, 8000, 'service worker is not ready');
  let sub = await reg.pushManager.getSubscription();
  if (!sub) {
    try {
      sub = await withTimeout(
        reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes((await vapidKey())!) }),
        15000, 'push subscribe');
    } catch (e) {
      throw new Error(`subscribe: ${(e as Error).name}: ${(e as Error).message}`);
    }
  }
  const json = sub.toJSON();
  const { error } = await supabase.rpc('save_push_subscription', {
    p_endpoint: sub.endpoint,
    p_p256dh: json.keys?.p256dh,
    p_auth: json.keys?.auth,
  });
  if (error) throw new Error(`save: ${error.message}`);
  setWant(false);
  return 'on';
}

export async function disablePush(): Promise<PushState> {
  setWant(false);
  const reg = await navigator.serviceWorker.getRegistration();
  const sub = await reg?.pushManager.getSubscription();
  if (sub) {
    await supabase.rpc('delete_push_subscription', { p_endpoint: sub.endpoint });
    await sub.unsubscribe();
  }
  return 'off';
}

/** Shows a notification from the page itself (no server): tells a phone setting problem from a delivery problem. */
export async function showLocalTest(): Promise<void> {
  const reg = await navigator.serviceWorker.ready;
  await reg.showNotification('בדיקה מקומית', { body: 'ההתראה הזו הופקה במכשיר עצמו, בלי שרת.', lang: 'he', dir: 'rtl', tag: 'local-test' });
}

/** One line per fact about push on this device, to read out when notifications do not appear. */
export async function pushDiagnostics(): Promise<string[]> {
  const out: string[] = [];
  out.push(`הרשאה: ${'Notification' in window ? Notification.permission : 'אין תמיכה'}`);
  const reg = 'serviceWorker' in navigator ? await navigator.serviceWorker.getRegistration() : undefined;
  out.push(`רקע האפליקציה: ${reg ? (reg.active ? 'פעיל' : reg.installing ? 'מתקין' : reg.waiting ? 'ממתין לעדכון' : 'לא פעיל') : 'לא רשום'}`);
  out.push(`מכשיר רשום להתראות: ${(await reg?.pushManager.getSubscription()) ? 'כן' : 'לא'}`);
  try {
    const sw = await (await fetch('/sw.js', { cache: 'no-store' })).text();
    out.push(`קוד ההתראות בגרסה שבאתר: ${sw.includes('push-handler') ? 'קיים' : 'חסר'}`);
    const h = await fetch('/push-handler.js', { cache: 'no-store' });
    out.push(`קובץ ההתראות: ${h.ok && (h.headers.get('content-type') ?? '').includes('javascript') ? 'תקין' : `לא תקין (${h.status}, ${h.headers.get('content-type')})`}`);
  } catch {
    out.push('לא הצלחתי לבדוק את קובץ ההתראות');
  }
  return out;
}
