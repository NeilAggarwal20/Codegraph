import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readFile, readdir, realpath } from 'node:fs/promises';
import path from 'node:path';
import { Project, SyntaxKind, ts } from 'ts-morph';
import { fallbackAdapter } from './fallback-adapter.ts';
import type {
  DependencyEdge,
  FrameworkAdapter,
  ImportCoverageRecord,
  ImportKind,
  ParsedFile,
  ParserResult,
  SkippedFile,
} from './types.ts';

const sourceExtensions = new Set(['.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs', '.mts', '.cts']);
const ignoredDirectories = new Set([
  '.git', '.next', '.turbo', '.vercel', 'coverage', 'dist', 'build', 'node_modules',
]);

interface ImportOccurrence {
  specifier: string;
  kind: ImportKind;
  node: import('ts-morph').Node;
}

function isWithin(parent: string, child: string): boolean {
  const relative = path.relative(parent, child);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

function toPosix(value: string): string {
  return value.split(path.sep).join('/');
}

function isIgnoredPath(root: string, candidate: string): boolean {
  const segments = path.relative(root, candidate).split(path.sep);
  return segments.some((segment) => ignoredDirectories.has(segment));
}

async function discoverFiles(root: string): Promise<string[]> {
  const found: string[] = [];
  const visit = async (directory: string): Promise<void> => {
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        if (!ignoredDirectories.has(entry.name)) await visit(absolute);
      } else if (entry.isFile() && sourceExtensions.has(path.extname(entry.name).toLowerCase())) {
        found.push(absolute);
      }
    }
  };
  await visit(root);
  return found;
}

function getImports(sourceFile: import('ts-morph').SourceFile): ImportOccurrence[] {
  const occurrences: ImportOccurrence[] = [];
  for (const declaration of sourceFile.getImportDeclarations()) {
    const specifier = declaration.getModuleSpecifierValue();
    if (specifier !== undefined) occurrences.push({ specifier, kind: 'import', node: declaration });
  }
  for (const declaration of sourceFile.getExportDeclarations()) {
    const specifier = declaration.getModuleSpecifierValue();
    if (specifier !== undefined) occurrences.push({ specifier, kind: 're-export', node: declaration });
  }
  sourceFile.forEachDescendant((node) => {
    if (!node.isKind(SyntaxKind.CallExpression) || node.getExpression().getKind() !== SyntaxKind.ImportKeyword) return;
    const argument = node.getArguments()[0];
    if (!argument || (!argument.isKind(SyntaxKind.StringLiteral) && !argument.isKind(SyntaxKind.NoSubstitutionTemplateLiteral))) return;
    occurrences.push({ specifier: argument.getLiteralValue(), kind: 'dynamic-import', node });
  });
  return occurrences;
}

function classifyResolution(
  specifier: string,
  fromAbsolute: string,
  root: string,
  compilerOptions: ts.CompilerOptions,
  knownFiles: Set<string>,
): { status: ImportCoverageRecord['status']; resolvedAbsolute?: string; reason?: string } {
  if (specifier.startsWith('.') || path.isAbsolute(specifier)) {
    const targetPath = path.resolve(path.dirname(fromAbsolute), specifier);
    if (isIgnoredPath(root, targetPath)) {
      return { status: 'excluded', resolvedAbsolute: targetPath, reason: 'Import points into a deliberately excluded directory.' };
    }
  }
  const specifierExtension = path.extname(specifier).toLowerCase();
  if ((specifier.startsWith('.') || path.isAbsolute(specifier)) && specifierExtension && !sourceExtensions.has(specifierExtension)) {
    const localAsset = path.resolve(path.dirname(fromAbsolute), specifier);
    if (existsSync(localAsset) && isWithin(root, localAsset)) {
      return { status: 'excluded', resolvedAbsolute: localAsset, reason: 'Local import is not a supported source module.' };
    }
  }
  const resolution = ts.resolveModuleName(specifier, fromAbsolute, compilerOptions, ts.sys).resolvedModule;
  if (!resolution) {
    if (!specifier.startsWith('.') && !path.isAbsolute(specifier)) {
      return { status: 'external', reason: 'Bare module specifier is outside the repository.' };
    }
    return { status: 'unresolved', reason: 'No matching file was found by TypeScript module resolution.' };
  }

  const resolvedAbsolute = path.resolve(resolution.resolvedFileName);
  if (!isWithin(root, resolvedAbsolute)) {
    return { status: 'external', resolvedAbsolute, reason: 'Resolved outside the repository.' };
  }
  if (isIgnoredPath(root, resolvedAbsolute)) {
    return { status: 'excluded', resolvedAbsolute, reason: 'Resolved to a deliberately excluded directory.' };
  }
  if (!knownFiles.has(resolvedAbsolute)) {
    return { status: 'excluded', resolvedAbsolute, reason: 'Resolved file is not a supported repository source file.' };
  }
  return { status: 'resolved', resolvedAbsolute };
}

export async function parseRepository(
  directory: string,
  adapter: FrameworkAdapter = fallbackAdapter,
): Promise<ParserResult> {
  const root = await realpath(path.resolve(directory));
  const discovered = await discoverFiles(root);
  const knownFiles = new Set(discovered.map((file) => path.resolve(file)));

  let project: Project;
  const configPath = path.join(root, 'tsconfig.json');
  try {
    project = new Project({ tsConfigFilePath: configPath, skipAddingFilesFromTsConfig: true });
  } catch {
    project = new Project({ compilerOptions: { allowJs: true, checkJs: false, jsx: ts.JsxEmit.Preserve } });
  }
  for (const file of discovered) project.addSourceFileAtPath(file);

  const parsedFiles: ParsedFile[] = [];
  const skippedFiles: SkippedFile[] = [];
  const occurrences: Array<{ from: string; fromAbsolute: string; occurrence: ImportOccurrence }> = [];
  const relativeByAbsolute = new Map<string, string>();

  for (const absolute of discovered) {
    const relative = toPosix(path.relative(root, absolute));
    relativeByAbsolute.set(path.resolve(absolute), relative);
    try {
      const contents = await readFile(absolute, 'utf8');
      const sourceFile = project.getSourceFile(absolute);
      if (!sourceFile) throw new Error('ts-morph did not create a source file.');
      const folder = toPosix(path.dirname(path.relative(root, absolute))) || '.';
      const identity = adapter.identifyFile(relative);
      parsedFiles.push({
        path: relative,
        folder,
        module: identity.module,
        kind: identity.kind,
        lines: contents.length === 0 ? 0 : contents.split(/\r\n|\n|\r/).length,
        sha256: createHash('sha256').update(contents).digest('hex'),
        fanIn: 0,
        fanOut: 0,
      });
      for (const occurrence of getImports(sourceFile)) {
        occurrences.push({ from: relative, fromAbsolute: absolute, occurrence });
      }
    } catch (error) {
      skippedFiles.push({ path: relative, reason: error instanceof Error ? error.message : 'Unknown parser failure.' });
    }
  }

  const edgesByKey = new Map<string, DependencyEdge>();
  const records: ImportCoverageRecord[] = [];
  const parsedPaths = new Set(parsedFiles.map((file) => file.path));
  for (const { from, fromAbsolute, occurrence } of occurrences) {
    const resolution = classifyResolution(occurrence.specifier, fromAbsolute, root, project.getCompilerOptions(), knownFiles);
    const resolvedTo = resolution.resolvedAbsolute ? relativeByAbsolute.get(resolution.resolvedAbsolute) : undefined;
    const record: ImportCoverageRecord = {
      from,
      specifier: occurrence.specifier,
      kind: occurrence.kind,
      status: resolution.status,
      ...(resolution.reason ? { reason: resolution.reason } : {}),
      ...(resolvedTo ? { resolvedTo } : {}),
    };
    if (resolution.status === 'resolved' && resolvedTo && parsedPaths.has(resolvedTo)) {
      const edge: DependencyEdge = { from, to: resolvedTo, kind: occurrence.kind };
      edgesByKey.set(`${edge.from}\0${edge.to}\0${edge.kind}`, edge);
    } else if (resolution.status === 'resolved') {
      record.status = 'excluded';
      record.reason = 'Resolved file could not be parsed, so no edge was created.';
    }
    records.push(record);
  }

  const edges = [...edgesByKey.values()].sort((a, b) => a.from.localeCompare(b.from) || a.to.localeCompare(b.to) || a.kind.localeCompare(b.kind));
  const filesByPath = new Map(parsedFiles.map((file) => [file.path, file]));
  for (const edge of edges) {
    const from = filesByPath.get(edge.from);
    const to = filesByPath.get(edge.to);
    if (from) from.fanOut += 1;
    if (to) to.fanIn += 1;
  }

  const reExportsFound = records.filter((record) => record.kind === 're-export').length;
  const reExportsResolved = records.filter((record) => record.kind === 're-export' && record.status === 'resolved').length;
  return {
    schemaVersion: 1,
    root,
    stats: {
      filesFound: discovered.length,
      filesParsed: parsedFiles.length,
      filesSkipped: skippedFiles.length,
      reExportsFound,
      reExportsResolved,
      folders: new Set(parsedFiles.map((file) => file.folder)).size,
    },
    files: parsedFiles.sort((a, b) => a.path.localeCompare(b.path)),
    edges,
    coverage: {
      importsSeen: records.length,
      resolved: records.filter((record) => record.status === 'resolved').length,
      external: records.filter((record) => record.status === 'external').length,
      excluded: records.filter((record) => record.status === 'excluded').length,
      unresolved: records.filter((record) => record.status === 'unresolved').length,
      records,
    },
    skippedFiles,
  };
}

