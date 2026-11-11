import { Fragment, useState, type ReactNode } from 'react';
import { rpc, useAction, useLoad, q, fmtDate } from '../lib/db';
import { supabase } from '../lib/supabase';
import { useAuth } from '../auth/AuthProvider';
import { Card, ErrorText, Field, PageHero } from '../components/ui';

/** The terms text: "## " lines are headings, "- " lines list items, blank lines split paragraphs. */
export function TermsText({ body }: { body: string }) {
  const out: ReactNode[] = [];
  let list: string[] = [];
  let para: string[] = [];
  const flush = () => {
    if (para.length) out.push(<p key={out.length}>{para.join(' ')}</p>);
    if (list.length) out.push(<ul key={out.length}>{list.map((l, i) => <li key={i}>{l}</li>)}</ul>);
    para = []; list = [];
  };
  for (const raw of body.split('\n')) {
    const line = raw.trim();
    if (!line) { flush(); continue; }
    if (line.startsWith('## ')) { flush(); out.push(<h3 key={out.length}>{line.slice(3)}</h3>); continue; }
    if (line.startsWith('- ')) { if (para.length) { const p = para; para = []; out.push(<p key={out.length}>{p.join(' ')}</p>); } list.push(line.slice(2)); continue; }
    if (list.length) flush();
    para.push(line);
  }
  flush();
  return <div className="terms-text">{out.map((n, i) => <Fragment key={i}>{n}</Fragment>)}</div>;
}

/** Shown after sign-in until the current version is accepted (also to existing users when a new version is published). */
export function TermsGate() {
  const { terms, reload, signOut, profile } = useAuth();
  const [agree, setAgree] = useState(false);
  const act = useAction();
  if (!terms) return null;
  const again = !!profile?.terms_version;
  return (
    <div className="picker-page">
      <PageHero kicker="Next Team" title={again ? 'התקנון עודכן' : 'תקנון ותנאי שימוש'} />
      <div className="overlap">
        <Card>
          <p className="muted">{again ? 'פרסמנו גרסה חדשה של התקנון. כדי להמשיך, קראו ואשרו אותה.' : 'לפני שמתחילים, קראו את התקנון ואשרו אותו.'}</p>
          <div className="terms-box" tabIndex={0} aria-label="נוסח התקנון"><TermsText body={terms.body} /></div>
          <label className="check terms-agree">
            <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} />
            <span>קראתי את התקנון ואני מסכים/ה לו, כולל הצגת המידע לחברי הקבוצה כפי שמתואר בו.</span>
          </label>
          <ErrorText error={act.error} />
          <button className="block" disabled={!agree || act.busy}
            onClick={() => act.run(async () => { await rpc('accept_terms', { p_version: terms.version }); reload(); })}>
            אישור והמשך
          </button>
          <p className="center-link"><button className="link" onClick={signOut}>לא מסכים/ה – יציאה</button></p>
        </Card>
      </div>
    </div>
  );
}

/** The terms as accepted, and for the system admin a form that publishes a new version. */
export default function TermsPage() {
  const { terms, profile, reload } = useAuth();
  const mine = useLoad(
    () => (profile ? q<{ version: number; accepted_at: string }[]>(supabase.from('terms_acceptances').select('version, accepted_at')
      .eq('user_id', profile.id).order('version', { ascending: false }).limit(1)) : Promise.resolve([])),
    [profile?.id, profile?.terms_version],
  );
  const [draft, setDraft] = useState<string | null>(null);
  const [done, setDone] = useState<number | null>(null);
  const act = useAction();
  const accepted = mine.data?.[0];
  return (
    <>
      <PageHero kicker="Next Team" title="תקנון ותנאי שימוש" />
      <div className="overlap"><Card>
        {terms ? (
          <>
            <small className="muted">
              גרסה {terms.version}{accepted ? ` · אישרת ב־${fmtDate(accepted.accepted_at)}` : ''}
            </small>
            <TermsText body={terms.body} />
          </>
        ) : <p className="muted">עדיין לא פורסם תקנון.</p>}
      </Card></div>
      {profile?.is_system_admin && (
        <Card title="עדכון התקנון (מנהל מערכת)">
          <p className="muted">פרסום גרסה חדשה יבקש מכל המשתמשים לאשר אותה בכניסה הבאה. "## " בתחילת שורה היא כותרת, "- " היא סעיף ברשימה, ושורה ריקה מפרידה בין פסקאות.</p>
          <Field label="נוסח">
            <textarea className="terms-edit" value={draft ?? terms?.body ?? ''} onChange={(e) => setDraft(e.target.value)} />
          </Field>
          <ErrorText error={act.error} />
          <div className="row">
            <button disabled={act.busy || draft === null || !draft.trim() || draft === terms?.body}
              onClick={() => { if (confirm('לפרסם גרסה חדשה? כל המשתמשים יתבקשו לאשר אותה.')) act.run(async () => {
                const v = await rpc<number>('publish_terms', { p_body: draft });
                setDone(v); setDraft(null); reload();
              }); }}>
              פרסום גרסה חדשה
            </button>
            {done && <span className="ok">גרסה {done} פורסמה</span>}
          </div>
        </Card>
      )}
    </>
  );
}
