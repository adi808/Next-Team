// Light / dark appearance: "auto" follows the phone's setting; the choice is kept on this device.
export type Theme = 'auto' | 'light' | 'dark';
const KEY = 'nt-theme';

export function getTheme(): Theme {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'light' || v === 'dark' ? v : 'auto';
  } catch { return 'auto'; }
}

/** Sets data-theme on <html> ("light" / "dark"), or removes it for "auto" (the CSS then follows the system). */
export function applyTheme(t: Theme = getTheme()) {
  const root = document.documentElement;
  if (t === 'auto') root.removeAttribute('data-theme'); else root.setAttribute('data-theme', t);
}

export function setTheme(t: Theme) {
  try { if (t === 'auto') localStorage.removeItem(KEY); else localStorage.setItem(KEY, t); } catch { /* storage blocked */ }
  applyTheme(t);
}
