import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { q, useLoad } from '../lib/db';
import { clockMs, fmtClock, playedMs, useMatchClock, type ClockState } from '../lib/matchClock';
import { useLookups } from './Lookups';
import { ShirtNo, useShirtNumbers } from './People';
import { Card, ErrorText } from './ui';
import type { EventResponse, EventRow, Lookup, Player } from '../lib/types';
import { isPreview } from '../auth/preview';

const ICONS: [RegExp, string][] = [[/yellow/, '🟨'], [/red/, '🟥'], [/assist/, '👟'], [/goal/, '⚽']];
const icon = (t: Lookup) => ICONS.find(([re]) => re.test(t.slug))?.[1] ?? t.name_he;

function useNow(active: boolean) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    setNow(Date.now());
    if (!active) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [active]);
  return now;
}

const minutes = (t: number) => Math.floor(t / 60_000);

/**
 * The match clock on a match page. Whoever runs it (staff, or a parent the staff allowed) sees the whole squad
 * with a start / stop button and a timer each, goals / assists / cards, the minimum minutes and an alert near the
 * end; everyone else sees only their own child's minutes.
 */
export function MatchClock({ event, sportId, players, responses, myKids }: {
  event: EventRow; sportId: string; players: Player[]; responses: EventResponse[]; myKids: Player[];
}) {
  const { state, canRun, params, pending, error, act, newId } = useMatchClock(event.id, event.team_id);
  const statTypes = useLookups('stat_type', { sportId });
  const shirt = useShirtNumbers(players.map((p) => p.id));
  const running = !!state?.periods.some((p) => !p.ended_at);
  const now = useNow(running || !!state?.stints.some((s) => !s.ended_at));
  const [report, setReport] = useState(false);
  if (!state) return null;

  const started = state.periods.length > 0;
  const clock = clockMs(state.periods, now);
  const played = (pid: string) => playedMs(state.stints.filter((s) => s.player_id === pid), state.periods, now);
  const onPitch = (pid: string) => state.stints.some((s) => s.player_id === pid && !s.ended_at);

  if (!canRun) {
    const mine = myKids.filter((k) => state.stints.some((s) => s.player_id === k.id));
    if (!started || !mine.length) return null;
    return (
      <Card title={`⏱ דקות משחק${running ? ' (בזמן אמת)' : ''}`}>
        {mine.map((k) => <KidMinutes key={k.id} name={k.full_name} t={played(k.id)} min={params.minMinutes} on={onPitch(k.id)} />)}
      </Card>
    );
  }

  const count = (pid: string, type: string) => state.stats.filter((s) => s.player_id === pid && s.stat_type_id === type).length;
  const removeLast = (pid: string, type: string) => {
    const last = [...state.stats].reverse().find((s) => s.player_id === pid && s.stat_type_id === type);
    if (last) act(last.client_id ? { kind: 'unstat', client: last.client_id } : { kind: 'unstat', stat: last.id });
  };
  // who counts for the minimum: those who play or said they are coming
  const inMatch = (pid: string) => state.stints.some((s) => s.player_id === pid) || responses.some((r) => r.player_id === pid && r.status === 'attending');
  const left = params.matchMinutes - clock / 60_000;
  const below = params.minMinutes > 0 ? players.filter((p) => inMatch(p.id) && minutes(played(p.id)) < params.minMinutes) : [];
  const alert = running && params.alertMinutes > 0 && left <= params.alertMinutes && below.length > 0;
  // a steady order (coming first, then by shirt number) so a row never moves under the finger
  const coming = (pid: string) => responses.some((r) => r.player_id === pid && r.status === 'attending');
  const order = [...players].sort((a, b) => Number(coming(b.id)) - Number(coming(a.id)) || (shirt(a.id) ?? 999) - (shirt(b.id) ?? 999) || a.full_name.localeCompare(b.full_name, 'he'));

  return (
    <section className="card match-clock">
      <div className="clock-head">
        <div className="clock-face" dir="ltr">{fmtClock(clock)}</div>
        <div className="grow">
          <strong>{running ? 'המשחק רץ' : started ? 'הפסקה' : 'המשחק עוד לא התחיל'}</strong>
          <small className="muted">{state.stints.filter((s) => !s.ended_at).length} על המגרש · אורך משחק {params.matchMinutes}′{params.minMinutes ? ` · מינימום ${params.minMinutes}′` : ''}</small>
        </div>
        <button className={`clock-switch${running ? ' on' : ''}`} role="switch" aria-checked={running} onClick={() => act({ kind: 'run', on: !running })}>
          {running ? '⏸ הפסקה' : started ? '▶ המשך משחק' : '▶ המשחק התחיל'}
        </button>
      </div>
      {isPreview() && <p className="clock-pending">👁 מצב צפייה: כך המאמן רואה את השעון. הלחיצות לא נשמרות.</p>}
      {pending > 0 && <p className="clock-pending">⏳ ממתין לסנכרון ({pending}) · נשמר בטלפון ויישלח כשתחזור קליטה</p>}
      {alert && (
        <p className="clock-alert" role="alert">⚠️ נשארו {Math.max(0, Math.ceil(left))} דקות. עדיין מתחת למינימום: {below.map((p) => `${p.full_name} (${minutes(played(p.id))}′)`).join(', ')}</p>
      )}
      <ul className="clock-list">
        {order.map((p) => {
          const t = played(p.id); const on = onPitch(p.id);
          const pct = params.minMinutes ? Math.min(100, (t / 60_000 / params.minMinutes) * 100) : 0;
          return (
            <li key={p.id} className={on ? 'on' : ''}>
              <div className="clock-row">
                <ShirtNo n={shirt(p.id)} />
                <span className="grow clock-name">{p.full_name}</span>
                <span className="clock-time" dir="ltr">{fmtClock(t)}</span>
                <button className={`clock-btn${on ? ' stop' : ''}`} aria-label={on ? `עצירה ל${p.full_name}` : `התחלה ל${p.full_name}`}
                  onClick={() => act({ kind: 'player', player: p.id, on: !on })}>{on ? '⏸' : '▶'}</button>
              </div>
              {params.minMinutes > 0 && (
                <div className={`clock-bar${pct >= 100 ? ' done' : ''}`} title={`${minutes(t)} מתוך ${params.minMinutes} דקות`}><i style={{ width: `${pct}%` }} /></div>
              )}
              <div className="clock-stats">
                {statTypes.map((st) => {
                  const n = count(p.id, st.id);
                  return (
                    <span key={st.id} className="clock-stat">
                      <button className="clock-chip" aria-label={`${st.name_he} ל${p.full_name}`}
                        onClick={() => act({ kind: 'stat', player: p.id, type: st.id, client: newId() })}>{icon(st)}{n > 0 ? ` ${n}` : ' +'}</button>
                      {n > 0 && <button className="clock-chip minus" aria-label={`ביטול ${st.name_he} ל${p.full_name}`} onClick={() => removeLast(p.id, st.id)}>−</button>}
                    </span>
                  );
                })}
              </div>
            </li>
          );
        })}
      </ul>
      <div className="row wrap">
        {started && <button className="secondary" onClick={() => { if (confirm('לסיים את המשחק? השעון וכל השחקנים ייעצרו.')) { act({ kind: 'end' }); setReport(true); } }}>🏁 סיום משחק</button>}
        {started && <button className="secondary" onClick={() => setReport(!report)}>📋 דוח דקות</button>}
      </div>
      {report && <MinutesReport event={event} state={state} players={players} played={played} min={params.minMinutes} statTypes={statTypes} shirt={shirt} />}
      <ErrorText error={error} />
    </section>
  );
}

function KidMinutes({ name, t, min, on }: { name: string; t: number; min: number; on: boolean }) {
  const pct = min ? Math.min(100, (t / 60_000 / min) * 100) : 0;
  return (
    <div className="kid-minutes">
      <div className="row"><strong className="grow">{name}{on ? ' · על המגרש' : ''}</strong><span className="clock-time" dir="ltr">{fmtClock(t)}</span></div>
      {min > 0 && <div className={`clock-bar${pct >= 100 ? ' done' : ''}`}><i style={{ width: `${pct}%` }} /></div>}
      {min > 0 && <small className="muted">{minutes(t)} מתוך מינימום {min} דקות</small>}
    </div>
  );
}

const KIND: [RegExp, 'goals' | 'assists' | 'yellow' | 'red'][] = [[/yellow/, 'yellow'], [/red/, 'red'], [/assist/, 'assists'], [/goal/, 'goals']];
type Counts = { goals: number; assists: number; yellow: number; red: number };

/** The formations the match was played in, oldest first (every save of the match's "formation" is kept). */
function useFormations(eventId: string) {
  const names = useLookups('formation', { includeInactive: true });
  const { data } = useLoad(async () => {
    const defs = await q<{ id: string }[]>(supabase.from('attribute_defs').select('id').eq('scope', 'event').eq('key', 'formation'));
    if (!defs.length) return [] as string[];
    const vals = await q<{ value: unknown; seq: number }[]>(supabase.from('attribute_values').select('value, seq')
      .in('def_id', defs.map((d) => d.id)).eq('entity_id', eventId).order('seq'));
    return vals.map((v) => (typeof v.value === 'string' ? v.value : '')).filter(Boolean);
  }, [eventId]);
  const seen: string[] = [];
  for (const id of data ?? []) { const n = names.find((l) => l.id === id)?.name_he; if (n && seen[seen.length - 1] !== n) seen.push(n); }
  return seen;
}

/**
 * The match report as a table: the formation(s) played, then per player the shirt number, name, minutes, goals,
 * assists, yellow and red cards. Shared to WhatsApp as text, or downloaded as a spreadsheet (CSV).
 */
function MinutesReport({ event, state, players, played, min, statTypes, shirt }: {
  event: EventRow; state: ClockState; players: Player[]; played: (id: string) => number; min: number; statTypes: Lookup[];
  shirt: (id: string) => number | undefined;
}) {
  const [msg, setMsg] = useState<string | null>(null);
  const formations = useFormations(event.id);
  const kindOf = (typeId: string) => { const slug = statTypes.find((t) => t.id === typeId)?.slug ?? ''; return KIND.find(([re]) => re.test(slug))?.[1]; };
  const counts = (pid: string): Counts => {
    const c: Counts = { goals: 0, assists: 0, yellow: 0, red: 0 };
    for (const s of state.stats) if (s.player_id === pid) { const k = kindOf(s.stat_type_id); if (k) c[k] += 1; }
    return c;
  };
  const rows = players
    .map((p) => ({ p, no: shirt(p.id), m: minutes(played(p.id)), c: counts(p.id) }))
    .filter((r) => r.m > 0 || state.stints.some((s) => s.player_id === r.p.id) || r.c.goals + r.c.assists + r.c.yellow + r.c.red > 0)
    .sort((a, b) => (a.no ?? 999) - (b.no ?? 999) || a.p.full_name.localeCompare(b.p.full_name, 'he'));
  const total = rows.reduce((t, r) => ({ goals: t.goals + r.c.goals, assists: t.assists + r.c.assists, yellow: t.yellow + r.c.yellow, red: t.red + r.c.red }),
    { goals: 0, assists: 0, yellow: 0, red: 0 });
  const formation = formations.join(' ← ') || 'לא הוגדר';
  const title = `דוח משחק${event.opponent ? ` נגד ${event.opponent}` : ''}`;
  const cell = (n: number) => (n ? String(n) : '-');
  const text = [
    `⏱ *${title}*`, `מערך: ${formation}`, '',
    '# | שם | דקות | ⚽ | 👟 | 🟨 | 🟥',
    ...rows.map((r) => `${r.no ?? '-'} | ${r.p.full_name}${min && r.m < min ? ' 🔴' : ''} | ${r.m}′ | ${cell(r.c.goals)} | ${cell(r.c.assists)} | ${cell(r.c.yellow)} | ${cell(r.c.red)}`),
    `סה"כ | | | ${total.goals} | ${total.assists} | ${total.yellow} | ${total.red}`,
    ...(min ? ['', `🔴 מתחת למינימום ${min} דקות`] : []),
  ].join('\n');
  async function copy() {
    try { await navigator.clipboard.writeText(text); setMsg('הדוח הועתק'); } catch { setMsg('לא הצלחנו להעתיק'); }
  }
  function csv() {
    const q2 = (v: string | number) => `"${String(v).replace(/"/g, '""')}"`;
    const lines = [[title], ['מערך', formation], [], ['מספר', 'שם', 'דקות', 'שערים', 'בישולים', 'צהובים', 'אדומים'],
      ...rows.map((r) => [r.no ?? '', r.p.full_name, r.m, r.c.goals, r.c.assists, r.c.yellow, r.c.red]),
      ['', 'סה"כ', '', total.goals, total.assists, total.yellow, total.red]];
    const blob = new Blob(['\ufeff' + lines.map((l) => l.map(q2).join(',')).join('\r\n')], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = `match-report-${event.starts_at.slice(0, 10)}.csv`; a.click();
  }
  return (
    <div className="clock-report">
      <h4 className="section-title">{title}</h4>
      <p className="report-formation">מערך: <strong>{formation}</strong></p>
      {!rows.length ? <p className="muted">אף שחקן עוד לא שיחק.</p> : (
        <div className="table-wrap">
          <table className="report-table">
            <thead><tr><th>#</th><th>שם</th><th>דקות</th><th title="שערים">⚽</th><th title="בישולים">👟</th><th title="צהובים">🟨</th><th title="אדומים">🟥</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.p.id}>
                  <td>{r.no ?? '-'}</td>
                  <td className="name">{r.p.full_name}</td>
                  <td className={min && r.m < min ? 'bad' : 'ok'}>{r.m}′</td>
                  <td>{cell(r.c.goals)}</td><td>{cell(r.c.assists)}</td><td>{cell(r.c.yellow)}</td><td>{cell(r.c.red)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot><tr><td /><td>סה"כ</td><td /><td>{total.goals}</td><td>{total.assists}</td><td>{total.yellow}</td><td>{total.red}</td></tr></tfoot>
          </table>
        </div>
      )}
      {min > 0 && <small className="muted">באדום: מתחת למינימום של {min} דקות</small>}
      <div className="row wrap">
        <button className="secondary" onClick={() => window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank', 'noopener')}>שיתוף בוואטסאפ</button>
        <button className="secondary" onClick={copy}>העתקה</button>
        <button className="secondary" onClick={csv}>הורדה לאקסל</button>
      </div>
      {msg && <p className="ok">{msg}</p>}
    </div>
  );
}
