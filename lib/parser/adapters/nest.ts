import { SyntaxKind } from 'ts-morph';
import type { AdapterContext, FileIdentity, FrameworkAdapter, FrameworkRoute } from '../types.ts';
import { joinRouteParts, moduleName, packageHas, staticString } from './shared.ts';

const routeDecorators = new Map([
  ['Get', 'GET'], ['Post', 'POST'], ['Put', 'PUT'], ['Patch', 'PATCH'],
  ['Delete', 'DELETE'], ['Options', 'OPTIONS'], ['Head', 'HEAD'], ['All', 'ALL'],
]);

function basename(relativePath: string): string {
  return relativePath.split('/').at(-1)?.replace(/\.(?:[cm]?[jt]sx?)$/i, '') ?? '';
}

export const nestAdapter: FrameworkAdapter = {
  framework: 'NestJS',
  matches(context: AdapterContext): boolean {
    return packageHas(context, '@nestjs/core') || context.relativePaths.some((file) => /\.controller\.[cm]?[jt]sx?$/i.test(file));
  },
  identifyFile(relativePath: string): FileIdentity {
    const name = basename(relativePath);
    const kind = /\.controller$/i.test(name) ? 'Controllers'
      : /\.service$/i.test(name) ? 'Services'
        : /\.module$/i.test(name) ? 'Modules'
          : /\.entity$/i.test(name) ? 'Entities'
            : /\.guard$/i.test(name) ? 'Guards'
              : /\.interceptor$/i.test(name) ? 'Interceptors'
                : /\.pipe$/i.test(name) ? 'Pipes'
                  : /\.decorator$/i.test(name) ? 'Decorators'
                    : 'Modules';
    return { module: moduleName(relativePath), kind };
  },
  extractRoutes(sourceFiles, relativePathByAbsolute): FrameworkRoute[] {
    const routes: FrameworkRoute[] = [];
    const globalPrefixes: string[] = [];
    let hasDynamicPrefix = false;
    let versionedRoutes = false;
    for (const sourceFile of sourceFiles) {
      for (const call of sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
        const expression = call.getExpression();
        if (!expression.isKind(SyntaxKind.PropertyAccessExpression)) continue;
        if (expression.getName() === 'enableVersioning') versionedRoutes = true;
        if (expression.getName() !== 'setGlobalPrefix') continue;
        const prefix = staticString(call.getArguments()[0]);
        if (prefix === null) hasDynamicPrefix = true;
        else globalPrefixes.push(prefix);
      }
    }
    const uniquePrefixes = [...new Set(globalPrefixes)];
    if (hasDynamicPrefix || versionedRoutes || uniquePrefixes.length > 1) return [];
    const globalPrefix = uniquePrefixes[0] ?? '';

    for (const sourceFile of sourceFiles) {
      const file = relativePathByAbsolute.get(sourceFile.getFilePath());
      if (!file || !/\.controller\.[cm]?[jt]sx?$/i.test(file)) continue;
      for (const controller of sourceFile.getClasses()) {
        const controllerDecorator = controller.getDecorators().find((decorator) => decorator.getName() === 'Controller');
        if (!controllerDecorator) continue;
        if (controller.getDecorators().some((decorator) => decorator.getName() === 'Version')) {
          versionedRoutes = true;
          continue;
        }
        const controllerArg = controllerDecorator.getArguments()[0];
        const controllerPath = controllerArg ? staticString(controllerArg) : '';
        if (controllerPath === null) continue;

        for (const method of controller.getMethods()) {
          for (const decorator of method.getDecorators()) {
            if (decorator.getName() === 'Version') {
              versionedRoutes = true;
              continue;
            }
            const verb = routeDecorators.get(decorator.getName());
            if (!verb) continue;
            const methodArg = decorator.getArguments()[0];
            const methodPath = methodArg ? staticString(methodArg) : '';
            if (methodPath === null) continue;
            routes.push({ method: verb, path: joinRouteParts(globalPrefix, controllerPath, methodPath), file });
          }
        }
      }
    }
    if (versionedRoutes) return [];
    return routes.sort((a, b) => a.path.localeCompare(b.path) || a.method.localeCompare(b.method) || a.file.localeCompare(b.file));
  },
};
