'use server';

import { seedAnalysesForOrg } from '@/lib/seed';
import { revalidatePath } from 'next/cache';
import { auth, clerkClient } from '@clerk/nextjs/server';
import { createClerkSupabaseClient } from '@/lib/supabase';

export async function handleSeedAnalyses() {
  const { orgId } = await auth();
  if (!orgId) return { success: false, error: 'No active organization' };

  const clerk = await clerkClient();
  const organization = await clerk.organizations.getOrganization({ organizationId: orgId });
  const supabase = await createClerkSupabaseClient();
  const { error } = await supabase
    .from('organizations')
    .upsert({ id: orgId, name: organization.name }, { onConflict: 'id' });

  if (error) {
    console.error('Failed to upsert organization before seeding:', error);
    return { success: false, error: 'Failed to prepare organization for seeding' };
  }

  const ok = await seedAnalysesForOrg(orgId);
  if (ok) {
    revalidatePath('/');
    return { success: true };
  }
  return { success: false, error: 'Failed to seed analyses' };
}
