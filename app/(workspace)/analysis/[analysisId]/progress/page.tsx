import { auth } from '@clerk/nextjs/server';
import { notFound } from 'next/navigation';
import { AnalysisProgress } from '@/components/analysis-progress';
import { createClerkSupabaseClient } from '@/lib/supabase';
import type { AnalysisStatus } from '@/lib/types';

export default async function AnalysisProgressPage({
  params,
}: {
  params: Promise<{ analysisId: string }>;
}) {
  const { analysisId } = await params;
  const { orgId } = await auth();
  if (!orgId) notFound();

  const supabase = await createClerkSupabaseClient();
  const { data: row, error } = await supabase
    .from('analyses')
    .select('id, project_id, org_id, status, stage, stage_message, updated_at, error_message')
    .eq('id', analysisId)
    .single();
  if (error || !row || row.org_id !== orgId) notFound();

  const { data: project, error: projectError } = await supabase
    .from('projects')
    .select('name, repo_url')
    .eq('id', row.project_id)
    .single();
  if (projectError || !project) notFound();

  return (
    <AnalysisProgress
      analysisId={row.id}
      repositoryName={project.name}
      repositoryUrl={project.repo_url}
      initialStatus={row.status as AnalysisStatus}
      initialStage={row.stage}
      initialMessage={row.stage_message}
      initialUpdatedAt={row.updated_at}
      initialError={row.error_message}
    />
  );
}
