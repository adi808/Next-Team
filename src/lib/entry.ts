// The role picker ("איך נכנסים היום?") opens the app for an account with several roles. Besides a start at the
// site root, it also comes up when the app comes back after a break straight into an inner screen: a tab the
// browser restored, or an installed app resumed from the background. A link opened from outside (an event shared
// on WhatsApp) still goes straight to its screen.
const KEY = 'lastSeen';
const AWAY_MS = 30 * 60_000;
let decided = false;

function lastSeen(): number {
  try { return Number(localStorage.getItem(KEY) ?? 0); } catch { return Date.now(); }
}

/** The app is in use now. */
export function touch() {
  try { localStorage.setItem(KEY, String(Date.now())); } catch { /* storage may be unavailable */ }
}

/** True when the app was not in use for a while. */
export const wasAway = () => Date.now() - lastSeen() > AWAY_MS;

/** The entry screen handled this start (it showed the picker or sent the user on): no second choice. */
export function entered() {
  decided = true;
  touch();
}

/** Asked by the first inner screen of this page load: the start is a return after a break, not an opened link. */
export function startNeedsPick(): boolean {
  if (decided) return false;
  decided = true;
  let opened = false;
  try {
    const nav = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined;
    opened = nav?.type === 'navigate';
  } catch { /* older browsers: treat as a restore */ }
  const need = !opened && wasAway();
  touch();
  return need;
}
