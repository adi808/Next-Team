import { supabase } from '../lib/supabase';
import { q, useLoad } from '../lib/db';
import type { TeamKit } from '../lib/types';

/** A kid wearing the kit: shirt, shorts and socks in the kit colours. */
export function KitAvatar({ kit, size = 64 }: { kit: Pick<TeamKit, 'shirt' | 'shorts' | 'socks' | 'name'>; size?: number }) {
  const line = 'rgba(15, 23, 42, 0.18)';
  return (
    <svg className="kit-avatar" width={size * 0.66} height={size} viewBox="0 0 64 96" role="img" aria-label={`תלבושת ${kit.name}`}>
      {/* legs and socks */}
      <rect x="22" y="62" width="8" height="22" rx="3" fill="#f1c7a0" />
      <rect x="34" y="62" width="8" height="22" rx="3" fill="#f1c7a0" />
      <rect x="21.5" y="72" width="9" height="13" rx="2.5" fill={kit.socks} stroke={line} />
      <rect x="33.5" y="72" width="9" height="13" rx="2.5" fill={kit.socks} stroke={line} />
      <path d="M19 85h12v4a3 3 0 0 1-3 3h-9z M33 85h12v7h-9a3 3 0 0 1-3-3z" fill="#1f2937" />
      {/* arms */}
      <rect x="8" y="30" width="7" height="24" rx="3.5" fill="#f1c7a0" />
      <rect x="49" y="30" width="7" height="24" rx="3.5" fill="#f1c7a0" />
      {/* shorts */}
      <path d="M19 52h26l2 15h-12l-3-6-3 6H17z" fill={kit.shorts} stroke={line} />
      {/* shirt with short sleeves */}
      <path d="M22 22h20l10 6-4 9-5-3v20H19V34l-5 3-4-9z" fill={kit.shirt} stroke={line} />
      <path d="M27 22a5 4 0 0 0 10 0" fill="none" stroke={line} />
      {/* head */}
      <circle cx="32" cy="13" r="9" fill="#f1c7a0" />
      <path d="M23 12a9 9 0 0 1 18 0c-3-3-6-4-9-4s-6 1-9 4z" fill="#4b3621" />
    </svg>
  );
}

/** The team's kits, active first (archived ones are kept so past events still show theirs). */
export function useTeamKits(teamId: string) {
  return useLoad(
    () => q<TeamKit[]>(supabase.from('team_kits').select('*').eq('team_id', teamId).order('sort_order')),
    [teamId],
  );
}

export function KitSelect({ kits, value, onChange }: { kits: TeamKit[]; value: string | null; onChange: (id: string | null) => void }) {
  const options = kits.filter((k) => k.active || k.id === value);
  return (
    <select value={value ?? ''} onChange={(e) => onChange(e.target.value || null)}>
      <option value="">בלי תלבושת מוגדרת</option>
      {options.map((k) => <option key={k.id} value={k.id}>{k.name}</option>)}
    </select>
  );
}
