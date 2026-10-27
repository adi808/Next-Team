import { supabase } from './supabase';
import { q, rpc } from './db';
import type { AttrDef } from './types';

/** When a match is created, prefill its format and formation from the team's defaults. */
export async function applyEventDefaults(eventId: string, teamId: string) {
  const defs = await q<AttrDef[]>(supabase.from('attribute_defs').select('*').eq('scope', 'event').in('key', ['match_format', 'formation']));
  for (const key of ['match_format', 'formation']) {
    const def = defs.find((d) => d.key === key);
    const from = (def?.config as { default_from_team?: string } | undefined)?.default_from_team;
    if (!def || !from) continue;
    const value = await rpc<unknown>('team_param', { p_team: teamId, p_key: from });
    if (typeof value === 'string') await rpc('set_attribute', { p_def: def.id, p_entity: eventId, p_value: value });
  }
}

export async function teamAllowsPlayerAnswers(teamId: string, birthDate: string | null): Promise<boolean> {
  const [can, min] = await Promise.all([
    rpc<unknown>('team_param', { p_team: teamId, p_key: 'players_can_respond' }),
    rpc<unknown>('team_param', { p_team: teamId, p_key: 'min_response_age' }),
  ]);
  if (can !== true || !birthDate) return false;
  const b = new Date(birthDate);
  const now = new Date();
  let age = now.getFullYear() - b.getFullYear();
  if (now < new Date(now.getFullYear(), b.getMonth(), b.getDate())) age -= 1;
  return age >= (typeof min === 'number' ? min : 0);
}
