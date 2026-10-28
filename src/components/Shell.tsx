import { useCallback, useEffect, useState } from 'react';
import { Link, Navigate, NavLink, Outlet, useLocation, useParams } from 'react-router-dom';
import { Picture } from './Picture';
import { Icon, type IconName } from './Icon';
import { useAuth } from '../auth/AuthProvider';
import { isDemo, supabase } from '../lib/supabase';
import type { Mode } from '../lib/types';
import { PendingRequestsBanner } from '../pages/RequestsPage';

const NAV: Record<Mode, { to: string; label: string; icon: IconName }[]> = {
  sysadmin: [{ to: 'clubs', label: 'מועדונים', icon: 'shield' }, { to: 'lists', label: 'רשימות', icon: 'list' }],
  admin: [{ to: 'clubs', label: 'המועדון', icon: 'shield' }, { to: 'lists', label: 'רשימות', icon: 'list' }],
  coach: [
    { to: 'coach', label: 'בית', icon: 'home' }, { to: 't/events', label: 'אירועים', icon: 'calendar' },
    { to: 't/squad', label: 'סגל', icon: 'users' }, { to: 't/chat', label: 'הודעות', icon: 'chat' },
  ],
  parent: [
    { to: 'events', label: 'אירועים', icon: 'calendar' }, { to: 'home', label: 'הילדים', icon: 'child' }, { to: 'tasks', label: 'משימות', icon: 'check' },
    { to: 'surveys', label: 'סקרים', icon: 'poll' }, { to: 'chat', label: 'הודעות', icon: 'chat' },
  ],
  player: [
    { to: 'events', label: 'אירועים', icon: 'calendar' }, { to: 'home', label: 'הפרופיל', icon: 'child' }, { to: 'tasks', label: 'משימות', icon: 'check' },
    { to: 'surveys', label: 'סקרים', icon: 'poll' }, { to: 'chat', label: 'הודעות', icon: 'chat' },
  ],
};

export const homeOf = (m: Mode) => `/m/${m}/${NAV[m][0].to}`;

/** Unread notification count for the bell; refreshed when the screen changes and every minute. */
function useUnread(key: string) {
  const [n, setN] = useState(0);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (isDemo) return;
    let off = false;
    const run = () => supabase.from('notifications').select('id', { count: 'exact', head: true }).is('read_at', null)
      .then(({ count }) => { if (!off) setN(count ?? 0); }, () => {});
    run();
    const t = setInterval(run, 60_000);
    return () => { off = true; clearInterval(t); };
  }, [key, tick]);
  return { unread: n, refresh: useCallback(() => setTick((x) => x + 1), []) };
}

export default function Shell() {
  const { mode } = useParams();
  const { modes, profile, signOut } = useAuth();
  const m = mode as Mode;
  const valid = modes.includes(m);
  const { pathname } = useLocation();
  const { unread, refresh } = useUnread(pathname);

  useEffect(() => {
    if (valid) try { localStorage.setItem('mode', m); } catch { /* storage may be unavailable */ }
  }, [valid, m]);

  if (!valid) return <Navigate to="/pick" replace />;
  return (
    <div className="shell">
      <header className="topbar">
        <Link className="brand" to={homeOf(m)}><span className="brand-mark">N</span>Next Team</Link>
        <span className="grow" />
        {!isDemo && (
          <Link className="bell" to={`/m/${m}/notifications`} aria-label={unread ? `${unread} התראות חדשות` : 'התראות'}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M6 9a6 6 0 0 1 12 0c0 6 2.5 7.5 2.5 7.5h-17S6 15 6 9zM10 20a2 2 0 0 0 4 0" />
            </svg>
            {unread > 0 && <b>{unread > 9 ? '9+' : unread}</b>}
          </Link>
        )}
        <Link className="who" to={`/m/${m}/me`} title="הפרופיל שלי">
          <Picture bucket="avatars" path={profile?.avatar_path} name={profile?.full_name || profile?.email || '?'} size={30} />
        </Link>
        <button className="link" onClick={signOut}>יציאה</button>
      </header>
      <main>
        {(m === 'coach' || m === 'admin' || m === 'sysadmin') && !pathname.endsWith('/requests') && !pathname.endsWith('/notifications') && <PendingRequestsBanner key={pathname} />}
        <Outlet context={{ refresh }} />
      </main>
      <nav className="bottom-nav" aria-label="ניווט">
        {NAV[m].map((n) => (
          <NavLink key={n.to} to={`/m/${m}/${n.to}`} className={({ isActive }) => (isActive ? 'active' : '')}>
            <Icon name={n.icon} />
            <span>{n.label}</span>
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
