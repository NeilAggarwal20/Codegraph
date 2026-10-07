'use client';

import { createClient } from '@supabase/supabase-js';

/** Creates a browser Supabase client using the supplied Clerk token callback without Supabase session persistence. */
export function createAuthenticatedSupabaseBrowserClient(getToken: () => Promise<string | null>) {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      accessToken: getToken,
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
    },
  );
}
