import type { EventRow } from './types';

const ISRAEL = 'Asia/Jerusalem';
const DAY_NAMES = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];

/** Day of the week in Israel, 0 = Sunday. */
export const israelDow = (iso: string) =>
  ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(new Date(iso).toLocaleDateString('en-US', { weekday: 'short', timeZone: ISRAEL }));
export const dayName = (dow: number) => DAY_NAMES[dow] ?? '';

/** "HH:MM" of an instant, in Israel time (the value of a time input). */
export const israelTime = (iso: string) =>
  new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: ISRAEL });

/** The event and every later event of the same type on the same weekday: what a bulk edit changes. */
export function sameSlotAhead<T extends Pick<EventRow, 'type_id' | 'starts_at'>>(rows: T[], base: Pick<EventRow, 'type_id' | 'starts_at'>): T[] {
  const dow = israelDow(base.starts_at);
  return rows.filter((r) => r.type_id === base.type_id && r.starts_at >= base.starts_at && israelDow(r.starts_at) === dow);
}

/** When an event is over: its end time, or 90 minutes after the start when it has none. */
export const endOf = (e: Pick<EventRow, 'starts_at' | 'ends_at'>) =>
  e.ends_at ? new Date(e.ends_at).getTime() : new Date(e.starts_at).getTime() + 90 * 60_000;

export const isOver = (e: Pick<EventRow, 'starts_at' | 'ends_at'>, now = Date.now()) => endOf(e) < now;

/** From events sorted by start: the nearest one, and the nearest one of another type (e.g. training, then a match). */
export function nextAndOther<T extends Pick<EventRow, 'type_id'>>(events: T[]): [T | undefined, T | undefined] {
  const next = events[0];
  return [next, next ? events.find((e) => e.type_id !== next.type_id) : undefined];
}

/**
 * The heading of an event. A match with an opponent reads "<our team> נגד <opponent>"; a title that already is the
 * opponent's name (or mentions it) is not repeated, and a title like "משחק ליגה" gets the opponent appended.
 */
export function eventHeading(e: Pick<EventRow, 'title' | 'opponent'>, typeLabel: string, teamName?: string): string {
  const title = (e.title ?? '').trim();
  const opp = (e.opponent ?? '').trim();
  if (!opp) return title || typeLabel;
  if (!title || title === opp) return `${teamName || typeLabel} נגד ${opp}`;
  return title.includes(opp) ? title : `${title} נגד ${opp}`;
}
