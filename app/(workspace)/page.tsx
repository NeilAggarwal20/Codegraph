import { auth, clerkClient } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { fetchAnalyses } from "@/lib/queries";
import type { AnalysisRow } from "@/lib/types";
import Link from "next/link";

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

function statusBadge(status: string) {
  switch (status) {
    case "completed":
      return (
        <span className="inline-flex items-center gap-1.5 rounded border border-emerald-600/30 bg-emerald-600/10 px-2 py-0.5 font-mono text-xs text-emerald-700 dark:text-emerald-400">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
          completed
        </span>
      );
    case "parsing":
      return (
        <span className="inline-flex items-center gap-1.5 rounded border border-amber-600/30 bg-amber-600/10 px-2 py-0.5 font-mono text-xs text-amber-700 dark:text-amber-400">
          <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
          parsing
        </span>
      );
    case "failed":
      return (
        <span className="inline-flex items-center gap-1.5 rounded border border-rose-600/30 bg-rose-600/10 px-2 py-0.5 font-mono text-xs text-rose-700 dark:text-rose-400">
          <span className="h-1.5 w-1.5 rounded-full bg-rose-500" />
          failed
        </span>
      );
    default:
      return (
        <span className="inline-flex items-center gap-1.5 rounded border border-line bg-raised px-2 py-0.5 font-mono text-xs text-fg-muted">
          <span className="h-1.5 w-1.5 rounded-full bg-fg-muted" />
          {status}
        </span>
      );
  }
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
  const analyses: AnalysisRow[] = await fetchAnalyses();
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
            {totalCount} {totalCount === 1 ? "analysis" : "analyses"}
          </p>
        </div>
        <Link
          href="/preview"
          className="rounded border border-line px-2.5 py-1.5 font-mono text-xs text-fg hover:border-accent hover:text-accent"
        >
          Canvas preview
        </Link>
      </div>

      {/* Real Analyses Table or Empty State */}
      {totalCount === 0 ? (
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
                <tr key={a.id} className="hover:bg-raised/50">
                  <td className="px-4 py-3 text-fg">
                    {a.projects?.name ?? a.project_id}
                  </td>
                  <td className="px-4 py-3">{statusBadge(a.status)}</td>
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
                  {a.error_message && (
                    <td
                      colSpan={5}
                      className="border-t border-rose-600/20 bg-rose-600/5 px-4 py-2 text-xs text-rose-700 dark:text-rose-400"
                    >
                      {a.error_message}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
