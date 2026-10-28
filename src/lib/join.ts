// A join link opened while signed out is kept here, so the user lands on it again after signing in
// (Google sign-in returns to the site root).
const KEY = 'pendingJoin';

export function rememberJoin(code: string) {
  try { localStorage.setItem(KEY, code); } catch { /* storage may be unavailable */ }
}

export function pendingJoin(): string | null {
  try { return localStorage.getItem(KEY); } catch { return null; }
}

export function forgetJoin() {
  try { localStorage.removeItem(KEY); } catch { /* storage may be unavailable */ }
}

export const joinUrl = (code: string) => `${window.location.origin}/join/${code}`;
