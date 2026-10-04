'use server';

import { seedAnalysesForOrg } from '@/lib/seed';
import { revalidatePath } from 'next/cache';

export async function handleSeedAnalyses(orgId: string) {
  if (!orgId) return { success: false, error: 'No active organization ID' };
  const ok = await seedAnalysesForOrg(orgId);
  if (ok) {
    revalidatePath('/');
    return { success: true };
  }
  return { success: false, error: 'Failed to seed analyses' };
}
