import { useState } from 'react';
import { useAuth } from '../auth/AuthProvider';
import { ROLE_LABELS, type AppRole } from '../lib/types';

const SECTIONS: Record<AppRole, string> = {
  club_admin: 'ניהול מועדון וקבוצות',
  coach: 'הקבוצה שלי',
  player: 'הקבוצה והודעות',
  parent: 'הילדים שלי',
};

export default function RoleShell() {
  const { profile, roles, signOut } = useAuth();
  const [active, setActive] = useState<AppRole | null>(roles[0] ?? null);

  return (
    <div className="shell">
      <header>
        <strong>Next Kick</strong>
        <span>{profile?.full_name || profile?.phone}</span>
        <button className="link" onClick={signOut}>יציאה</button>
      </header>

      <main>
        {roles.length === 0 ? (
          <p>
            עדיין אין לכם שיוך למועדון או לקבוצה. בקשו ממנהל המועדון או מהמאמן להזמין
            אתכם לפי מספר הטלפון.
          </p>
        ) : (
          <>
            <h2>{active ? ROLE_LABELS[active] : ''}</h2>
            <p>{active ? SECTIONS[active] : ''} – בקרוב (שלב C2).</p>
          </>
        )}
      </main>

      {roles.length > 1 && (
        <nav aria-label="תפקידים">
          {roles.map((r) => (
            <button key={r} aria-current={r === active} onClick={() => setActive(r)}>
              {ROLE_LABELS[r]}
            </button>
          ))}
        </nav>
      )}
    </div>
  );
}
