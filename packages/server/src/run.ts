import { spawn } from 'node:child_process';
import type { Server } from 'node:http';
import { fileURLToPath } from 'node:url';
import { createAdaptorServer } from '@hono/node-server';
import { cleanupStaleAttachments, openCore, type Core } from '@bluemanta/core';
import { parseArgs, USAGE } from './args.js';
import { runServiceCommand } from './service.js';
import { createApp } from './app.js';
import { loadToken } from './token.js';

export type ServerIo = {
  argv: readonly string[];
  env: NodeJS.ProcessEnv;
  stdout: (line: string) => void;
  stderr: (line: string) => void;
  platform?: NodeJS.Platform;
};

export type RunningServer = {
  port: number;
  close: () => Promise<void>;
};

export type StartOptions = {
  dataDir: string;
  port: number;
  webDir?: string | null;
  stdout: (line: string) => void;
  stderr: (line: string) => void;
};

export type StartOutcome =
  | { status: 'started'; server: RunningServer }
  | { status: 'already_running' }
  | { status: 'port_in_use' };

export const DEFAULT_WEB_DIR = fileURLToPath(new URL('../../web/dist/', import.meta.url));

export function baseUrl(port: number): string {
  return `http://127.0.0.1:${port}/`;
}

export function tokenUrl(port: number, token: string): string {
  return `${baseUrl(port)}#token=${token}`;
}

/** 端口上的程序是不是 bluemanta 本地服务。 */
export async function isBluemantaServer(port: number): Promise<boolean> {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/v1/health`, { signal: AbortSignal.timeout(2000) });
    if (!response.ok) return false;
    const body = (await response.json()) as { service?: unknown };
    return body.service === 'bluemanta';
  } catch {
    return false;
  }
}

function listen(server: Server, port: number): Promise<'listening' | 'in_use'> {
  return new Promise((resolve, reject) => {
    const onError = (error: NodeJS.ErrnoException) => {
      server.off('listening', onListening);
      if (error.code === 'EADDRINUSE') resolve('in_use');
      else reject(error);
    };
    const onListening = () => {
      server.off('error', onError);
      resolve('listening');
    };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(port, '127.0.0.1');
  });
}

/**
 * 先占端口再打开数据库：端口已被占用时不碰数据库，直接判断是不是自己已在运行。
 * 占端口到 core 就绪之间的请求返回 503。
 */
export async function startServer(options: StartOptions): Promise<StartOutcome> {
  const token = loadToken(options.dataDir, options.stderr);
  let handle: ((request: Request) => Response | Promise<Response>) | null = null;
  const server = createAdaptorServer({
    fetch: (request: Request) =>
      handle ? handle(request) : Response.json({ ok: false, code: 'internal', message: '服务正在启动' }, { status: 503 }),
  }) as Server;

  const listened = await listen(server, options.port);
  if (listened === 'in_use') {
    return (await isBluemantaServer(options.port)) ? { status: 'already_running' } : { status: 'port_in_use' };
  }

  let core: Core;
  try {
    core = openCore({ dataDir: options.dataDir });
  } catch (error) {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    throw error;
  }
  const app = createApp({
    core,
    token,
    port: options.port,
    webDir: options.webDir === undefined ? DEFAULT_WEB_DIR : options.webDir,
    logError: options.stderr,
  });
  handle = (request) => app.fetch(request);
  cleanupStaleAttachments(core);
  options.stdout(`bluemanta 本地服务已启动：${baseUrl(options.port)}（数据目录：${options.dataDir}）`);

  let closing: Promise<void> | null = null;
  return {
    status: 'started',
    server: {
      port: options.port,
      close: () => {
        closing ??= new Promise<void>((resolve) => {
          server.close(() => resolve());
          server.closeAllConnections();
        }).then(() => core.close());
        return closing;
      },
    },
  };
}

function openInBrowser(url: string): Promise<number> {
  return new Promise((resolve) => {
    const child = spawn('open', [url], { stdio: 'ignore' });
    child.once('error', () => resolve(1));
    child.once('exit', (code) => resolve(code ?? 1));
  });
}

/** 命令行入口。`start` 成功时返回运行中的服务，其他情况返回退出码。 */
export async function runServerCommand(io: ServerIo): Promise<number | RunningServer> {
  const args = parseArgs(io.argv, io.env);
  if (!args.ok) {
    io.stderr(args.message);
    io.stderr(USAGE);
    return 2;
  }
  if (args.value.command === 'service') {
    return runServiceCommand({
      action: args.value.action,
      explicitDataDir: args.value.explicitDataDir,
      explicitPort: args.value.explicitPort,
      stdout: io.stdout,
      stderr: io.stderr,
      platform: io.platform,
    });
  }
  const { command, dataDir, port } = args.value;

  try {
    if (command === 'start') {
      const outcome = await startServer({ dataDir, port, stdout: io.stdout, stderr: io.stderr });
      if (outcome.status === 'started') return outcome.server;
      if (outcome.status === 'already_running') {
        io.stdout(`bluemanta 本地服务已在运行：${baseUrl(port)}`);
        return 0;
      }
      io.stderr(`端口 ${port} 被其他程序占用`);
      return 1;
    }

    const url = tokenUrl(port, loadToken(dataDir, io.stderr));
    if (command === 'url') {
      io.stdout(url);
      return 0;
    }
    if ((io.platform ?? process.platform) !== 'darwin') {
      io.stderr('open 只支持 macOS；可以用 url 子命令拿到地址后自己打开');
      return 1;
    }
    const code = await openInBrowser(url);
    if (code !== 0) io.stderr('没能打开浏览器');
    return code;
  } catch (error) {
    io.stderr(`bluemanta 本地服务：${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }
}
