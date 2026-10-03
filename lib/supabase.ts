import { createClient } from '@supabase/supabase-js';
import { auth } from '@clerk/nextjs/server';
import './env';

export async function createClerkSupabaseClient() {
  const { getToken } = await auth();

  let token: string | null = null;
  try {
    token = await getToken({ template: 'supabase' });
  } catch {
    // Fall back to standard session token if template not configured
  }

  if (!token) {
    token = await getToken();
  }

  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      global: {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      },
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
    }
  );
}
