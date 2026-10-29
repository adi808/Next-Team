import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from './supabase';

interface PgError { message: string; code?: string }

const BY_CODE: Record<string, string> = {
  '42501': 'אין לך הרשאה לפעולה הזו',
  P0002: 'לא נמצא',
  '22003': 'הערך מחוץ לטווח המותר',
  '23505': 'כבר קיים',
  '28000': 'יש להתחבר מחדש',
};

export function friendlyError(e: unknown): string {
  const err = e as PgError;
  if (err?.message?.includes('phone number belongs')) return 'מספר הטלפון כבר שייך לחשבון אחר';
  if (err?.code && BY_CODE[err.code]) return BY_CODE[err.code];
  if (err?.code === '22023') return `הנתונים שהוזנו אינם תקינים (${err.message})`;
  return err?.message ?? 'משהו השתבש';
}

// Unwraps a supabase result; throws the PostgREST error.
export async function q<T>(p: PromiseLike<{ data: unknown; error: PgError | null }>): Promise<T> {
  const { data, error } = await p;
  if (error) throw error;
  return data as T;
}

// Updates or deletes one row by id; RLS hides rows it refuses, so an empty result means no permission.
export async function mutateOne(p: PromiseLike<{ data: unknown; error: PgError | null }>): Promise<void> {
  const rows = await q<unknown[] | null>(p);
  if (!rows?.length) throw { code: '42501', message: 'not allowed' } satisfies PgError;
}

export function rpc<T = unknown>(name: string, args?: Record<string, unknown>): Promise<T> {
  return q<T>(supabase.rpc(name, args));
}

export function useLoad<T>(fn: () => Promise<T>, deps: unknown[]) {
  const [data, setData] = useState<T | undefined>();
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);
  const fnRef = useRef(fn);
  fnRef.current = fn;
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fnRef.current().then(
      (d) => { if (!cancelled) { setData(d); setError(null); setLoading(false); } },
      (e) => { if (!cancelled) { setError(friendlyError(e)); setLoading(false); } },
    );
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick]);
  const reload = useCallback(() => setTick((t) => t + 1), []);
  return { data, error, loading, reload };
}

// Runs an async action with busy/error state.
export function useAction() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = useCallback(async <T,>(fn: () => Promise<T>): Promise<T | undefined> => {
    setBusy(true);
    setError(null);
    try {
      return await fn();
    } catch (e) {
      setError(friendlyError(e));
      return undefined;
    } finally {
      setBusy(false);
    }
  }, []);
  return { busy, error, run, setError };
}

export const fmtDate = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleString('he-IL', { dateStyle: 'short', timeStyle: 'short' }) : '';

export const fmtDay = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleDateString('he-IL') : '';

export function ageOf(birth: string | null): number | null {
  if (!birth) return null;
  const b = new Date(birth);
  const now = new Date();
  let a = now.getFullYear() - b.getFullYear();
  if (now < new Date(now.getFullYear(), b.getMonth(), b.getDate())) a -= 1;
  return a;
}
