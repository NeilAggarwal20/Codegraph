import type { AdapterContext, FileIdentity, FrameworkAdapter, FrameworkRoute } from '../types.ts';
import { moduleName, packageHas } from './shared.ts';

const folderRoles = new Map<string, string>([
  ['route', 'Routers'], ['routes', 'Routers'],
  ['controller', 'Controllers'], ['controllers', 'Controllers'],
  ['service', 'Services'], ['services', 'Services'],
  ['middleware', 'Middleware'], ['middlewares', 'Middleware'],
  ['model', 'Models'], ['models', 'Models'],
  ['repository', 'Repositories'], ['repositories', 'Repositories'],
  ['handler', 'Handlers'], ['handlers', 'Handlers'],
]);

export const expressAdapter: FrameworkAdapter = {
  framework: 'Express',
  matches(context: AdapterContext): boolean {
    return packageHas(context, 'express');
  },
  identifyFile(relativePath: string): FileIdentity {
    const folders = relativePath.split('/').slice(0, -1).reverse();
    const basename = relativePath.split('/').at(-1)?.toLowerCase() ?? '';
    const kind = folders.map((folder) => folderRoles.get(folder.toLowerCase())).find(Boolean)
      ?? (/(^|\.)test\.[^.]+$|(^|\.)spec\.[^.]+$/.test(basename) ? 'Tests'
        : folders.some((folder) => folder.toLowerCase() === 'config') ? 'Config files'
          : 'Unclassified');
    return { module: moduleName(relativePath), kind };
  },
  extractRoutes(): FrameworkRoute[] {
    return [];
  },
};
