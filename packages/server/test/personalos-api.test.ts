import { chmodSync, cpSync, mkdirSync, readFileSync, realpathSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openCore, type Core } from '@bluemanta/core';
import { defaultKnowledgeEnv, KnowledgeError, PersonalOsReader, type KnowledgeEnv } from '@bluemanta/knowledge';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  ApiFailure,
  PersonalOsDomainResponse,
  PersonalOsFileResponse,
  PersonalOsLogResponse,
  PersonalOsOverviewResponse,
  PersonalOsRegistryResponse,
  PersonalOsTodayResponse,
} from '../src/api-types.js';
import { createApp } from '../src/app.js';
import { removeTempDirs, tempDir } from './helpers.js';

const PORT = 4310;
const HOST = `127.0.0.1:${PORT}`;
const TOKEN = '56'.repeat(32);
const BASE = '/api/v1/personalos';
const FIXTURE_HOME = fileURLToPath(new URL('../../knowledge/fixtures/home', import.meta.url));
const FIXTURE_ROOT = join(FIXTURE_HOME, 'Documents', 'PersonalOS');
const cores: Core[] = [];

beforeEach(() => vi.stubEnv('BLUEMANTA_TODAY', '2026-11-21'));
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  while (cores.length) cores.pop()?.close();
  removeTempDirs();
});

function enc(path: string): string {
  return path.split('/').map(encodeURIComponent).join('/');
}

const SIX_PATHS = [BASE, `${BASE}/today`, `${BASE}/domains/${enc('工作')}`, `${BASE}/registry`, `${BASE}/log`, `${BASE}/files/${enc('我/状态.md')}`];

function fixture(env: KnowledgeEnv | null = defaultKnowledgeEnv({ home: FIXTURE_HOME })) {
  const core = openCore({ dataDir: tempDir() });
  cores.push(core);
  const app = createApp({ core, token: TOKEN, port: PORT, webDir: null, ...(env ? { knowledgeEnv: env } : {}) });
  return {
    call: async (path: string, options: { token?: string | null; host?: string; method?: string } = {}) => {
      const token = options.token === undefined ? TOKEN : options.token;
      return app.request(`http://${HOST}${path}`, {
        method: options.method ?? 'GET',
        headers: { host: options.host ?? HOST, ...(token === null ? {} : { authorization: `Bearer ${token}` }) },
      });
    },
  };
}

function copiedFixture() {
  const home = tempDir('bluemanta-personalos-home-');
  const root = join(home, 'Documents', 'PersonalOS');
  cpSync(FIXTURE_ROOT, root, { recursive: true });
  return { home, root, ...fixture(defaultKnowledgeEnv({ home })) };
}

async function json<T>(response: Response): Promise<T> {
  return (await response.json()) as T;
}

async function expectFailure(response: Response, status: number, code: ApiFailure['code']): Promise<void> {
  expect(response.status).toBe(status);
  expect(response.headers.get('cache-control')).toBe('no-store');
  expect(await json<ApiFailure>(response)).toMatchObject({ ok: false, code, message: expect.any(String) });
}

describe('PersonalOS 只读接口', () => {
  it('六个入口都要求本机口令，无口令或错误口令返回 401', async () => {
    const { call } = fixture();
    for (const path of SIX_PATHS) {
      await expectFailure(await call(path, { token: null }), 401, 'unauthorized');
      await expectFailure(await call(path, { token: 'invalid-token' }), 401, 'unauthorized');
    }
  });

  it('六个入口复用 Host 校验，允许同端口 localhost', async () => {
    const { call } = fixture();
    for (const path of SIX_PATHS) {
      await expectFailure(await call(path, { host: 'evil.example:4310' }), 403, 'forbidden_host');
      await expectFailure(await call(path, { host: '127.0.0.1:4311' }), 403, 'forbidden_host');
    }
    expect((await call(BASE, { host: 'localhost:4310' })).status).toBe(200);
  });

  it('六接口成功响应都是 no-store，且不暴露 fixture home 绝对路径', async () => {
    const { call } = fixture();
    for (const path of SIX_PATHS) {
      const response = await call(path);
      expect(response.status, path).toBe(200);
      expect(response.headers.get('cache-control'), path).toBe('no-store');
      const body = await json<{ ok: boolean }>(response);
      expect(body.ok, path).toBe(true);
      expect(JSON.stringify(body), path).not.toContain(FIXTURE_HOME);
    }
  });

  it('概览返回 9 个登记领域和未登记园艺，财务目录缺失但其他领域可读', async () => {
    const body = await json<PersonalOsOverviewResponse>(await fixture().call(BASE));
    expect(body).toMatchObject({ ok: true, root: '~/Documents/PersonalOS', exists: true, today: '2026-11-21', inbox: 3 });
    expect(body.about).toContain('林舟');
    expect(body.focus).toHaveLength(3);
    expect(body.domains.map((domain) => domain.id)).toEqual(['我', '工作', '副业', '写作', '技术', '家庭', '健康', '财务', '生活事务', '园艺']);
    expect(body.domains.find((domain) => domain.id === '工作')).toMatchObject({ path: '领域/工作', registered: true, exists: true, updatedAt: '2026-11-01', stale: true, staleDays: 20, openCount: 3, overdueCount: 2 });
    expect(body.domains.find((domain) => domain.id === '财务')).toMatchObject({ registered: true, exists: false, availability: 'missing' });
    expect(body.domains.find((domain) => domain.id === '园艺')).toMatchObject({ registered: false, exists: true, updatedAt: null, stale: true });
    expect(body.warnings).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'invalid_due', file: '领域/写作/状态.md' })]));
    expect(body.documents.map((document) => document.path)).toEqual(expect.arrayContaining(['AGENTS.md', '协议/阅读.md', '蓝图/目录说明.md']));
    expect(body.documents.some((document) => document.name === 'CLAUDE.md')).toBe(false);
  });

  it('今天按 2/1/2/1/5/1 分组，无日期只展示前 3 条，等待和周期标记保留', async () => {
    const body = await json<PersonalOsTodayResponse>(await fixture().call(`${BASE}/today`));
    expect(body).toMatchObject({ ok: true, today: '2026-11-21', undated: { total: 5 }, later: { count: 1 } });
    expect(body.overdue).toHaveLength(2);
    expect(body.dueToday).toHaveLength(1);
    expect(body.next7).toHaveLength(2);
    expect(body.waiting).toHaveLength(1);
    expect(body.undated.items).toHaveLength(3);
    expect(body.later.items).toHaveLength(1);
    expect(body.inbox).toHaveLength(3);
    expect(body.overdue.map((todo) => todo.due)).toEqual(['2026-11-18', '2026-11-20']);
    expect(body.overdue[1]).toMatchObject({ wait: '秦遥', bucket: 'overdue' });
    expect(body.dueToday[0]).toMatchObject({ every: '1w', due: '2026-11-21' });
    expect(body.next7[1]).toMatchObject({ due: '2026-11-28', bucket: 'next7' });
    expect(body.later.items[0]).toMatchObject({ every: '1m', due: '2026-11-29', bucket: 'later' });
    expect(body.waiting[0]).toMatchObject({ wait: '夏禾', due: null, bucket: 'waiting' });
    expect(body.undated.items.map((todo) => todo.domain)).toEqual(['我', '工作', '副业']);
    const displayed = [...body.overdue, ...body.dueToday, ...body.next7, ...body.waiting, ...body.undated.items, ...body.later.items];
    expect(displayed.every((todo) => !todo.done)).toBe(true);
    expect(new Set(displayed.map((todo) => todo.id)).size).toBe(displayed.length);
    expect(displayed[0]).toMatchObject({ file: '领域/工作/状态.md', line: 19, id: '领域/工作/状态.md:19', doneAt: null });
  });

  it('领域详情平铺状态、挂接卡片和文件，保留未知标签、非法日期警告与知识入口', async () => {
    const { call } = fixture();
    const work = await json<PersonalOsDomainResponse>(await call(`${BASE}/domains/${enc('工作')}`));
    expect(work).toMatchObject({ ok: true, id: '工作', file: '领域/工作/状态.md', openCount: 3 });
    expect(work.sections).toEqual(expect.arrayContaining([expect.objectContaining({ title: '留给下一轮的问题', kind: 'other', markdown: expect.stringContaining('分类标签') })]));
    expect(work.mounts.map((mount) => mount.title)).toEqual(['社区试点记录簿', '书架反馈汇总']);
    expect(work.links).toContain('[访谈方案](事项/访谈方案.md)');
    expect(work.changes[0]).toMatchObject({ date: '2026-11-01' });
    expect(work.registry).toHaveLength(3);
    expect(work.matters).toHaveLength(2);
    expect(work.todos[2]).toMatchObject({ text: '补充读者引导语候选', tags: ['@effort(短)'] });
    const writing = await json<PersonalOsDomainResponse>(await call(`${BASE}/domains/${enc('写作')}`));
    expect(writing.todos[1]).toMatchObject({ due: null, bucket: 'undated', warnings: [expect.objectContaining({ code: 'invalid_due' })] });
    const tech = await json<PersonalOsDomainResponse>(await call(`${BASE}/domains/${enc('技术')}`));
    expect(tech.knowledge).toEqual([expect.objectContaining({ path: '领域/技术/知识.md', kind: 'markdown' })]);
  });

  it('资料登记合并三领域九行，两张表和三类位置完整，本机存在状态正确', async () => {
    const body = await json<PersonalOsRegistryResponse>(await fixture().call(`${BASE}/registry`));
    expect(body.items).toHaveLength(9);
    const local = body.items.filter((item) => item.location.kind === 'local');
    expect(local.filter((item) => item.location.exists)).toHaveLength(3);
    expect(local.filter((item) => item.location.exists === false)).toHaveLength(2);
    expect(local.every((item) => item.location.display.startsWith('~/Documents/PersonalOS/'))).toBe(true);
    expect(body.items.filter((item) => item.location.kind === 'link')).toHaveLength(2);
    expect(body.items.filter((item) => item.location.kind === 'other')).toHaveLength(2);
    expect(body.items.filter((item) => item.domain === '技术')).toHaveLength(3);
    expect(body.items).toEqual(expect.arrayContaining([expect.objectContaining({ topic: '场地沟通', title: '场地问答入口', status: '待核对', source: '领域/工作/资料登记.md' })]));
  });

  it('日志按日期倒序，包含无领域条目与折叠小节，支持领域筛选和更早分页', async () => {
    const { call } = fixture();
    const body = await json<PersonalOsLogResponse>(await call(`${BASE}/log`));
    expect(body.hasMore).toBe(true);
    expect(body.items.map((item) => item.date)).toEqual([...body.items.map((item) => item.date)].sort().reverse());
    expect(body.items).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'entry', domain: null, date: '2026-11-19' }),
      expect.objectContaining({ kind: 'section', title: '2026-11-20 索引实验交付说明', markdown: expect.stringContaining('输入输出说明') }),
    ]));
    const tech = await json<PersonalOsLogResponse>(await call(`${BASE}/log?domain=${enc('技术')}`));
    expect(tech.items).toHaveLength(1);
    expect(tech.items.every((item) => item.domain === '技术')).toBe(true);
    const earlier = await json<PersonalOsLogResponse>(await call(`${BASE}/log?before=2026-10-23&days=30`));
    expect(earlier.hasMore).toBe(false);
    expect(earlier.items).toEqual(expect.arrayContaining([expect.objectContaining({ kind: 'section', date: '2026-10-15', title: '2026-10-15 纸面试点交付说明' })]));
    expect(earlier.items.every((item) => item.date < '2026-10-23')).toBe(true);
  });

  it('文件接口沿用 v1 形状，Markdown 给正文，普通文件只有元信息', async () => {
    const { call, root } = copiedFixture();
    const markdown = await json<PersonalOsFileResponse>(await call(`${BASE}/files/${enc('我/状态.md')}`));
    expect(markdown).toMatchObject({ ok: true, displayPath: '~/Documents/PersonalOS/我/状态.md', library: { id: 'personalos', root: '~/Documents/PersonalOS', writable: false }, file: { path: '我/状态.md', name: '状态.md', kind: 'markdown', availability: 'available', content: expect.stringContaining('当前重点') } });
    writeFileSync(join(root, '演示数据.txt'), 'synthetic non-markdown bytes');
    const other = await json<PersonalOsFileResponse>(await call(`${BASE}/files/${enc('演示数据.txt')}`));
    expect(other.file).toMatchObject({ kind: 'file', size: 28, availability: 'available' });
    expect(other.file).not.toHaveProperty('content');
  });

  it('环境变量同时指定 fixture home 和当天日期，日期变化会在后续请求生效', async () => {
    vi.stubEnv('BLUEMANTA_KNOWLEDGE_HOME', FIXTURE_HOME);
    vi.stubEnv('BLUEMANTA_TODAY', '2026-11-22');
    const { call } = fixture(null);
    const today = await json<PersonalOsTodayResponse>(await call(`${BASE}/today`));
    expect(today.today).toBe('2026-11-22');
    expect(today.overdue).toHaveLength(3);
    expect(today.dueToday).toHaveLength(0);
    expect(today.next7).toHaveLength(3);
    vi.stubEnv('BLUEMANTA_TODAY', '2026-11-23');
    const next = await json<PersonalOsTodayResponse>(await call(`${BASE}/today`));
    expect(next.today).toBe('2026-11-23');
    expect(next.dueToday[0]?.domain).toBe('写作');
  });

  it('PersonalOS 根目录不存在：概览 exists false，其余五入口返回 library_missing', async () => {
    const home = tempDir('bluemanta-personalos-missing-');
    const { call } = fixture(defaultKnowledgeEnv({ home }));
    const response = await call(BASE);
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    const body = await json<PersonalOsOverviewResponse>(response);
    expect(body).toMatchObject({ ok: true, exists: false, root: '~/Documents/PersonalOS', domains: [], inbox: 0 });
    for (const path of SIX_PATHS.slice(1)) await expectFailure(await call(path), 404, 'library_missing');
  });

  it('不存在的领域和文件返回 404 not_found', async () => {
    const { call } = fixture();
    await expectFailure(await call(`${BASE}/domains/${enc('不存在的领域')}`), 404, 'not_found');
    await expectFailure(await call(`${BASE}/files/${enc('不存在的文件.md')}`), 404, 'not_found');
    const missingDomain = await json<PersonalOsDomainResponse>(await call(`${BASE}/domains/${enc('财务')}`));
    expect(missingDomain).toMatchObject({ ok: true, id: '财务', exists: false });
  });

  it('编码越界、隐藏段、非法编码和绝对路径均返回 400 invalid_path', async () => {
    const { call } = fixture();
    const paths = ['..%2F..%2Fsecret.md', '%2Fetc%2Fpasswd', 'a%5Cb.md', '%E0%A4%A', '.DS_Store', '.claude%2Ffixture-only.md', '.gitdata.nosync%2FHEAD', `${enc('领域/工作')}/.private/notes.md`, `${enc('领域/工作')}/.${enc('待下载资料.md')}.icloud`];
    for (const path of paths) await expectFailure(await call(`${BASE}/files/${path}`), 400, 'invalid_path');
  });

  it('隐藏文件和隐藏内容不会出现在六接口的任何成功响应中', async () => {
    const { call, root } = copiedFixture();
    mkdirSync(join(root, '.gitdata.nosync', 'objects'), { recursive: true });
    writeFileSync(join(root, '.gitdata.nosync', 'objects', 'secret.md'), 'private-git-fixture-marker');
    mkdirSync(join(root, '领域', '工作', '.internal'), { recursive: true });
    writeFileSync(join(root, '领域', '工作', '.internal', 'note.md'), 'private-domain-fixture-marker');
    for (const path of SIX_PATHS) {
      const response = await call(path);
      expect(response.status, path).toBe(200);
      const text = await response.text();
      for (const hidden of ['.claude', '.DS_Store', '.gitdata.nosync', '.internal', 'hidden-fixture-never-visible', 'private-git-fixture-marker', 'private-domain-fixture-marker']) expect(text, path).not.toContain(hidden);
    }
  });

  it('旧知识库文件入口不能绕过 PersonalOS 的隐藏路径保护，旧库仍可读', async () => {
    const { call } = fixture();
    await expectFailure(await call('/api/v1/knowledge/libraries/personalos/files/.claude/fixture-only.md'), 404, 'not_found');
    for (const library of ['personal', 'arsenal']) {
      const response = await call(`/api/v1/knowledge/libraries/${library}/files/README.md`);
      expect(response.status, library).toBe(200);
    }
  });

  it('iCloud 占位以逻辑文件名显示为未下载，不能伪装成空 Markdown', async () => {
    const { call } = fixture();
    const response = await call(`${BASE}/files/${enc('领域/工作/待下载资料.md')}`);
    expect(response.status).toBe(200);
    const body = await json<PersonalOsFileResponse>(response);
    expect(body.file).toMatchObject({ path: '领域/工作/待下载资料.md', name: '待下载资料.md', kind: 'markdown', availability: 'icloud', message: '尚未从 iCloud 下载' });
    expect(body.file).not.toHaveProperty('content');
    const work = await json<PersonalOsDomainResponse>(await call(`${BASE}/domains/${enc('工作')}`));
    expect(work.files).toEqual(expect.arrayContaining([expect.objectContaining({ path: '领域/工作/待下载资料.md', availability: 'icloud' })]));
  });

  it.skipIf(process.platform === 'win32' || process.getuid?.() === 0)('真实文件系统拒绝访问时返回 500 read_error，恢复权限后可读', async () => {
    const { call, root } = copiedFixture();
    const directory = join(root, '领域', '工作');
    const originalMode = statSync(directory).mode & 0o777;
    try {
      chmodSync(directory, 0o000);
      // Establish the real errno before exercising the full HTTP -> reader -> filesystem path.
      expect(() => realpathSync(join(directory, '状态.md'))).toThrowError(expect.objectContaining({ code: 'EACCES' }));
      const response = await call(`${BASE}/files/${enc('领域/工作/状态.md')}`);
      expect(response.status).toBe(500);
      expect(response.headers.get('cache-control')).toBe('no-store');
      const body = await json<ApiFailure>(response);
      expect(body).toMatchObject({ ok: false, code: 'read_error' });
      expect(JSON.stringify(body)).not.toContain(root);
    } finally {
      chmodSync(directory, originalMode);
    }
    const restored = await call(`${BASE}/files/${enc('领域/工作/状态.md')}`);
    expect(restored.status).toBe(200);
    expect((await json<PersonalOsFileResponse>(restored)).file.content).toContain('雾灯便签');
  });

  it.skipIf(process.platform === 'win32' || process.getuid?.() === 0)('库根的父目录不可遍历时概览返回读取失败，不误报库不存在', async () => {
    const { call, home, root } = copiedFixture();
    const documents = join(home, 'Documents');
    const originalMode = statSync(documents).mode & 0o777;
    try {
      chmodSync(documents, 0o000);
      expect(() => statSync(root)).toThrowError(expect.objectContaining({ code: 'EACCES' }));
      const response = await call(BASE);
      expect(response.status).toBe(500);
      expect(response.headers.get('cache-control')).toBe('no-store');
      const body = await json<ApiFailure>(response);
      expect(body).toMatchObject({ ok: false, code: 'read_error' });
      expect(body).not.toHaveProperty('exists');
      expect(JSON.stringify(body)).not.toContain(home);
    } finally {
      chmodSync(documents, originalMode);
    }
    const restored = await call(BASE);
    expect(restored.status).toBe(200);
    expect((await json<PersonalOsOverviewResponse>(restored)).exists).toBe(true);
  });

  it.each(['known', 'unexpected'])('读取失败返回 500 read_error，不泄露内部路径或异常详情（%s）', async (kind) => {
    const { call } = fixture();
    const detail = `${FIXTURE_ROOT}/sensitive-test-detail.md`;
    vi.spyOn(PersonalOsReader.prototype, 'file').mockImplementation(() => {
      if (kind === 'known') throw new KnowledgeError('read_error', detail);
      throw new Error(detail);
    });
    const response = await call(`${BASE}/files/${enc('我/状态.md')}`);
    expect(response.status).toBe(500);
    expect(response.headers.get('cache-control')).toBe('no-store');
    const body = await json<ApiFailure>(response);
    expect(body).toMatchObject({ ok: false, code: 'read_error' });
    expect(JSON.stringify(body)).not.toContain(detail);
    expect(JSON.stringify(body)).not.toContain(FIXTURE_HOME);
  });

  it('同一个服务的下一次请求现读修改过的状态文件和今天分组', async () => {
    const { call, root } = copiedFixture();
    const path = join(root, '领域', '工作', '状态.md');
    const before = await json<PersonalOsTodayResponse>(await call(`${BASE}/today`));
    expect(before.overdue).toHaveLength(2);
    writeFileSync(path, readFileSync(path, 'utf8').replace('整理试点访谈问题卡 @due(2026-11-18)', '更新后的虚构访谈问题卡 @due(2026-11-21)'));
    const after = await json<PersonalOsTodayResponse>(await call(`${BASE}/today`));
    expect(after.overdue).toHaveLength(1);
    expect(after.dueToday).toHaveLength(2);
    expect(after.dueToday.some((todo) => todo.text === '更新后的虚构访谈问题卡')).toBe(true);
    const file = await json<PersonalOsFileResponse>(await call(`${BASE}/files/${enc('领域/工作/状态.md')}`));
    expect(file.file.content).toContain('更新后的虚构访谈问题卡');
  });

  it('日志非法参数返回 400，不把错误日期或天数悄悄当成默认值', async () => {
    const { call } = fixture();
    for (const query of ['days=0', 'days=abc', 'days=1.5', 'before=2026-02-30']) await expectFailure(await call(`${BASE}/log?${query}`), 400, 'invalid_input');
  });
});
