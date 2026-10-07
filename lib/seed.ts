import { createClerkSupabaseClient } from './supabase';
import { AnalysisRow } from './types';

/**
 * Upserts the supplied organization and fetches analyses visible through the active JWT's RLS scope.
 * Logs database errors and returns an empty list when the analysis query fails.
 */
export async function fetchAnalysesForCurrentOrg(
  orgId: string,
  orgName: string
): Promise<AnalysisRow[]> {
  const supabase = await createClerkSupabaseClient();

  // Ensure organization row exists in database for foreign key constraints
  const { error: organizationError } = await supabase
    .from('organizations')
    .upsert({ id: orgId, name: orgName }, { onConflict: 'id' });
  if (organizationError) {
    console.error('Failed to upsert organization record:', organizationError);
  }

  // RLS scopes this query from the active organization claim in the Clerk JWT.
  const { data: analyses, error } = await supabase
    .from('analyses')
    .select(
      'id, project_id, org_id, commit_sha, status, stage, stage_message, updated_at, error_message, parsed_files_count, created_at, completed_at, projects(id, name, repo_url)'
    )
    .order('created_at', { ascending: false });

  if (error) {
    console.error('Error querying analyses table via Supabase RLS:', error);
    return [];
  }

  return (analyses || []) as unknown as AnalysisRow[];
}

export async function seedAnalysesForOrg(orgId: string): Promise<boolean> {
  const supabase = await createClerkSupabaseClient();

  try {
    const { data: project, error: projErr } = await supabase
      .from('projects')
      .insert({
        org_id: orgId,
        name: 'codegraph/repository-map',
        repo_url: 'https://github.com/codegraph/repository-map',
        default_branch: 'main',
      })
      .select()
      .single();

    if (projErr || !project) {
      console.error('Failed to insert seed project:', projErr);
      return false;
    }

    const { error: analysisErr } = await supabase.from('analyses').insert([
      {
        project_id: project.id,
        org_id: orgId,
        commit_sha: '8f9a0b1',
        status: 'completed',
        parsed_files_count: 124,
        created_at: new Date(Date.now() - 3600000 * 2).toISOString(),
        completed_at: new Date(Date.now() - 3600000).toISOString(),
      },
      {
        project_id: project.id,
        org_id: orgId,
        commit_sha: '2c3d4e5',
        status: 'parsing',
        parsed_files_count: 52,
        created_at: new Date(Date.now() - 600000).toISOString(),
      },
      {
        project_id: project.id,
        org_id: orgId,
        commit_sha: '6f7g8h9',
        status: 'failed',
        error_message: 'Failed to resolve import alias @/components/missing',
        parsed_files_count: 14,
        created_at: new Date(Date.now() - 86400000).toISOString(),
      },
    ]);

    if (analysisErr) {
      console.error('Failed to insert seed analyses:', analysisErr);
      return false;
    }

    return true;
  } catch (err) {
    console.error('Error seeding analyses:', err);
    return false;
  }
}
