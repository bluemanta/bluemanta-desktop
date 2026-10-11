/**
 * 单独生成虚构数据：
 *   node scripts/seed-cli.ts [--empty] [--data-dir <目录>]
 * 默认写到 packages/web/.dev-data/seed（每次清空重建）。指定目录时，目录必须不存在或为空。
 */
import { resolve } from 'node:path';
import { assertNotRealDataDir, isEmptyDir, resetSandbox, sandboxDir } from './sandbox.ts';
import { seedIdeas } from './seed.ts';

const args = process.argv.slice(2);
const empty = args.includes('--empty');
const flag = args.indexOf('--data-dir');
const custom = flag === -1 ? null : args[flag + 1];

let dataDir: string;
if (custom) {
  dataDir = resolve(custom);
  assertNotRealDataDir(dataDir);
  if (!isEmptyDir(dataDir)) {
    process.stderr.write(`目录不是空的，不往里面写：${dataDir}\n`);
    process.exit(1);
  }
} else {
  dataDir = sandboxDir(empty ? 'seed-empty' : 'seed');
  resetSandbox(dataDir);
}

const result = seedIdeas(dataDir, empty ? 'empty' : 'full');
process.stdout.write(
  `已写入虚构数据：${result.active} 条灵感、回收站 ${result.trashed} 条、图片 ${result.attachments} 张（${dataDir}）\n`,
);
