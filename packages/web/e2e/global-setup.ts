import { execFileSync } from 'node:child_process';
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
  // 服务只读取虚构 home，覆盖父 shell 的知识库和 Skill/agent 目录配置。
  const fixtureHome = join(WEB_DIST, '..', '..', 'knowledge', 'fixtures', 'home');
  process.env.BLUEMANTA_KNOWLEDGE_HOME = fixtureHome;
  process.env.BLUEMANTA_SKILL_HOME = fixtureHome;
  process.env.DSH_HOME = join(fixtureHome, '.dsh');
  process.env.DSH_AGENTS_HOME = join(fixtureHome, '.agents');
  process.env.BLUEMANTA_TODAY = '2026-11-21';
  if (!existsSync(join(WEB_DIST, 'index.html'))) {
    throw new Error('网页还没构建：先运行 npm run build（走查用构建产物，由本地服务托管）');
  }
  const full = await serve('full', 'full');
  const empty = await serve('empty', 'empty');
  const writes = await serve('writes', 'full');
  const shots = await serve('shots', 'full');
  const home = sandboxDir('git-home');
  resetSandbox(home);
  execFileSync(process.execPath,[join(WEB_DIST,'../../knowledge/scripts/git-fixture.mjs'),join(home,'Documents/PersonalOS')]);
  process.env.BLUEMANTA_KNOWLEDGE_HOME = home;
  const git = await serve('git','empty');
  const refreshHome = sandboxDir('refresh-home');
  resetSandbox(refreshHome);
  execFileSync(process.execPath,[join(WEB_DIST,'../../knowledge/scripts/git-fixture.mjs'),join(refreshHome,'Documents/PersonalOS')]);
  process.env.BLUEMANTA_KNOWLEDGE_HOME=refreshHome;
  const refresh=await serve('refresh','empty');
  process.env.BM_E2E_REFRESH_URL=refresh.url;
  process.env.BM_E2E_REFRESH_TOKEN=refresh.token;
  // 迭代 3 写入走查：独立的可写副本；提交用虚构身份，不用本机的 git 配置。
  const writeHome = sandboxDir('pos-write-home');
  resetSandbox(writeHome);
  execFileSync(process.execPath,[join(WEB_DIST,'../../knowledge/scripts/git-fixture.mjs'),join(writeHome,'Documents/PersonalOS')]);
  Object.assign(process.env,{GIT_AUTHOR_NAME:'纸星',GIT_AUTHOR_EMAIL:'paper@example.invalid',GIT_COMMITTER_NAME:'纸星',GIT_COMMITTER_EMAIL:'paper@example.invalid',GIT_CONFIG_GLOBAL:'/dev/null',GIT_CONFIG_NOSYSTEM:'1'});
  process.env.BLUEMANTA_KNOWLEDGE_HOME = writeHome;
  const posWrite = await serve('pos-write','empty');
  process.env.BM_E2E_POS_WRITE_URL = posWrite.url;
  process.env.BM_E2E_POS_WRITE_TOKEN = posWrite.token;
  process.env.BLUEMANTA_KNOWLEDGE_HOME = fixtureHome;
  process.env.BM_E2E_GIT_URL=git.url;
  process.env.BM_E2E_GIT_TOKEN=git.token;
  process.env.BM_E2E_URL = full.url;
  process.env.BM_E2E_TOKEN = full.token;
  process.env.BM_E2E_EMPTY_URL = empty.url;
  process.env.BM_E2E_EMPTY_TOKEN = empty.token;
  process.env.BM_E2E_WRITE_URL = writes.url;
  process.env.BM_E2E_WRITE_TOKEN = writes.token;
  process.env.BM_E2E_SHOT_URL = shots.url;
  process.env.BM_E2E_SHOT_TOKEN = shots.token;
  return async () => {
    await posWrite.server.close();
    await refresh.server.close();
    await git.server.close();
    await full.server.close();
    await empty.server.close();
    await writes.server.close();
    await shots.server.close();
  };
}
