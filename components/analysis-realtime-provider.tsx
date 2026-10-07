'use client';

import { useAuth } from '@clerk/nextjs';
import { createContext, useContext, useMemo, type ReactNode } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createAuthenticatedSupabaseBrowserClient } from '@/lib/supabase-browser';

const RealtimeClientContext = createContext<SupabaseClient | null>(null);

/** Shares a memoized Supabase browser client using Clerk's token provider with descendants. */
export function AnalysisRealtimeProvider({ children }: { children: ReactNode }) {
  const { getToken } = useAuth();
  const supabase = useMemo(() => createAuthenticatedSupabaseBrowserClient(getToken), [getToken]);
  return <RealtimeClientContext.Provider value={supabase}>{children}</RealtimeClientContext.Provider>;
}

/** Returns the shared Realtime client, throwing when no analysis provider is mounted. */
export function useAnalysisRealtimeClient(): SupabaseClient {
  const client = useContext(RealtimeClientContext);
  if (!client) throw new Error('Analysis realtime components require AnalysisRealtimeProvider.');
  return client;
}
