// Where the user was last inside the app. Enabling notifications can make the system restart the installed app,
// which then opens the start page; for a couple of minutes after that request the app returns to the same screen.
// Otherwise the start page keeps offering the choice of role.
const KEY = 'lastPlace';
const ARMED = 'resumeUntil';
const WINDOW_MS = 2 * 60_000;

export function rememberPlace(uid: string, path: string) {
  try { localStorage.setItem(KEY, JSON.stringify({ uid, path })); } catch { /* storage may be unavailable */ }
}

/** Called when the user asks for notifications: the next start within two minutes resumes where they were. */
export function armResume() {
  try { localStorage.setItem(ARMED, String(Date.now() + WINDOW_MS)); } catch { /* storage may be unavailable */ }
}

export function recentPlace(uid: string | undefined): string | null {
  try {
    if (Number(localStorage.getItem(ARMED) ?? 0) < Date.now()) return null;
    const v = JSON.parse(localStorage.getItem(KEY) ?? 'null') as { uid: string; path: string } | null;
    return v && v.uid === uid && v.path.startsWith('/m/') ? v.path : null;
  } catch {
    return null;
  }
}
