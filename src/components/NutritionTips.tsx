import { useState } from 'react';
import { supabase } from '../lib/supabase';
import { q, rpc, useAction, useLoad } from '../lib/db';
import { dayTitle, shortDate, ymdIL } from '../lib/week';
import { Card, ErrorText } from './ui';

export interface Tip { id: string; team_id: string; day: string; tip: string }

const addDays = (ymd: string, n: number) => { const d = new Date(`${ymd}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const label = (ymd: string, today: string) => (ymd === today ? 'היום' : ymd === addDays(today, 1) ? 'מחר' : `${dayTitle(ymd)} ${shortDate(ymd)}`);

/** The staff write a nutrition tip for the team for a day ("fruit before training"); kids and parents see it. */
export function TeamNutritionTips({ teamId }: { teamId: string }) {
  const today = ymdIL(new Date());
  const { data, reload } = useLoad(
    () => q<Tip[]>(supabase.from('team_nutrition_tips').select('id, team_id, day, tip').eq('team_id', teamId).gte('day', today).order('day')),
    [teamId, today],
  );
  const [day, setDay] = useState(today);
  const [tip, setTip] = useState('');
  const act = useAction();
  const add = () => act.run(async () => { await rpc('add_team_nutrition_tip', { p_team: teamId, p_day: day, p_tip: tip }); setTip(''); reload(); });
  const remove = (id: string) => act.run(async () => { await rpc('delete_team_nutrition_tip', { p_id: id }); reload(); });
  return (
    <Card title="🍎 טיפ תזונה לקבוצה">
      <p className="muted">הילדים וההורים יראו אותו בטאב התזונה באותו יום, וההמלצה של העוזר תתחשב בו.</p>
      <div className="chips">
        {[0, 1, 2].map((n) => { const d = addDays(today, n); return <button key={d} className={day === d ? 'on' : ''} aria-pressed={day === d} onClick={() => setDay(d)}>{label(d, today)}</button>; })}
        <input type="date" value={day} min={today} onChange={(e) => e.target.value && setDay(e.target.value)} aria-label="יום אחר" />
      </div>
      <textarea rows={2} maxLength={500} value={tip} onChange={(e) => setTip(e.target.value)} placeholder="למשל: לאכול פרי שעה לפני האימון ולהביא בקבוק מים מלא" />
      <button disabled={!tip.trim() || act.busy} onClick={add}>שליחת הטיפ</button>
      {!!data?.length && (
        <ul className="list compact">
          {data.map((t) => (
            <li key={t.id} className="row">
              <small className="muted">{label(t.day, today)}</small>
              <span className="grow">{t.tip}</span>
              <button className="small secondary" disabled={act.busy} onClick={() => remove(t.id)} aria-label="מחיקת הטיפ">✕</button>
            </li>
          ))}
        </ul>
      )}
      <ErrorText error={act.error} />
    </Card>
  );
}
