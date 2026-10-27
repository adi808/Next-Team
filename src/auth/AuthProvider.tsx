import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import type { AppRole, Membership, Profile } from '../lib/types';

interface AuthState {
  loading: boolean;
  session: Session | null;
  profile: Profile | null;
  memberships: Membership[];
  roles: AppRole[];
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [loading, setLoading] = useState(true);
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [memberships, setMemberships] = useState<Membership[]>([]);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      if (!data.session) setLoading(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, next) => {
      setSession(next);
      if (!next) {
        setProfile(null);
        setMemberships([]);
        setLoading(false);
      }
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  const userId = session?.user.id;
  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    setLoading(true);
    Promise.all([
      supabase.from('profiles').select('*').eq('id', userId).single(),
      supabase.from('memberships').select('id, club_id, team_id, role').eq('user_id', userId),
    ]).then(([p, m]) => {
      if (cancelled) return;
      setProfile((p.data as Profile | null) ?? null);
      setMemberships((m.data as Membership[] | null) ?? []);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [userId]);

  const roles = [...new Set(memberships.map((m) => m.role))];

  return (
    <AuthContext.Provider
      value={{
        loading,
        session,
        profile,
        memberships,
        roles,
        signOut: async () => {
          await supabase.auth.signOut();
        },
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
