import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { mutateOne, rpc, useAction } from '../lib/db';
import { uploadImage } from '../lib/images';
import { useAuth } from '../auth/AuthProvider';
import { Card, ErrorText, Field, PageHero } from '../components/ui';
import { Picture, PicturePicker } from '../components/Picture';
import { Link } from 'react-router-dom';
import { disablePush, enablePush, pushState, wantsPush, type PushState } from '../lib/push';
import { isDemo } from '../lib/supabase';

export default function ProfilePage() {
  const { profile, reload, modes } = useAuth();
  const [name, setName] = useState(profile?.full_name ?? '');
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
  async function saveName() {
    await act.run(async () => {
      await mutateOne(supabase.from('profiles').update({ full_name: name.trim() }).eq('id', profile!.id).select('id'));
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
          <small className="muted"><bdi>{profile.email}</bdi></small>
        </div>
        <Field label="השם שיוצג לאחרים">
          <input value={name} onChange={(e) => { setName(e.target.value); setSaved(false); }} placeholder="שם מלא" />
        </Field>
        <ErrorText error={act.error} />
        <div className="row">
          <button disabled={!name.trim() || name.trim() === profile.full_name || act.busy} onClick={saveName}>שמירה</button>
          {saved && <span className="ok">נשמר</span>}
        </div>
      </Card>
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
        </>
      )}
      <ErrorText error={act.error} />
      {detail && <p className="muted">{detail}</p>}
    </Card>
  );
}
