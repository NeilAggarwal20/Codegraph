import 'server-only';

import { auth, clerkClient } from '@clerk/nextjs/server';
import { createClerkSupabaseClient } from '@/lib/supabase';
import { parseRepository } from '@/lib/parser/parse-repository';
import type { DependencyEdge, ParserResult } from '@/lib/parser/types';
import {
  createRepositoryWorkspace,
  downloadAndExtractRepository,
  parseGitHubRepositoryUrl,
  removeRepositoryWorkspace,
  resolveGitHubRepository,
} from './github-archive';

export type AnalysisPreparationResult =
  | { status: 'ready' | 'existing'; analysisId: string }
  | { status: 'error'; error: string };

export type AnalysisRunResult =
  | { status: 'completed' | 'already-running'; analysisId: string; commitSha?: string }
  | { status: 'failed'; analysisId: string; stage: string; error: string };

/** Extracts an Error's message or supplies a fallback for other thrown values. */
function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'An unknown error occurred.';
}

/** Converts parser output to the storage RPC's field names and attaches resolved import specifiers. */
function makeStorageArtifact(result: ParserResult) {
  const specifierByEdge = new Map<string, string>();
  for (const record of result.coverage.records) {
    if (record.status !== 'resolved' || !record.resolvedTo) continue;
    const key = `${record.from}\0${record.resolvedTo}\0${record.kind}`;
    if (!specifierByEdge.has(key)) specifierByEdge.set(key, record.specifier);
  }

  return {
    schemaVersion: result.schemaVersion,
    root: result.root,
    stats: result.stats,
    coverage: result.coverage,
    skippedFiles: result.skippedFiles,
    files: result.files.map((file) => ({
      path: file.path,
      lines: file.lines,
      folder: file.folder,
      module: file.module,
      kind: file.kind,
      sha256: file.sha256,
      fan_in: file.fanIn,
      fan_out: file.fanOut,
    })),
    edges: result.edges.map((edge: DependencyEdge) => ({
      from_path: edge.from,
      to_path: edge.to,
      kind: edge.kind,
      import_specifier: specifierByEdge.get(`${edge.from}\0${edge.to}\0${edge.kind}`) ?? '',
    })),
  };
}

/**
 * Validates the repository URL and upserts its organization and project records.
 * Returns the analysis ID and whether the preparation RPC queued work or reused a run.
 * @param rerun - Requests a reset of an eligible existing analysis instead of reusing it.
 * @throws If no organization is active or preparation fails.
 */
export async function prepareRepositoryAnalysis(repoUrl: string, rerun = false): Promise<AnalysisPreparationResult> {
  const repository = parseGitHubRepositoryUrl(repoUrl);
  const { orgId } = await auth();
  if (!orgId) throw new Error('Select an organization before analysing a repository.');

  const clerk = await clerkClient();
  const organization = await clerk.organizations.getOrganization({ organizationId: orgId });
  const supabase = await createClerkSupabaseClient();

  const { error: orgError } = await supabase
    .from('organizations')
    .upsert({ id: orgId, name: organization.name }, { onConflict: 'id' });
  if (orgError) throw new Error('Could not prepare the active organization for repository analysis.', { cause: orgError });

  const { data: project, error: projectError } = await supabase
    .from('projects')
    .upsert({
      org_id: orgId,
      name: `${repository.owner}/${repository.name}`,
      repo_url: repository.url,
    }, { onConflict: 'org_id,repo_url' })
    .select('id')
    .single();
if (projectError || !project) {
  throw new Error(
    `Could not create or load this repository record. ${
      projectError
        ? `${projectError.code ?? ''} | ${projectError.message ?? ''} | ${projectError.details ?? ''} | ${projectError.hint ?? ''}`
        : 'No project returned.'
    }`
  );
}

  const { data: preparedData, error: prepareError } = await supabase
    .rpc('prepare_repository_analysis', {
      p_project_id: project.id,
      p_org_id: orgId,
      p_rerun: rerun,
    })
    .maybeSingle();
if (prepareError || !preparedData) {
  throw new Error(
    `Could not create or load this repository analysis. ${
      prepareError
        ? `${prepareError.code ?? ''} | ${prepareError.message ?? ''} | ${prepareError.details ?? ''} | ${prepareError.hint ?? ''}`
        : 'No preparation data returned.'
    }`
  );
}

  const preparation = preparedData as unknown as { analysis_id: string; should_run: boolean };
  return {
    status: preparation.should_run ? 'ready' : 'existing',
    analysisId: preparation.analysis_id,
  };
}

/**
 * Claims an analysis in the active organization, then fetches, parses, and stores its repository.
 * Records pipeline failures with their stage and attempts temporary workspace cleanup.
 * Returns the run outcome, or already-running when the claim is refused.
 * @throws If authorization, project lookup, claiming, or repository URL validation fails.
 */
export async function runPreparedRepositoryAnalysis(analysisId: string): Promise<AnalysisRunResult> {
  const { orgId } = await auth();
  if (!orgId) throw new Error('Select an organization before running a repository analysis.');

  const supabase = await createClerkSupabaseClient();
  const { data: analysis, error: analysisError } = await supabase
    .from('analyses')
    .select('id, project_id, org_id')
    .eq('id', analysisId)
    .single();
  if (analysisError || !analysis || analysis.org_id !== orgId) {
    throw new Error('That analysis does not exist in the active organization.', { cause: analysisError });
  }

  const { data: project, error: projectError } = await supabase
    .from('projects')
    .select('repo_url')
    .eq('id', analysis.project_id)
    .single();
  if (projectError || !project) throw new Error('Could not load the repository for this analysis.', { cause: projectError });

  const { data: claimData, error: claimError } = await supabase.rpc('claim_repository_analysis', {
    p_analysis_id: analysisId,
    p_org_id: orgId,
  });
  if (claimError) throw new Error('Could not start the repository analysis.', { cause: claimError });
  if (claimData !== true) return { status: 'already-running', analysisId };

  const repository = parseGitHubRepositoryUrl(project.repo_url);

  let stage = 'fetching';
  /** Tracks the current failure stage and persists its progress message and timestamp. */
  const setStage = async (nextStage: string, message: string) => {
    stage = nextStage;
    const { error } = await supabase
      .from('analyses')
      .update({ stage, stage_message: message, updated_at: new Date().toISOString() })
      .eq('id', analysisId);
    if (error) throw new Error(`Could not update analysis stage: ${message}`, { cause: error });
  };

  let workspace: string | null = null;
  try {
    const repositoryInfo = await resolveGitHubRepository(repository);

    const { error: projectUpdateError } = await supabase
      .from('projects')
      .update({ name: `${repositoryInfo.owner}/${repositoryInfo.name}`, default_branch: repositoryInfo.defaultBranch })
    .eq('id', analysis.project_id);
    if (projectUpdateError) throw new Error('Could not save repository metadata.', { cause: projectUpdateError });

    await setStage('selecting', `Resolving the default branch “${repositoryInfo.defaultBranch}” to a commit.`);
    const { error: commitError } = await supabase
      .from('analyses')
      .update({ commit_sha: repositoryInfo.commitSha, updated_at: new Date().toISOString() })
      .eq('id', analysisId);
    if (commitError) throw new Error('Could not record the selected repository commit.', { cause: commitError });

    await setStage('fetching', `Downloading the archive for commit ${repositoryInfo.commitSha.slice(0, 12)}.`);
    workspace = await createRepositoryWorkspace();
    await downloadAndExtractRepository(repositoryInfo, workspace);

    await setStage('selecting', 'Selected the source tree from the repository archive.');
    await setStage('parsing', 'Parsing source files and resolving imports.');
    const parsed = await parseRepository(`${workspace}/repository`);

    await setStage('storing', `Storing ${parsed.files.length} parsed files and ${parsed.edges.length} dependency edges.`);
    const { error: storageError } = await supabase.rpc('store_analysis_result', {
      p_analysis_id: analysisId,
      p_org_id: orgId,
      p_commit_sha: repositoryInfo.commitSha,
      p_artifact: makeStorageArtifact(parsed),
    });
    if (storageError) throw new Error('Could not store the parsed repository graph.', { cause: storageError });

    return { status: 'completed', analysisId, commitSha: repositoryInfo.commitSha };
  } catch (error) {
    const message = errorMessage(error);
    const failureText = `Failed during ${stage}: ${message}`;
    const { error: failureWriteError } = await supabase
      .from('analyses')
      .update({
        status: 'failed',
        error_message: failureText,
        stage: 'failed',
        stage_message: failureText,
        updated_at: new Date().toISOString(),
      })
      .eq('id', analysisId);

    return {
      status: 'failed',
      analysisId,
      stage,
      error: failureWriteError ? `${failureText} (The failed state could not be saved.)` : failureText,
    };
  } finally {
    if (workspace) {
      try {
        await removeRepositoryWorkspace(workspace);
      } catch {
        console.error('Could not remove the temporary repository workspace.');
      }
    }
  }
}
