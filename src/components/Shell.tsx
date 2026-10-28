import { useEffect } from 'react';
import { Link, Navigate, NavLink, Outlet, useNavigate, useParams } from 'react-router-dom';
import { Picture } from './Picture';
import { useAuth } from '../auth/AuthProvider';
import { MODE_LABELS, type Mode } from '../lib/types';

const NAV: Record<Mode, { to: string; label: string }[]> = {
  sysadmin: [{ to: 'clubs', label: 'מועדונים' }, { to: 'lists', label: 'רשימות' }],
  admin: [{ to: 'clubs', label: 'המועדון שלי' }, { to: 'lists', label: 'רשימות' }],
  coach: [{ to: 'teams', label: 'הקבוצות שלי' }],
  parent: [
    { to: 'events', label: 'אירועים' }, { to: 'home', label: 'הילדים שלי' }, { to: 'tasks', label: 'משימות' },
    { to: 'surveys', label: 'סקרים' }, { to: 'chat', label: 'הודעות' },
  ],
  player: [
    { to: 'events', label: 'אירועים' }, { to: 'home', label: 'הפרופיל שלי' }, { to: 'tasks', label: 'משימות' },
    { to: 'surveys', label: 'סקרים' }, { to: 'chat', label: 'הודעות' },
  ],
};

export const homeOf = (m: Mode) => `/m/${m}/${NAV[m][0].to}`;

export default function Shell() {
  const { mode } = useParams();
  const { modes, profile, signOut } = useAuth();
  const navigate = useNavigate();
  const m = mode as Mode;
  const valid = modes.includes(m);

  useEffect(() => {
    if (valid) try { localStorage.setItem('mode', m); } catch { /* storage may be unavailable */ }
  }, [valid, m]);

  if (!valid) return <Navigate to="/pick" replace />;
  return (
    <div className="shell">
      <div className="topbar">
      <header>
        <strong>Next Team</strong>
        <button className="mode-chip" disabled={modes.length < 2} onClick={() => navigate('/pick')}
          title={modes.length > 1 ? 'החלפת מצב' : undefined}>
          {MODE_LABELS[m]}{modes.length > 1 ? ' ▾' : ''}
        </button>
        <Link className="who" to={`/m/${m}/me`} title="הפרופיל שלי">
          <Picture bucket="avatars" path={profile?.avatar_path} name={profile?.full_name || profile?.email || '?'} size={28} />
          <bdi>{profile?.full_name || profile?.email || profile?.phone}</bdi>
        </Link>
        <button className="link" onClick={signOut}>יציאה</button>
      </header>
      <nav aria-label="ניווט">
        {NAV[m].map((n) => (
          <NavLink key={n.to} to={`/m/${m}/${n.to}`} className={({ isActive }) => (isActive ? 'active' : '')}>{n.label}</NavLink>
        ))}
      </nav>
      </div>
      <main><Outlet /></main>
    </div>
  );
}
