import { createClerkSupabaseClient } from './supabase';
import { readParserResult } from './parser/read-result';
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
      'id, project_id, org_id, commit_sha, status, stage, stage_message, updated_at, error_message, parsed_files_count, created_at, completed_at, projects(id, name, repo_url)'
    )
    .order('created_at', { ascending: false });

  if (error) {
    if (
      (error.code === '42703' || error.code === 'PGRST204') &&
      /analyses\.stage/.test(error.message)
    ) {
      throw new Error(
        'The Supabase project is missing Phase 7 analysis columns. Apply supabase/migrations/20261005000000_phase_07_pipeline.sql in the Supabase SQL Editor, then refresh.',
        { cause: error }
      );
    }

    throw new Error('Failed to fetch organization analyses.', { cause: error });
  }

  return (data ?? []) as unknown as AnalysisRow[];
}

interface StoredFileRow {
  id: string;
  path: string;
  lines: number;
  folder: string;
  module_name: string;
  kind: string;
  sha256: string | null;
  fan_in: number;
  fan_out: number;
}

interface StoredEdgeRow {
  source_file_id: string;
  target_file_id: string;
  kind: string;
}

/**
 * Reconstructs and validates parser output from stored metadata, files, and dependency edges.
 * Access is scoped by Supabase RLS; missing data, invalid output, or dangling edges cause errors.
 */
export async function fetchStoredParserResult(analysisId: string) {
  const supabase = await createClerkSupabaseClient();
  const [artifactResult, filesResult, edgesResult] = await Promise.all([
    supabase
      .from('analysis_artifacts')
      .select('schema_version, root, stats, coverage, skipped_files')
      .eq('analysis_id', analysisId)
      .single(),
    supabase
      .from('files')
      .select('id, path, lines, folder, module_name, kind, sha256, fan_in, fan_out')
      .eq('analysis_id', analysisId),
    supabase
      .from('edges')
      .select('source_file_id, target_file_id, kind')
      .eq('analysis_id', analysisId),
  ]);

  if (artifactResult.error || !artifactResult.data) {
    throw new Error('Could not load the stored analysis metadata.', { cause: artifactResult.error });
  }
  if (filesResult.error) throw new Error('Could not load the stored repository files.', { cause: filesResult.error });
  if (edgesResult.error) throw new Error('Could not load the stored dependency edges.', { cause: edgesResult.error });

  const files = (filesResult.data ?? []) as unknown as StoredFileRow[];
  const pathById = new Map(files.map((file) => [file.id, file.path]));
  const edges = ((edgesResult.data ?? []) as unknown as StoredEdgeRow[]).map((edge) => {
    const from = pathById.get(edge.source_file_id);
    const to = pathById.get(edge.target_file_id);
    if (!from || !to) throw new Error('The stored analysis contains an edge with a missing file.');
    return { from, to, kind: edge.kind };
  });

  return readParserResult({
    schemaVersion: artifactResult.data.schema_version,
    root: artifactResult.data.root,
    stats: artifactResult.data.stats,
    coverage: artifactResult.data.coverage,
    skippedFiles: artifactResult.data.skipped_files,
    files: files.map((file) => ({
      path: file.path,
      lines: file.lines,
      folder: file.folder,
      module: file.module_name,
      kind: file.kind,
      sha256: file.sha256,
      fanIn: file.fan_in,
      fanOut: file.fan_out,
    })),
    edges,
  });
}
