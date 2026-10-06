'use client';

import { useEffect, useState } from 'react';
import { useAnalysisStageChannel } from '@/components/analysis-stage-channel';
import type { AnalysisRow } from '@/lib/types';

const staleAfterMilliseconds = 5 * 60 * 1000;

export function AnalysisStageIndicator({ analysis }: { analysis: AnalysisRow }) {
  const [clock, setClock] = useState(0);
  const active = analysis.status === 'pending' || analysis.status === 'parsing';
  const view = useAnalysisStageChannel(analysis.id, {
    status: analysis.status,
    stage: analysis.stage,
    message: analysis.stage_message,
    updatedAt: new Date(analysis.updated_at).getTime(),
  }, active);

  useEffect(() => {
    if (view.status !== 'pending' && view.status !== 'parsing') return;
    const remaining = Math.max(0, staleAfterMilliseconds - (Date.now() - view.updatedAt));
    const timer = window.setTimeout(() => setClock(Date.now()), remaining + 10);
    return () => window.clearTimeout(timer);
  }, [view.status, view.updatedAt]);

  const stale = (view.status === 'pending' || view.status === 'parsing') && clock - view.updatedAt >= staleAfterMilliseconds;
  const statusClass = view.status === 'completed'
    ? 'border-emerald-600/30 bg-emerald-600/10 text-emerald-700 dark:text-emerald-400'
    : view.status === 'failed'
      ? 'border-rose-600/30 bg-rose-600/10 text-rose-700 dark:text-rose-400'
      : stale
        ? 'border-amber-600/30 bg-amber-600/10 text-amber-700 dark:text-amber-400'
        : 'border-amber-600/30 bg-amber-600/10 text-amber-700 dark:text-amber-400';

  return (
    <div className="min-w-40 space-y-1">
      <span className={`inline-flex rounded border px-2 py-0.5 font-mono text-[10px] ${statusClass}`}>
        {stale ? 'stale' : view.status}
      </span>
      <p className="font-mono text-[10px] text-fg-muted">{view.stage}: {view.message}</p>
      {stale && <p className="font-mono text-[10px] text-amber-700 dark:text-amber-400">No update in five minutes.</p>}
      {view.connectionError && active && <p className="font-mono text-[10px] text-amber-700 dark:text-amber-400">Live updates unavailable.</p>}
    </div>
  );
}
