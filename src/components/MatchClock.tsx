import { useEffect, useState } from 'react';
import { clockMs, fmtClock, playedMs, useMatchClock, type ClockState } from '../lib/matchClock';
import { useLookups } from './Lookups';
import { ShirtNo, useShirtNumbers } from './People';
import { Card, ErrorText } from './ui';
import type { EventResponse, EventRow, Lookup, Player } from '../lib/types';

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
                  onClick={() => act({ kind: 'player', player: p.id, on: !on })}>{on ? '⏹ עצור' : '▶ התחל'}</button>
              </div>
              {params.minMinutes > 0 && (
                <div className={`clock-bar${pct >= 100 ? ' done' : ''}`} title={`${minutes(t)} מתוך ${params.minMinutes} דקות`}><i style={{ width: `${pct}%` }} /></div>
              )}
              <div className="clock-stats">
                {statTypes.map((st) => {
                  const n = count(p.id, st.id);
                  return (
                    <span key={st.id} className="clock-stat">
                      <button className="small secondary" aria-label={`${st.name_he} ל${p.full_name}`}
                        onClick={() => act({ kind: 'stat', player: p.id, type: st.id, client: newId() })}>{icon(st)}{n > 0 ? ` ${n}` : ' +'}</button>
                      {n > 0 && <button className="small secondary minus" aria-label={`ביטול ${st.name_he} ל${p.full_name}`} onClick={() => removeLast(p.id, st.id)}>−</button>}
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
      {report && <MinutesReport event={event} state={state} players={players} played={played} min={params.minMinutes} statTypes={statTypes} />}
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

function MinutesReport({ event, state, players, played, min, statTypes }: {
  event: EventRow; state: ClockState; players: Player[]; played: (id: string) => number; min: number; statTypes: Lookup[];
}) {
  const [msg, setMsg] = useState<string | null>(null);
  const rows = players.map((p) => ({ p, m: minutes(played(p.id)) })).filter((r) => r.m > 0 || state.stints.some((s) => s.player_id === r.p.id))
    .sort((a, b) => b.m - a.m);
  const statsOf = (pid: string) => statTypes.map((t) => ({ t, n: state.stats.filter((s) => s.player_id === pid && s.stat_type_id === t.id).length })).filter((x) => x.n > 0);
  const text = [
    `⏱ *דקות משחק${event.opponent ? ` נגד ${event.opponent}` : ''}*`,
    ...rows.map(({ p, m }) => `${min && m < min ? '🔴' : '🟢'} ${p.full_name}: ${m}′${statsOf(p.id).map(({ t, n }) => ` ${icon(t)}${n > 1 ? `×${n}` : ''}`).join('')}`),
    ...(min ? ['', `מינימום: ${min} דקות`] : []),
  ].join('\n');
  async function copy() {
    try { await navigator.clipboard.writeText(text); setMsg('הדוח הועתק'); } catch { setMsg('לא הצלחנו להעתיק'); }
  }
  return (
    <div className="clock-report">
      <h4 className="section-title">דוח דקות</h4>
      {!rows.length && <p className="muted">אף שחקן עוד לא שיחק.</p>}
      <ul className="list compact">
        {rows.map(({ p, m }) => (
          <li key={p.id} className="row">
            <span className="grow">{p.full_name}</span>
            {statsOf(p.id).map(({ t, n }) => <span key={t.id}>{icon(t)}{n > 1 ? `×${n}` : ''}</span>)}
            <strong className={min && m < min ? 'bad' : 'ok'}>{m}′</strong>
          </li>
        ))}
      </ul>
      <div className="row wrap">
        <button className="secondary" onClick={() => window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank', 'noopener')}>שיתוף בוואטסאפ</button>
        <button className="secondary" onClick={copy}>העתקה</button>
      </div>
      {msg && <p className="ok">{msg}</p>}
    </div>
  );
}
