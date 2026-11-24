import { cpSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openCore, type Core } from '@bluemanta/core';
import { defaultKnowledgeEnv } from '@bluemanta/knowledge';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ApiFailure, PersonalOsSourcesResponse, PersonalOsTaskLogResponse } from '../src/api-types.js';
import { createApp } from '../src/app.js';
import { removeTempDirs, tempDir } from './helpers.js';

const PORT = 4310;
const HOST = `127.0.0.1:${PORT}`;
const TOKEN = '78'.repeat(32);
const BASE = '/api/v1/personalos/sources';
const FIXTURE = fileURLToPath(new URL('../../knowledge/fixtures/sources', import.meta.url));
const cores: Core[] = [];
const apps: ReturnType<typeof createApp>[] = [];

afterEach(() => {
  vi.unstubAllEnvs();
  while (apps.length) apps.pop()?.close();
  while (cores.length) cores.pop()?.close();
  removeTempDirs();
});

/** The SourcesReader reads its env overrides when the app is created, so stub them first. */
function fixture() {
  const home = tempDir('bluemanta-sources-home-');
  cpSync(join(FIXTURE, 'home'), home, { recursive: true });
  vi.stubEnv('BLUEMANTA_LAUNCHCTL_LIST_FILE', join(FIXTURE, 'launchctl-list.txt'));
  const core = openCore({ dataDir: tempDir() }); cores.push(core);
  const app = createApp({ core, token: TOKEN, port: PORT, webDir: null, knowledgeEnv: defaultKnowledgeEnv({ home }) }); apps.push(app);
  const call = (path: string, options: { token?: string | null; host?: string; method?: string } = {}) => {
    const token = options.token === undefined ? TOKEN : options.token;
    return app.request(`http://${HOST}${path}`, { method: options.method ?? 'GET', headers: { host: options.host ?? HOST, ...(token === null ? {} : { authorization: `Bearer ${token}` }) } });
  };
  return { home, call };
}
const log = (ref: string): string => `${BASE}/tasks/${encodeURIComponent(ref)}/log`;
async function expectFailure(response: Response, status: number, code: ApiFailure['code']): Promise<void> {
  expect(response.status).toBe(status);
  expect(response.headers.get('cache-control')).toBe('no-store');
  expect(await response.json()).toMatchObject({ ok: false, code, message: expect.any(String) });
}

describe('接入页接口（规格 personalos-sources 第 4 节）', () => {
  it('要求口令和本机 Host', async () => {
    const { call } = fixture();
    for (const path of [BASE, log('launchd:local.example.mirror-refresh')]) {
      await expectFailure(await call(path, { token: null }), 401, 'unauthorized');
      await expectFailure(await call(path, { host: 'evil.example:4310' }), 403, 'forbidden_host');
    }
  });
  it('汇总：三组任务、来源、计数，路径缩写成 ~，不泄露 home 和提示词', async () => {
    const { call, home } = fixture();
    const response = await call(BASE);
    expect(response.status).toBe(200); expect(response.headers.get('cache-control')).toBe('no-store');
    const text = await response.text(); const body = JSON.parse(text) as PersonalOsSourcesResponse;
    expect(body.ok).toBe(true);
    expect(body.registry.exists).toBe(true);
    expect(body.sources.map((source) => source.name)).toEqual(['示例聊天', '示例笔记', '示例社区', '示例书签', '示例推送']);
    expect(body.summary.unregistered).toBe(4);
    expect(body.services.map((task) => task.ref)).toEqual(['launchd:local.example.service']);
    expect(body.tasks.find((task) => task.ref === 'launchd:local.example.weekly')?.state).toBe('signaled');
    expect(text).not.toContain(home);
    expect(text).not.toContain('提示词');
    expect(text).toContain('~/Library/LaunchAgents/local.example.mirror-refresh.plist');
  });
  it('日志：可显示的返回最后 20 行，其他 403，非法标识 400', async () => {
    const { call } = fixture();
    const ok = await call(log('launchd:local.example.mirror-refresh'));
    expect(ok.status).toBe(200);
    expect(await ok.json()).toMatchObject({ ok: true, ref: 'launchd:local.example.mirror-refresh', path: '~/vault/logs/refresh.log', lines: expect.arrayContaining(['2026-11-24T08:05:02 成功']) } satisfies Partial<PersonalOsTaskLogResponse>);
    await expectFailure(await call(log('launchd:local.example.weekly')), 403, 'forbidden');
    await expectFailure(await call(log('launchd:com.apple.example-checkin')), 403, 'forbidden');
    await expectFailure(await call(`${BASE}/tasks/${encodeURIComponent('../../etc')}/log`), 400, 'invalid_input');
    await expectFailure(await call(`${BASE}/tasks/%E0%A4%A/log`), 400, 'invalid_input');
  });
  it('只允许 GET', async () => {
    const { call } = fixture();
    await expectFailure(await call(BASE, { method: 'POST' }), 405, 'method_not_allowed');
    await expectFailure(await call(log('launchd:local.example.mirror-refresh'), { method: 'DELETE' }), 405, 'method_not_allowed');
  });
});
