import type { FileIdentity, FrameworkAdapter } from './types.ts';
import { moduleName } from './adapters/shared.ts';

/** Framework-free identity: one module per source file, with no route guesses. */
export const fallbackAdapter: FrameworkAdapter = {
  framework: 'Generic',
  matches(): boolean {
    return true;
  },
  identifyFile(relativePath: string): FileIdentity {
    return { module: moduleName(relativePath), kind: 'Modules' };
  },
  extractRoutes() {
    return [];
  },
};
