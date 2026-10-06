import { auth, clerkClient } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { fetchAnalyses } from "@/lib/queries";
import type { AnalysisRow } from "@/lib/types";
import Link from "next/link";
import { Fragment } from "react";
import { AnalysisStageIndicator } from "@/components/analysis-stage-indicator";
import { RepositoryAnalysisForm } from "@/components/repository-analysis-form";

function formatTimestamp(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default async function WorkspacePage() {
  const { orgId } = await auth();

  if (!orgId) {
    redirect("/start");
  }

  // Determine current organization name dynamically from Clerk
  const clerk = await clerkClient();
  const org = await clerk.organizations.getOrganization({
    organizationId: orgId,
  });
  const orgName = org.name;

  // Real data fetched from Supabase via RLS using Clerk JWT token (no application-level org filter)
  let analyses: AnalysisRow[] = [];
  let analysesFailed = false;
  let analysesErrorMessage = 'Could not load analyses for this organization. Try refreshing the page.';
  try {
    analyses = await fetchAnalyses();
  } catch (error) {
    console.error("Failed to load organization analyses:", error);
    analysesFailed = true;
    if (error instanceof Error) analysesErrorMessage = error.message;
  }
  const totalCount = analyses.length;

  return (
    <div className="mx-auto w-full max-w-5xl px-6 py-8">
      {/* Organization Header & Total Count */}
      <div className="mb-6 flex items-baseline justify-between border-b border-line pb-4">
        <div>
          <h1 className="font-mono text-xl font-semibold text-fg">
            {orgName}
          </h1>
          <p className="mt-1 font-mono text-sm text-fg-muted">
            {analysesFailed ? "Analyses unavailable" : `${totalCount} ${totalCount === 1 ? "analysis" : "analyses"}`}
          </p>
        </div>
        <Link
          href="/preview"
          className="rounded border border-line px-2.5 py-1.5 font-mono text-xs text-fg hover:border-accent hover:text-accent"
        >
          Canvas preview
        </Link>
      </div>

      <RepositoryAnalysisForm />

      {/* Real Analyses Table or Empty State */}
      {analysesFailed ? (
        <div role="alert" className="rounded-lg border border-rose-600/20 bg-rose-600/5 px-6 py-8 text-center font-mono text-sm text-rose-700 dark:text-rose-400">
          {analysesErrorMessage}
        </div>
      ) : totalCount === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-line bg-surface px-6 py-16 text-center">
          <p className="font-mono text-base text-fg-muted">
            No analyses yet for this organization.
          </p>
          <p className="mt-2 font-mono text-sm text-fg-muted">
            Analyses will appear here once a repository is parsed.
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-line bg-surface">
          <table className="w-full border-collapse font-mono text-sm">
            <thead>
              <tr className="border-b border-line text-left text-xs uppercase tracking-wider text-fg-muted">
                <th className="px-4 py-3 font-medium">Repository</th>
                <th className="px-4 py-3 font-medium">State</th>
                <th className="px-4 py-3 font-medium">Commit</th>
                <th className="px-4 py-3 font-medium">Started</th>
                <th className="px-4 py-3 font-medium">Finished</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {analyses.map((a) => (
                <Fragment key={a.id}>
                  <tr className="hover:bg-raised/50">
                    <td className="px-4 py-3 text-fg">
                      <Link href={`/analysis/${a.id}/progress`} className="cursor-pointer hover:text-accent">
                        {a.projects?.name ?? a.project_id}
                      </Link>
                    </td>
                    <td className="px-4 py-3"><AnalysisStageIndicator analysis={a} /></td>
                    <td className="px-4 py-3 text-fg-muted">
                      {a.commit_sha ? (
                        <code className="rounded bg-raised px-1.5 py-0.5 text-xs">
                          {a.commit_sha}
                        </code>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="px-4 py-3 text-fg-muted">
                      {formatTimestamp(a.created_at)}
                    </td>
                    <td className="px-4 py-3 text-fg-muted">
                      {formatTimestamp(a.completed_at)}
                    </td>
                  </tr>
                  {a.error_message && (
                    <tr>
                      <td
                        colSpan={5}
                        className="border-t border-rose-600/20 bg-rose-600/5 px-4 py-2 text-xs text-rose-700 dark:text-rose-400"
                      >
                        {a.error_message}
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
