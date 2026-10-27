import { createClient } from '@supabase/supabase-js';
import { demoSupabase } from '../demo/client';

/** True only in the demo build (in-browser sample data, no server). */
export const isDemo = import.meta.env.VITE_DEMO === '1';

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

if (!isDemo && (!url || !anonKey)) {
  throw new Error('Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY (see .env.example)');
}

export const supabase = isDemo ? demoSupabase() : createClient(url as string, anonKey as string);
