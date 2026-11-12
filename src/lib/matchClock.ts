import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from './supabase';
import { q, rpc } from './db';

/**
 * The match clock: periods when the "match started" switch is on, stints of each player on the pitch, and the
 * goals / assists / cards recorded on the clock screen. Minutes played = the overlap of a player's stints with
 * the periods. Actions are kept in a queue on the phone with the time they happened and sent in order, so the
 * clock keeps working without reception; the server treats a repeated action as a no-op.
 */
export interface Period { started_at: string; ended_at: string | null }
export interface Stint { player_id: string; started_at: string; ended_at: string | null }
export interface ClockStat { id: string; player_id: string; stat_type_id: string; minute: number | null; client_id: string | null }
export interface ClockState { periods: Period[]; stints: Stint[]; stats: ClockStat[] }

export type ClockAction =
  | { kind: 'run'; on: boolean }
  | { kind: 'player'; player: string; on: boolean }
  | { kind: 'end' }
  | { kind: 'stat'; player: string; type: string; client: string }
  | { kind: 'unstat'; stat?: string; client?: string };

interface Queued { id: string; event: string; at: string; action: ClockAction; sent?: boolean }

const ms = (iso: string) => new Date(iso).getTime();

/** How long the clock has run up to `now`, in ms. */
export function clockMs(periods: Period[], now: number): number {
  return periods.reduce((s, p) => s + Math.max(0, Math.min(p.ended_at ? ms(p.ended_at) : now, now) - ms(p.started_at)), 0);
}

/** Time a player has played up to `now`: their stints that overlap the running clock, in ms. */
export function playedMs(stints: Stint[], periods: Period[], now: number): number {
  let total = 0;
  for (const s of stints) {
    const a0 = ms(s.started_at); const a1 = s.ended_at ? ms(s.ended_at) : now;
    for (const p of periods) {
      const b0 = ms(p.started_at); const b1 = p.ended_at ? ms(p.ended_at) : now;
      total += Math.max(0, Math.min(a1, b1, now) - Math.max(a0, b0));
    }
  }
  return total;
}

/** "23:05" */
export const fmtClock = (t: number) => {
  const s = Math.floor(t / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

/** The same action the server applies, on the local copy: shows queued actions at once. */
export function applyAction(st: ClockState, at: string, a: ClockAction): ClockState {
  const open = <T extends { ended_at: string | null }>(r: T) => !r.ended_at;
  const close = <T extends { started_at: string; ended_at: string | null }>(r: T): T => (r.ended_at ? r : { ...r, ended_at: ms(at) < ms(r.started_at) ? r.started_at : at });
  switch (a.kind) {
    case 'run':
      if (a.on) return st.periods.some(open) ? st : { ...st, periods: [...st.periods, { started_at: at, ended_at: null }] };
      return { ...st, periods: st.periods.map(close) };
    case 'player': {
      const mine = (s: Stint) => s.player_id === a.player;
      if (a.on) return st.stints.some((s) => mine(s) && open(s)) ? st : { ...st, stints: [...st.stints, { player_id: a.player, started_at: at, ended_at: null }] };
      return { ...st, stints: st.stints.map((s) => (mine(s) ? close(s) : s)) };
    }
    case 'end':
      return { ...st, periods: st.periods.map(close), stints: st.stints.map(close) };
    case 'stat':
      if (st.stats.some((s) => s.client_id === a.client)) return st;
      return { ...st, stats: [...st.stats, { id: a.client, client_id: a.client, player_id: a.player, stat_type_id: a.type, minute: Math.ceil(clockMs(st.periods, ms(at)) / 60_000) }] };
    case 'unstat':
      return { ...st, stats: st.stats.filter((s) => !((a.stat && s.id === a.stat) || (a.client && s.client_id === a.client))) };
  }
}

// The queue lives in memory and is copied to the phone's storage, so it survives closing the app.
const KEY = 'nt-clock-queue';
let memQueue: Queued[] | null = null;
function readQueue(): Queued[] {
  if (!memQueue) {
    try { memQueue = JSON.parse(localStorage.getItem(KEY) ?? '[]') as Queued[]; } catch { memQueue = []; }
  }
  return memQueue;
}
function writeQueue(items: Queued[]) {
  memQueue = items;
  try { localStorage.setItem(KEY, JSON.stringify(items)); } catch { /* private mode: the queue lives in memory only */ }
}
function uuid(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  const h = Array.from({ length: 32 }, () => Math.floor(Math.random() * 16).toString(16)).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20)}`;
}

function send(item: Queued) {
  const { event: e, at, action: a } = item;
  switch (a.kind) {
    case 'run': return rpc('set_match_running', { p_event: e, p_on: a.on, p_at: at });
    case 'player': return rpc('set_player_on', { p_event: e, p_player: a.player, p_on: a.on, p_at: at });
    case 'end': return rpc('end_match', { p_event: e, p_at: at });
    case 'stat': return rpc('record_match_stat', { p_event: e, p_player: a.player, p_stat_type: a.type, p_at: at, p_client: a.client });
    case 'unstat': return rpc('delete_match_stat', { p_event: e, p_stat: a.stat ?? null, p_client: a.client ?? null });
  }
}

/** A failure the server answered (no permission, bad input): drop the action. Anything else: keep and retry. */
const answered = (e: unknown) => {
  const code = (e as { code?: string })?.code;
  return !!code && /^(42|22|P0|23|28)/.test(code);
};

export interface MatchParams { minMinutes: number; matchMinutes: number; alertMinutes: number }

/** The clock of one match: server state, the phone's queue on top of it, and the actions. */
export function useMatchClock(eventId: string, teamId: string) {
  const [server, setServer] = useState<ClockState | null>(null);
  const [canRun, setCanRun] = useState(false);
  const [params, setParams] = useState<MatchParams>({ minMinutes: 0, matchMinutes: 50, alertMinutes: 10 });
  const [queue, setQueue] = useState<Queued[]>(() => readQueue().filter((x) => x.event === eventId));
  const [error, setError] = useState<string | null>(null);
  const flushing = useRef(false);

  const load = useCallback(async () => {
    try {
      const [periods, stints, stats] = await Promise.all([
        q<Period[]>(supabase.from('match_periods').select('started_at, ended_at').eq('event_id', eventId).order('started_at')),
        q<Stint[]>(supabase.from('play_intervals').select('player_id, started_at, ended_at').eq('event_id', eventId).order('started_at')),
        q<ClockStat[]>(supabase.from('event_stats').select('id, player_id, stat_type_id, minute, client_id').eq('event_id', eventId).order('created_at')),
      ]);
      setServer({ periods, stints, stats });
      // what was sent is now part of the server state
      setQueue((qq) => { const left = qq.filter((x) => !x.sent); if (left.length !== qq.length) writeQueue([...readQueue().filter((x) => x.event !== eventId), ...left]); return left; });
    } catch { /* offline: keep what we have */ }
  }, [eventId]);

  useEffect(() => {
    let cancelled = false;
    load();
    rpc<boolean>('can_run_match', { p_team: teamId }).then((v) => { if (!cancelled) setCanRun(v === true); }, () => {});
    Promise.all(['min_play_minutes', 'match_minutes', 'min_minutes_alert'].map((k) => rpc<unknown>('team_param', { p_team: teamId, p_key: k }).catch(() => null)))
      .then(([a, b, c]) => {
        if (cancelled) return;
        setParams({ minMinutes: typeof a === 'number' ? a : 0, matchMinutes: typeof b === 'number' ? b : 50, alertMinutes: typeof c === 'number' ? c : 10 });
      });
    return () => { cancelled = true; };
  }, [load, teamId]);

  const flush = useCallback(async () => {
    if (flushing.current) return;
    flushing.current = true;
    try {
      for (;;) {
        const next = readQueue().find((x) => x.event === eventId && !x.sent);
        if (!next) break;
        try {
          await send(next);
          const all = readQueue().map((x) => (x.id === next.id ? { ...x, sent: true } : x));
          writeQueue(all); setQueue(all.filter((x) => x.event === eventId));
        } catch (e) {
          if (!answered(e)) break; // no reception: try again later
          const all = readQueue().filter((x) => x.id !== next.id);
          writeQueue(all); setQueue(all.filter((x) => x.event === eventId));
          setError((e as { message?: string })?.message ?? 'הפעולה נדחתה');
        }
      }
    } finally { flushing.current = false; }
    await load();
  }, [eventId, load]);

  // keep in step with other phones, and retry what is waiting
  useEffect(() => {
    const tick = () => { if (document.visibilityState === 'visible') flush(); };
    const id = window.setInterval(tick, 5000);
    window.addEventListener('online', tick);
    return () => { window.clearInterval(id); window.removeEventListener('online', tick); };
  }, [flush]);

  const act = useCallback((action: ClockAction) => {
    setError(null);
    const item: Queued = { id: uuid(), event: eventId, at: new Date().toISOString(), action };
    const all = [...readQueue(), item];
    writeQueue(all);
    setQueue((qq) => [...qq, item]);
    flush();
  }, [eventId, flush]);

  const state = useMemo(() => (server ? queue.reduce((st, x) => applyAction(st, x.at, x.action), server) : null), [server, queue]);
  const pending = queue.filter((x) => !x.sent).length;
  return { state, canRun, params, pending, error, act, newId: uuid };
}
