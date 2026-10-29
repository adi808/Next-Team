import type { EventRow } from './types';

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
