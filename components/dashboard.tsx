'use client';

import { useTransition } from 'react';
import { AnalysisRow } from '@/lib/types';
import { handleSeedAnalyses } from '@/app/actions';

interface DashboardProps {
  analyses: AnalysisRow[];
  orgId: string;
  orgName: string;
}

export function Dashboard({ analyses, orgId, orgName }: DashboardProps) {
  const [isPending, startTransition] = useTransition();

  const onSeedClick = () => {
    startTransition(async () => {
      await handleSeedAnalyses(orgId);
    });
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'completed':
        return (
          <span className="inline-flex items-center gap-1 rounded border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 font-mono text-[10px] font-medium text-emerald-600 dark:text-emerald-400">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
            Completed
          </span>
        );
      case 'parsing':
        return (
          <span className="inline-flex items-center gap-1 rounded border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 font-mono text-[10px] font-medium text-amber-600 dark:text-amber-400">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-amber-500" />
            Parsing
          </span>
        );
      case 'failed':
        return (
          <span className="inline-flex items-center gap-1 rounded border border-rose-500/30 bg-rose-500/10 px-2 py-0.5 font-mono text-[10px] font-medium text-rose-600 dark:text-rose-400">
            <span className="h-1.5 w-1.5 rounded-full bg-rose-500" />
            Failed
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center gap-1 rounded border border-zinc-500/30 bg-zinc-500/10 px-2 py-0.5 font-mono text-[10px] font-medium text-zinc-600 dark:text-zinc-400">
            <span className="h-1.5 w-1.5 rounded-full bg-zinc-400" />
            {status}
          </span>
        );
    }
  };

  const formatDate = (iso: string | null) => {
    if (!iso) return '—';
    const date = new Date(iso);
    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  return (
    <div className="flex flex-1 flex-col p-6 overflow-y-auto font-sans">
      <div className="max-w-4xl space-y-6">
        {/* Header section */}
        <div className="flex items-center justify-between border-b border-border pb-4">
          <div>
            <h1 className="text-base font-semibold tracking-tight text-foreground font-mono">
              Repository Analyses
            </h1>
            <p className="mt-0.5 font-mono text-xs text-zinc-500">
              Workspace:{' '}
              <span className="font-semibold text-foreground">{orgName}</span>{' '}
              <span className="text-zinc-400">({orgId})</span>
            </p>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onSeedClick}
              disabled={isPending}
              className="rounded border border-border bg-surface px-2.5 py-1 font-mono text-xs font-medium text-foreground hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors disabled:opacity-50 cursor-pointer"
            >
              {isPending ? 'Seeding...' : 'Seed Sample Data'}
            </button>
          </div>
        </div>

        {/* Analyses List or Empty State */}
        {analyses.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-border bg-surface p-12 text-center">
            <div className="rounded-full bg-zinc-100 p-3 dark:bg-zinc-800 text-zinc-400 mb-3 font-mono text-lg">
              [ ∅ ]
            </div>
            <h3 className="font-mono text-sm font-semibold text-foreground">
              No analyses for this team
            </h3>
            <p className="mt-1 font-mono text-xs text-zinc-500 max-w-sm">
              This organization has never run an analysis. Click seed data or switch teams to inspect analysis records.
            </p>
            <button
              type="button"
              onClick={onSeedClick}
              disabled={isPending}
              className="mt-4 rounded bg-accent px-3 py-1.5 font-mono text-xs font-medium text-white hover:opacity-90 transition-opacity cursor-pointer"
            >
              {isPending ? 'Seeding analyses...' : 'Seed Sample Analyses'}
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="flex items-center justify-between font-mono text-[11px] text-zinc-400 px-1">
              <span>{analyses.length} total analyses</span>
              <span>Protected by Database Row Level Security</span>
            </div>

            <div className="divide-y divide-border rounded-md border border-border bg-surface overflow-hidden">
              {analyses.map((item) => (
                <div
                  key={item.id}
                  className="flex flex-col gap-2 p-4 transition-colors hover:bg-zinc-50/50 dark:hover:bg-zinc-900/50"
                >
                  <div className="flex items-center justify-between gap-4">
                    <div className="flex items-center gap-3 min-w-0">
                      <span className="font-mono text-xs font-semibold text-foreground truncate">
                        {item.projects?.name || 'Repository'}
                      </span>
                      <span className="font-mono text-[11px] text-zinc-400 truncate">
                        {item.projects?.repo_url}
                      </span>
                    </div>

                    <div className="flex items-center gap-3 shrink-0">
                      {getStatusBadge(item.status)}
                    </div>
                  </div>

                  <div className="flex items-center justify-between font-mono text-xs text-zinc-500 pt-1 border-t border-border/50">
                    <div className="flex items-center gap-4">
                      {item.commit_sha && (
                        <span>
                          commit:{' '}
                          <span className="text-foreground">{item.commit_sha}</span>
                        </span>
                      )}
                      <span>
                        files:{' '}
                        <span className="text-foreground">
                          {item.parsed_files_count}
                        </span>
                      </span>
                    </div>

                    <div className="flex items-center gap-3 text-[11px] text-zinc-400">
                      <span>Created {formatDate(item.created_at)}</span>
                      {item.completed_at && (
                        <span>• Completed {formatDate(item.completed_at)}</span>
                      )}
                    </div>
                  </div>

                  {item.error_message && (
                    <div className="mt-1 rounded bg-rose-500/10 p-2 font-mono text-[11px] text-rose-600 dark:text-rose-400 border border-rose-500/20">
                      Error: {item.error_message}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
