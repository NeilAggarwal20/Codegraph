import { auth } from '@clerk/nextjs/server';
import { notFound, redirect } from 'next/navigation';
import { AnalysisMapActions } from '@/components/analysis-map-actions';
import { CanvasShell } from '@/components/canvas-shell';
import { fetchStoredParserResult } from '@/lib/queries';
import { createClerkSupabaseClient } from '@/lib/supabase';
import { isLangSmithTracingConfigured } from '@/lib/ai/client';

export default async function AnalysisMapPage({
  params,
}: {
  params: Promise<{ analysisId: string }>;
}) {
  const { analysisId } = await params;
  const { orgId } = await auth();
  if (!orgId) notFound();

  const supabase = await createClerkSupabaseClient();
  const { data: analysis, error } = await supabase
    .from('analyses')
    .select('id, project_id, org_id, status, commit_sha')
    .eq('id', analysisId)
    .single();
  if (error || !analysis || analysis.org_id !== orgId) notFound();
  if (analysis.status !== 'completed') redirect(`/analysis/${analysisId}/progress`);

  const { data: project, error: projectError } = await supabase
    .from('projects')
    .select('name, repo_url')
    .eq('id', analysis.project_id)
    .single();
  if (projectError || !project) notFound();

  const result = await fetchStoredParserResult(analysisId);
  const graphImports = result.coverage.resolved + result.coverage.unresolved;
  const coveragePercent = graphImports === 0
    ? 100
    : Math.round((result.coverage.resolved / graphImports) * 100);
  const partial = result.coverage.unresolved > 0 || result.stats.filesSkipped > 0;

  return (
    <div className="flex h-[calc(100vh-4rem)] min-h-0 flex-col bg-canvas">
      <header className="flex min-h-10 shrink-0 items-center justify-between gap-3 border-b border-line px-3 font-mono text-[10px]">
        <div className="min-w-0 truncate text-fg">
          <span className="font-semibold">{project.name}</span>
          {analysis.commit_sha && <span className="ml-3 text-fg-muted">{analysis.commit_sha.slice(0, 12)}</span>}
          <span className={`ml-3 ${partial ? 'text-amber-700 dark:text-amber-400' : 'text-fg-muted'}`}>
            {partial ? 'Partial graph' : 'Full graph'} · {coveragePercent}% ({result.coverage.resolved}/{graphImports} local imports resolved)
          </span>
        </div>
        <AnalysisMapActions repositoryUrl={project.repo_url} />
      </header>
      <div className="min-h-0 flex-1">
        <CanvasShell
          analysis={result}
          analysisId={analysisId}
          repositoryUrl={project.repo_url}
          tracingConfigured={isLangSmithTracingConfigured()}
        />
      </div>
    </div>
  );
}
