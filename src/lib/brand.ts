import { supabase } from './supabase';
import { q, useLoad } from './db';
import { lum } from './share';
import type { Club, Team, TeamKit } from './types';

export const APP_BLUE = '#2563eb';
const NAVY = '#13235b';

const isHex = (c: string | null | undefined): c is string => !!c && /^#[0-9a-f]{6}$/i.test(c);

/** A colour mixed toward black (amount < 0) or white (amount > 0). */
export function shade(hex: string, amount: number): string {
  const n = parseInt(hex.slice(1), 16);
  const to = amount < 0 ? 0 : 255;
  const a = Math.abs(amount);
  const mix = (v: number) => Math.round(v + (to - v) * a).toString(16).padStart(2, '0');
  return `#${mix(n >> 16)}${mix((n >> 8) & 255)}${mix(n & 255)}`;
}

const distance = (a: string, b: string) => {
  const x = parseInt(a.slice(1), 16); const y = parseInt(b.slice(1), 16);
  return Math.abs((x >> 16) - (y >> 16)) + Math.abs(((x >> 8) & 255) - ((y >> 8) & 255)) + Math.abs((x & 255) - (y & 255));
};

export interface Colors { primary: string; secondary: string }

/**
 * The colours of an event: the shirt of its kit, with the shorts (or the socks) as the second colour.
 * When the two are too close, the second is a darker shade of the first. No kit: the app blue with navy.
 */
export function kitColors(kit?: Pick<TeamKit, 'shirt' | 'shorts' | 'socks'> | null): Colors {
  if (!kit || !isHex(kit.shirt)) return { primary: APP_BLUE, secondary: NAVY };
  const primary = kit.shirt;
  const second = [kit.shorts, kit.socks].find((c) => isHex(c) && distance(c, primary) > 120);
  return { primary, secondary: second ?? (lum(primary) > 150 ? NAVY : shade(primary, -0.45)) };
}

/** The event's kit, or the team's first active kit when the event has none. */
export function kitFor(kits: TeamKit[], teamId: string, kitId: string | null | undefined): TeamKit | undefined {
  return kits.find((k) => k.id === kitId) ?? kits.filter((k) => k.team_id === teamId && k.active).sort((a, b) => a.sort_order - b.sort_order)[0];
}

export interface Brand { teamName: string; clubName: string; logoPath: string | null; kits: TeamKit[] }

/** What a team's artwork needs: its name, the club's name and logo, and its kits (for the colours). */
export function useTeamBrand(teamId: string) {
  return useLoad<Brand | null>(async () => {
    if (!teamId) return null;
    const team = await q<Pick<Team, 'id' | 'name' | 'club_id'>>(supabase.from('teams').select('id, name, club_id').eq('id', teamId).single());
    const [clubs, kits] = await Promise.all([
      q<Pick<Club, 'id' | 'name' | 'logo_path'>[]>(supabase.from('clubs').select('id, name, logo_path').eq('id', team.club_id)),
      q<TeamKit[]>(supabase.from('team_kits').select('*').eq('team_id', teamId).order('sort_order')),
    ]);
    return { teamName: team.name, clubName: clubs[0]?.name ?? '', logoPath: clubs[0]?.logo_path ?? null, kits };
  }, [teamId]);
}
