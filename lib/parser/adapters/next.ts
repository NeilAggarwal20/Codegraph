import { SyntaxKind, type SourceFile } from 'ts-morph';
import type { AdapterContext, FileIdentity, FrameworkAdapter, FrameworkRoute } from '../types.ts';
import { moduleName, packageHas } from './shared.ts';

const methods = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']);

function isSource(relativePath: string): boolean {
  return /\.(?:[cm]?[jt]sx?)$/i.test(relativePath);
}

function routeFile(relativePath: string): { surface: 'page' | 'handler'; path: string; methodExports: boolean } | null {
  const parts = relativePath.split('/');
  let rootIndex = -1;
  let router: 'app' | 'pages' | null = null;
  if (parts[0] === 'app' || parts[0] === 'pages') {
    rootIndex = 0;
    router = parts[0];
  } else if (parts[0] === 'src' && (parts[1] === 'app' || parts[1] === 'pages')) {
    rootIndex = 1;
    router = parts[1];
  }
  if (!router || !isSource(relativePath)) return null;

  const withoutExtension = parts.at(-1)?.replace(/\.(?:[cm]?[jt]sx?)$/i, '') ?? '';
  if (router === 'app') {
    if (withoutExtension !== 'page' && withoutExtension !== 'route') return null;
    const routeSegments = parts.slice(rootIndex + 1, -1);
    if (routeSegments.some((segment) => /^\(\.{1,2}\)/.test(segment))) return null;
    const urlSegments = routeSegments.filter((segment) => !/^\(.*\)$/.test(segment) && !segment.startsWith('@'));
    return { surface: withoutExtension === 'page' ? 'page' : 'handler', path: urlSegments.length ? `/${urlSegments.join('/')}` : '/', methodExports: withoutExtension === 'route' };
  }

  if (withoutExtension.startsWith('_')) return null;
  const routeSegments = parts.slice(rootIndex + 1, -1);
  const isApi = routeSegments[0] === 'api';
  const urlSegments = isApi ? routeSegments.slice(1) : routeSegments;
  if (withoutExtension !== 'index') urlSegments.push(withoutExtension);
  return { surface: isApi ? 'handler' : 'page', path: urlSegments.length ? `/${urlSegments.join('/')}` : '/', methodExports: false };
}

function hasUseServerDirective(sourceFile: SourceFile): boolean {
  const statement = sourceFile.getStatements()[0];
  if (!statement?.isKind(SyntaxKind.ExpressionStatement)) return false;
  const expression = statement.getExpression();
  if (expression.isKind(SyntaxKind.StringLiteral) || expression.isKind(SyntaxKind.NoSubstitutionTemplateLiteral)) {
    return expression.getLiteralText() === 'use server';
  }
  return false;
}

function exportedNames(sourceFile: SourceFile): Set<string> {
  const names = new Set<string>();
  for (const statement of sourceFile.getFunctions()) {
    if (statement.isExported() && statement.getName()) names.add(statement.getName()!);
  }
  for (const statement of sourceFile.getVariableStatements()) {
    if (!statement.isExported()) continue;
    for (const declaration of statement.getDeclarations()) names.add(declaration.getName());
  }
  return names;
}

export const nextAdapter: FrameworkAdapter = {
  framework: 'Next.js',
  matches(context: AdapterContext): boolean {
    return packageHas(context, 'next');
  },
  identifyFile(relativePath: string, sourceFile: SourceFile): FileIdentity {
    const base = relativePath.split('/').at(-1)?.replace(/\.(?:[cm]?[jt]sx?)$/i, '').toLowerCase() ?? '';
    const route = routeFile(relativePath);
    let kind = 'Modules';
    if (route?.surface === 'page') kind = 'Page routes';
    else if (route?.surface === 'handler') kind = 'API endpoints';
    else if (hasUseServerDirective(sourceFile)) kind = 'Server actions';
    else if (['layout', 'template', 'default', 'loading', 'error', 'global-error', 'not-found'].includes(base)) kind = 'Layouts';
    else if (['middleware', 'proxy'].includes(base)) kind = 'Middleware';
    else if (/(^|\/)(components|ui)\//i.test(relativePath)) kind = 'Components';
    return { module: moduleName(relativePath), kind };
  },
  extractRoutes(sourceFiles, relativePathByAbsolute): FrameworkRoute[] {
    const routes: FrameworkRoute[] = [];
    for (const sourceFile of sourceFiles) {
      const file = relativePathByAbsolute.get(sourceFile.getFilePath());
      if (!file) continue;
      const route = routeFile(file);
      if (!route) continue;
      if (route.surface === 'page') {
        if (file.split('/').some((segment) => segment.startsWith('@'))) continue;
        routes.push({ method: 'PAGE', path: route.path, file });
        continue;
      }
      if (!route.methodExports) continue;
      for (const name of exportedNames(sourceFile)) {
        if (methods.has(name)) routes.push({ method: name, path: route.path, file });
      }
    }
    return routes.sort((a, b) => a.path.localeCompare(b.path) || a.method.localeCompare(b.method) || a.file.localeCompare(b.file));
  },
};
