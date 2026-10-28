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
