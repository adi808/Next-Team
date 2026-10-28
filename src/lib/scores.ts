import type { AttrDef, AttrValue, EntityRole } from './types';

export interface DefScope { clubId: string; teamIds: string[]; sportIds: string[]; roles: EntityRole[] }

/** The parameter definitions that apply to a player and that the caller may see. */
export function defsFor(defs: AttrDef[], s: DefScope): AttrDef[] {
  return defs.filter((d) => d.active
    && (!d.club_id || d.club_id === s.clubId)
    && (!d.team_id || s.teamIds.includes(d.team_id))
    && (!d.sport_id || s.sportIds.includes(d.sport_id))
    && d.visible_to.some((r) => s.roles.includes(r)));
}

/** A value on a 1-10 rating as a 0-10 score (other ranges are scaled to 10). */
export function toTen(def: AttrDef, v: unknown): number | null {
  if (typeof v !== 'number') return null;
  const max = (def.config as { max?: number }).max ?? 10;
  return max > 0 ? (v / max) * 10 : null;
}

export interface Rating { def: AttrDef; score: number; at: string }

/** The latest rating of a player on each scale parameter. `values` may hold several players' values. */
export function latestRatings(scaleDefs: AttrDef[], values: (AttrValue & { seq?: number })[], playerId: string): Rating[] {
  const out: Rating[] = [];
  for (const def of scaleDefs) {
    const last = values.filter((v) => v.def_id === def.id && v.entity_id === playerId)
      .sort((a, b) => (b.seq ?? 0) - (a.seq ?? 0) || b.recorded_at.localeCompare(a.recorded_at))[0];
    const score = last ? toTen(def, last.value) : null;
    if (last && score !== null) out.push({ def, score, at: last.recorded_at });
  }
  return out;
}

export const average = (xs: number[]): number | null => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
