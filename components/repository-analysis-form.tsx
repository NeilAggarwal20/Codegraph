'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition, type FormEvent } from 'react';
import { prepareRepositoryAnalysisAction } from '@/app/actions';

export function RepositoryAnalysisForm() {
  const router = useRouter();
  const [repoUrl, setRepoUrl] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    startTransition(async () => {
      const result = await prepareRepositoryAnalysisAction(repoUrl);
      if (result.status === 'error') {
        setError(result.error);
        return;
      }
      router.push(`/analysis/${result.analysisId}/progress`);
    });
  };

  return (
    <form onSubmit={submit} className="mb-6 rounded border border-line bg-surface p-4">
      <label htmlFor="repository-url" className="mb-2 block font-mono text-xs font-semibold text-fg">Analyze a public GitHub repository</label>
      <div className="flex flex-col gap-2 sm:flex-row">
        <input
          id="repository-url"
          name="repository-url"
          type="url"
          required
          autoComplete="url"
          placeholder="https://github.com/owner/repository"
          value={repoUrl}
          onChange={(event) => setRepoUrl(event.target.value)}
          disabled={isPending}
          className="min-w-0 flex-1 rounded border border-line bg-canvas px-3 py-2 font-mono text-xs text-fg placeholder:text-fg-muted disabled:opacity-60"
        />
        <button type="submit" disabled={isPending || !repoUrl.trim()} className="cursor-pointer rounded bg-accent px-4 py-2 font-mono text-xs font-semibold text-white disabled:cursor-wait disabled:opacity-50">
          {isPending ? 'Preparing…' : 'Analyze repository'}
        </button>
      </div>
      <p className="mt-2 font-mono text-[10px] text-fg-muted">Public GitHub repositories only. No repository access token is requested.</p>
      {error && <p role="alert" className="mt-2 break-words font-mono text-xs text-rose-700 dark:text-rose-400">{error}</p>}
    </form>
  );
}
