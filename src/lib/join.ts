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

/** The code from a pasted join link, or from the bare code. */
export function parseJoinCode(text: string): string | null {
  const m = text.trim().match(/(?:\/join\/)?([A-Za-z0-9]{8,})\/?(?:[?#].*)?$/);
  return m ? m[1] : null;
}

export const joinUrl = (code: string) => `${window.location.origin}/join/${code}`;
