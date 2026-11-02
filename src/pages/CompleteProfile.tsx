import { useState } from 'react';
import { useAuth } from '../auth/AuthProvider';
import { rpc, useAction } from '../lib/db';
import { Card, ErrorText, Field, PageHero } from '../components/ui';

/**
 * One-time details step for an account that has no name yet. Google gives a name; an emailed code does not, so
 * someone a coach or admin added by email (and who did not come through a join link) lands here once.
 */
export default function CompleteProfile() {
  const { profile, reload, signOut } = useAuth();
  const [name, setName] = useState(profile?.full_name ?? '');
  const [phone, setPhone] = useState(profile?.phone ?? '');
  const act = useAction();

  async function save() {
    await act.run(async () => {
      await rpc('update_my_profile', { p_full_name: name.trim(), p_phone: phone.trim() || null });
      reload();
    });
  }

  return (
    <div className="picker-page">
      <PageHero kicker="Next Team" title="ברוכים הבאים!" ball />
      <div className="overlap">
        <Card title="הפרטים שלכם">
          <form className="stack" onSubmit={(e) => { e.preventDefault(); if (name.trim()) save(); }}>
            <p className="muted">כך המאמנים, ההורים וחברי הקבוצה יזהו אתכם. ממלאים פעם אחת, ואפשר לשנות אחר כך בפרופיל.</p>
            <Field label="שם מלא">
              <input value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" autoFocus />
            </Field>
            <Field label="טלפון (לא חובה)">
              <input type="tel" dir="ltr" value={phone} onChange={(e) => setPhone(e.target.value)} autoComplete="tel" />
            </Field>
            <small className="muted">מייל: <bdi>{profile?.email}</bdi></small>
            <ErrorText error={act.error} />
            <button disabled={!name.trim() || act.busy}>המשך</button>
          </form>
        </Card>
        <p className="center-link"><button className="link" onClick={signOut}>יציאה</button></p>
      </div>
    </div>
  );
}
