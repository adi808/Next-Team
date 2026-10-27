import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { q } from '../lib/db';
import type { Player } from '../lib/types';

const names = new Map<string, string>();

/** id -> display name for accounts the caller is allowed to see (RLS decides). */
export function useNames(ids: string[]) {
  const [, setTick] = useState(0);
  const key = [...new Set(ids)].sort().join(',');
  useEffect(() => {
    const missing = key.split(',').filter((i) => i && !names.has(i));
    if (!missing.length) return;
    let cancelled = false;
    q<{ id: string; full_name: string; phone: string | null }[]>(
      supabase.from('profiles').select('id, full_name, phone').in('id', missing),
    ).then((rows) => {
      rows.forEach((r) => names.set(r.id, r.full_name || r.phone || 'משתמש'));
      missing.forEach((i) => { if (!names.has(i)) names.set(i, 'משתמש'); });
      if (!cancelled) setTick((t) => t + 1);
    }, () => {});
    return () => { cancelled = true; };
  }, [key]);
  return (id: string | null | undefined) => (id ? names.get(id) ?? '…' : '');
}

export function PlayerAvatar({ player, size = 40 }: { player: Pick<Player, 'full_name' | 'photo_path'>; size?: number }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    setUrl(null);
    if (!player.photo_path) return;
    let cancelled = false;
    supabase.storage.from('player-photos').createSignedUrl(player.photo_path, 3600).then(({ data }) => {
      if (!cancelled && data) setUrl(data.signedUrl);
    });
    return () => { cancelled = true; };
  }, [player.photo_path]);
  const style = { width: size, height: size, fontSize: size / 2.4 };
  return url ? (
    <img className="avatar" style={style} src={url} alt={player.full_name} />
  ) : (
    <span className="avatar" style={style} aria-label={player.full_name}>
      {player.full_name.trim().slice(0, 1)}
    </span>
  );
}
