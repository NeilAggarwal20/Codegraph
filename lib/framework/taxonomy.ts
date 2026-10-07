import type { ParsedFile } from '@/lib/parser/types';

type FrameworkName = 'Next.js' | 'NestJS' | 'Express' | 'React' | 'Generic';

export const frameworkNames: Record<string, string> = {
  'Next.js': 'Next.js',
  NestJS: 'NestJS',
  Express: 'Express',
  React: 'React',
  Generic: 'Not detected',
};

const roleOrder: Record<FrameworkName, readonly string[]> = {
  'Next.js': ['Page routes', 'API endpoints', 'Server actions', 'Components', 'Layouts', 'Middleware', 'Modules'],
  NestJS: ['Controllers', 'Services', 'Modules', 'Entities', 'Guards', 'Interceptors', 'Pipes', 'Decorators'],
  Express: ['Routers', 'Controllers', 'Services', 'Models', 'Middleware', 'Config files', 'Tests', 'Unclassified'],
  React: ['Components', 'Hooks', 'Modules'],
  Generic: ['Modules'],
};

export function countFrameworkRoles(framework: string, files: readonly ParsedFile[]) {
  const countByRole = new Map<string, number>();
  for (const file of files) countByRole.set(file.kind, (countByRole.get(file.kind) ?? 0) + 1);
  const selectedOrder = Object.hasOwn(roleOrder, framework) ? roleOrder[framework as FrameworkName] : roleOrder.Generic;
  const ordered = selectedOrder.map((kind) => ({ kind, count: countByRole.get(kind) ?? 0 }));
  const known = new Set(ordered.map((item) => item.kind));
  const other = [...countByRole]
    .filter(([kind]) => !known.has(kind))
    .map(([kind, count]) => ({ kind, count }))
    .sort((a, b) => a.kind.localeCompare(b.kind));
  return [...ordered, ...other].filter((item) => item.count > 0);
}
