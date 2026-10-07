import type { ParserResult } from './types.ts';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Parse and validate a parser artifact before downstream code trusts its shape. */
export function readParserResult(value: unknown): ParserResult {
  if (!isRecord(value) || value.schemaVersion !== 1 || typeof value.root !== 'string') {
    throw new Error('Invalid parser artifact header.');
  }
  if (!isRecord(value.stats) || !Array.isArray(value.files) || !Array.isArray(value.edges) ||
      !isRecord(value.coverage) || !Array.isArray(value.coverage.records) || !Array.isArray(value.skippedFiles)) {
    throw new Error('Invalid parser artifact structure.');
  }
  const stats = value.stats;
  const coverage = value.coverage;
  const counts = ['filesFound', 'filesParsed', 'filesSkipped', 'reExportsFound', 'reExportsResolved', 'folders'];
  if (counts.some((key) => typeof stats[key] !== 'number')) throw new Error('Invalid parser statistics.');
  const coverageCounts = ['importsSeen', 'resolved', 'external', 'excluded', 'unresolved'];
  if (coverageCounts.some((key) => typeof coverage[key] !== 'number')) throw new Error('Invalid coverage statistics.');
  for (const file of value.files) {
    if (!isRecord(file) || ['path', 'folder', 'module', 'kind'].some((key) => typeof file[key] !== 'string') ||
        (typeof file.sha256 !== 'string' && file.sha256 !== null) ||
        (file.exports !== undefined && (!Array.isArray(file.exports) || file.exports.some((name) => typeof name !== 'string'))) ||
        ['lines', 'fanIn', 'fanOut'].some((key) => typeof file[key] !== 'number')) {
      throw new Error('Invalid file record.');
    }
  }
  for (const edge of value.edges) {
    if (!isRecord(edge) || typeof edge.from !== 'string' || typeof edge.to !== 'string' ||
        !['import', 're-export', 'dynamic-import', 'require'].includes(String(edge.kind))) {
      throw new Error('Invalid dependency edge.');
    }
  }
  for (const record of value.coverage.records) {
    if (!isRecord(record) || typeof record.from !== 'string' || typeof record.specifier !== 'string' ||
        !['import', 're-export', 'dynamic-import', 'require'].includes(String(record.kind)) ||
        !['resolved', 'external', 'excluded', 'unresolved'].includes(String(record.status))) {
      throw new Error('Invalid import coverage record.');
    }
  }
  for (const skipped of value.skippedFiles) {
    if (!isRecord(skipped) || typeof skipped.path !== 'string' || typeof skipped.reason !== 'string') {
      throw new Error('Invalid skipped-file record.');
    }
  }
  const framework = value.framework ?? 'Generic';
  if (typeof framework !== 'string') throw new Error('Invalid framework identity.');
  const routes = value.routes ?? [];
  if (!Array.isArray(routes) || routes.some((route) => !isRecord(route) ||
      typeof route.method !== 'string' || typeof route.path !== 'string' || typeof route.file !== 'string')) {
    throw new Error('Invalid extracted routes.');
  }
  const files = value.files.map((file) => ({ ...file, exports: file.exports ?? [] }));
  return { ...value, framework, routes, files } as unknown as ParserResult;
}

