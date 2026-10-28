import { useCallback, useState } from 'react';
import { useAuth } from './AuthProvider';

const KEY = 'team';

/** The team a coach is working on now: the last one chosen, or the first one they coach. */
export function useCoachTeam(): [string | null, (id: string) => void] {
  const { coachTeamIds } = useAuth();
  const [saved, setSaved] = useState<string | null>(() => {
    try { return localStorage.getItem(KEY); } catch { return null; }
  });
  const choose = useCallback((id: string) => {
    setSaved(id);
    try { localStorage.setItem(KEY, id); } catch { /* storage may be unavailable */ }
  }, []);
  const current = saved && coachTeamIds.includes(saved) ? saved : coachTeamIds[0] ?? null;
  return [current, choose];
}
