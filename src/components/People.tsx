import { useEffect, useState } from 'react';
import { Picture } from './Picture';
import { supabase } from '../lib/supabase';
import { q } from '../lib/db';
import type { Player } from '../lib/types';

const names = new Map<string, string>();
const avatars = new Map<string, string | null>();

/** id -> display name for accounts the caller is allowed to see (RLS decides). */
export function useNames(ids: string[]) {
  const [, setTick] = useState(0);
  const key = [...new Set(ids)].sort().join(',');
  useEffect(() => {
    const missing = key.split(',').filter((i) => i && !names.has(i));
    if (!missing.length) return;
    let cancelled = false;
    q<{ id: string; full_name: string; email: string | null; phone: string | null; avatar_path: string | null }[]>(
      supabase.from('profiles').select('id, full_name, email, phone, avatar_path').in('id', missing),
    ).then((rows) => {
      rows.forEach((r) => { names.set(r.id, r.full_name || r.email || r.phone || 'משתמש'); avatars.set(r.id, r.avatar_path); });
      missing.forEach((i) => { if (!names.has(i)) names.set(i, 'משתמש'); });
      if (!cancelled) setTick((t) => t + 1);
    }, () => {});
    return () => { cancelled = true; };
  }, [key]);
  return (id: string | null | undefined) => (id ? names.get(id) ?? '…' : '');
}

export function PlayerAvatar({ player, size = 40 }: { player: Pick<Player, 'full_name' | 'photo_path'>; size?: number }) {
  return <Picture bucket="player-photos" path={player.photo_path} name={player.full_name} size={size} />;
}

/** An account's picture next to its name; pair with useNames for the same ids so the cache is filled. */
export function PersonAvatar({ id, size = 28 }: { id: string; size?: number }) {
  return <Picture bucket="avatars" path={avatars.get(id)} name={names.get(id) ?? '?'} size={size} />;
}
