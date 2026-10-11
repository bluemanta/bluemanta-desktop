import { defaultDataDir, openCore } from '@bluemanta/core';
import type { HostContext } from './context.js';
import { resolveDataDir } from './data-dir.js';
import {
  createLocalServer,
  failingServer,
  loadWebConfig,
  probeHealth,
  resolveServerCli,
  resolveServerPort,
  spawnNodeServer,
  WEB_CONFIG_PATH,
  type LocalServer,
} from './local-server.js';
import { registerIdeaTools } from './register-idea-tools.js';

export const name = 'bluemanta';
export const inject = ['connection', 'tools'];

export type { HostContext } from './context.js';
export { resolveDataDir } from './data-dir.js';
export {
  AGENT_LIMITATION,
  AGENT_SOURCE,
  IDEA_CAPTURE_TOOL,
  IDEA_GET_TOOL,
  IDEA_SEARCH_TOOL,
  captureIdea,
  getIdea,
  ideaRequestId,
  searchIdeas,
} from './idea-tools.js';
export { registerIdeaTools } from './register-idea-tools.js';
export {
  DEFAULT_SERVER_PORT,
  HEALTH_TIMEOUT_MS,
  WEB_CONFIG_PATH,
  createLocalServer,
  failingServer,
  loadWebConfig,
  occupiedReason,
  probeHealth,
  readServerToken,
  resolveServerCli,
  resolveServerPort,
  spawnNodeServer,
} from './local-server.js';
export type { EnsureResult, HealthState, LocalServer, WebConfig } from './local-server.js';

export type ApplyOptions = {
  /** 测试注入。缺省时按环境变量检查并按需拉起本地服务。 */
  server?: LocalServer;
  dataDir?: string;
};

function defaultServer(dataDir: string): LocalServer {
  const port = resolveServerPort(process.env.BLUEMANTA_SERVER_PORT);
  if (!port.ok) return failingServer(port.reason);
  return createLocalServer({
    port: port.port,
    dataDir,
    execPath: process.execPath,
    scriptPath: () => resolveServerCli(),
    probe: probeHealth,
    spawnServer: spawnNodeServer,
    baseEnv: process.env,
  });
}

const NO_STORE = { 'cache-control': 'no-store' };

export function apply(ctx: HostContext, options: ApplyOptions = {}): void {
  const dataDir = options.dataDir ?? resolveDataDir(process.env.BLUEMANTA_DATA_DIR, defaultDataDir);
  const server = options.server ?? defaultServer(dataDir);
  const core = openCore({ dataDir });
  ctx.effect(() => {
    const disposeTools = registerIdeaTools(ctx, core);
    const disposeRoute = ctx.connection.fetch.register({
      path: WEB_CONFIG_PATH,
      methods: ['GET'],
      requestBody: 'buffered',
      fetch: async () => {
        try {
          return Response.json(await loadWebConfig(server, dataDir), { headers: NO_STORE });
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          return Response.json({ ok: false, reason: `本地服务没有启动：${message}` }, { headers: NO_STORE });
        }
      },
    });
    void server.ensure().catch(() => undefined);
    return () => {
      disposeRoute();
      for (const dispose of disposeTools) dispose();
      server.stop();
      core.close();
    };
  }, 'bluemanta: core');
}
