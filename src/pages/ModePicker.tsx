import { Navigate, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthProvider';
import { MODE_LABELS, type Mode } from '../lib/types';
import { homeOf } from '../components/Shell';
import { Icon, type IconName } from '../components/Icon';
import { PageHero } from '../components/ui';

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
  const { modes, loading, profile, signOut } = useAuth();
  const navigate = useNavigate();
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
            <span><strong>{MODE_LABELS[m]}</strong><small>{HINTS[m]}</small></span>
            <span className="chev" aria-hidden="true">‹</span>
          </button>
        ))}
      </div>
      <p className="center-link"><button className="link" onClick={signOut}>יציאה</button></p>
    </div>
  );
}
