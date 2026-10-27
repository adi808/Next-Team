import { useEffect } from 'react';
import { Navigate, NavLink, Outlet, useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../auth/AuthProvider';
import { MODE_LABELS, type Mode } from '../lib/types';

const NAV: Record<Mode, { to: string; label: string }[]> = {
  sysadmin: [{ to: 'clubs', label: 'מועדונים' }, { to: 'lists', label: 'רשימות' }],
  admin: [{ to: 'clubs', label: 'המועדון שלי' }, { to: 'lists', label: 'רשימות' }],
  coach: [{ to: 'teams', label: 'הקבוצות שלי' }],
  parent: [
    { to: 'home', label: 'הילדים שלי' }, { to: 'events', label: 'אירועים' }, { to: 'tasks', label: 'משימות' },
    { to: 'surveys', label: 'סקרים' }, { to: 'chat', label: 'הודעות' },
  ],
  player: [
    { to: 'home', label: 'הפרופיל שלי' }, { to: 'events', label: 'אירועים' }, { to: 'tasks', label: 'משימות' },
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
      <header>
        <strong>Next Team</strong>
        <button className="mode-chip" disabled={modes.length < 2} onClick={() => navigate('/pick')}
          title={modes.length > 1 ? 'החלפת מצב' : undefined}>
          {MODE_LABELS[m]}{modes.length > 1 ? ' ▾' : ''}
        </button>
        <span className="who">{profile?.full_name || profile?.phone}</span>
        <button className="link" onClick={signOut}>יציאה</button>
      </header>
      <main><Outlet /></main>
      <nav aria-label="ניווט">
        {NAV[m].map((n) => (
          <NavLink key={n.to} to={`/m/${m}/${n.to}`} className={({ isActive }) => (isActive ? 'active' : '')}>{n.label}</NavLink>
        ))}
      </nav>
    </div>
  );
}
