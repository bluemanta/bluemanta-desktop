import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import type { FetchRoute, HostContext, ToolRegistration } from '../src/context.js';
import { resolveDataDir } from '../src/data-dir.js';
import {
  apply,
  IDEA_CAPTURE_TOOL,
  IDEA_GET_TOOL,
  IDEA_SEARCH_TOOL,
  inject,
  name,
  WEB_CONFIG_PATH,
  type LocalServer,
} from '../src/index.js';

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

  it('只注册 web-config，保留三个工具，卸载时停掉自己拉起的服务', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'bluemanta-host-'));
    dirs.push(dir);
    const routes: FetchRoute[] = [];
    const tools: ToolRegistration[] = [];
    const cleanups: Array<() => void> = [];
    const trace: string[] = [];
    const server: LocalServer = {
      async ensure() {
        trace.push('ensure');
        return { ok: false, reason: '本地服务没有启动：端口 4310 被其他程序占用' };
      },
      stop() {
        trace.push('stop');
      },
    };
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
      tools: {
        register(definition) {
          tools.push(definition);
          return () => {
            const index = tools.indexOf(definition);
            if (index >= 0) tools.splice(index, 1);
          };
        },
      },
      effect(enter) {
        const dispose = enter();
        if (typeof dispose === 'function') cleanups.push(dispose);
      },
    };

    try {
      apply(ctx, { dataDir: dir, server });
      expect(name).toBe('bluemanta');
      expect(inject).toEqual(['connection', 'tools']);
      expect(tools.map((tool) => tool.name)).toEqual([IDEA_CAPTURE_TOOL, IDEA_SEARCH_TOOL, IDEA_GET_TOOL]);
      expect(tools.every((tool) => tool.description.includes('不能收藏、追记、删除'))).toBe(true);
      expect(routes.map((route) => ({ path: route.path, method: route.methods[0], body: route.requestBody }))).toEqual([
        { path: WEB_CONFIG_PATH, method: 'GET', body: 'buffered' },
      ]);

      const configFetch = routes[0]?.fetch;
      const config = await configFetch?.(new Request('http://127.0.0.1/api/bluemanta/web-config'));
      expect(config?.status).toBe(200);
      await expect(config?.json()).resolves.toEqual({
        ok: false,
        reason: '本地服务没有启动：端口 4310 被其他程序占用',
      });

      for (const cleanup of cleanups) cleanup();
      cleanups.length = 0;
      expect(routes).toEqual([]);
      expect(tools).toEqual([]);
      expect(trace).toContain('stop');
    } finally {
      for (const cleanup of cleanups) cleanup();
    }
  });
});

describe('包清单与浏览器端', () => {
  it('声明组合包、client 入口和嵌入页', () => {
    const root = fileURLToPath(new URL('..', import.meta.url));
    const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as {
      dsh: { bundle: { patch: string }; client: { platform: string; immediately: boolean; inject: string[] } };
      exports: { '.': { import: string }; './client': string };
      dependencies?: Record<string, string>;
      peerDependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    expect(pkg.peerDependencies?.['@deepseek-ai/dsh-tools']).toBe('0.2.1-rc.2');
    expect(pkg.devDependencies?.['@deepseek-ai/dsh-tools']).toBe('0.2.1-rc.2');
    expect(pkg.dependencies?.['@deepseek-ai/dsh-tools']).toBeUndefined();
    expect(pkg.dsh.bundle.patch).toBe('./cordis.patch.yml');
    expect(pkg.dsh.client).toEqual({
      platform: 'web',
      immediately: true,
      inject: [
        '@deepseek-ai/dsh-client-ui-layout',
        '@deepseek-ai/dsh-client-ui-sidebar',
        '@deepseek-ai/dsh-client-ui-conversation',
        '@deepseek-ai/dsh-client-ui-sidebar-right',
        '@deepseek-ai/dsh-client-ui-tool',
      ],
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
    expect(pkg.dependencies?.['@bluemanta/server']).toBe('file:../server');
    expect(client).toContain("id: PANEL_ID");
    expect(client).toContain("const PANEL_ID = 'bluemanta.ideas'");
    expect(client).toContain("label: '灵感台'");
    expect(client).toContain('api/bluemanta/web-config');
    expect(client).toContain('正在打开灵感台…');
    expect(client).not.toContain('灵感清单');
    expect(client).not.toContain('数据统计');
    expect(client).not.toContain('还没有记下灵感');
    expect(client).not.toContain('function IdeaDetail');
    expect(client).not.toContain('function IdeaCreate');
    expect(client).not.toContain('@deepseek-ai/');
    // 灵感界面继续用 CSS 变量。品牌占位图标必须用固定色，只放行这两个。
    const withoutBrandColors = client.replaceAll('#2A715A', '').replaceAll('#FFFFFF', '');
    expect(withoutBrandColors).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(client).not.toMatch(/rgba?\(/);
  });
});
