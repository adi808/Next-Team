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

// A link into the app (for example an event shared on WhatsApp) opened while signed out: kept the same way.
const PATH_KEY = 'pendingPath';

export function rememberPath(path: string) {
  try { localStorage.setItem(PATH_KEY, path); } catch { /* storage may be unavailable */ }
}

export function pendingPath(): string | null {
  try { return localStorage.getItem(PATH_KEY); } catch { return null; }
}

export function forgetPath() {
  try { localStorage.removeItem(PATH_KEY); } catch { /* storage may be unavailable */ }
}

export const joinUrl = (code: string) => `${window.location.origin}/join/${code}`;
