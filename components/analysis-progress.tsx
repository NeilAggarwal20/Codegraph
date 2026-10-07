'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { prepareRepositoryAnalysisAction, runPreparedRepositoryAnalysisAction } from '@/app/actions';
import { useAnalysisStageChannel } from '@/components/analysis-stage-channel';
import type { AnalysisStatus } from '@/lib/types';

const staleAfterMilliseconds = 5 * 60 * 1000;

/**
 * Shows live analysis stages, connection errors, and runs stale for five minutes.
 * Starts pending work after subscribing and opens the map when the run completes.
 */
export function AnalysisProgress({
  analysisId,
  repositoryName,
  repositoryUrl,
  initialStatus,
  initialStage,
  initialMessage,
  initialUpdatedAt,
  initialError,
}: {
  analysisId: string;
  repositoryName: string;
  repositoryUrl: string;
  initialStatus: AnalysisStatus;
  initialStage: string;
  initialMessage: string;
  initialUpdatedAt: string;
  initialError: string | null;
}) {
  const router = useRouter();
  const started = useRef(false);
  const [runError, setRunError] = useState<string | null>(null);
  const [rerunning, setRerunning] = useState(false);
  const [clock, setClock] = useState(0);
  const view = useAnalysisStageChannel(analysisId, {
    status: initialStatus,
    stage: initialStage,
    message: initialMessage,
    updatedAt: new Date(initialUpdatedAt).getTime(),
  }, initialStatus === 'pending' || initialStatus === 'parsing');

  useEffect(() => {
    if (view.status === 'completed') router.replace(`/analysis/${analysisId}`);
  }, [analysisId, router, view.status]);

  useEffect(() => {
    if (initialStatus !== 'pending' || !view.connected || started.current) return;
    started.current = true;
    void runPreparedRepositoryAnalysisAction(analysisId)
      .then((result) => {
        if (result.status === 'completed') router.replace(`/analysis/${analysisId}`);
        else if (result.status === 'failed') router.refresh();
      })
      .catch((error: unknown) => {
        setRunError(error instanceof Error ? error.message : 'Could not start this analysis.');
      });
  }, [analysisId, initialStatus, router, view.connected]);

  useEffect(() => {
    if (view.status !== 'pending' && view.status !== 'parsing') return;
    const remaining = Math.max(0, staleAfterMilliseconds - (Date.now() - view.updatedAt));
    const timer = window.setTimeout(() => setClock(Date.now()), remaining + 10);
    return () => window.clearTimeout(timer);
  }, [view.status, view.updatedAt]);

  const isStale = (view.status === 'pending' || view.status === 'parsing') &&
    clock - view.updatedAt >= staleAfterMilliseconds;

  /** Resets the repository analysis for a rerun and refreshes the server-provided state. */
  const handleRerun = async () => {
    setRerunning(true);
    setRunError(null);
    try {
      const result = await prepareRepositoryAnalysisAction(repositoryUrl, true);
      if (result.status === 'error') {
        setRunError(result.error);
        setRerunning(false);
        return;
      }
      started.current = false;
      router.refresh();
    } catch (error) {
      setRunError(error instanceof Error ? error.message : 'Could not prepare a new run.');
      setRerunning(false);
    }
  };

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-6 py-10">
      <header className="border-b border-line pb-4">
        <p className="font-mono text-[10px] uppercase tracking-wider text-fg-muted">Repository analysis</p>
        <h1 className="mt-2 break-all font-mono text-lg font-semibold text-fg">{repositoryName}</h1>
        <p className="mt-1 break-all font-mono text-xs text-fg-muted">{repositoryUrl}</p>
      </header>

      <section aria-live="polite" aria-atomic="true" className="rounded border border-line bg-surface p-5">
        <div className="flex items-center justify-between gap-4">
          <h2 className="font-mono text-xs font-semibold uppercase tracking-wider text-fg">Progress</h2>
          <span className={`font-mono text-[10px] uppercase ${view.status === 'failed' ? 'text-rose-600 dark:text-rose-400' : view.status === 'completed' ? 'text-emerald-700 dark:text-emerald-400' : isStale ? 'text-amber-700 dark:text-amber-400' : 'text-fg-muted'}`}>
            {isStale ? 'stale' : view.status}
          </span>
        </div>
        <p className="mt-4 font-mono text-sm font-semibold text-fg">{view.stage}</p>
        <p className="mt-1 font-mono text-xs leading-5 text-fg-muted">{view.message}</p>
        {view.connectionError && <p role="status" className="mt-3 font-mono text-[10px] text-amber-700 dark:text-amber-400">Live updates unavailable: {view.connectionError}</p>}
        {isStale && <p className="mt-3 font-mono text-[10px] text-amber-700 dark:text-amber-400">No stage update has arrived for five minutes. This run may have stopped.</p>}
        {(initialError || view.status === 'failed') && <p role="alert" className="mt-3 break-words font-mono text-xs leading-5 text-rose-700 dark:text-rose-400">{initialError ?? view.message}</p>}
        {runError && <p role="alert" className="mt-3 break-words font-mono text-xs text-rose-700 dark:text-rose-400">{runError}</p>}
      </section>

      <div className="flex flex-wrap items-center gap-3 font-mono text-xs">
        {(view.status === 'completed' || view.status === 'failed' || isStale) && (
          <button type="button" onClick={handleRerun} disabled={rerunning} className="cursor-pointer rounded border border-line px-3 py-2 text-fg disabled:cursor-wait disabled:opacity-50">
            {rerunning ? 'Preparing…' : 'Run again'}
          </button>
        )}
        <Link href="/" className="text-fg-muted underline underline-offset-4">Back to dashboard</Link>
      </div>
    </main>
  );
}
