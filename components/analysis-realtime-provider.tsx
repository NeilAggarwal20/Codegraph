'use client';

import { useAuth } from '@clerk/nextjs';
import { createContext, useContext, useMemo, type ReactNode } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createAuthenticatedSupabaseBrowserClient } from '@/lib/supabase-browser';

const RealtimeClientContext = createContext<SupabaseClient | null>(null);

export function AnalysisRealtimeProvider({ children }: { children: ReactNode }) {
  const { getToken } = useAuth();
  const supabase = useMemo(() => createAuthenticatedSupabaseBrowserClient(getToken), [getToken]);
  return <RealtimeClientContext.Provider value={supabase}>{children}</RealtimeClientContext.Provider>;
}

export function useAnalysisRealtimeClient(): SupabaseClient {
  const client = useContext(RealtimeClientContext);
  if (!client) throw new Error('Analysis realtime components require AnalysisRealtimeProvider.');
  return client;
}
