import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useAuth } from '../auth/AuthProvider';
import { rpc, useAction, useLoad } from '../lib/db';
import { normEmail } from '../lib/email';
import { forgetJoin } from '../lib/join';
import { useLookups } from '../components/Lookups';
import { Card, ErrorText, Field, Loading, PageHero } from '../components/ui';

interface LinkInfo { team_id: string; team_name: string; club_name: string; sport_name: string | null; my_status: 'coach' | 'member' | 'pending' | 'none' }
interface Child { full_name: string; birth_date: string; email: string }
type As = 'coach' | 'manager' | 'parent';

const AS: { id: As; label: string; hint: string }[] = [
  { id: 'coach', label: 'מאמן', hint: 'צוות מקצועי של הקבוצה' },
  { id: 'manager', label: 'מנהל קבוצה', hint: 'ניהול הקבוצה, אירועים והודעות' },
  { id: 'parent', label: 'הורה', hint: 'רישום הילד או הילדים לקבוצה' },
];
const emptyChild = (): Child => ({ full_name: '', birth_date: '', email: '' });

/**
 * A team's join link. A signed-in user who is already on the team is told so; anyone else picks how they join
 * (coach, team manager or parent with their children) and sends a request. The club admin decides staff
 * requests, the team's staff decide parent requests; they are told in the app and by email.
 */
export default function JoinPage() {
  const { code = '' } = useParams();
  const auth = useAuth();
  const info = useLoad(() => rpc<LinkInfo[]>('join_link_info', { p_code: code }).then((r) => r[0] ?? null), [code]);
  const staffRoles = useLookups('staff_role');
  const [as, setAs] = useState<As | null>(null);
  const [moreKids, setMoreKids] = useState(false);
  const [name, setName] = useState(auth.profile?.full_name ?? '');
  const [phone, setPhone] = useState(auth.profile?.phone ?? '');
  const [kids, setKids] = useState<Child[]>([emptyChild()]);
  const [sent, setSent] = useState(false);
  const act = useAction();
  useEffect(forgetJoin, []);

  const i = info.data;
  const hero = (
    <PageHero kicker={i ? [i.club_name, i.sport_name].filter(Boolean).join(' · ') : 'Next Team'} title={i ? `הצטרפות ל${i.team_name}` : 'הצטרפות לקבוצה'} ball />
  );
  if (!i) {
    return (
      <div className="picker-page">
        {hero}
        <div className="overlap card">
          {info.loading ? <Loading loading /> : <ErrorText error={info.error ?? 'הקישור לא נמצא או שכבר אינו פעיל.'} />}
          <Link to="/">למסך הבית</Link>
        </div>
      </div>
    );
  }

  async function send() {
    const role = as === 'parent' ? 'parent' : 'coach';
    const children = kids.map((k) => ({ ...k, full_name: k.full_name.trim(), email: k.email.trim() ? normEmail(k.email) : null }));
    if (role === 'parent' && children.some((k, n) => kids[n].email.trim() && !k.email)) return act.setError('כתובת מייל של ילד לא תקינה');
    const staff = as === 'manager' ? staffRoles.find((l) => l.slug === 'team_manager')?.id ?? null : null;
    await act.run(async () => {
      await rpc('submit_join_request', {
        p_code: code, p_role: role, p_full_name: name, p_phone: phone.trim() || null,
        p_children: role === 'parent' ? children : [], p_staff_role: staff,
      });
      setSent(true);
    });
  }

  let body;
  if (sent || i.my_status === 'pending') {
    body = (
      <Card title="הבקשה נשלחה ✓">
        <p>הבקשה ממתינה לאישור. שלחנו הודעה ומייל {as === 'parent' ? 'למאמן ולמנהל הקבוצה' : 'למנהל המועדון'}, ותקבלו הודעה כשהבקשה תאושר.</p>
        <Link className="button-link" to="/">למסך הבית</Link>
      </Card>
    );
  } else if (i.my_status === 'coach' || (i.my_status === 'member' && !moreKids)) {
    body = (
      <Card title={i.my_status === 'coach' ? 'אתם כבר בצוות הקבוצה' : 'אתם כבר רשומים בקבוצה'}>
        <p>זיהינו אתכם לפי החשבון שאיתו נכנסתם ({auth.profile?.email}).</p>
        <div className="row wrap">
          <Link className="button-link grow" to="/">כניסה לקבוצה</Link>
          {i.my_status === 'member' && <button className="secondary" onClick={() => { setMoreKids(true); setAs('parent'); }}>רישום ילד נוסף</button>}
        </div>
      </Card>
    );
  } else {
    const ready = !!as && !!name.trim() && (as !== 'parent' || kids.every((k) => k.full_name.trim() && k.birth_date));
    body = (
      <>
        {!moreKids && (
          <Card title="מה התפקיד שלכם בקבוצה?">
            <div className="role-choice">
              {AS.map((o) => (
                <button key={o.id} className={`role-option ${as === o.id ? 'on' : ''}`} onClick={() => setAs(o.id)} aria-pressed={as === o.id}>
                  <strong>{o.label}</strong><small>{o.hint}</small>
                </button>
              ))}
            </div>
          </Card>
        )}
        {as && (
          <Card title="הפרטים שלכם">
            <div className="stack">
              <Field label="שם מלא"><input value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" /></Field>
              <Field label="טלפון (לא חובה)"><input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} autoComplete="tel" /></Field>
              <small className="muted">מייל: {auth.profile?.email}</small>
            </div>
          </Card>
        )}
        {as === 'parent' && (
          <Card title="הילדים">
            {kids.map((k, n) => {
              const set = (patch: Partial<Child>) => setKids(kids.map((x, m) => (m === n ? { ...x, ...patch } : x)));
              return (
                <div key={n} className="stack join-child">
                  <div className="row"><strong className="grow">ילד {n + 1}</strong>
                    {kids.length > 1 && <button className="small secondary" onClick={() => setKids(kids.filter((_, m) => m !== n))}>הסרה</button>}
                  </div>
                  <Field label="שם מלא"><input value={k.full_name} onChange={(e) => set({ full_name: e.target.value })} /></Field>
                  <Field label="תאריך לידה"><input type="date" value={k.birth_date} onChange={(e) => set({ birth_date: e.target.value })} /></Field>
                  <Field label="מייל של הילד (לא חובה)"><input type="email" value={k.email} onChange={(e) => set({ email: e.target.value })} /></Field>
                </div>
              );
            })}
            {kids.length < 6 && <button className="small secondary" onClick={() => setKids([...kids, emptyChild()])}>+ ילד נוסף</button>}
          </Card>
        )}
        {as && (
          <div className="stack">
            <button disabled={!ready || act.busy} onClick={send}>שליחת בקשה לאישור</button>
            <ErrorText error={act.error} />
          </div>
        )}
      </>
    );
  }
  return (
    <div className="picker-page">
      {hero}
      <div className="overlap join-body">{body}</div>
    </div>
  );
}
