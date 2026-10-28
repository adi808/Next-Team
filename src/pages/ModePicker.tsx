import { Navigate, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthProvider';
import { MODE_LABELS, type Mode } from '../lib/types';
import { homeOf } from '../components/Shell';
import { Icon, type IconName } from '../components/Icon';
import { PageHero } from '../components/ui';
import { useLookupName } from '../components/Lookups';

const HINTS: Record<Mode, string> = {
  sysadmin: 'מועדונים, רשימות והגדרות מערכת',
  admin: 'קבוצות, צוות ופרמטרים של המועדון',
  coach: 'הסגל, אירועים, משימות, סקרים והודעות',
  parent: 'הילדים שלי, אירועים ואישורי הגעה',
  player: 'הפרופיל, האירועים והמשימות שלי',
};
const ICONS: Record<Mode, IconName> = { sysadmin: 'shield', admin: 'list', coach: 'users', parent: 'child', player: 'check' };

/** Entry screen: an account with several roles (for example coach and parent) chooses how to enter. */
export default function ModePicker({ auto }: { auto?: boolean }) {
  const { modes, loading, profile, signOut, memberships } = useAuth();
  const navigate = useNavigate();
  const staffName = useLookupName('staff_role');
  // The team staff card carries the staff type (e.g. team manager) when all the user's teams agree on it.
  const types = [...new Set(memberships.filter((m) => m.role === 'coach').map((m) => staffName(m.staff_role_id)))];
  const label = (m: Mode) => (m === 'coach' && types.length === 1 && types[0] ? types[0] : MODE_LABELS[m]);
  if (loading) return <p className="center">טוען…</p>;

  // one role: straight in; several: always this screen
  if (auto && modes.length === 1) return <Navigate to={homeOf(modes[0])} replace />;

  if (!modes.length) {
    return (
      <main className="login">
        <h1>Next Team</h1>
        <p>עדיין אין לכם שיוך למועדון או לקבוצה. בקשו ממנהל המועדון או מהמאמן להוסיף אתכם לפי כתובת המייל שאיתה נכנסתם.</p>
        <button className="link" onClick={signOut}>יציאה</button>
      </main>
    );
  }
  const first = (profile?.full_name || '').split(' ')[0];
  return (
    <div className="picker-page">
      <PageHero kicker={first ? `שלום, ${first}` : 'Next Team'} title="איך נכנסים היום?" ball />
      <div className="overlap role-cards">
        {modes.map((m) => (
          <button key={m} className="role-card" onClick={() => navigate(homeOf(m))}>
            <span className="role-icon"><Icon name={ICONS[m]} size={26} /></span>
            <span><strong>{label(m)}</strong><small>{HINTS[m]}</small></span>
            <span className="chev" aria-hidden="true">‹</span>
          </button>
        ))}
      </div>
      <p className="center-link"><button className="link" onClick={signOut}>יציאה</button></p>
    </div>
  );
}
