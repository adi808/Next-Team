// Where the user was last inside the app. When the system restarts the installed app (for example after the
// notification permission changes) it opens the start page; within a few minutes that returns to the same screen
// instead of the "how do you want to enter" choice.
const KEY = 'lastPlace';
const WINDOW_MS = 10 * 60_000;

export function rememberPlace(uid: string, path: string) {
  try { localStorage.setItem(KEY, JSON.stringify({ uid, path, at: Date.now() })); } catch { /* storage may be unavailable */ }
}

export function recentPlace(uid: string | undefined): string | null {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? 'null') as { uid: string; path: string; at: number } | null;
    return v && v.uid === uid && v.path.startsWith('/m/') && Date.now() - v.at < WINDOW_MS ? v.path : null;
  } catch {
    return null;
  }
}
