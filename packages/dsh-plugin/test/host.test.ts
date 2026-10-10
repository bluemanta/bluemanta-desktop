import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import type { FetchRoute, HostContext } from '../src/context.js';
import { resolveDataDir } from '../src/data-dir.js';
import { ATTACHMENT_PATH, ATTACHMENTS_PATH } from '../src/uploads.js';
import { COMMANDS_PATH } from '../src/commands.js';
import { apply, CARDS_PATH, HEALTH_PATH, inject, name } from '../src/index.js';

describe('数据目录', () => {
  it('空白环境变量回退到默认目录，其它值原样使用去掉首尾空白后的路径', () => {
    expect(resolveDataDir(undefined, () => '/fallback')).toBe('/fallback');
    expect(resolveDataDir('   ', () => '/fallback')).toBe('/fallback');
    expect(resolveDataDir('  /tmp/bluemanta  ', () => '/fallback')).toBe('/tmp/bluemanta');
  });
});

describe('宿主插件', () => {
  const dirs: string[] = [];

  afterEach(() => {
    while (dirs.length > 0) {
      const dir = dirs.pop();
      if (dir) rmSync(dir, { recursive: true, force: true });
    }
  });

  it('注册读取、命令和附件路由，卸载时关闭数据库', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'bluemanta-host-'));
    dirs.push(dir);
    const previous = process.env.BLUEMANTA_DATA_DIR;
    process.env.BLUEMANTA_DATA_DIR = dir;
    const routes: FetchRoute[] = [];
    const cleanups: Array<() => void> = [];
    const ctx: HostContext = {
      connection: {
        fetch: {
          register(route) {
            routes.push(route);
            return () => {
              const index = routes.indexOf(route);
              if (index >= 0) routes.splice(index, 1);
            };
          },
        },
      },
      effect(enter) {
        const dispose = enter();
        if (typeof dispose === 'function') cleanups.push(dispose);
      },
    };

    try {
      apply(ctx);
      expect(name).toBe('bluemanta');
      expect(inject).toEqual(['connection']);
      expect(routes.map((route) => ({ path: route.path, method: route.methods[0], body: route.requestBody }))).toEqual([
        { path: HEALTH_PATH, method: 'GET', body: 'buffered' },
        { path: CARDS_PATH, method: 'GET', body: 'buffered' },
        { path: COMMANDS_PATH, method: 'POST', body: 'buffered' },
        { path: ATTACHMENTS_PATH, method: 'POST', body: 'streaming' },
        { path: ATTACHMENT_PATH, method: 'GET', body: 'buffered' },
      ]);

      const healthFetch = routes[0]?.fetch;
      expect(healthFetch).toBeTypeOf('function');
      const health = await healthFetch?.(new Request('http://127.0.0.1/api/bluemanta/health'));
      expect(health?.status).toBe(200);
      await expect(health?.json()).resolves.toMatchObject({
        dataDir: dir,
        counts: { projects: 0, tasks: 0, cards: 0 },
      });

      for (const cleanup of cleanups) cleanup();
      cleanups.length = 0;
      expect(routes).toEqual([]);
      const closed = await healthFetch?.(new Request('http://127.0.0.1/api/bluemanta/health'));
      expect(closed?.status).toBe(500);
    } finally {
      for (const cleanup of cleanups) cleanup();
      if (previous === undefined) delete process.env.BLUEMANTA_DATA_DIR;
      else process.env.BLUEMANTA_DATA_DIR = previous;
    }
  });
});

describe('包清单与浏览器端', () => {
  it('声明组合包、client 入口和灵感清单页面', () => {
    const root = fileURLToPath(new URL('..', import.meta.url));
    const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as {
      dsh: { bundle: { patch: string }; client: { platform: string; immediately: boolean; inject: string[] } };
      exports: { '.': { import: string }; './client': string };
    };
    expect(pkg.dsh.bundle.patch).toBe('./cordis.patch.yml');
    expect(pkg.dsh.client).toEqual({
      platform: 'web',
      immediately: true,
      inject: ['@deepseek-ai/dsh-client-ui-layout', '@deepseek-ai/dsh-client-ui-sidebar'],
    });
    expect(pkg.exports['./client']).toBe('./client.js');
    expect(pkg.exports['.'].import).toBe('./dist/index.js');

    const patch = readFileSync(join(root, 'cordis.patch.yml'), 'utf8');
    expect(patch).toContain('id: bluemanta');
    expect(patch).toContain("name: '@bluemanta/dsh-plugin'");

    const client = readFileSync(join(root, 'client.js'), 'utf8');
    expect(client).toContain("window.__ModuleLoader__.load");
    expect(client).toContain("id: '@bluemanta/dsh-plugin'");
    expect(client).toContain("require('react')");
    expect(client).toContain("id: PANEL_ID");
    expect(client).toContain("const PANEL_ID = 'bluemanta.ideas'");
    expect(client).toContain("fetch(CARDS_ROUTE)");
    expect(client).toContain("const CARDS_ROUTE = 'api/bluemanta/cards?cardType=idea'");
    expect(client).toContain("label: '灵感台'");
    expect(client).toContain('还没有记下灵感');
    expect(client).toContain('灵感清单');
    expect(client).toContain('数据统计');
    expect(client).toContain('回收站');
    expect(client).toContain('api/bluemanta/commands');
    expect(client).toContain('api/bluemanta/attachment?id=');
    expect(client).not.toContain('@deepseek-ai/');
    expect(client).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(client).not.toMatch(/rgba?\(/);
  });
});
