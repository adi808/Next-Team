// "View as": a club admin (or the system admin) looks at the app as a team's coach or as one of its players,
// without being added to the team. It changes only what the app shows: the server still checks every request
// with the admin's own rights, and the app refuses to save anything while it is on (read only).
export type Preview = { kind: 'coach'; teamId: string } | { kind: 'player'; playerId: string };

const KEY = 'nt-preview';
// kept in memory too, for pages where sessionStorage is blocked (it then lasts until the page reloads)
let mem: string | null = null;

export function getPreview(): Preview | null {
  try {
    let raw = mem;
    try { raw = sessionStorage.getItem(KEY); } catch { /* storage blocked: use the memory copy */ }
    const v = JSON.parse(raw ?? 'null');
    if (v?.kind === 'coach' && typeof v.teamId === 'string') return { kind: 'coach', teamId: v.teamId };
    if (v?.kind === 'player' && typeof v.playerId === 'string') return { kind: 'player', playerId: v.playerId };
  } catch { /* bad value */ }
  return null;
}

export const isPreview = () => getPreview() !== null;

const changed = () => window.dispatchEvent(new Event('nt-preview'));

export function startPreview(p: Preview) {
  mem = JSON.stringify(p);
  try { sessionStorage.setItem(KEY, mem); } catch { /* storage blocked */ }
  changed();
}

export function endPreview() {
  mem = null;
  try { sessionStorage.removeItem(KEY); } catch { /* storage blocked */ }
  changed();
}

/** The error thrown by every save while previewing; friendlyError shows it in Hebrew. */
export const PREVIEW_ERROR = { code: 'preview', message: 'read only while previewing' };
export function assertNotPreview() {
  if (isPreview()) throw PREVIEW_ERROR;
}
