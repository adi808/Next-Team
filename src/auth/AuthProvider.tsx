import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import { isDemo, supabase } from '../lib/supabase';
import { q } from '../lib/db';
import type { Membership, Mode, Player, Profile } from '../lib/types';
import { endPreview, getPreview, type Preview } from './preview';

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
  /** the current terms of use (null while none is published) */
  terms: { version: number; body: string } | null;
  /** "view as" a coach or a player (club admin / system admin only), read only */
  preview: (Preview & { label: string }) | null;
  /** a "view as" was just chosen and is still loading */
  previewPending: boolean;
  endPreview: () => void;
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
  const [preview, setPreview] = useState<Preview | null>(getPreview);
  const [allPlayers, setAllPlayers] = useState<Player[]>([]);
  const [terms, setTerms] = useState<AuthState['terms']>(null);
  const [previewTeam, setPreviewTeam] = useState<{ id: string; club_id: string; name: string } | null>(null);
  useEffect(() => {
    const on = () => setPreview(getPreview());
    window.addEventListener('nt-preview', on);
    return () => window.removeEventListener('nt-preview', on);
  }, []);
  const previewKey = preview ? JSON.stringify(preview) : '';
  const [resolvedKey, setResolvedKey] = useState('');

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      if (!data.session) setLoading(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, next) => {
      setSession(next);
      // Signed in (by code, emailed link or Google): forget the address the login screen was waiting on.
      if (next) { try { localStorage.removeItem('nt-login-pending'); } catch { /* storage blocked */ } }
      if (!next) {
        setProfile(null); setMemberships([]); setChildren([]); setMe(null); setAllPlayers([]); setPreviewTeam(null);
        loadedOnce.current = false; setLoading(false);
        if (getPreview()) endPreview();
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
      const [p, m, g, players, t] = await Promise.all([
        q<Profile>(supabase.from('profiles').select('*').eq('id', userId).single()),
        q<Membership[]>(supabase.from('memberships').select('id, club_id, team_id, role, staff_role_id').eq('user_id', userId)),
        q<{ player_id: string }[]>(
          supabase.from('guardianships').select('player_id').eq('parent_id', userId).eq('status', 'approved')),
        q<Player[]>(supabase.from('v_players').select('*')),
        q<{ version: number; body: string }[]>(supabase.from('app_terms').select('version, body').order('version', { ascending: false }).limit(1))
          .catch(() => []), // before the terms migration: no terms screen
      ]);
      if (cancelled) return;
      const mine = new Set(g.map((x) => x.player_id));
      setProfile(p);
      setMemberships(m);
      setChildren(players.filter((pl) => mine.has(pl.id)));
      setMe(players.find((pl) => pl.is_me) ?? null);
      setTerms(t[0] ?? null);
      setAllPlayers(players);
      const pv = getPreview();
      const team = pv?.kind === 'coach'
        ? (await q<{ id: string; club_id: string; name: string }[]>(supabase.from('teams').select('id, club_id, name').eq('id', pv.teamId)))[0] ?? null
        : null;
      if (cancelled) return;
      setPreviewTeam(team);
      setResolvedKey(pv ? JSON.stringify(pv) : '');
      loadedOnce.current = true;
      setLoading(false);
    })().catch(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [userId, tick, previewKey]);

  const reload = useCallback(() => setTick((t) => t + 1), []);

  const value = useMemo<AuthState>(() => {
    const adminClubIds = memberships.filter((m) => m.role === 'club_admin').map((m) => m.club_id);
    let coachTeamIds = memberships.filter((m) => m.role === 'coach' && m.team_id).map((m) => m.team_id as string);
    let allMemberships = memberships;
    let meNow = me;
    // "view as": only for the system admin or the admin of the team's / player's club
    const canView = (club: string | undefined) => !!club && (!!profile?.is_system_admin || adminClubIds.includes(club));
    let shown: AuthState['preview'] = null;
    if (preview?.kind === 'coach' && previewTeam?.id === preview.teamId && canView(previewTeam.club_id)) {
      coachTeamIds = [previewTeam.id];
      allMemberships = [...memberships.filter((m) => m.role !== 'coach'),
        { id: `preview-${previewTeam.id}`, club_id: previewTeam.club_id, team_id: previewTeam.id, role: 'coach', staff_role_id: null } as Membership];
      shown = { ...preview, label: previewTeam.name };
    }
    const pp = preview?.kind === 'player' ? allPlayers.find((x) => x.id === preview.playerId) : undefined;
    if (pp && canView(pp.club_id)) {
      meNow = pp;
      shown = { ...preview!, label: pp.full_name };
    }
    const modes: Mode[] = [];
    if (profile?.is_system_admin) modes.push('sysadmin');
    if (adminClubIds.length) modes.push('admin');
    if (coachTeamIds.length) modes.push('coach');
    if (children.length || profile?.is_parent) modes.push('parent');
    if (meNow) modes.push('player');
    return {
      loading, session, profile, memberships: allMemberships, children, me: meNow, modes, adminClubIds, coachTeamIds, reload,
      terms, preview: shown, endPreview, previewPending: !!previewKey && previewKey !== resolvedKey,
      signOut: async () => {
        if (isDemo) { window.dispatchEvent(new Event('demo-exit')); return; }
        await supabase.auth.signOut();
      },
    };
  }, [loading, session, profile, memberships, children, me, reload, terms, preview, previewTeam, allPlayers, previewKey, resolvedKey]);

  return <AuthContext.Provider value={value}>{kids}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
