import { spawn, type ChildProcess } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openCore } from '@bluemanta/core';
import { afterEach, describe, expect, it } from 'vitest';
import { freePort, removeTempDirs, tempDir } from './helpers.js';

const cliJs = fileURLToPath(new URL('../dist/cli.js', import.meta.url));
const ideaJs = fileURLToPath(new URL('../../cli/dist/idea.js', import.meta.url));
const repoRoot = fileURLToPath(new URL('../../..', import.meta.url));

type Running = {
  child: ChildProcess;
  stdout: () => string;
  stderr: () => string;
  exited: Promise<number | null>;
};

const children: ChildProcess[] = [];
const servers: Server[] = [];

afterEach(async () => {
  for (const child of children.splice(0)) {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
  }
  await Promise.all(servers.splice(0).map((server) => new Promise((resolve) => server.close(resolve))));
  removeTempDirs();
});

function cleanEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  delete env.BLUEMANTA_DATA_DIR;
  delete env.BLUEMANTA_SERVER_PORT;
  return env;
}

function run(script: string, args: string[], input?: string): Running {
  const child = spawn(process.execPath, [script, ...args], { cwd: repoRoot, env: cleanEnv(), stdio: 'pipe' });
  children.push(child);
  let out = '';
  let err = '';
  child.stdout?.setEncoding('utf8').on('data', (chunk: string) => (out += chunk));
  child.stderr?.setEncoding('utf8').on('data', (chunk: string) => (err += chunk));
  if (input !== undefined) child.stdin?.end(input);
  else child.stdin?.end();
  const exited = new Promise<number | null>((resolve) => child.once('exit', (code) => resolve(code)));
  return { child, stdout: () => out, stderr: () => err, exited };
}

async function waitForStart(server: Running): Promise<void> {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    if (server.stdout().includes('已启动')) return;
    if (server.child.exitCode !== null) break;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`服务没有启动：${server.stdout()} ${server.stderr()}`);
}

async function startServer(dataDir: string, port: number): Promise<Running> {
  const server = run(cliJs, ['start', '--data-dir', dataDir, '--port', String(port)]);
  await waitForStart(server);
  return server;
}

function readToken(dataDir: string): string {
  return (JSON.parse(readFileSync(join(dataDir, 'local-server.json'), 'utf8')) as { token: string }).token;
}

describe('服务进程', () => {
  it('启动、只写一行日志、口令文件 600、SIGTERM 后正常退出', async () => {
    const dataDir = tempDir();
    const port = await freePort();
    const server = await startServer(dataDir, port);
    const token = readToken(dataDir);
    expect(statSync(join(dataDir, 'local-server.json')).mode & 0o777).toBe(0o600);

    const health = await fetch(`http://127.0.0.1:${port}/api/v1/health`);
    expect(await health.json()).toMatchObject({ service: 'bluemanta', apiVersion: 1 });
    const unauthorized = await fetch(`http://127.0.0.1:${port}/api/v1/ideas`);
    expect(unauthorized.status).toBe(401);
    const created = await fetch(`http://127.0.0.1:${port}/api/v1/ideas`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ requestId: 'proc-1', title: '进程测试的虚构灵感', body: '不该出现在日志里的正文' }),
    });
    expect(created.status).toBe(200);
    const listed = await fetch(`http://localhost:${port}/api/v1/ideas`, { headers: { authorization: `Bearer ${token}` } });
    expect(listed.status).toBe(200);

    server.child.kill('SIGTERM');
    expect(await server.exited).toBe(0);
    const lines = server.stdout().trim().split('\n');
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain(`http://127.0.0.1:${port}/`);
    expect(lines[0]).toContain(dataDir);
    const logs = server.stdout() + server.stderr();
    expect(logs).not.toContain(token);
    expect(logs).not.toContain('不该出现在日志里的正文');
    expect(logs).not.toContain('进程测试的虚构灵感');

    const core = openCore({ dataDir });
    try {
      expect(core.listCards({ cardType: 'idea' })).toHaveLength(1);
    } finally {
      core.close();
    }
  });

  it('已在运行时再启动：提示已在运行并以 0 退出', async () => {
    const dataDir = tempDir();
    const port = await freePort();
    await startServer(dataDir, port);
    const second = run(cliJs, ['start', '--data-dir', dataDir, '--port', String(port)]);
    expect(await second.exited).toBe(0);
    expect(second.stdout()).toContain('已在运行');
  });

  it('端口被其他程序占用：报错并以非 0 退出', async () => {
    const port = await freePort();
    const other = createServer((_request, response) => {
      response.writeHead(404).end('not here');
    });
    servers.push(other);
    await new Promise<void>((resolve) => other.listen(port, '127.0.0.1', resolve));
    const server = run(cliJs, ['start', '--data-dir', tempDir(), '--port', String(port)]);
    const code = await server.exited;
    expect(code).not.toBe(0);
    expect(server.stderr()).toContain(`端口 ${port} 被其他程序占用`);
  });

  it('url 打印带口令的地址', async () => {
    const dataDir = tempDir();
    const result = run(cliJs, ['url', '--data-dir', dataDir, '--port', '4999']);
    expect(await result.exited).toBe(0);
    expect(result.stdout().trim()).toBe(`http://127.0.0.1:4999/#token=${readToken(dataDir)}`);
  });

  it('服务经接口写 50 条的同时，另一个进程用 idea.js add 写 50 条，100 条都在', async () => {
    const dataDir = tempDir();
    const port = await freePort();
    const server = await startServer(dataDir, port);
    const token = readToken(dataDir);

    const viaHttp = (async () => {
      const failures: string[] = [];
      for (let index = 0; index < 50; index += 1) {
        const response = await fetch(`http://127.0.0.1:${port}/api/v1/ideas`, {
          method: 'POST',
          headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
          body: JSON.stringify({ requestId: `http-${index}`, title: `接口写入的虚构灵感 ${index}` }),
        });
        if (response.status !== 200) failures.push(`${response.status} ${await response.text()}`);
      }
      return failures;
    })();

    const viaCli = (async () => {
      const failures: string[] = [];
      for (let index = 0; index < 50; index += 1) {
        const child = run(
          ideaJs,
          ['add', '--data-dir', dataDir],
          JSON.stringify({ requestId: `cli-${index}`, title: `命令行写入的虚构灵感 ${index}` }),
        );
        const code = await child.exited;
        if (code !== 0) failures.push(`${code} ${child.stdout()} ${child.stderr()}`);
      }
      return failures;
    })();

    const [httpFailures, cliFailures] = await Promise.all([viaHttp, viaCli]);
    expect(httpFailures).toEqual([]);
    expect(cliFailures).toEqual([]);

    const list = await fetch(`http://127.0.0.1:${port}/api/v1/ideas`, { headers: { authorization: `Bearer ${token}` } });
    const body = (await list.json()) as { count: number; items: Array<{ createdBy: { kind: string } }> };
    expect(body.count).toBe(100);
    expect(body.items.filter((item) => item.createdBy.kind === 'human')).toHaveLength(50);
    expect(body.items.filter((item) => item.createdBy.kind === 'agent')).toHaveLength(50);

    server.child.kill('SIGINT');
    expect(await server.exited).toBe(0);
    expect(server.stderr()).not.toMatch(/SQLITE_BUSY|database is locked/i);
  });
});
