import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import {
  createLocalServer,
  loadWebConfig,
  occupiedReason,
  probeHealth,
  readServerToken,
  resolveServerCli,
  resolveServerPort,
  type HealthState,
  type ServerChild,
} from '../src/local-server.js';

const TOKEN = 'a'.repeat(64);

function clocked() {
  let time = 0;
  return {
    now: () => time,
    sleep: async (ms: number) => {
      time += ms;
    },
  };
}

function fakeChild() {
  const listeners = new Map<string, Array<(...args: unknown[]) => void>>();
  const kills: string[] = [];
  const child: ServerChild = {
    kill(signal) {
      kills.push(signal ?? '');
      return true;
    },
    on(event, listener) {
      const list = listeners.get(event) ?? [];
      list.push(listener);
      listeners.set(event, list);
      return child;
    },
  };
  return {
    child,
    kills,
    emit(event: string, ...args: unknown[]) {
      for (const listener of listeners.get(event) ?? []) listener(...args);
    },
  };
}

function sequence(states: HealthState[]): () => Promise<HealthState> {
  let index = 0;
  return async () => states[Math.min(index++, states.length - 1)] ?? 'down';
}

describe('端口与 cli 路径', () => {
  it('空白用 4310，非法端口给出原因', () => {
    expect(resolveServerPort(undefined)).toEqual({ ok: true, port: 4310 });
    expect(resolveServerPort('  ')).toEqual({ ok: true, port: 4310 });
    expect(resolveServerPort('4311')).toEqual({ ok: true, port: 4311 });
    expect(resolveServerPort('0').ok).toBe(false);
    expect(resolveServerPort('65536').ok).toBe(false);
    expect(resolveServerPort('abc').ok).toBe(false);
  });

  it('cli 路径来自包入口，不写死仓库目录', () => {
    const seen: string[] = [];
    const path = resolveServerCli((id) => {
      seen.push(id);
      return 'file:///virtual/node_modules/@bluemanta/server/dist/index.js';
    });
    expect(seen).toEqual(['@bluemanta/server']);
    expect(path).toBe('/virtual/node_modules/@bluemanta/server/dist/cli.js');
  });

  it('真实解析出的 cli 存在', () => {
    // vitest 会换掉 import.meta.resolve。dsh 加载的是构建产物，这里用 Node 直接跑它，不注入解析函数。
    const entry = pathToFileURL(fileURLToPath(new URL('../dist/local-server.js', import.meta.url))).href;
    const output = execFileSync(
      process.execPath,
      [
        '--input-type=module',
        '-e',
        `import { existsSync } from 'node:fs'; import { resolveServerCli } from ${JSON.stringify(entry)}; const path = resolveServerCli(); if (!existsSync(path)) { console.error(path); process.exit(1); } console.log(path);`,
      ],
      { encoding: 'utf8' },
    );
    expect(output.trim()).toMatch(/[/\\]cli\.js$/);
  });
});

describe('拉起与停止', () => {
  it('已经是 bluemanta 服务时不拉起，停止时也不发信号', async () => {
    const spawned: unknown[] = [];
    const server = createLocalServer({
      port: 4310,
      dataDir: '/tmp/data',
      execPath: '/usr/bin/node',
      scriptPath: '/virtual/cli.js',
      probe: async () => 'bluemanta',
      spawnServer: (options) => {
        spawned.push(options);
        throw new Error('不应拉起');
      },
    });
    await expect(server.ensure()).resolves.toEqual({ ok: true, baseUrl: 'http://127.0.0.1:4310', owned: false });
    server.stop();
    expect(spawned).toEqual([]);
  });

  it('已经是 bluemanta 时不解析 cli，解析失败也不挡住复用', async () => {
    let resolved = 0;
    const server = createLocalServer({
      port: 4310,
      dataDir: '/tmp/data',
      execPath: '/usr/bin/node',
      scriptPath: () => {
        resolved += 1;
        throw new Error('Package subpath');
      },
      probe: async () => 'bluemanta',
      spawnServer: () => {
        throw new Error('不应拉起');
      },
    });
    await expect(server.ensure()).resolves.toEqual({ ok: true, baseUrl: 'http://127.0.0.1:4310', owned: false });
    expect(resolved).toBe(0);
  });

  it('需要拉起时路径解析失败，不调用拉起函数', async () => {
    let spawned = 0;
    const server = createLocalServer({
      port: 4310,
      dataDir: '/tmp/data',
      execPath: '/usr/bin/node',
      scriptPath: () => {
        throw new Error("Package subpath './package.json' is not defined by \"exports\"");
      },
      probe: async () => 'down',
      spawnServer: () => {
        spawned += 1;
        throw new Error('不应拉起');
      },
    });
    await expect(server.ensure()).resolves.toEqual({
      ok: false,
      reason: "本地服务没有启动：Package subpath './package.json' is not defined by \"exports\"",
    });
    expect(spawned).toBe(0);
  });

  it('没在跑时拉起，环境变量带上 ELECTRON_RUN_AS_NODE，只停自己拉起的', async () => {
    const time = clocked();
    const proc = fakeChild();
    const spawned: Array<{ execPath: string; args: readonly string[]; env: NodeJS.ProcessEnv }> = [];
    const server = createLocalServer({
      port: 4311,
      dataDir: '/tmp/bm-data',
      execPath: '/electron',
      scriptPath: '/pkg/dist/cli.js',
      baseEnv: { PATH: '/usr/bin' },
      probe: sequence(['down', 'down', 'bluemanta']),
      spawnServer: (options) => {
        spawned.push(options);
        return proc.child;
      },
      timeoutMs: 1_000,
      pollMs: 100,
      ...time,
    });
    await expect(server.ensure()).resolves.toEqual({ ok: true, baseUrl: 'http://127.0.0.1:4311', owned: true });
    expect(spawned).toEqual([
      {
        execPath: '/electron',
        args: ['/pkg/dist/cli.js', 'start'],
        env: {
          PATH: '/usr/bin',
          ELECTRON_RUN_AS_NODE: '1',
          BLUEMANTA_DATA_DIR: '/tmp/bm-data',
          BLUEMANTA_SERVER_PORT: '4311',
        },
      },
    ]);
    server.stop();
    expect(proc.kills).toEqual(['SIGTERM']);
  });

  it('端口被别的程序占用时不拉起，原因写明端口', async () => {
    let spawned = 0;
    const server = createLocalServer({
      port: 4310,
      dataDir: '/tmp/data',
      execPath: '/usr/bin/node',
      scriptPath: '/virtual/cli.js',
      probe: async () => 'other',
      spawnServer: () => {
        spawned += 1;
        throw new Error('不应拉起');
      },
    });
    await expect(server.ensure()).resolves.toEqual({ ok: false, reason: occupiedReason(4310) });
    expect(occupiedReason(4310)).toBe('本地服务没有启动：端口 4310 被其他程序占用');
    expect(spawned).toBe(0);
    server.stop();
  });

  it('子进程退出后记下日志，下次检查会重新拉起', async () => {
    const time = clocked();
    const logs: string[] = [];
    const first = fakeChild();
    const second = fakeChild();
    const children = [first, second];
    let calls = 0;
    const probes: HealthState[] = ['down', 'bluemanta', 'down', 'bluemanta'];
    const server = createLocalServer({
      port: 4310,
      dataDir: '/tmp/data',
      execPath: '/usr/bin/node',
      scriptPath: '/virtual/cli.js',
      probe: async () => probes.shift() ?? 'bluemanta',
      spawnServer: () => {
        const next = children[calls];
        calls += 1;
        if (!next) throw new Error('多拉了一次');
        return next.child;
      },
      log: (line) => logs.push(line),
      timeoutMs: 1_000,
      pollMs: 100,
      ...time,
    });
    await expect(server.ensure()).resolves.toMatchObject({ ok: true, owned: true });
    first.emit('exit', 1, null);
    expect(logs).toEqual(['本地服务进程已退出（1）']);
    await expect(server.ensure()).resolves.toMatchObject({ ok: true, owned: true });
    expect(calls).toBe(2);
    server.stop();
    expect(second.kills).toEqual(['SIGTERM']);
    expect(first.kills).toEqual([]);
  });

  it('拉起后进程马上退出，报进程已退出', async () => {
    const time = clocked();
    const proc = fakeChild();
    const server = createLocalServer({
      port: 4310,
      dataDir: '/tmp/data',
      execPath: '/usr/bin/node',
      scriptPath: '/virtual/cli.js',
      probe: async () => 'down',
      spawnServer: () => {
        queueMicrotask(() => proc.emit('exit', 1, null));
        return proc.child;
      },
      timeoutMs: 500,
      pollMs: 100,
      ...time,
    });
    const pending = server.ensure();
    await Promise.resolve();
    await expect(pending).resolves.toEqual({ ok: false, reason: '本地服务没有启动：进程已退出' });
  });

  it('健康检查超时后停掉自己拉起的进程', async () => {
    const time = clocked();
    const proc = fakeChild();
    const server = createLocalServer({
      port: 4310,
      dataDir: '/tmp/data',
      execPath: '/usr/bin/node',
      scriptPath: '/virtual/cli.js',
      probe: async () => 'down',
      spawnServer: () => proc.child,
      timeoutMs: 300,
      pollMs: 100,
      ...time,
    });
    await expect(server.ensure()).resolves.toEqual({ ok: false, reason: '本地服务没有启动：等待健康检查超时' });
    expect(proc.kills).toEqual(['SIGTERM']);
  });

  it('拉起函数抛错时返回原因，不向外抛', async () => {
    const server = createLocalServer({
      port: 4310,
      dataDir: '/tmp/data',
      execPath: '/usr/bin/node',
      scriptPath: '/virtual/cli.js',
      probe: async () => 'down',
      spawnServer: () => {
        throw new Error('ENOENT');
      },
    });
    await expect(server.ensure()).resolves.toEqual({ ok: false, reason: '本地服务没有启动：ENOENT' });
  });
});

describe('web-config', () => {
  const dirs: string[] = [];
  afterEach(() => {
    while (dirs.length > 0) {
      const dir = dirs.pop();
      if (dir) rmSync(dir, { recursive: true, force: true });
    }
  });

  it('服务可用时返回地址和口令，失败时只返回原因', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'bluemanta-token-'));
    dirs.push(dir);
    writeFileSync(join(dir, 'local-server.json'), `${JSON.stringify({ token: TOKEN })}\n`);
    const up = { ensure: async () => ({ ok: true as const, baseUrl: 'http://127.0.0.1:4310', owned: false }), stop() {} };
    await expect(loadWebConfig(up, dir)).resolves.toEqual({
      ok: true,
      baseUrl: 'http://127.0.0.1:4310',
      token: TOKEN,
    });
    const down = { ensure: async () => ({ ok: false as const, reason: occupiedReason(4310) }), stop() {} };
    await expect(loadWebConfig(down, dir)).resolves.toEqual({ ok: false, reason: occupiedReason(4310) });
  });

  it('口令文件缺失或内容不对', () => {
    const dir = mkdtempSync(join(tmpdir(), 'bluemanta-token-'));
    dirs.push(dir);
    expect(readServerToken(dir)).toEqual({ ok: false, reason: '读不到本地服务口令' });
    writeFileSync(join(dir, 'local-server.json'), '{}\n');
    expect(readServerToken(dir)).toEqual({ ok: false, reason: '本地服务口令无效' });
  });
});

describe('健康检查探测', () => {
  it('按响应区分 bluemanta、其他程序和没人在听', async () => {
    const fetchOf = (body: unknown, ok = true) =>
      (async () => ({
        ok,
        json: async () => body,
      })) as unknown as typeof fetch;
    await expect(probeHealth(1, fetchOf({ service: 'bluemanta' }))).resolves.toBe('bluemanta');
    await expect(probeHealth(1, fetchOf({ service: 'other' }))).resolves.toBe('other');
    await expect(probeHealth(1, fetchOf(null, false))).resolves.toBe('other');
    await expect(probeHealth(1, (async () => {
      throw new Error('ECONNREFUSED');
    }) as unknown as typeof fetch)).resolves.toBe('down');
  });
});
