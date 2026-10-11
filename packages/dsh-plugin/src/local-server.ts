/**
 * 插件激活时检查本机服务：已是 bluemanta 就复用，否则拉起 `@bluemanta/server`。
 * 只停自己拉起的子进程。探测和拉起都可以注入，单元测试不碰真实端口。
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const DEFAULT_SERVER_PORT = 4310;
export const HEALTH_TIMEOUT_MS = 10_000;
export const WEB_CONFIG_PATH = '/api/bluemanta/web-config';
export const TOKEN_FILE = 'local-server.json';

export type HealthState = 'bluemanta' | 'other' | 'down';

export type EnsureResult =
  | { ok: true; baseUrl: string; owned: boolean }
  | { ok: false; reason: string };

export type WebConfig =
  | { ok: true; baseUrl: string; token: string }
  | { ok: false; reason: string };

export function occupiedReason(port: number): string {
  return `本地服务没有启动：端口 ${port} 被其他程序占用`;
}

export function resolveServerPort(envValue: string | undefined): { ok: true; port: number } | { ok: false; reason: string } {
  const trimmed = envValue?.trim() ?? '';
  if (trimmed === '') return { ok: true, port: DEFAULT_SERVER_PORT };
  if (!/^\d+$/.test(trimmed)) return { ok: false, reason: 'BLUEMANTA_SERVER_PORT 需要是 1 到 65535 的整数' };
  const port = Number(trimmed);
  if (port < 1 || port > 65535) return { ok: false, reason: 'BLUEMANTA_SERVER_PORT 需要是 1 到 65535 的整数' };
  return { ok: true, port };
}

function pathFromResolved(resolved: string): string {
  return resolved.startsWith('file:') ? fileURLToPath(resolved) : resolved;
}

/**
 * 经包解析找到 `dist/cli.js`，不写死仓库路径。
 * 服务包的 `exports` 没有 `./package.json`，只能解析入口 `dist/index.js`，再取同目录的 `cli.js`。
 */
export function resolveServerCli(resolvePkg: (id: string) => string = (id) => import.meta.resolve(id)): string {
  return join(dirname(pathFromResolved(resolvePkg('@bluemanta/server'))), 'cli.js');
}

export type Probe = (port: number) => Promise<HealthState>;

export type ServerChild = {
  kill(signal?: NodeJS.Signals): boolean;
  on(event: string, listener: (...args: unknown[]) => void): unknown;
};

export type SpawnServer = (options: {
  execPath: string;
  args: readonly string[];
  env: NodeJS.ProcessEnv;
}) => ServerChild;

export type LocalServer = {
  ensure(): Promise<EnsureResult>;
  stop(): void;
};

export type LocalServerOptions = {
  port: number;
  dataDir: string;
  execPath: string;
  /** 字符串，或拉起前才调用的解析函数。已有服务时不会调用。 */
  scriptPath: string | (() => string);
  probe: Probe;
  spawnServer: SpawnServer;
  baseEnv?: NodeJS.ProcessEnv;
  log?: (line: string) => void;
  timeoutMs?: number;
  pollMs?: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
};

export function createLocalServer(options: LocalServerOptions): LocalServer {
  const log = options.log ?? ((line: string) => console.error(line));
  const timeoutMs = options.timeoutMs ?? HEALTH_TIMEOUT_MS;
  const pollMs = options.pollMs ?? 200;
  const now = options.now ?? (() => Date.now());
  const sleep = options.sleep ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));
  const baseUrl = `http://127.0.0.1:${options.port}`;
  let child: ServerChild | null = null;
  let owned = false;
  let stopping = false;
  let inflight: Promise<EnsureResult> | null = null;

  function forget(next: ServerChild, code: number | null, signal: NodeJS.Signals | null): void {
    if (child !== next) return;
    child = null;
    owned = false;
    if (!stopping) log(`本地服务进程已退出（${signal ?? code ?? '未知'}）`);
  }

  function track(next: ServerChild): void {
    child = next;
    owned = true;
    let settled = false;
    const finish = (code: number | null, signal: NodeJS.Signals | null) => {
      if (settled) return;
      settled = true;
      forget(next, code, signal);
    };
    next.on('exit', (code, signal) => finish(code as number | null, signal as NodeJS.Signals | null));
    next.on('error', () => finish(null, null));
  }

  async function waitUntilHealthy(started: ServerChild): Promise<EnsureResult> {
    const deadline = now() + timeoutMs;
    while (now() < deadline) {
      if (stopping) return { ok: false, reason: '插件已停用' };
      if (child !== started) {
        const state = await options.probe(options.port);
        if (state === 'bluemanta') return { ok: true, baseUrl, owned: false };
        if (state === 'other') return { ok: false, reason: occupiedReason(options.port) };
        return { ok: false, reason: '本地服务没有启动：进程已退出' };
      }
      const state = await options.probe(options.port);
      if (state === 'bluemanta') return { ok: true, baseUrl, owned: true };
      // 子进程还活着时，503 或还没听上端口都算正在启动，不当成别人占用。
      await sleep(pollMs);
    }
    if (child === started) {
      child = null;
      owned = false;
      try {
        started.kill('SIGTERM');
      } catch {
        // 进程已经不在。
      }
    }
    return { ok: false, reason: '本地服务没有启动：等待健康检查超时' };
  }

  async function ensureOnce(): Promise<EnsureResult> {
    if (stopping) return { ok: false, reason: '插件已停用' };
    const state = await options.probe(options.port);
    if (state === 'bluemanta') return { ok: true, baseUrl, owned };
    if (state === 'other') return { ok: false, reason: occupiedReason(options.port) };
    if (child) return waitUntilHealthy(child);
    let started: ServerChild;
    try {
      const scriptPath = typeof options.scriptPath === 'function' ? options.scriptPath() : options.scriptPath;
      started = options.spawnServer({
        execPath: options.execPath,
        args: [scriptPath, 'start'],
        env: {
          ...options.baseEnv,
          ELECTRON_RUN_AS_NODE: '1',
          BLUEMANTA_DATA_DIR: options.dataDir,
          BLUEMANTA_SERVER_PORT: String(options.port),
        },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { ok: false, reason: `本地服务没有启动：${message}` };
    }
    track(started);
    if (stopping) {
      try {
        started.kill('SIGTERM');
      } catch {
        // 进程已经不在。
      }
      return { ok: false, reason: '插件已停用' };
    }
    return waitUntilHealthy(started);
  }

  return {
    ensure() {
      inflight ??= ensureOnce().finally(() => {
        inflight = null;
      });
      return inflight;
    },
    stop() {
      stopping = true;
      const current = child;
      const wasOwned = owned;
      child = null;
      owned = false;
      if (wasOwned && current) {
        try {
          current.kill('SIGTERM');
        } catch {
          // 进程已经不在。
        }
      }
    },
  };
}

export function spawnNodeServer(options: { execPath: string; args: readonly string[]; env: NodeJS.ProcessEnv }): ChildProcess {
  return spawn(options.execPath, [...options.args], {
    env: options.env,
    stdio: 'ignore',
    windowsHide: true,
  });
}

/** `GET /api/v1/health`：bluemanta 服务、别的程序、或没人在听。 */
export async function probeHealth(port: number, fetchImpl: typeof fetch = globalThis.fetch): Promise<HealthState> {
  try {
    const response = await fetchImpl(`http://127.0.0.1:${port}/api/v1/health`, {
      signal: AbortSignal.timeout(2000),
    });
    if (!response.ok) return 'other';
    let body: { service?: unknown };
    try {
      body = (await response.json()) as { service?: unknown };
    } catch {
      return 'other';
    }
    return body.service === 'bluemanta' ? 'bluemanta' : 'other';
  } catch {
    return 'down';
  }
}

export function readServerToken(dataDir: string): { ok: true; token: string } | { ok: false; reason: string } {
  try {
    const raw = readFileSync(join(dataDir, TOKEN_FILE), 'utf8');
    const token = (JSON.parse(raw) as { token?: unknown }).token;
    if (typeof token !== 'string' || !/^[0-9a-f]{64}$/.test(token)) return { ok: false, reason: '本地服务口令无效' };
    return { ok: true, token };
  } catch {
    return { ok: false, reason: '读不到本地服务口令' };
  }
}

export async function loadWebConfig(server: LocalServer, dataDir: string): Promise<WebConfig> {
  const ensured = await server.ensure();
  if (!ensured.ok) return { ok: false, reason: ensured.reason };
  const token = readServerToken(dataDir);
  if (!token.ok) return token;
  return { ok: true, baseUrl: ensured.baseUrl, token: token.token };
}

export function failingServer(reason: string): LocalServer {
  return {
    ensure: () => Promise.resolve({ ok: false, reason }),
    stop() {},
  };
}
