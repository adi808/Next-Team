import { useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthProvider';
import { MODE_LABELS, type Mode } from '../lib/types';
import { homeOf } from '../components/Shell';
import { Icon, type IconName } from '../components/Icon';
import { PageHero } from '../components/ui';
import { useLookupName } from '../components/Lookups';
import { parseJoinCode } from '../lib/join';

const HINTS: Record<Mode, string> = {
  sysadmin: 'מועדונים, רשימות והגדרות מערכת',
  admin: 'קבוצות, צוות ופרמטרים של המועדון',
  coach: 'הסגל, אירועים, משימות, סקרים והודעות',
  parent: 'הילדים שלי, אירועים ואישורי הגעה',
  player: 'הפרופיל, האירועים והמשימות שלי',
};
const ICONS: Record<Mode, IconName> = { sysadmin: 'shield', admin: 'list', coach: 'users', parent: 'child', player: 'check' };

function JoinCodeField() {
  const navigate = useNavigate();
  const [text, setText] = useState('');
  const code = parseJoinCode(text);
  return (
    <div className="stack">
      <label className="field"><span>קישור או קוד הצטרפות</span>
        <input dir="ltr" value={text} onChange={(e) => setText(e.target.value)} placeholder="https://…/join/…" />
      </label>
      {!!text.trim() && !code && <small className="muted">לא זיהינו קישור הצטרפות. הדביקו את הקישור המלא שקיבלתם.</small>}
      <button disabled={!code} onClick={() => navigate(`/join/${code}`)}>המשך להצטרפות</button>
    </div>
  );
}

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
        <p>נכנסתם עם <bdi>{profile?.email}</bdi>, והחשבון הזה עדיין לא משויך לאף קבוצה.</p>
        <ul>
          <li>יש לכם קישור הצטרפות מהמאמן? הדביקו אותו כאן.</li>
          <li>מישהו אמור היה להוסיף אתכם לפי המייל? ודאו שהמייל שהוא הקליד זהה למייל שלמעלה, ואם לא, בקשו ממנו לתקן.</li>
          <li>נכנסתם בטעות עם חשבון אחר? צאו והיכנסו עם החשבון הנכון.</li>
        </ul>
        <JoinCodeField />
        <button className="link" onClick={signOut}>יציאה והתחברות עם חשבון אחר</button>
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
