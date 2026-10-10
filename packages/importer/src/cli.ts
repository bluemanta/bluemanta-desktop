import { realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { defaultDataDir } from '@bluemanta/core';
import { failureCount, formatReport } from './report.js';
import { runImport, type RunImportOptions } from './run.js';

export function defaultSourcePath(): string {
  return join(homedir(), 'Library', 'Application Support', 'BluemantaOPC', 'store.json');
}

const USAGE = `用法: npm run import:workbench -- [--source <store.json>] [--data-dir <数据目录>] [--config <映射.json>] [--dry-run]`;

export function parseArgs(argv: readonly string[]): RunImportOptions {
  let sourcePath = defaultSourcePath();
  let dataDir = defaultDataDir();
  let configPath: string | undefined;
  let dryRun = false;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--help') {
      throw new Error(USAGE);
    }
    if (arg === '--dry-run') {
      dryRun = true;
      continue;
    }
    if (arg === '--source' || arg === '--data-dir' || arg === '--config') {
      const value = argv[index + 1];
      if (value === undefined || value.startsWith('--')) throw new Error(`${arg} 需要路径\n${USAGE}`);
      index += 1;
      if (arg === '--source') sourcePath = value;
      else if (arg === '--data-dir') dataDir = value;
      else configPath = value;
      continue;
    }
    throw new Error(`未知参数：${arg ?? ''}\n${USAGE}`);
  }

  return { sourcePath, dataDir, ...(configPath === undefined ? {} : { configPath }), dryRun };
}

export function main(argv: readonly string[]): number {
  let options: RunImportOptions;
  try {
    options = parseArgs(argv);
  } catch (error) {
    console.error(error instanceof Error ? error.message : '参数不正确');
    return 2;
  }
  try {
    const report = runImport(options);
    console.log(formatReport(report));
    return failureCount(report) > 0 ? 1 : 0;
  } catch (error) {
    console.error(error instanceof Error ? error.message : '导入失败');
    return 1;
  }
}

function isDirectRun(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return import.meta.url === pathToFileURL(realpathSync(entry)).href;
  } catch {
    return false;
  }
}

if (isDirectRun()) {
  process.exit(main(process.argv.slice(2)));
}
