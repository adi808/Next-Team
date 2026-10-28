import { useEffect } from 'react';
import { Link, Navigate, NavLink, Outlet, useLocation, useParams } from 'react-router-dom';
import { Picture } from './Picture';
import { Icon, type IconName } from './Icon';
import { useAuth } from '../auth/AuthProvider';
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

export default function Shell() {
  const { mode } = useParams();
  const { modes, profile, signOut } = useAuth();
  const m = mode as Mode;
  const valid = modes.includes(m);
  const { pathname } = useLocation();

  useEffect(() => {
    if (valid) try { localStorage.setItem('mode', m); } catch { /* storage may be unavailable */ }
  }, [valid, m]);

  if (!valid) return <Navigate to="/pick" replace />;
  return (
    <div className="shell">
      <header className="topbar">
        <Link className="brand" to={homeOf(m)}><span className="brand-mark">N</span>Next Team</Link>
        <span className="grow" />
        <Link className="who" to={`/m/${m}/me`} title="הפרופיל שלי">
          <Picture bucket="avatars" path={profile?.avatar_path} name={profile?.full_name || profile?.email || '?'} size={30} />
        </Link>
        <button className="link" onClick={signOut}>יציאה</button>
      </header>
      <main>
        {(m === 'coach' || m === 'admin' || m === 'sysadmin') && !pathname.endsWith('/requests') && <PendingRequestsBanner key={pathname} />}
        <Outlet />
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
