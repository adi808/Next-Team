// Adding the app to the home screen. Chrome on Android fires beforeinstallprompt once, often before any screen
// mounts, so the event is caught here at startup and kept for the install banner. iPhone has no such event:
// Safari installs only through Share → Add to Home Screen, so the banner explains the steps instead.
type InstallPrompt = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }> };

let deferred: InstallPrompt | null = null;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((f) => f());

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferred = e as InstallPrompt;
    notify();
  });
  window.addEventListener('appinstalled', () => {
    deferred = null;
    notify();
  });
}

export const canPrompt = () => deferred !== null;

export function onInstallChange(f: () => void) {
  listeners.add(f);
  return () => { listeners.delete(f); };
}

/** Shows the browser's own install dialog (Android / desktop Chrome). True when the user accepted. */
export async function promptInstall(): Promise<boolean> {
  const e = deferred;
  if (!e) return false;
  deferred = null;
  await e.prompt();
  const { outcome } = await e.userChoice;
  notify();
  return outcome === 'accepted';
}

/** Already running from the home screen. */
export const isInstalled = () =>
  window.matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;

const ua = () => navigator.userAgent;
// iPadOS reports itself as a Mac; touch support tells them apart.
export const isIOS = () => /iPhone|iPad|iPod/.test(ua()) || (/Macintosh/.test(ua()) && navigator.maxTouchPoints > 1);
export const isAndroid = () => /Android/.test(ua());

// A dismissed banner stays hidden for a month.
const KEY = 'installDismissed';
const MONTH = 30 * 86400_000;

export function installDismissed(): boolean {
  try { return Date.now() - Number(localStorage.getItem(KEY) ?? 0) < MONTH; } catch { return false; }
}

export function dismissInstall() {
  try { localStorage.setItem(KEY, String(Date.now())); } catch { /* storage may be unavailable */ }
}
