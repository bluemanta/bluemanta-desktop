/**
 * `npm run dev:web`：生成虚构数据 → 在空闲端口启动本地服务 → 启动 Vite 并把 /api 代理过去 →
 * 打印带口令的地址。数据只在 packages/web/.dev-data/ 下，每次启动重建。
 *   --empty  空库模式
 */
import { loadToken, startServer } from '@bluemanta/server';
import { createServer } from 'vite';
import { join } from 'node:path';
import { freePort, resetSandbox, sandboxDir, WEB_ROOT } from './sandbox.ts';
import { seedIdeas } from './seed.ts';

const empty = process.argv.includes('--empty');
const dataDir = sandboxDir(empty ? 'dev-empty' : 'dev');
resetSandbox(dataDir);
const seeded = seedIdeas(dataDir, empty ? 'empty' : 'full');

const port = await freePort();
const log = (line: string) => process.stdout.write(`${line}\n`);
const outcome = await startServer({ dataDir, port, webDir: null, stdout: log, stderr: (line) => process.stderr.write(`${line}\n`) });
if (outcome.status !== 'started') {
  process.stderr.write(`本地服务没有启动（${outcome.status}）\n`);
  process.exit(1);
}
const token = loadToken(dataDir, (line) => process.stderr.write(`${line}\n`));

process.env.BLUEMANTA_API_TARGET = `http://127.0.0.1:${port}`;
const vite = await createServer({ configFile: join(WEB_ROOT, 'vite.config.ts'), root: WEB_ROOT });
await vite.listen();
const local = vite.resolvedUrls?.local[0] ?? '';

log('');
log(`虚构数据：${seeded.active} 条灵感、回收站 ${seeded.trashed} 条、图片 ${seeded.attachments} 张`);
log(`打开：${local}#token=${token}`);
log('按 Ctrl-C 停止。');

let stopping = false;
const stop = async () => {
  if (stopping) return;
  stopping = true;
  await vite.close();
  await outcome.server.close();
  process.exit(0);
};
process.once('SIGINT', () => void stop());
process.once('SIGTERM', () => void stop());
