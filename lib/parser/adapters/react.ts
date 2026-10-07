import { SyntaxKind, type SourceFile } from 'ts-morph';
import type { AdapterContext, FileIdentity, FrameworkAdapter, FrameworkRoute } from '../types.ts';
import { moduleName, packageHas } from './shared.ts';

export const reactAdapter: FrameworkAdapter = {
  framework: 'React',
  matches(context: AdapterContext): boolean {
    return packageHas(context, 'react');
  },
  identifyFile(relativePath: string, sourceFile: SourceFile): FileIdentity {
    const base = relativePath.split('/').at(-1) ?? '';
    const name = base.replace(/\.[^.]+$/, '');
    const containsJsx = sourceFile.getDescendantsOfKind(SyntaxKind.JsxElement).length > 0 ||
      sourceFile.getDescendantsOfKind(SyntaxKind.JsxSelfClosingElement).length > 0;
    const kind = /^use[A-Z]/.test(name) ? 'Hooks' : containsJsx ? 'Components' : 'Modules';
    return { module: moduleName(relativePath), kind };
  },
  extractRoutes(): FrameworkRoute[] {
    return [];
  },
};
