import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { AdapterContext, FrameworkAdapter } from './types.ts';
import { fallbackAdapter } from './fallback-adapter.ts';
import { nextAdapter } from './adapters/next.ts';
import { nestAdapter } from './adapters/nest.ts';
import { expressAdapter } from './adapters/express.ts';
import { reactAdapter } from './adapters/react.ts';

const adapters: readonly FrameworkAdapter[] = [nextAdapter, nestAdapter, expressAdapter, reactAdapter];

export async function selectFrameworkAdapter(root: string, relativePaths: readonly string[]): Promise<FrameworkAdapter> {
  let packageJson: unknown = null;
  try {
    packageJson = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8')) as unknown;
  } catch {
    // Repositories without a readable package manifest still use path-based detection.
  }
  const context: AdapterContext = { packageJson, relativePaths };
  return adapters.find((adapter) => adapter.matches(context)) ?? fallbackAdapter;
}
