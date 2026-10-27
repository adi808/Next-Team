import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import { q } from '../lib/db';
import type { Membership, Mode, Player, Profile } from '../lib/types';

interface AuthState {
  loading: boolean;
  session: Session | null;
  profile: Profile | null;
  memberships: Membership[];
  /** players this user is an approved parent of */
  children: Player[];
  /** the player profile of this account, if any */
  me: Player | null;
  modes: Mode[];
  adminClubIds: string[];
  coachTeamIds: string[];
  reload: () => void;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children: kids }: { children: ReactNode }) {
  const [loading, setLoading] = useState(true);
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [memberships, setMemberships] = useState<Membership[]>([]);
  const [children, setChildren] = useState<Player[]>([]);
  const [me, setMe] = useState<Player | null>(null);
  const [tick, setTick] = useState(0);
  const loadedOnce = useRef(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      if (!data.session) setLoading(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, next) => {
      setSession(next);
      if (!next) {
        setProfile(null); setMemberships([]); setChildren([]); setMe(null); loadedOnce.current = false; setLoading(false);
      }
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  const userId = session?.user.id;
  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    // a background refresh must not replace the whole screen with the loader (it would remount the caller)
    if (!loadedOnce.current) setLoading(true);
    (async () => {
      const [p, m, g, players] = await Promise.all([
        q<Profile>(supabase.from('profiles').select('*').eq('id', userId).single()),
        q<Membership[]>(supabase.from('memberships').select('id, club_id, team_id, role').eq('user_id', userId)),
        q<{ player_id: string }[]>(
          supabase.from('guardianships').select('player_id').eq('parent_id', userId).eq('status', 'approved')),
        q<Player[]>(supabase.from('v_players').select('*')),
      ]);
      if (cancelled) return;
      const mine = new Set(g.map((x) => x.player_id));
      setProfile(p);
      setMemberships(m);
      setChildren(players.filter((pl) => mine.has(pl.id)));
      setMe(players.find((pl) => pl.is_me) ?? null);
      loadedOnce.current = true;
      setLoading(false);
    })().catch(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [userId, tick]);

  const reload = useCallback(() => setTick((t) => t + 1), []);

  const value = useMemo<AuthState>(() => {
    const adminClubIds = memberships.filter((m) => m.role === 'club_admin').map((m) => m.club_id);
    const coachTeamIds = memberships.filter((m) => m.role === 'coach' && m.team_id).map((m) => m.team_id as string);
    const modes: Mode[] = [];
    if (profile?.is_system_admin) modes.push('sysadmin');
    if (adminClubIds.length) modes.push('admin');
    if (coachTeamIds.length) modes.push('coach');
    if (children.length) modes.push('parent');
    if (me) modes.push('player');
    return {
      loading, session, profile, memberships, children, me, modes, adminClubIds, coachTeamIds, reload,
      signOut: async () => { await supabase.auth.signOut(); },
    };
  }, [loading, session, profile, memberships, children, me, reload]);

  return <AuthContext.Provider value={value}>{kids}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
