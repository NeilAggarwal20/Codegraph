'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { prepareRepositoryAnalysisAction } from '@/app/actions';

/** Renders dashboard navigation and a repository rerun action with pending and error feedback. */
export function AnalysisMapActions({ repositoryUrl }: { repositoryUrl: string }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  /** Prepares an explicit rerun and opens its progress page, displaying preparation errors. */
  const rerun = () => {
    setError(null);
    startTransition(async () => {
      try {
        const result = await prepareRepositoryAnalysisAction(repositoryUrl, true);
        if (result.status === 'error') {
          setError(result.error);
          return;
        }
        router.push(`/analysis/${result.analysisId}/progress`);
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : 'Could not prepare a new run.');
      }
    });
  };

  return (
    <div className="flex items-center gap-3">
      <Link href="/" className="text-fg-muted underline underline-offset-4">Dashboard</Link>
      <button type="button" onClick={rerun} disabled={isPending} className="cursor-pointer rounded border border-line px-2 py-1 text-fg disabled:cursor-wait disabled:opacity-50">
        {isPending ? 'Preparing…' : 'Run again'}
      </button>
      {error && <span role="alert" className="max-w-sm truncate text-rose-700 dark:text-rose-400">{error}</span>}
    </div>
  );
}
