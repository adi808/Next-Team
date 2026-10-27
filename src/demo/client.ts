import { createClient } from '@supabase/supabase-js';
import { DemoServer } from './server';

export const demoServer = /*#__PURE__*/ new DemoServer();

const KEY = 'sb-demo-auth-token';
const store = /*#__PURE__*/ new Map<string, string>();
const memoryStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => { store.set(k, v); },
  removeItem: (k: string) => { store.delete(k); },
};

const b64 = (o: object) => btoa(JSON.stringify(o)).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');

/** Signs the demo session in as one of the sample people; the app re-reads it when it remounts. */
export function demoSignIn(userId: string) {
  const exp = Math.floor(Date.now() / 1000) + 10 * 365 * 86400;
  const profile = demoServer.t.profiles.find((p) => p.id === userId);
  demoServer.uid = userId;
  store.set(KEY, JSON.stringify({
    access_token: `${b64({ alg: 'none', typ: 'JWT' })}.${b64({ sub: userId, exp, role: 'authenticated' })}.demo`,
    refresh_token: 'demo', expires_in: exp, expires_at: exp, token_type: 'bearer',
    user: { id: userId, aud: 'authenticated', phone: profile?.phone, app_metadata: {}, user_metadata: {}, created_at: '2026-01-01T00:00:00Z' },
  }));
}

export function demoSupabase() {
  return createClient('http://demo.local', 'demo', {
    global: { fetch: demoServer.fetch },
    auth: { storage: memoryStorage, storageKey: KEY, persistSession: true, autoRefreshToken: false, detectSessionInUrl: false },
  });
}
