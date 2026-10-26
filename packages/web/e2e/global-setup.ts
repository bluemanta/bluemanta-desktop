/**
 * 走查前：在 .dev-data/ 下生成虚构库，各起一个本地服务托管构建好的网页。
 * 完整库和空库只读；写操作和截图各用一份，避免并行用例互相改数据。
 * 地址和口令经环境变量交给用例（Playwright 的 worker 继承这里设置的环境变量）。
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { loadToken, startServer, type RunningServer } from '@bluemanta/server';
import { freePort, resetSandbox, sandboxDir, WEB_DIST } from '../scripts/sandbox.ts';
import { seedIdeas, type SeedMode } from '../scripts/seed.ts';

async function serve(name: string, mode: SeedMode): Promise<{ server: RunningServer; url: string; token: string }> {
  const dataDir = sandboxDir(`e2e-${name}`);
  resetSandbox(dataDir);
  seedIdeas(dataDir, mode);
  const port = await freePort();
  const quiet = () => {};
  const outcome = await startServer({ dataDir, port, webDir: WEB_DIST, stdout: quiet, stderr: quiet });
  if (outcome.status !== 'started') throw new Error(`本地服务没有启动（${outcome.status}）`);
  return { server: outcome.server, url: `http://127.0.0.1:${port}`, token: loadToken(dataDir, quiet) };
}

export default async function globalSetup(): Promise<() => Promise<void>> {
  // 知识台走查用虚构库（packages/knowledge/fixtures），服务在创建时读这个环境变量。
  process.env.BLUEMANTA_KNOWLEDGE_HOME = join(WEB_DIST, '..', '..', 'knowledge', 'fixtures', 'home');
  if (!existsSync(join(WEB_DIST, 'index.html'))) {
    throw new Error('网页还没构建：先运行 npm run build（走查用构建产物，由本地服务托管）');
  }
  const full = await serve('full', 'full');
  const empty = await serve('empty', 'empty');
  const writes = await serve('writes', 'full');
  const shots = await serve('shots', 'full');
  process.env.BM_E2E_URL = full.url;
  process.env.BM_E2E_TOKEN = full.token;
  process.env.BM_E2E_EMPTY_URL = empty.url;
  process.env.BM_E2E_EMPTY_TOKEN = empty.token;
  process.env.BM_E2E_WRITE_URL = writes.url;
  process.env.BM_E2E_WRITE_TOKEN = writes.token;
  process.env.BM_E2E_SHOT_URL = shots.url;
  process.env.BM_E2E_SHOT_TOKEN = shots.token;
  return async () => {
    await full.server.close();
    await empty.server.close();
    await writes.server.close();
    await shots.server.close();
  };
}
