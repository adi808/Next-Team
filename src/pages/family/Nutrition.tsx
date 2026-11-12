import { useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { friendlyError, q, useLoad } from '../../lib/db';
import { useAuth } from '../../auth/AuthProvider';
import { Card, Empty, ErrorText, Loading, PageHero } from '../../components/ui';
import { dayTitle, shortDate, ymdIL } from '../../lib/week';
import type { Player } from '../../lib/types';

interface Meal { when?: string; time?: string; ideas?: string }
interface Plan { day_type?: string; headline?: string; meals?: Meal[]; before?: string[]; after?: string[]; drink?: string; tip?: string }
interface Review { verdict?: string; compliment?: string; good?: string[]; improve?: string[]; next?: string }
interface Entry { id: string; kind: 'plan' | 'review'; day: string; input: string; output: Plan & Review; created_at: string }

const DAY_TYPE: Record<string, { label: string; icon: string }> = {
  match: { label: 'יום משחק', icon: '⚽' }, training: { label: 'יום אימון', icon: '🏃' }, rest: { label: 'יום מנוחה', icon: '🌿' },
};
const VERDICT: Record<string, { label: string; icon: string; tone: string }> = {
  great: { label: 'כל הכבוד!', icon: '🌟', tone: 'great' },
  good: { label: 'יפה מאוד', icon: '👍', tone: 'good' },
  improve: { label: 'יש מה לשפר', icon: '💡', tone: 'improve' },
};
const list = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && !!x.trim()) : []);
const str = (v: unknown) => (typeof v === 'string' ? v : '');

const addDays = (ymd: string, n: number) => { const d = new Date(`${ymd}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

async function callNutrition(body: Record<string, unknown>): Promise<Entry> {
  const { data, error } = await supabase.functions.invoke('nutrition', { body });
  if (error) {
    let msg = 'העוזר לא זמין כרגע. נסו שוב.';
    try { const j = await (error as { context?: Response }).context?.json(); if (j?.error) msg = j.error; } catch { /* keep the default */ }
    throw new Error(msg);
  }
  return (data as { entry: Entry }).entry;
}

/**
 * Nutrition for a child: a suggestion for the day that follows the schedule (match, training or rest), the age and
 * the allergies, and "what did you eat today?" with a compliment and what to improve. Only the child and the
 * parents see it.
 */
export function FamilyNutrition() {
  const { mode } = useParams();
  const { children, me } = useAuth();
  const asParent = mode === 'parent';
  const kids: Player[] = asParent ? children : me ? [me] : [];
  const [kidId, setKidId] = useState('');
  const kid = kids.find((k) => k.id === kidId) ?? kids[0];
  const today = ymdIL(new Date());
  const [day, setDay] = useState(today);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState<'plan' | 'review' | null>(null);
  const [error, setError] = useState<string | null>(null);

  const { data, loading, error: loadError, reload } = useLoad(
    () => (kid ? q<Entry[]>(supabase.from('nutrition_entries').select('id, kind, day, input, output, created_at').eq('player_id', kid.id).eq('day', day).order('created_at')) : Promise.resolve([])),
    [kid?.id, day],
  );
  const tips = useLoad(async () => {
    if (!kid) return [] as { id: string; tip: string }[];
    const links = await q<{ team_id: string }[]>(supabase.from('team_players').select('team_id').eq('player_id', kid.id));
    if (!links.length) return [];
    return q<{ id: string; tip: string }[]>(supabase.from('team_nutrition_tips').select('id, tip').in('team_id', links.map((l) => l.team_id)).eq('day', day).order('created_at'));
  }, [kid?.id, day]);
  const plan = data?.filter((e) => e.kind === 'plan').pop();
  const reviews = useMemo(() => (data ?? []).filter((e) => e.kind === 'review').reverse(), [data]);

  async function run(action: 'plan' | 'review') {
    if (!kid) return;
    setBusy(action); setError(null);
    try {
      await callNutrition({ player_id: kid.id, day, action, text: action === 'review' ? text : undefined });
      if (action === 'review') setText('');
      reload();
    } catch (e) { setError(e instanceof Error ? e.message : friendlyError(e)); } finally { setBusy(null); }
  }

  const first = kid?.full_name.split(' ')[0] ?? '';
  return (
    <>
      <PageHero kicker="תזונה" title={asParent ? `מה ${first} אוכל/ת היום?` : 'מה אוכלים היום?'} />
      {!kids.length && <Empty>עדיין אין ילדים מקושרים.</Empty>}
      {kid && (
        <div className="stack nutrition">
          <div className="card nutrition-bar">
            {kids.length > 1 && (
              <div className="chips">
                {kids.map((k) => <button key={k.id} className={k.id === kid.id ? 'on' : ''} aria-pressed={k.id === kid.id} onClick={() => setKidId(k.id)}>{k.full_name.split(' ')[0]}</button>)}
              </div>
            )}
            <div className="row nutrition-day">
              <button className="small secondary" aria-label="היום הקודם" disabled={day <= addDays(today, -7)} onClick={() => setDay(addDays(day, -1))}>→</button>
              <strong className="grow">{day === today ? 'היום' : day === addDays(today, 1) ? 'מחר' : dayTitle(day)} · <span dir="ltr">{shortDate(day)}</span></strong>
              <button className="small secondary" aria-label="היום הבא" disabled={day >= addDays(today, 7)} onClick={() => setDay(addDays(day, 1))}>←</button>
            </div>
          </div>
          <Loading loading={loading} error={loadError} />

          {!!tips.data?.length && (
            <div className="card coach-tip">
              <strong>💬 מהמאמן</strong>
              {tips.data.map((t) => <p key={t.id}>{t.tip}</p>)}
            </div>
          )}
          <Card title="🍽️ המלצה ליום">
            {plan ? <PlanView plan={plan.output} /> : <p className="muted">ההמלצה מותאמת ללו"ז של {first} באותו יום (משחק, אימון או מנוחה), לגיל ולאלרגיות שבפרופיל.</p>}
            <button className={plan ? 'secondary' : ''} disabled={!!busy} onClick={() => run('plan')}>
              {busy === 'plan' ? 'מכין המלצה…' : plan ? '🔄 המלצה חדשה' : '✨ הכנת המלצה ליום'}
            </button>
          </Card>

          <Card title={asParent ? `🥗 מה ${first} אכל/ה היום?` : '🥗 מה אכלת היום?'}>
            <textarea rows={4} value={text} maxLength={2000} onChange={(e) => setText(e.target.value)}
              placeholder="למשל: בבוקר פיתה עם גבינה ומלפפון, בצהריים שניצל ואורז, אחרי האימון בננה ומים" />
            <button disabled={!!busy || !text.trim()} onClick={() => run('review')}>{busy === 'review' ? 'בודק…' : 'קבלת משוב'}</button>
            {reviews.map((r) => <ReviewView key={r.id} entry={r} />)}
          </Card>
          <ErrorText error={error} />
          <p className="muted nutrition-note">מידע כללי לילדים ספורטאים, לא ייעוץ רפואי או דיאטטי. בלי משקל ובלי ספירת קלוריות. בעניין אלרגיות, רגישויות או מצב רפואי מתייעצים עם רופא או דיאטנית.</p>
        </div>
      )}
    </>
  );
}

function PlanView({ plan }: { plan: Plan }) {
  const t = DAY_TYPE[str(plan.day_type)] ?? DAY_TYPE.rest;
  const meals = Array.isArray(plan.meals) ? plan.meals.filter((m) => m && str(m.ideas)) : [];
  return (
    <div className="nutrition-plan">
      <div className={`day-type ${str(plan.day_type) || 'rest'}`}><span>{t.icon}</span><strong>{t.label}</strong></div>
      {str(plan.headline) && <p className="nutrition-headline">{plan.headline}</p>}
      {meals.length > 0 && (
        <ul className="meals">
          {meals.map((m, i) => (
            <li key={i}><b>{str(m.when)}{str(m.time) ? <small dir="ltr"> {m.time}</small> : null}</b><span>{m.ideas}</span></li>
          ))}
        </ul>
      )}
      {list(plan.before).length > 0 && <><h4 className="section-title">לפני</h4><ul>{list(plan.before).map((x, i) => <li key={i}>{x}</li>)}</ul></>}
      {list(plan.after).length > 0 && <><h4 className="section-title">אחרי</h4><ul>{list(plan.after).map((x, i) => <li key={i}>{x}</li>)}</ul></>}
      {str(plan.drink) && <p className="nutrition-drink">💧 {plan.drink}</p>}
      {str(plan.tip) && <p className="nutrition-tip">⭐ {plan.tip}</p>}
    </div>
  );
}

function ReviewView({ entry }: { entry: Entry }) {
  const r = entry.output;
  const v = VERDICT[str(r.verdict)] ?? VERDICT.good;
  return (
    <div className={`nutrition-review ${v.tone}`}>
      <div className="row"><span className="verdict-icon">{v.icon}</span><strong className="grow">{v.label}</strong>
        <small className="muted" dir="ltr">{new Date(entry.created_at).toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Jerusalem' })}</small></div>
      <p className="muted review-input">"{entry.input}"</p>
      {str(r.compliment) && <p>{r.compliment}</p>}
      {list(r.good).length > 0 && <ul className="good">{list(r.good).map((x, i) => <li key={i}>✓ {x}</li>)}</ul>}
      {list(r.improve).length > 0 && <><h4 className="section-title">מה אפשר לשפר</h4><ul>{list(r.improve).map((x, i) => <li key={i}>{x}</li>)}</ul></>}
      {str(r.next) && <p className="nutrition-tip">🍎 בארוחה הבאה: {r.next}</p>}
    </div>
  );
}
