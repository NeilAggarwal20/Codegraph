import { createClerkSupabaseClient } from './supabase';
import type { AnalysisRow } from './types';

/**
 * Fetches analyses for the current organization.
 *
 * There is no application-level org filter here. Row Level Security on the
 * analyses table restricts results to rows whose org_id matches the org_id
 * claim inside the Clerk JWT (org_id or Clerk's o.id claim) passed to Supabase.
 */
export async function fetchAnalyses(): Promise<AnalysisRow[]> {
  const supabase = await createClerkSupabaseClient();

  const { data, error } = await supabase
    .from('analyses')
    .select(
      'id, project_id, org_id, commit_sha, status, error_message, parsed_files_count, created_at, completed_at, projects(id, name, repo_url)'
    )
    .order('created_at', { ascending: false });

  if (error) {
    throw new Error('Failed to fetch organization analyses.', { cause: error });
  }

  return (data ?? []) as unknown as AnalysisRow[];
}
