import { Navigate, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthProvider';
import { MODE_LABELS, type Mode } from '../lib/types';
import { homeOf } from '../components/Shell';

const HINTS: Record<Mode, string> = {
  sysadmin: 'מועדונים, רשימות והגדרות מערכת',
  admin: 'קבוצות, צוות ופרמטרים של המועדון',
  coach: 'הסגל, אירועים, משימות, סקרים והודעות',
  parent: 'הילדים שלי, אירועים ואישורי הגעה',
  player: 'הפרופיל, האירועים והמשימות שלי',
};

/** Users with several roles (for example a parent who is also a club admin) choose a mode here. */
export default function ModePicker({ auto }: { auto?: boolean }) {
  const { modes, loading } = useAuth();
  const navigate = useNavigate();
  if (loading) return <p className="center">טוען…</p>;

  if (auto) {
    let saved: string | null = null;
    try { saved = localStorage.getItem('mode'); } catch { /* ignore */ }
    const target = modes.find((m) => m === saved) ?? (modes.length === 1 ? modes[0] : null);
    if (target) return <Navigate to={homeOf(target)} replace />;
  }

  if (!modes.length) {
    return (
      <main className="login">
        <h1>Next Team</h1>
        <p>עדיין אין לכם שיוך למועדון או לקבוצה. בקשו ממנהל המועדון או מהמאמן להוסיף אתכם לפי כתובת המייל שאיתה נכנסתם.</p>
      </main>
    );
  }
  return (
    <main className="login">
      <h1>איך נכנסים?</h1>
      <div className="stack">
        {modes.map((m) => (
          <button key={m} className="mode-card" onClick={() => navigate(homeOf(m))}>
            <strong>{MODE_LABELS[m]}</strong>
            <small>{HINTS[m]}</small>
          </button>
        ))}
      </div>
    </main>
  );
}
