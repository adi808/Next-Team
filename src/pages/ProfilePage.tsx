import { useEffect, useState } from 'react';
import { q, rpc, useAction, useLoad } from '../lib/db';
import { supabase } from '../lib/supabase';
import { MODE_LABELS } from '../lib/types';
import { useLookupName } from '../components/Lookups';
import { uploadImage } from '../lib/images';
import { useAuth } from '../auth/AuthProvider';
import { Card, ErrorText, Field, PageHero } from '../components/ui';
import { Picture, PicturePicker } from '../components/Picture';
import { Link } from 'react-router-dom';
import { disablePush, enablePush, pushDiagnostics, pushState, showLocalTest, wantsPush, type PushState } from '../lib/push';
import { isDemo } from '../lib/supabase';
import { fmtPhone } from '../components/Contacts';

/** Every role this account holds, so it is clear who is signed in and what each role may do. */
function RolesCard() {
  const { profile, modes, memberships, children, me } = useAuth();
  const staffName = useLookupName('staff_role');
  const ids = [...new Set(memberships.map((m) => m.team_id).filter((t): t is string => !!t))];
  const teams = useLoad(() => (ids.length && !isDemo
    ? q<{ id: string; name: string }[]>(supabase.from('teams').select('id, name').in('id', ids))
    : Promise.resolve([])), [ids.join(',')]);
  const teamName = (id: string | null) => teams.data?.find((t) => t.id === id)?.name ?? '';
  const staff = memberships.filter((m) => m.role === 'coach');
  const detail: Record<string, string> = {
    sysadmin: 'כל המועדונים, הרשימות וההגדרות',
    admin: `ניהול המועדון והקבוצות, אישור בקשות הצטרפות של צוות${memberships.filter((m) => m.role === 'club_admin').length > 1 ? ' (כמה מועדונים)' : ''}`,
    coach: staff.map((m) => `${staffName(m.staff_role_id) || 'מאמן'} · ${teamName(m.team_id)}`).join('، ') + ' (הסגל, אירועים, הודעות ואישור הורים)',
    parent: `הורה של ${children.map((c) => c.full_name).join(', ')}: אישורי הגעה ופרטי הילד`,
    player: `${me?.full_name ?? ''}: הפרופיל, האירועים והמשימות שלי`,
  };
  return (
    <Card title="התפקידים שלי">
      <small className="muted">מחובר/ת כ־<bdi>{profile?.email}</bdi></small>
      {!modes.length && <p className="muted">החשבון הזה עדיין לא משויך לאף תפקיד.</p>}
      <ul className="list compact">
        {modes.map((m) => <li key={m} className="stack"><strong>{MODE_LABELS[m]}</strong><small className="muted">{detail[m]}</small></li>)}
      </ul>
    </Card>
  );
}

export default function ProfilePage() {
  const { profile, reload, modes } = useAuth();
  const [name, setName] = useState(profile?.full_name ?? '');
  const [phone, setPhone] = useState(profile?.phone ? fmtPhone(profile.phone) : '');
  const [saved, setSaved] = useState(false);
  const act = useAction();
  if (!profile) return null;

  async function setAvatar(file: File) {
    await act.run(async () => {
      const path = await uploadImage('avatars', profile!.id, file);
      await rpc('set_my_avatar', { p_path: path });
      reload();
    });
  }
  const phoneChanged = phone.trim() !== (profile.phone ? fmtPhone(profile.phone) : '');
  async function saveDetails() {
    await act.run(async () => {
      await rpc('update_my_profile', { p_full_name: name.trim(), p_phone: phone.trim() || null });
      setSaved(true);
      reload();
    });
  }

  return (
    <>
      <PageHero kicker="חשבון" title="הפרופיל שלי" />
      {modes.length > 1 && <Link className="button-link soft block" to="/pick">החלפת תפקיד</Link>}
      <Card>
        <div className="profile-card">
          <Picture bucket="avatars" path={profile.avatar_path} name={profile.full_name || profile.email || '?'} size={96} />
          <PicturePicker label={profile.avatar_path ? 'החלפת תמונה' : 'הוספת תמונה'} busy={act.busy} onPick={setAvatar} />
          <small className="muted">מייל: <bdi>{profile.email}</bdi> (כתובת הכניסה)</small>
        </div>
        <Field label="השם שיוצג לאחרים">
          <input value={name} onChange={(e) => { setName(e.target.value); setSaved(false); }} placeholder="שם מלא" />
        </Field>
        <Field label="טלפון (לא חובה, גלוי לחברי הקבוצה)">
          <input type="tel" dir="ltr" inputMode="tel" autoComplete="tel" value={phone} placeholder="050-1234567"
            onChange={(e) => { setPhone(e.target.value); setSaved(false); }} />
        </Field>
        <ErrorText error={act.error} />
        <div className="row">
          <button disabled={!name.trim() || (name.trim() === profile.full_name && !phoneChanged) || act.busy} onClick={saveDetails}>שמירה</button>
          {saved && <span className="ok">נשמר</span>}
        </div>
      </Card>
      <RolesCard />
      {!isDemo && <PushCard />}
    </>
  );
}

function PushCard() {
  const [state, setState] = useState<PushState | null>(null);
  const act = useAction();
  const [sent, setSent] = useState(false);
  useEffect(() => {
    // If the app restarted right after the permission was granted, finish the subscription that was started.
    pushState().then(async (st) => {
      if (st === 'off' && wantsPush() && Notification.permission === 'granted') {
        try { st = await enablePush(); } catch { /* the button shows the error on the next try */ }
      }
      setState(st);
    }, () => setState('unsupported'));
  }, []);
  const [detail, setDetail] = useState('');
  const [diag, setDiag] = useState<string[] | null>(null);
  const toggle = async () => {
    setDetail('');
    const next = await act.run(async () => (state === 'on' ? await disablePush() : await enablePush()));
    if (next) { setState(next); if (next === 'off' && state === 'off') setDetail('לא אושרה הרשאה להתראות. נסו שוב ואשרו כשהדפדפן שואל.'); }
  };
  return (
    <Card title="🔔 התראות למכשיר">
      {state === null && <p className="muted">בודק…</p>}
      {state === 'unsupported' && (
        <p>המכשיר או הדפדפן לא תומכים בהתראות. באייפון: פתחו בספארי, לחצו "שיתוף" ואז "הוסף למסך הבית", ופתחו את האפליקציה משם (iOS 16.4 ומעלה).</p>
      )}
      {state === 'denied' && <p>ההתראות חסומות בהגדרות הדפדפן. אפשרו אותן לאתר הזה ונסו שוב.</p>}
      {(state === 'on' || state === 'off') && (
        <>
          <p>{state === 'on' ? 'ההתראות פעילות במכשיר הזה.' : 'קבלו התראה על בקשות הצטרפות, אישורים ועדכונים.'}</p>
          <div className="row wrap">
            <button className={state === 'on' ? 'secondary' : ''} disabled={act.busy} onClick={toggle}>{state === 'on' ? 'כיבוי התראות' : 'הפעלת התראות'}</button>
            {state === 'on' && (
              <button className="secondary" disabled={act.busy}
                onClick={() => act.run(async () => { await rpc('send_test_notification'); setSent(true); })}>שליחת התראת ניסיון</button>
            )}
          </div>
          {sent && <p className="ok">נשלחה. תוך כמה שניות היא אמורה לקפוץ.</p>}
          {state === 'on' && (
            <div className="row wrap">
              <button className="small secondary" disabled={act.busy} onClick={() => act.run(showLocalTest)}>בדיקה מקומית (בלי שרת)</button>
              <button className="small secondary" onClick={async () => setDiag(await pushDiagnostics())}>פרטי אבחון</button>
            </div>
          )}
          {diag && <ul className="list compact">{diag.map((l) => <li key={l}>{l}</li>)}</ul>}
        </>
      )}
      <ErrorText error={act.error} />
      {detail && <p className="muted">{detail}</p>}
    </Card>
  );
}
