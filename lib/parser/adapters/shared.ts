import type { AdapterContext } from '../types.ts';
import { SyntaxKind, type Node } from 'ts-morph';

export function packageHas(context: AdapterContext, ...names: string[]): boolean {
  if (typeof context.packageJson !== 'object' || context.packageJson === null || Array.isArray(context.packageJson)) return false;
  const packageJson = context.packageJson as Record<string, unknown>;
  for (const section of ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']) {
    const dependencies = packageJson[section];
    if (typeof dependencies !== 'object' || dependencies === null || Array.isArray(dependencies)) continue;
    const values = dependencies as Record<string, unknown>;
    if (names.some((name) => Object.hasOwn(values, name))) return true;
  }
  return false;
}

export function moduleName(relativePath: string): string {
  return relativePath.replace(/\.(?:[cm]?[jt]sx?)$/i, '');
}

export function staticString(node: Node | undefined): string | null {
  if (!node || (!node.isKind(SyntaxKind.StringLiteral) && !node.isKind(SyntaxKind.NoSubstitutionTemplateLiteral))) return null;
  return node.getLiteralText();
}

export function joinRouteParts(...parts: string[]): string {
  const joined = parts.map((part) => part.replace(/^\/+|\/+$/g, '')).filter(Boolean).join('/');
  return joined ? `/${joined}` : '/';
}
