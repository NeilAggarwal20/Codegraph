import type { DependencyEdge, ParsedFile, ParserResult } from '../parser/types.ts';

export interface FoldedNode {
  id: string;
  label: string;
  files: ParsedFile[];
  fanIn: number;
  fanOut: number;
}

export interface FoldedEdge {
  id: string;
  from: string;
  to: string;
  edges: DependencyEdge[];
}

export interface FoldedGraph {
  threshold: number;
  nodes: FoldedNode[];
  edges: FoldedEdge[];
  internalEdges: DependencyEdge[];
  fileOwners: Map<string, string>;
}

const defaultNodeLimit = 24;
const firstThreshold = 2;

function parentFolder(folder: string): string | undefined {
  if (folder === '.' || folder === '') return undefined;
  const normalized = folder.replace(/\\/g, '/');
  const separator = normalized.lastIndexOf('/');
  return separator < 0 ? '.' : normalized.slice(0, separator) || '.';
}

function folderDepth(folder: string): number {
  return folder === '.' ? 0 : folder.split('/').length;
}

function addFolderAndParents(folder: string, folders: Set<string>): void {
  let current = folder.replace(/\\/g, '/') || '.';
  folders.add(current);
  while (current !== '.') {
    current = parentFolder(current) ?? '.';
    folders.add(current);
  }
}

function makeBuckets(files: ParsedFile[]): { buckets: Map<string, ParsedFile[]>; fileOwners: Map<string, string> } {
  const buckets = new Map<string, ParsedFile[]>();
  const folders = new Set<string>();
  for (const file of files) addFolderAndParents(file.folder, folders);
  for (const folder of folders) buckets.set(folder, []);

  const fileOwners = new Map<string, string>();
  for (const file of files) {
    const folder = file.folder.replace(/\\/g, '/') || '.';
    buckets.get(folder)?.push(file);
    fileOwners.set(file.path, folder);
  }
  return { buckets, fileOwners };
}

function foldAtThreshold(files: ParsedFile[], threshold: number): { buckets: Map<string, ParsedFile[]>; fileOwners: Map<string, string> } {
  const { buckets, fileOwners } = makeBuckets(files);
  const deepestFirst = [...buckets.keys()].sort((a, b) => folderDepth(b) - folderDepth(a) || a.localeCompare(b));

  for (const folder of deepestFirst) {
    if (folder === '.') continue;
    const bucket = buckets.get(folder);
    if (!bucket || bucket.length >= threshold) continue;

    const parent = parentFolder(folder) ?? '.';
    const parentBucket = buckets.get(parent) ?? [];
    parentBucket.push(...bucket);
    parentBucket.sort((a, b) => a.path.localeCompare(b.path));
    buckets.set(parent, parentBucket);
    buckets.delete(folder);
    for (const file of bucket) fileOwners.set(file.path, parent);
  }

  return { buckets, fileOwners };
}

function uniqueLabels(paths: string[]): Map<string, string> {
  const parts = paths.map((folder) => folder === '.' ? ['.'] : folder.split('/'));
  const labels = new Map<string, string>();
  for (let index = 0; index < paths.length; index += 1) {
    const ownParts = parts[index];
    let label = ownParts[ownParts.length - 1];
    let suffixLength = 1;
    while (paths.some((_, otherIndex) => {
      if (otherIndex === index) return false;
      const otherParts = parts[otherIndex];
      const ownSuffix = ownParts.slice(-suffixLength).join('/');
      return otherParts.slice(-suffixLength).join('/') === ownSuffix;
    }) && suffixLength < ownParts.length) {
      suffixLength += 1;
      label = ownParts.slice(-suffixLength).join('/');
    }
    if (paths.some((_, otherIndex) => otherIndex !== index && (parts[otherIndex].slice(-suffixLength).join('/') === ownParts.slice(-suffixLength).join('/')))) {
      label = `${ownParts.join('/')}`;
    }
    labels.set(paths[index], label);
  }
  return labels;
}

function materializeGraph(
  data: Pick<ParserResult, 'files' | 'edges'>,
  threshold: number,
): FoldedGraph {
  const { buckets, fileOwners } = foldAtThreshold(data.files, threshold);
  const nonEmpty = [...buckets.entries()]
    .filter(([, files]) => files.length > 0)
    .sort(([a], [b]) => a.localeCompare(b));
  const folderPaths = nonEmpty.map(([folder]) => folder);
  const labels = uniqueLabels(folderPaths);

  const nodes: FoldedNode[] = nonEmpty.map(([folder, files]) => ({
    id: folder,
    label: labels.get(folder) ?? folder,
    files: [...files].sort((a, b) => a.path.localeCompare(b.path)),
    fanIn: files.reduce((total, file) => total + file.fanIn, 0),
    fanOut: files.reduce((total, file) => total + file.fanOut, 0),
  }));

  const groupedEdges = new Map<string, DependencyEdge[]>();
  const internalEdges: DependencyEdge[] = [];
  for (const edge of data.edges) {
    const from = fileOwners.get(edge.from);
    const to = fileOwners.get(edge.to);
    if (!from || !to) continue;
    if (from === to) {
      internalEdges.push(edge);
      continue;
    }
    const key = `${from}\0${to}`;
    const group = groupedEdges.get(key) ?? [];
    group.push(edge);
    groupedEdges.set(key, group);
  }

  const edges: FoldedEdge[] = [...groupedEdges.entries()]
    .map(([key, memberEdges]) => {
      const [from, to] = key.split('\0');
      return { id: `${from}->${to}`, from, to, edges: memberEdges.sort((a, b) => a.from.localeCompare(b.from) || a.to.localeCompare(b.to)) };
    })
    .sort((a, b) => a.from.localeCompare(b.from) || a.to.localeCompare(b.to));

  return { threshold, nodes, edges, internalEdges, fileOwners };
}

/** Fold sparse folders upward, raising the threshold only as far as needed to meet the node limit. */
export function foldRepository(data: Pick<ParserResult, 'files' | 'edges'>, nodeLimit = defaultNodeLimit): FoldedGraph {
  if (data.files.length === 0) return { threshold: firstThreshold, nodes: [], edges: [], internalEdges: [], fileOwners: new Map() };

  const highestUsefulThreshold = Math.max(firstThreshold, data.files.length);
  for (let threshold = firstThreshold; threshold <= highestUsefulThreshold; threshold += 1) {
    const graph = materializeGraph(data, threshold);
    if (graph.nodes.length <= nodeLimit || threshold === highestUsefulThreshold) return graph;
  }

  return materializeGraph(data, highestUsefulThreshold);
}

