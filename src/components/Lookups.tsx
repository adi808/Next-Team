import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { q } from '../lib/db';
import type { Lookup } from '../lib/types';

const cache = new Map<string, Promise<Lookup[]>>();

export function clearLookupCache() {
  cache.clear();
}

function loadDomain(domain: string): Promise<Lookup[]> {
  let p = cache.get(domain);
  if (!p) {
    p = q<Lookup[]>(supabase.from('lookups').select('*').eq('domain', domain).order('sort_order'));
    p.catch(() => cache.delete(domain));
    cache.set(domain, p);
  }
  return p;
}

/** All values of a list. sportId keeps values of that sport (or of every sport); parentId filters dependent lists. */
export function useLookups(domain: string, opts: { sportId?: string | null; parentId?: string | null; includeInactive?: boolean } = {}) {
  const [all, setAll] = useState<Lookup[]>([]);
  useEffect(() => {
    let cancelled = false;
    loadDomain(domain).then((rows) => { if (!cancelled) setAll(rows); }, () => {});
    return () => { cancelled = true; };
  }, [domain]);
  return all.filter(
    (l) =>
      (opts.includeInactive || l.active) &&
      (!opts.sportId || !l.sport_id || l.sport_id === opts.sportId) &&
      (opts.parentId === undefined || l.parent_id === opts.parentId),
  );
}

export function useLookupName(domain: string) {
  const all = useLookups(domain, { includeInactive: true });
  return (id: string | null | undefined) => all.find((l) => l.id === id)?.name_he ?? '';
}

export function LookupSelect(props: {
  domain: string;
  value: string | null;
  onChange: (id: string | null) => void;
  sportId?: string | null;
  parentId?: string | null;
  empty?: string;
  id?: string;
}) {
  const items = useLookups(props.domain, { sportId: props.sportId, parentId: props.parentId });
  return (
    <select id={props.id} value={props.value ?? ''} onChange={(e) => props.onChange(e.target.value || null)}>
      <option value="">{props.empty ?? 'בחרו…'}</option>
      {items.map((l) => (
        <option key={l.id} value={l.id}>{l.name_he}</option>
      ))}
    </select>
  );
}

import type { Sport } from '../lib/types';
let sportsCache: Promise<Sport[]> | null = null;
export function useSports() {
  const [sports, setSports] = useState<Sport[]>([]);
  useEffect(() => {
    sportsCache ??= q<Sport[]>(supabase.from('sports').select('*').order('sort_order'));
    sportsCache.then(setSports, () => { sportsCache = null; });
  }, []);
  return sports;
}
