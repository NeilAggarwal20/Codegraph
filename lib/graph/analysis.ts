import type { DependencyEdge, ParsedFile } from '../parser/types';

export type WalkDirection = 'dependencies' | 'dependents';

export interface GraphWalkEntry {
  path: string;
  depth: number;
}

function makeAdjacency(
  files: ParsedFile[],
  edges: DependencyEdge[],
  direction: WalkDirection,
): Map<string, string[]> {
  const knownFiles = new Set(files.map((file) => file.path));
  const adjacency = new Map(files.map((file) => [file.path, new Set<string>()]));
  for (const edge of edges) {
    const from = direction === 'dependencies' ? edge.from : edge.to;
    const to = direction === 'dependencies' ? edge.to : edge.from;
    if (!knownFiles.has(from) || !knownFiles.has(to)) continue;
    adjacency.get(from)?.add(to);
  }
  return new Map([...adjacency].map(([path, neighbours]) => [path, [...neighbours].sort()]));
}

export function walkGraph(
  files: ParsedFile[],
  edges: DependencyEdge[],
  startPath: string,
  direction: WalkDirection,
  maxDepth = 2,
): GraphWalkEntry[] {
  if (!files.some((file) => file.path === startPath) || maxDepth < 1) return [];

  const adjacency = makeAdjacency(files, edges, direction);
  const visited = new Set([startPath]);
  const queue: GraphWalkEntry[] = [{ path: startPath, depth: 0 }];
  const result: GraphWalkEntry[] = [];

  for (let index = 0; index < queue.length; index += 1) {
    const current = queue[index];
    if (current.depth >= maxDepth) continue;
    for (const neighbour of adjacency.get(current.path) ?? []) {
      if (visited.has(neighbour)) continue;
      visited.add(neighbour);
      const entry = { path: neighbour, depth: current.depth + 1 };
      result.push(entry);
      queue.push(entry);
    }
  }

  return result;
}

export function findImportCycles(files: ParsedFile[], edges: DependencyEdge[]): string[][] {
  const adjacency = makeAdjacency(files, edges, 'dependencies');
  const reverse = makeAdjacency(files, edges, 'dependents');
  const visited = new Set<string>();
  const finishOrder: string[] = [];

  for (const file of files) {
    if (visited.has(file.path)) continue;
    visited.add(file.path);
    const stack: Array<{ path: string; next: number }> = [{ path: file.path, next: 0 }];

    while (stack.length > 0) {
      const frame = stack[stack.length - 1];
      const neighbours = adjacency.get(frame.path) ?? [];
      if (frame.next < neighbours.length) {
        const neighbour = neighbours[frame.next];
        frame.next += 1;
        if (!visited.has(neighbour)) {
          visited.add(neighbour);
          stack.push({ path: neighbour, next: 0 });
        }
      } else {
        finishOrder.push(frame.path);
        stack.pop();
      }
    }
  }

  visited.clear();
  const cycles: string[][] = [];
  for (let index = finishOrder.length - 1; index >= 0; index -= 1) {
    const root = finishOrder[index];
    if (visited.has(root)) continue;
    const component: string[] = [];
    const stack = [root];
    visited.add(root);
    while (stack.length > 0) {
      const path = stack.pop();
      if (path === undefined) continue;
      component.push(path);
      for (const neighbour of reverse.get(path) ?? []) {
        if (visited.has(neighbour)) continue;
        visited.add(neighbour);
        stack.push(neighbour);
      }
    }

    const hasSelfLoop = component.length === 1 && (adjacency.get(root) ?? []).includes(root);
    if (component.length > 1 || hasSelfLoop) cycles.push(component.sort());
  }

  return cycles.sort((a, b) => a[0].localeCompare(b[0]));
}

function isFrameworkEntry(file: ParsedFile): boolean {
  const roleTokens = file.kind.toLowerCase().split(/[^a-z0-9]+/);
  if (roleTokens.some((token) => ['page', 'route', 'layout', 'middleware', 'config', 'configuration'].includes(token))) {
    return true;
  }

  const basename = file.path.split('/').at(-1) ?? file.path;
  return /^(?:page|route|layout|middleware)(?:\.[^.]+)*$/i.test(basename) ||
    /(?:^|\.)config\.[^.]+$/i.test(basename) ||
    /\.controller\.[^.]+$/i.test(basename);
}

export function findFilesNothingImports(files: ParsedFile[], edges: DependencyEdge[]): ParsedFile[] {
  const importedFiles = new Set(edges.map((edge) => edge.to));
  return files
    .filter((file) => !importedFiles.has(file.path) && !isFrameworkEntry(file))
    .sort((a, b) => b.fanOut - a.fanOut || a.path.localeCompare(b.path));
}
