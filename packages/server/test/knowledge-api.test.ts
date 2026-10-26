import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openCore, type Core } from '@bluemanta/core';
import { defaultKnowledgeEnv, type KnowledgeEnv } from '@bluemanta/knowledge';
import { afterEach, describe, expect, it } from 'vitest';
import type {
  ApiFailure,
  KnowledgeFileResponse,
  KnowledgeInboxResponse,
  KnowledgeIndexResponse,
  KnowledgeLibrariesResponse,
  KnowledgeRouteResponse,
  KnowledgeSearchResponse,
  KnowledgeTopicResponse,
} from '../src/api-types.js';
import { createApp } from '../src/app.js';
import { removeTempDirs, tempDir } from './helpers.js';

const PORT = 4310;
const TOKEN = '34'.repeat(32);
const HOST = `127.0.0.1:${PORT}`;
const FIXTURE_HOME = fileURLToPath(new URL('../../knowledge/fixtures/home', import.meta.url));
const cores: Core[] = [];

afterEach(() => {
  while (cores.length) cores.pop()?.close();
  removeTempDirs();
});

function fixture(env: KnowledgeEnv = defaultKnowledgeEnv({ home: FIXTURE_HOME })): {
  dataDir: string;
  core: Core;
  call: (path: string, token?: boolean) => Promise<Response>;
} {
  const dataDir = tempDir();
  const core = openCore({ dataDir });
  cores.push(core);
  const app = createApp({ core, token: TOKEN, port: PORT, webDir: null, knowledgeEnv: env });
  return {
    dataDir,
    core,
    call: async (path, token = true) =>
      await app.request(`http://${HOST}${path}`, { headers: { host: HOST, ...(token ? { authorization: `Bearer ${TOKEN}` } : {}) } }),
  };
}

function enc(path: string): string {
  return path.split('/').map(encodeURIComponent).join('/');
}

describe('知识台接口', () => {
  it('没有口令返回 401', async () => {
    const { call } = fixture();
    expect((await call('/api/v1/knowledge/libraries', false)).status).toBe(401);
    expect((await call('/api/v1/knowledge/search?q=x', false)).status).toBe(401);
  });

  it('列出库：根目录 home 缩写为 ~，没有绝对路径', async () => {
    const { call } = fixture();
    const response = await call('/api/v1/knowledge/libraries');
    expect(response.status).toBe(200);
    const body = (await response.json()) as KnowledgeLibrariesResponse;
    expect(body.libraries).toEqual([
      expect.objectContaining({ id: 'personal', name: '个人', root: '~/Documents/Knowledge', exists: true, topicCount: 6, inboxCount: 1, writable: false }),
      expect.objectContaining({ id: 'arsenal', root: '~/Documents/Shuyun/SalesOS/Arsenal', exists: true, topicCount: 2 }),
    ]);
    expect(JSON.stringify(body)).not.toContain(FIXTURE_HOME);
  });

  it('库的分类与主题；库不存在或 id 不对', async () => {
    const { call } = fixture();
    const body = (await (await call('/api/v1/knowledge/libraries/personal')).json()) as KnowledgeIndexResponse;
    expect(body.categories.map((category) => category.name)).toEqual(['思考与判断', '职业与业务', 'AI与技术', '家庭与生活']);
    expect((await call('/api/v1/knowledge/libraries/nope')).status).toBe(404);
    expect((await call('/api/v1/knowledge/libraries/Bad_Id')).status).toBe(400);

    const missing = fixture({ home: '/nowhere', libraries: [{ id: 'gone', name: '不存在', root: '/nowhere/x', writable: false }] });
    const gone = await missing.call('/api/v1/knowledge/libraries/gone');
    expect(gone.status).toBe(200);
    expect(((await gone.json()) as KnowledgeIndexResponse).library.exists).toBe(false);
    const topic = await missing.call('/api/v1/knowledge/libraries/gone/topics/01_a/b');
    expect(topic.status).toBe(404);
    expect(((await topic.json()) as ApiFailure).code).toBe('knowledge_library_missing');
  });

  it('读主题：中文路径经百分号编码', async () => {
    const { call } = fixture();
    const response = await call(`/api/v1/knowledge/libraries/personal/topics/${enc('02_职业与业务/售前方法')}`);
    expect(response.status).toBe(200);
    const body = (await response.json()) as KnowledgeTopicResponse;
    expect(body.topic).toMatchObject({ name: '售前方法', registered: true });
    expect(body.documents.knowledge).toContain('评分项');
    expect(body.files.map((file) => file.name)).toEqual(['方案框架_v1.pptx', '客户研究清单.md']);
    expect(body.archive).toHaveLength(1);
    expect((await call(`/api/v1/knowledge/libraries/personal/topics/${enc('02_职业与业务/没有')}`)).status).toBe(404);
  });

  it('读文件：Markdown 给正文和显示路径，其他文件只给元信息', async () => {
    const { call } = fixture();
    const md = (await (await call(`/api/v1/knowledge/libraries/personal/files/${enc('02_职业与业务/售前方法/客户研究清单.md')}`)).json()) as KnowledgeFileResponse;
    expect(md.file).toMatchObject({ kind: 'markdown', name: '客户研究清单.md' });
    expect(md.displayPath).toBe('~/Documents/Knowledge/02_职业与业务/售前方法/客户研究清单.md');
    const bin = (await (await call(`/api/v1/knowledge/libraries/personal/files/${enc('02_职业与业务/售前方法/方案框架_v1.pptx')}`)).json()) as KnowledgeFileResponse;
    expect(bin.file.kind).toBe('file');
    expect('content' in bin.file).toBe(false);
  });

  it('路径越界一律拒绝，包括编码过的 ../ 和 %2F', async () => {
    const { call } = fixture();
    for (const path of ['..%2F..%2Fsecret.md', 'a%5Cb.md', '%2E%2E%2FShuyun%2FSalesOS%2FArsenal%2FREADME.md']) {
      const response = await call(`/api/v1/knowledge/libraries/personal/files/${path}`);
      expect(response.status, path).toBe(400);
      expect(((await response.json()) as ApiFailure).code).toBe('knowledge_invalid_path');
    }
    // 未编码斜杠的 %2E%2E 会被 URL 标准在路由前解析成 ..，落到别的路径上，到不了读文件这一步。
    const resolved = await call('/api/v1/knowledge/libraries/personal/files/%2E%2E/%2E%2E/Shuyun/SalesOS/Arsenal/README.md');
    expect(resolved.status).toBe(404);
    expect(await resolved.text()).not.toContain('虚构的售前武器库');
    expect((await call('/api/v1/knowledge/libraries/personal/files/%E0%A4%A')).status).toBe(400);
  });

  it('收件箱', async () => {
    const { call } = fixture();
    const body = (await (await call('/api/v1/knowledge/libraries/personal/inbox')).json()) as KnowledgeInboxResponse;
    expect(body.files.map((file) => file.name)).toEqual(['2026-10-20-读书笔记草稿.md']);
  });

  it('搜索：库和灵感一起，结果里没有内部字段；索引第一次搜索时才建', async () => {
    const { call, core, dataDir } = fixture();
    const created = core.card.create({
      requestId: 'knowledge-api-1',
      source: { kind: 'human', name: 'test' },
      cardType: 'idea',
      title: '会员分层的新想法',
      body: '按最近一次消费把会员分成三层。',
    });
    expect(created.ok).toBe(true);
    expect(existsSync(join(dataDir, 'knowledge-index.sqlite'))).toBe(false);
    const body = (await (await call(`/api/v1/knowledge/search?q=${encodeURIComponent('会员分层')}`)).json()) as KnowledgeSearchResponse;
    expect(existsSync(join(dataDir, 'knowledge-index.sqlite'))).toBe(true);
    expect(body.keywords).toEqual(['会员分层']);
    expect(body.hits[0]).toMatchObject({ source: 'idea', title: '会员分层的新想法' });
    expect(body.hits.some((hit) => hit.source === 'library')).toBe(true);
    expect('chunkId' in (body.hits[0] ?? {})).toBe(false);

    const noIdeas = (await (await call(`/api/v1/knowledge/search?q=${encodeURIComponent('会员')}&ideas=0&library=arsenal`)).json()) as KnowledgeSearchResponse;
    expect(noIdeas.hits.length).toBeGreaterThan(0);
    expect(noIdeas.hits.every((hit) => hit.library === 'arsenal')).toBe(true);
  });

  it('搜索参数校验', async () => {
    const { call } = fixture();
    expect((await call('/api/v1/knowledge/search')).status).toBe(400);
    expect((await call('/api/v1/knowledge/search?q=x&limit=0')).status).toBe(400);
    expect((await call('/api/v1/knowledge/search?q=x&limit=51')).status).toBe(400);
    expect((await call('/api/v1/knowledge/search?q=x&ideas=yes')).status).toBe(400);
    expect((await call('/api/v1/knowledge/search?q=x&library=..')).status).toBe(400);
  });

  it('路由：按别名找主题，附读取顺序', async () => {
    const { call } = fixture();
    const body = (await (await call('/api/v1/knowledge/route?q=Loyalty')).json()) as KnowledgeRouteResponse;
    expect(body.candidates[0]).toMatchObject({ library: 'arsenal', topicPath: '01_业务主题/会员体系', name: '会员体系' });
    expect(body.candidates[0]?.readOrder[0]).toBe('01_业务主题/会员体系/README.md');
    expect((await call('/api/v1/knowledge/route')).status).toBe(400);
  });
});
