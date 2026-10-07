'use server';

import { seedAnalysesForOrg } from '@/lib/seed';
import { revalidatePath } from 'next/cache';
import { auth, clerkClient } from '@clerk/nextjs/server';
import { createClerkSupabaseClient } from '@/lib/supabase';
import {
  prepareRepositoryAnalysis,
  runPreparedRepositoryAnalysis,
} from '@/lib/pipeline/run-repository-analysis';

/**
 * Prepares or reuses a repository analysis and revalidates the dashboard.
 * Converts preparation exceptions into an error result for the submitting client.
 */
export async function prepareRepositoryAnalysisAction(repoUrl: string, rerun = false) {
  let result: Awaited<ReturnType<typeof prepareRepositoryAnalysis>>;
  try {
    result = await prepareRepositoryAnalysis(repoUrl, rerun);
  } catch (error) {
    result = { status: 'error' as const, error: error instanceof Error ? error.message : 'Could not prepare this repository.' };
  }
  revalidatePath('/');
  return result;
}

/** Runs a prepared analysis through the pipeline's organization and claim checks. */
export async function runPreparedRepositoryAnalysisAction(analysisId: string) {
  return await runPreparedRepositoryAnalysis(analysisId);
}

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
