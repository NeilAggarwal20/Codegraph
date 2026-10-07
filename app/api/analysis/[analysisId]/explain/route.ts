import { createHash } from 'node:crypto';
import { NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { createClerkSupabaseClient } from '@/lib/supabase';
import { explainFromRepositoryFacts, type ExplanationInput } from '@/lib/ai/explanations';
import { isLangSmithTracingConfigured } from '@/lib/ai/client';
import { parseGitHubRepositoryUrl, resolveGitHubRepository } from '@/lib/pipeline/github-archive';
import { foldRepository } from '@/lib/graph/folded-graph';

export const runtime = 'nodejs';

interface FileRow {
  id: string;
  path: string;
  folder: string;
  kind: string;
  lines: number;
  sha256: string | null;
  fan_in: number;
  fan_out: number;
  exports: string[];
}

interface EdgeRow {
  source_file_id: string;
  target_file_id: string;
  kind: string;
}

interface AnalysisRow {
  id: string;
  project_id: string;
  org_id: string;
  commit_sha: string | null;
  status: string;
}

interface ProjectRow {
  repo_url: string;
}

interface ExplainRequest {
  subjectType: 'file' | 'folder';
  subjectPath: string;
  filePaths?: string[];
}

const maxSourceCharacters = 100_000;

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

async function getRawFile(owner: string, repository: string, commitSha: string, filePath: string): Promise<string | null> {
  const encodedPath = filePath.split('/').map((segment) => encodeURIComponent(segment)).join('/');
  const response = await fetch(`https://raw.githubusercontent.com/${owner}/${repository}/${commitSha}/${encodedPath}`, {
    headers: { 'User-Agent': 'Codegraph repository mapper' },
    signal: AbortSignal.timeout(30_000),
    cache: 'no-store',
  });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`GitHub could not verify ${filePath} (HTTP ${response.status}).`);
  const source = await response.text();
  if (source.length > maxSourceCharacters) throw new Error(`${filePath} is too large to explain in one request.`);
  return source;
}

async function mapConcurrent<T, R>(items: readonly T[], concurrency: number, action: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let nextIndex = 0;
  const worker = async () => {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await action(items[index]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
  return results;
}

function normalizeRequest(value: unknown): ExplainRequest | null {
  if (typeof value !== 'object' || value === null) return null;
  const body = value as Record<string, unknown>;
  if ((body.subjectType !== 'file' && body.subjectType !== 'folder') || typeof body.subjectPath !== 'string' || !body.subjectPath || body.subjectPath.length > 1024 || body.subjectPath.startsWith('/') || body.subjectPath.split('/').includes('..')) return null;
  if (body.subjectType === 'file') return { subjectType: 'file', subjectPath: body.subjectPath };
  if (!Array.isArray(body.filePaths) || body.filePaths.length === 0 || body.filePaths.some((item) => typeof item !== 'string')) return null;
  return { subjectType: 'folder', subjectPath: body.subjectPath, filePaths: [...new Set(body.filePaths as string[])] };
}

function isFallbackKind(kind: string): boolean {
  return kind === 'Modules' || kind === 'module' || kind === 'Unclassified';
}

export async function POST(request: Request, { params }: { params: Promise<{ analysisId: string }> }) {
  const { orgId } = await auth();
  if (!orgId) return NextResponse.json({ error: 'Select an organization before requesting an explanation.' }, { status: 401 });

  let body: ExplainRequest | null;
  try {
    body = normalizeRequest(await request.json());
  } catch {
    body = null;
  }
  if (!body) return NextResponse.json({ error: 'Choose a file or folded folder to explain.' }, { status: 400 });

  const { analysisId } = await params;
  try {
    const supabase = await createClerkSupabaseClient();
    const analysisResult = await supabase
      .from('analyses')
      .select('id, project_id, org_id, commit_sha, status')
      .eq('id', analysisId)
      .single();
    const analysis = analysisResult.data as unknown as AnalysisRow | null;
    if (analysisResult.error || !analysis || analysis.org_id !== orgId) {
      return NextResponse.json({ error: 'That analysis is not available in the active organization.' }, { status: 404 });
    }
    if (analysis.status !== 'completed' || !analysis.commit_sha) {
      return NextResponse.json({ error: 'This analysis has no completed repository snapshot to explain.' }, { status: 409 });
    }
    const analysisCommitSha = analysis.commit_sha;

    const [projectResult, filesResult, edgesResult] = await Promise.all([
      supabase.from('projects').select('repo_url').eq('id', analysis.project_id).single(),
      supabase.from('files').select('id, path, folder, kind, lines, sha256, fan_in, fan_out, exports').eq('analysis_id', analysisId),
      supabase.from('edges').select('source_file_id, target_file_id, kind').eq('analysis_id', analysisId),
    ]);
    if (projectResult.error || !projectResult.data) throw new Error('Could not load the repository details.');
    if (filesResult.error) throw new Error('Could not load the files in this analysis.');
    if (edgesResult.error) throw new Error('Could not load the dependency edges in this analysis.');

    const project = projectResult.data as unknown as ProjectRow;
    const files = (filesResult.data ?? []) as unknown as FileRow[];
    const edges = (edgesResult.data ?? []) as unknown as EdgeRow[];
    const fileById = new Map(files.map((file) => [file.id, file]));
    const fileByPath = new Map(files.map((file) => [file.path, file]));
    const edgePaths = edges.flatMap((edge) => {
      const source = fileById.get(edge.source_file_id);
      const target = fileById.get(edge.target_file_id);
      return source && target ? [{ from: source.path, to: target.path, kind: edge.kind }] : [];
    });

    let subjectFiles: FileRow[];
    if (body.subjectType === 'file') {
      const file = fileByPath.get(body.subjectPath);
      if (!file) return NextResponse.json({ error: 'That file is not part of this analysis.' }, { status: 404 });
      subjectFiles = [file];
    } else {
      const folded = foldRepository({
        files: files.map((file) => ({
          path: file.path,
          folder: file.folder,
          module: '',
          kind: file.kind,
          lines: file.lines,
          sha256: file.sha256,
          exports: file.exports,
          fanIn: file.fan_in,
          fanOut: file.fan_out,
        })),
        edges: edgePaths.map((edge) => ({ ...edge, kind: 'import' as const })),
      });
      const folder = folded.nodes.find((node) => node.id === body.subjectPath);
      const canonicalPaths = folder?.files.map((file) => file.path).sort() ?? [];
      const requestedPaths = [...(body.filePaths ?? [])].sort();
      if (!folder || canonicalPaths.length !== requestedPaths.length || canonicalPaths.some((path, index) => path !== requestedPaths[index])) {
        return NextResponse.json({ error: 'The selected folder does not match this analysis.' }, { status: 400 });
      }
      subjectFiles = canonicalPaths.map((path) => fileByPath.get(path)).filter((file): file is FileRow => Boolean(file));
    }

    const selectedFileIds = new Set(subjectFiles.map((file) => file.id));
    const oneHopIds = new Set<string>(selectedFileIds);
    if (body.subjectType === 'file') {
      for (const edge of edgePaths) {
        if (edge.from === body.subjectPath) oneHopIds.add(fileByPath.get(edge.to)?.id ?? '');
        if (edge.to === body.subjectPath) oneHopIds.add(fileByPath.get(edge.from)?.id ?? '');
      }
      oneHopIds.delete('');
    }
    const evidenceFiles = files.filter((file) => oneHopIds.has(file.id));
    const repository = await resolveGitHubRepository(parseGitHubRepositoryUrl(project.repo_url));
    if (evidenceFiles.some((file) => !file.sha256)) {
      return NextResponse.json({ status: 'stale', message: 'At least one selected file has no stored content hash. Re-analyse the repository to verify it.' });
    }
    const verifiedSources = await mapConcurrent(evidenceFiles, 6, async (file) => ({
      file,
      source: await getRawFile(repository.owner, repository.name, analysisCommitSha, file.path),
    }));
    const changedFile = verifiedSources.find(({ file, source }) => source === null || sha256(source) !== file.sha256);
    if (changedFile) {
      return NextResponse.json({ status: 'stale', message: `The saved content hash for ${changedFile.file.path} no longer matches its analysed commit. Re-analyse the repository before requesting a fresh explanation.` });
    }
    const sourceByPath = new Map(verifiedSources.flatMap(({ file, source }) => source === null ? [] : [[file.path, source] as const]));
    if (repository.commitSha !== analysisCommitSha) {
      return NextResponse.json({
        status: 'stale',
        message: 'The repository has moved past the analysed commit. Re-analyse it before requesting a fresh explanation.',
      });
    }

    const subjectIds = new Set(subjectFiles.map((file) => file.id));
    const incoming = edgePaths.filter((edge) => subjectIds.has(fileByPath.get(edge.to)?.id ?? '') && !subjectIds.has(fileByPath.get(edge.from)?.id ?? ''));
    const outgoing = edgePaths.filter((edge) => subjectIds.has(fileByPath.get(edge.from)?.id ?? '') && !subjectIds.has(fileByPath.get(edge.to)?.id ?? ''));
    const internal = edgePaths.filter((edge) => subjectIds.has(fileByPath.get(edge.from)?.id ?? '') && subjectIds.has(fileByPath.get(edge.to)?.id ?? ''));
    const file = body.subjectType === 'file' ? subjectFiles[0] : null;
    const imports = body.subjectType === 'file' ? edgePaths.filter((edge) => edge.from === subjectFiles[0].path) : [];
    const importedBy = body.subjectType === 'file' ? edgePaths.filter((edge) => edge.to === subjectFiles[0].path) : [];
    const contextPaths = new Set<string>([
      ...(body.subjectType === 'folder' ? [body.subjectPath] : []),
      ...subjectFiles.map((item) => item.path),
      ...incoming.flatMap((edge) => [edge.from, edge.to]),
      ...outgoing.flatMap((edge) => [edge.from, edge.to]),
      ...internal.flatMap((edge) => [edge.from, edge.to]),
      ...imports.flatMap((edge) => [edge.from, edge.to]),
      ...importedBy.flatMap((edge) => [edge.from, edge.to]),
    ]);
    const facts = body.subjectType === 'file'
      ? JSON.stringify({
        file: { ...subjectFiles[0], source: sourceByPath.get(subjectFiles[0].path) },
        imports: imports.map((edge) => ({ ...edge, source: sourceByPath.get(edge.to) })),
        importedBy: importedBy.map((edge) => ({ ...edge, source: sourceByPath.get(edge.from) })),
      })
      : JSON.stringify({
        folder: body.subjectPath,
        files: subjectFiles.map((item) => ({ path: item.path, role: item.kind, lines: item.lines, fanIn: item.fan_in, fanOut: item.fan_out, exports: item.exports })),
        directIncomingEdges: incoming,
        directOutgoingEdges: outgoing,
        internalEdges: internal,
      });
    const factsHash = sha256(JSON.stringify({ model: 'gpt-4.1-2025-04-14', subjectType: body.subjectType, subjectPath: body.subjectPath, facts }));
    const shouldClassify = Boolean(file && isFallbackKind(file.kind));
    const input: ExplanationInput = {
      analysisId,
      orgId,
      subjectType: body.subjectType,
      subjectKey: body.subjectPath,
      factsHash,
      fileId: file?.id ?? null,
      roleHash: shouldClassify ? factsHash : null,
      shouldClassify,
      facts,
      allowedPaths: [...contextPaths],
    };

    const result = await explainFromRepositoryFacts(input);
    return NextResponse.json({ status: 'ready', ...result, tracingConfigured: isLangSmithTracingConfigured() });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Could not explain this repository item.';
    console.error('Repository explanation failed:', error);
    const status = message.includes('not configured') ? 503 : 500;
    return NextResponse.json({ error: message, tracingConfigured: isLangSmithTracingConfigured() }, { status });
  }
}
