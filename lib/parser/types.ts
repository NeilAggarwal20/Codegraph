export type ImportKind = 'import' | 're-export' | 'dynamic-import';

export type ImportCoverageStatus = 'resolved' | 'external' | 'excluded' | 'unresolved';

export interface ParsedFile {
  path: string;
  folder: string;
  module: string;
  kind: string;
  lines: number;
  sha256: string;
  fanIn: number;
  fanOut: number;
}

export interface DependencyEdge {
  from: string;
  to: string;
  kind: ImportKind;
}

export interface ImportCoverageRecord {
  from: string;
  specifier: string;
  kind: ImportKind;
  status: ImportCoverageStatus;
  reason?: string;
  resolvedTo?: string;
}

export interface SkippedFile {
  path: string;
  reason: string;
}

export interface ParserResult {
  schemaVersion: 1;
  root: string;
  stats: {
    filesFound: number;
    filesParsed: number;
    filesSkipped: number;
    reExportsFound: number;
    reExportsResolved: number;
    folders: number;
  };
  files: ParsedFile[];
  edges: DependencyEdge[];
  coverage: {
    importsSeen: number;
    resolved: number;
    external: number;
    excluded: number;
    unresolved: number;
    records: ImportCoverageRecord[];
  };
  skippedFiles: SkippedFile[];
}

export interface FileIdentity {
  module: string;
  kind: string;
}

export interface FrameworkAdapter {
  identifyFile(relativePath: string): FileIdentity;
}

