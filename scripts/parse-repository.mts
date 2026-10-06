import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parseRepository } from '../lib/parser/parse-repository.ts';
import { readParserResult } from '../lib/parser/read-result.ts';

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const directory = args.find((arg) => !arg.startsWith('--'));
  const outIndex = args.indexOf('--out');
  const outputPath = outIndex >= 0 ? args[outIndex + 1] : undefined;
  if (!directory || (outIndex >= 0 && !outputPath) || args.some((arg) => arg.startsWith('--') && arg !== '--out')) {
    throw new Error('Usage: pnpm parse <directory> [--out <file.json>]');
  }

  const result = await parseRepository(directory);
  console.log(`Framework: ${result.framework}.`);
  console.log(`Files: ${result.stats.filesFound} found, ${result.stats.filesParsed} parsed, ${result.stats.filesSkipped} skipped.`);
  console.log(`Folders: ${result.stats.folders}.`);
  console.log(`Routes: ${result.routes.length} extracted.`);
  console.log(`Re-exports: ${result.stats.reExportsResolved} resolved / ${result.stats.reExportsFound} found.`);
  console.log(`Imports: ${result.coverage.importsSeen} seen; ${result.coverage.resolved} resolved, ${result.coverage.external} external, ${result.coverage.excluded} excluded, ${result.coverage.unresolved} unresolved.`);
  for (const skipped of result.skippedFiles) console.log(`Skipped ${skipped.path}: ${skipped.reason}`);
  for (const record of result.coverage.records.filter((item) => item.status === 'unresolved')) {
    console.log(`Unresolved ${record.from} -> ${record.specifier}: ${record.reason ?? 'unknown reason'}`);
  }

  if (outputPath) {
    const absoluteOutput = path.resolve(outputPath);
    const json = `${JSON.stringify(result, null, 2)}\n`;
    await writeFile(absoluteOutput, json, 'utf8');
    const roundTrip = readParserResult(JSON.parse(await readFile(absoluteOutput, 'utf8')) as unknown);
    console.log(`Wrote and validated ${absoluteOutput} (${roundTrip.files.length} files, ${roundTrip.edges.length} edges).`);
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
