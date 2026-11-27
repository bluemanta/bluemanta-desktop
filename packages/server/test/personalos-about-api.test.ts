import { cpSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openCore, type Core } from '@bluemanta/core';
import { defaultKnowledgeEnv } from '@bluemanta/knowledge';
import { afterEach, describe, expect, it } from 'vitest';
import type { PersonalOsAboutResponse } from '../src/api-types.js';
import { createApp } from '../src/app.js';
import { removeTempDirs, tempDir } from './helpers.js';

const PORT = 4310;
const HOST = `127.0.0.1:${PORT}`;
const TOKEN = '79'.repeat(32);
const BASE = '/api/v1/personalos/about';
const FIXTURE = fileURLToPath(new URL('../../knowledge/fixtures/home/Documents/PersonalOS', import.meta.url));
const cores: Core[] = [];
const apps: ReturnType<typeof createApp>[] = [];
afterEach(() => {
  while (apps.length) apps.pop()?.close();
  while (cores.length) cores.pop()?.close();
  removeTempDirs();
});

function fixture(withLibrary = true) {
  const home = tempDir('bluemanta-about-home-');
  if (withLibrary) cpSync(FIXTURE, join(home, 'Documents', 'PersonalOS'), { recursive: true });
  const core = openCore({ dataDir: tempDir() }); cores.push(core);
  const app = createApp({ core, token: TOKEN, port: PORT, webDir: null, knowledgeEnv: defaultKnowledgeEnv({ home }) }); apps.push(app);
  const call = (options: { token?: string | null; method?: string } = {}) => {
    const token = options.token === undefined ? TOKEN : options.token;
    return app.request(`http://${HOST}${BASE}`, { method: options.method ?? 'GET', headers: { host: HOST, ...(token === null ? {} : { authorization: `Bearer ${token}` }) } });
  };
  return { home, call };
}

describe('关于页接口（规格第 15.4 节）', () => {
  it('返回版本、入口、领域、记录、目录结构，路径不泄露 home', async () => {
    const { call, home } = fixture();
    const response = await call();
    expect(response.status).toBe(200); expect(response.headers.get('cache-control')).toBe('no-store');
    const text = await response.text(); const body = JSON.parse(text) as PersonalOsAboutResponse;
    expect(body).toMatchObject({ ok: true, exists: true, root: '~/Documents/PersonalOS', routerFile: 'AGENTS.md' });
    expect(body.about.current?.version).toBe('v1.2');
    expect(body.entries[0]?.role).toBe('router');
    expect(body.domains.length).toBe(10);
    expect(body.sources.exists).toBe(false);
    expect(body.tree.some((node) => node.name === '领域')).toBe(true);
    expect(text).not.toContain(home);
  });
  it('PersonalOS 不存在时 exists 为 false', async () => {
    const { call, home } = fixture(false);
    rmSync(join(home, 'Documents'), { recursive: true, force: true });
    const body = await (await call()).json() as PersonalOsAboutResponse;
    expect(body).toMatchObject({ ok: true, exists: false, entries: [], domains: [] });
  });
  it('要求口令；不支持的方法 405', async () => {
    const { call } = fixture();
    expect((await call({ token: null })).status).toBe(401);
    expect((await call({ method: 'POST' })).status).toBe(405);
  });
});
