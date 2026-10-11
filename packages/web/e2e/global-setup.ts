/**
 * 走查前：在 .dev-data/ 下生成两份虚构库（完整、空库），各起一个本地服务托管构建好的网页。
 * 地址和口令经环境变量交给用例（Playwright 的 worker 继承这里设置的环境变量）。
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { loadToken, startServer, type RunningServer } from '@bluemanta/server';
import { freePort, resetSandbox, sandboxDir, WEB_DIST } from '../scripts/sandbox.ts';
import { seedIdeas, type SeedMode } from '../scripts/seed.ts';

async function serve(mode: SeedMode): Promise<{ server: RunningServer; url: string; token: string }> {
  const dataDir = sandboxDir(`e2e-${mode}`);
  resetSandbox(dataDir);
  seedIdeas(dataDir, mode);
  const port = await freePort();
  const quiet = () => {};
  const outcome = await startServer({ dataDir, port, webDir: WEB_DIST, stdout: quiet, stderr: quiet });
  if (outcome.status !== 'started') throw new Error(`本地服务没有启动（${outcome.status}）`);
  return { server: outcome.server, url: `http://127.0.0.1:${port}`, token: loadToken(dataDir, quiet) };
}

export default async function globalSetup(): Promise<() => Promise<void>> {
  if (!existsSync(join(WEB_DIST, 'index.html'))) {
    throw new Error('网页还没构建：先运行 npm run build（走查用构建产物，由本地服务托管）');
  }
  const full = await serve('full');
  const empty = await serve('empty');
  process.env.BM_E2E_URL = full.url;
  process.env.BM_E2E_TOKEN = full.token;
  process.env.BM_E2E_EMPTY_URL = empty.url;
  process.env.BM_E2E_EMPTY_TOKEN = empty.token;
  return async () => {
    await full.server.close();
    await empty.server.close();
  };
}
