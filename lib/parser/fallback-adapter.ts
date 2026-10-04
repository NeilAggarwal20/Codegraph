import type { FileIdentity, FrameworkAdapter } from './types.ts';

/** Framework-free identity: one module per source file, with no route guesses. */
export const fallbackAdapter: FrameworkAdapter = {
  identifyFile(relativePath: string): FileIdentity {
    const moduleName = relativePath.replace(/\.(?:[cm]?[jt]sx?)$/i, '');
    return { module: moduleName, kind: 'module' };
  },
};

