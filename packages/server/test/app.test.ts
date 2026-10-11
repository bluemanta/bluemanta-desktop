import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { openCore, type Core } from '@bluemanta/core';
import { afterEach, describe, expect, it } from 'vitest';
import type {
  ApiFailure,
  AttachmentUploadResponse,
  HealthResponse,
  IdeaListResponse,
  IdeaPurgeResponse,
  IdeaRecord,
  IdeaResponse,
  IdeaWriteResponse,
} from '../src/api-types.js';
import { createApp, type ServerCore } from '../src/app.js';
import { gif, jpeg, png, removeTempDirs, tempDir, webp } from './helpers.js';

const PORT = 4310;
const TOKEN = 'ab'.repeat(32);
const HOST = `127.0.0.1:${PORT}`;

type Harness = {
  dir: string;
  core: Core;
  logs: string[];
  bodies: string[];
  call: (method: string, path: string, init?: CallInit) => Promise<Response>;
};

type CallInit = {
  json?: unknown;
  raw?: string | Uint8Array;
  token?: string | null;
  host?: string | null;
  headers?: Record<string, string>;
};

const cores: Core[] = [];

afterEach(() => {
  while (cores.length > 0) cores.pop()?.close();
  removeTempDirs();
});

function harness(options: { webDir?: string | null; core?: ServerCore } = {}): Harness {
  const dir = tempDir();
  const core = openCore({ dataDir: dir });
  cores.push(core);
  const logs: string[] = [];
  const bodies: string[] = [];
  const app = createApp({
    core: options.core ?? core,
    token: TOKEN,
    port: PORT,
    webDir: options.webDir ?? null,
    logError: (line) => logs.push(line),
  });
  const call = async (method: string, path: string, init: CallInit = {}) => {
    const headers: Record<string, string> = { ...init.headers };
    const host = init.host === undefined ? HOST : init.host;
    if (host !== null) headers.host = host;
    const token = init.token === undefined ? TOKEN : init.token;
    if (token !== null) headers.authorization = `Bearer ${token}`;
    let body: string | Uint8Array | undefined = init.raw;
    if (init.json !== undefined) {
      headers['content-type'] = 'application/json';
      body = JSON.stringify(init.json);
    }
    const response = await app.request(`http://${HOST}${path}`, { method, headers, ...(body === undefined ? {} : { body }) });
    if ((response.headers.get('content-type') ?? '').includes('json')) {
      bodies.push(await response.clone().text());
    }
    return response;
  };
  return { dir, core, logs, bodies, call };
}

async function json<T>(response: Response): Promise<T> {
  return (await response.json()) as T;
}

let counter = 0;
function rid(label: string): string {
  counter += 1;
  return `test-${label}-${counter}`;
}

async function createIdea(h: Harness, input: Record<string, unknown> = {}): Promise<IdeaRecord> {
  const response = await h.call('POST', '/api/v1/ideas', {
    json: { requestId: rid('create'), title: '虚构灵感', body: '一段虚构的正文', ...input },
  });
  expect(response.status).toBe(200);
  return (await json<IdeaWriteResponse>(response)).record;
}

describe('鉴权与 Host 校验', () => {
  it('health 不要口令', async () => {
    const h = harness();
    const response = await h.call('GET', '/api/v1/health', { token: null });
    expect(response.status).toBe(200);
    const body = await json<HealthResponse>(response);
    expect(body).toEqual({ service: 'bluemanta', apiVersion: 1, version: expect.any(String) });
  });

  it('无口令、错口令、格式不对都返回 401', async () => {
    const h = harness();
    for (const init of [
      { token: null },
      { token: 'cd'.repeat(32) },
      { token: 'short' },
      { token: null, headers: { authorization: TOKEN } },
      { token: null, headers: { authorization: `Basic ${TOKEN}` } },
    ]) {
      const response = await h.call('GET', '/api/v1/ideas', init);
      expect(response.status).toBe(401);
      const body = await json<ApiFailure>(response);
      expect(body.ok).toBe(false);
      expect(body.code).toBe('unauthorized');
      expect(typeof body.message).toBe('string');
    }
    expect((await h.call('GET', '/api/v1/ideas')).status).toBe(200);
    expect((await h.call('GET', '/api/v1/ideas', { token: null, headers: { authorization: `bearer ${TOKEN}` } })).status).toBe(200);
  });

  it('只接受 127.0.0.1 和 localhost 加本端口的 Host，静态页和 health 也一样', async () => {
    const h = harness();
    for (const host of ['evil.example:4310', '127.0.0.1:4311', '127.0.0.1', 'localhost', '0.0.0.0:4310', null]) {
      for (const path of ['/api/v1/ideas', '/api/v1/health', '/', '/ideas']) {
        const response = await h.call('GET', path, { host });
        expect(response.status).toBe(403);
        expect((await json<ApiFailure>(response)).code).toBe('forbidden_host');
      }
    }
    expect((await h.call('GET', '/api/v1/ideas', { host: 'localhost:4310' })).status).toBe(200);
    expect((await h.call('GET', '/api/v1/ideas', { host: 'LOCALHOST:4310' })).status).toBe(200);
  });

  it('所有响应带 nosniff 和 no-referrer，不带 CORS 和 X-Frame-Options', async () => {
    const h = harness();
    const responses = [
      await h.call('GET', '/api/v1/health'),
      await h.call('GET', '/api/v1/ideas'),
      await h.call('GET', '/api/v1/ideas', { token: null }),
      await h.call('GET', '/api/v1/ideas', { host: 'evil.example' }),
      await h.call('GET', '/api/v1/nope'),
      await h.call('GET', '/'),
      await h.call('OPTIONS', '/api/v1/ideas', { headers: { origin: 'https://evil.example' } }),
    ];
    for (const response of responses) {
      expect(response.headers.get('x-content-type-options')).toBe('nosniff');
      expect(response.headers.get('referrer-policy')).toBe('no-referrer');
      expect(response.headers.get('x-frame-options')).toBeNull();
      for (const name of response.headers.keys()) {
        expect(name.startsWith('access-control-')).toBe(false);
      }
    }
  });
});

describe('灵感接口', () => {
  it('新建、读取、列表、搜索', async () => {
    const h = harness();
    const created = await createIdea(h, { title: '海边的虚构灵感', body: '退潮后的沙滩像一张纸', category: 'life' });
    expect(created.rev).toBe(1);
    expect(created.category).toBe('life');
    expect(created.categorySource).toBe('user');
    expect(created.createdBy).toEqual({ kind: 'human', name: 'desktop' });
    expect(created.rawInput).toEqual({ status: 'present', channel: 'web', text: '退潮后的沙滩像一张纸' });
    expect(created.showRaw).toBe(false);
    expect(created.extensions).toEqual([]);
    expect(created.attachments).toEqual([]);

    const got = await json<IdeaResponse>(await h.call('GET', `/api/v1/ideas/${created.id}`));
    expect(got.record).toEqual(created);

    const list = await json<IdeaListResponse>(await h.call('GET', '/api/v1/ideas'));
    expect(list.ok).toBe(true);
    expect(list.count).toBe(1);
    expect(list.items[0]).toEqual(created);
    expect(list.items[0]?.match).toBeUndefined();

    const search = await json<IdeaListResponse>(await h.call('GET', `/api/v1/ideas?q=${encodeURIComponent('沙滩')}`));
    expect(search.count).toBe(1);
    expect(search.items[0]?.match).toEqual({ field: 'body', excerpt: expect.stringContaining('沙滩') });
    const miss = await json<IdeaListResponse>(await h.call('GET', `/api/v1/ideas?q=${encodeURIComponent('不存在的词')}`));
    expect(miss.count).toBe(0);

    const trash = await json<IdeaListResponse>(await h.call('GET', '/api/v1/ideas?scope=trash'));
    expect(trash.count).toBe(0);
  });

  it('列表参数不对时 400', async () => {
    const h = harness();
    expect((await h.call('GET', '/api/v1/ideas?scope=all')).status).toBe(400);
    expect((await h.call('GET', '/api/v1/ideas?scope=active&scope=trash')).status).toBe(400);
    expect((await h.call('GET', '/api/v1/ideas?q=%20')).status).toBe(400);
    expect((await h.call('GET', '/api/v1/ideas?q=a&q=b')).status).toBe(400);
  });

  it('只暴露灵感：其他类型的卡片在列表里看不到，按 id 访问 404', async () => {
    const h = harness();
    const note = h.core.card.create({
      requestId: rid('note'),
      source: { kind: 'human', name: 'test' },
      cardType: 'note',
      title: '虚构笔记',
      rawInput: { status: 'legacy' },
    });
    if (!note.ok) throw new Error(note.message);
    await createIdea(h);
    const list = await json<IdeaListResponse>(await h.call('GET', '/api/v1/ideas'));
    expect(list.items.map((item) => item.id)).not.toContain(note.record.id);
    expect((await h.call('GET', `/api/v1/ideas/${note.record.id}`)).status).toBe(404);
    const patch = await h.call('PATCH', `/api/v1/ideas/${note.record.id}`, {
      json: { requestId: rid('patch'), rev: 1, title: '改' },
    });
    expect(patch.status).toBe(404);
    expect((await h.call('POST', `/api/v1/ideas/${note.record.id}/trash`, { json: { requestId: rid('t'), rev: 1 } })).status).toBe(404);
  });

  it('完整一轮：修改（旧 rev 409）、收藏、延展、回收站、恢复、彻底删除', async () => {
    const h = harness();
    const created = await createIdea(h);

    const patchRequest = { requestId: rid('patch'), rev: created.rev, title: '改过的虚构标题', category: 'work' };
    const patched = await h.call('PATCH', `/api/v1/ideas/${created.id}`, { json: patchRequest });
    expect(patched.status).toBe(200);
    const afterPatch = (await json<IdeaWriteResponse>(patched)).record;
    expect(afterPatch.title).toBe('改过的虚构标题');
    expect(afterPatch.category).toBe('work');
    expect(afterPatch.rev).toBe(2);

    const stale = await h.call('PATCH', `/api/v1/ideas/${created.id}`, {
      json: { requestId: rid('stale'), rev: created.rev, body: '用旧版本改' },
    });
    expect(stale.status).toBe(409);
    expect((await json<ApiFailure>(stale)).code).toBe('version_conflict');

    const star = await h.call('PUT', `/api/v1/ideas/${created.id}/star`, {
      json: { requestId: rid('star'), rev: afterPatch.rev, starred: true },
    });
    expect(star.status).toBe(200);
    const starred = (await json<IdeaWriteResponse>(star)).record;
    expect(starred.starred).toBe(true);
    expect(starred.updatedAt).toBe(afterPatch.updatedAt);

    const extended = await h.call('POST', `/api/v1/ideas/${created.id}/extensions`, {
      json: { requestId: rid('ext'), rev: starred.rev, text: '虚构的延展' },
    });
    expect(extended.status).toBe(200);
    const withExtension = (await json<IdeaWriteResponse>(extended)).record;
    expect(withExtension.extensions).toEqual([{ id: expect.any(String), text: '虚构的延展', createdAt: expect.any(String) }]);
    const extensionId = withExtension.extensions[0]?.id ?? '';

    const removedExtension = await h.call('DELETE', `/api/v1/ideas/${created.id}/extensions/${extensionId}`, {
      json: { requestId: rid('ext-del'), rev: withExtension.rev },
    });
    expect(removedExtension.status).toBe(200);
    const withoutExtension = (await json<IdeaWriteResponse>(removedExtension)).record;
    expect(withoutExtension.extensions).toEqual([]);

    const missingExtension = await h.call('DELETE', `/api/v1/ideas/${created.id}/extensions/ext_missing`, {
      json: { requestId: rid('ext-missing'), rev: withoutExtension.rev },
    });
    expect(missingExtension.status).toBe(404);

    const trashed = await h.call('POST', `/api/v1/ideas/${created.id}/trash`, {
      json: { requestId: rid('trash'), rev: withoutExtension.rev },
    });
    expect(trashed.status).toBe(200);
    const inTrash = (await json<IdeaWriteResponse>(trashed)).record;
    expect(inTrash.deletedAt).not.toBeNull();
    expect((await json<IdeaListResponse>(await h.call('GET', '/api/v1/ideas'))).count).toBe(0);
    expect((await json<IdeaListResponse>(await h.call('GET', '/api/v1/ideas?scope=trash'))).count).toBe(1);

    const editInTrash = await h.call('PATCH', `/api/v1/ideas/${created.id}`, {
      json: { requestId: rid('edit-trash'), rev: inTrash.rev, body: '回收站里不能改' },
    });
    expect(editInTrash.status).toBe(400);

    const restored = await h.call('POST', `/api/v1/ideas/${created.id}/restore`, {
      json: { requestId: rid('restore'), rev: inTrash.rev },
    });
    expect(restored.status).toBe(200);
    const back = (await json<IdeaWriteResponse>(restored)).record;
    expect(back.deletedAt).toBeNull();

    const purgeActive = await h.call('POST', `/api/v1/ideas/${created.id}/purge`, {
      json: { requestId: rid('purge-active'), rev: back.rev },
    });
    expect(purgeActive.status).toBe(400);

    const again = await json<IdeaWriteResponse>(
      await h.call('POST', `/api/v1/ideas/${created.id}/trash`, { json: { requestId: rid('trash2'), rev: back.rev } }),
    );
    const purgeRequest = { requestId: rid('purge'), rev: again.record.rev };
    const purged = await h.call('POST', `/api/v1/ideas/${created.id}/purge`, { json: purgeRequest });
    expect(purged.status).toBe(200);
    expect(await json<IdeaPurgeResponse>(purged)).toEqual({ ok: true, record: { id: created.id } });
    expect((await h.call('GET', `/api/v1/ideas/${created.id}`)).status).toBe(404);

    const replayPurge = await h.call('POST', `/api/v1/ideas/${created.id}/purge`, { json: purgeRequest });
    expect(replayPurge.status).toBe(200);
    expect(await json<IdeaPurgeResponse>(replayPurge)).toEqual({ ok: true, record: { id: created.id }, duplicate: true });

    const history = h.core.listHistory({ objectId: created.id });
    expect(history.every((entry) => entry.source.kind === 'human' && entry.source.name === 'desktop')).toBe(true);
  });

  it('忽略请求里的 source，一律记为 desktop', async () => {
    const h = harness();
    const created = await createIdea(h, { source: { kind: 'agent', name: 'evil' } });
    expect(created.createdBy).toEqual({ kind: 'human', name: 'desktop' });
    const star = await h.call('PUT', `/api/v1/ideas/${created.id}/star`, {
      json: { requestId: rid('star'), rev: created.rev, starred: true, source: { kind: 'agent', name: 'evil' } },
    });
    expect(star.status).toBe(200);
  });

  it('同一 requestId 同内容重放返回 duplicate，不重复写；同号不同内容 409', async () => {
    const h = harness();
    const request = { requestId: rid('replay'), title: '重放用的虚构灵感', body: '' };
    const first = await json<IdeaWriteResponse>(await h.call('POST', '/api/v1/ideas', { json: request }));
    expect(first.duplicate).toBeUndefined();
    const second = await h.call('POST', '/api/v1/ideas', { json: request });
    expect(second.status).toBe(200);
    const replayed = await json<IdeaWriteResponse>(second);
    expect(replayed.duplicate).toBe(true);
    expect(replayed.record).toEqual(first.record);
    expect(h.core.listCards({ cardType: 'idea' })).toHaveLength(1);

    const mismatch = await h.call('POST', '/api/v1/ideas', { json: { ...request, title: '换了内容' } });
    expect(mismatch.status).toBe(409);
    expect((await json<ApiFailure>(mismatch)).code).toBe('duplicate_request_mismatch');
    expect(h.core.listCards({ cardType: 'idea' })).toHaveLength(1);

    const patch = { requestId: rid('patch-replay'), rev: first.record.rev, body: '补一段' };
    expect((await h.call('PATCH', `/api/v1/ideas/${first.record.id}`, { json: patch })).status).toBe(200);
    const patchAgain = await json<IdeaWriteResponse>(await h.call('PATCH', `/api/v1/ideas/${first.record.id}`, { json: patch }));
    expect(patchAgain.duplicate).toBe(true);
    expect(h.core.getCard(first.record.id)?.rev).toBe(2);
  });

  it('请求体不是 JSON 或不是对象时 400，字段校验失败 400', async () => {
    const h = harness();
    const notJson = await h.call('POST', '/api/v1/ideas', { raw: '{oops', headers: { 'content-type': 'application/json' } });
    expect(notJson.status).toBe(400);
    expect((await json<ApiFailure>(notJson)).code).toBe('invalid_input');
    expect((await h.call('POST', '/api/v1/ideas', { json: [1, 2] })).status).toBe(400);
    expect((await h.call('POST', '/api/v1/ideas')).status).toBe(400);
    expect((await h.call('POST', '/api/v1/ideas', { json: { requestId: rid('empty') } })).status).toBe(400);
    expect((await h.call('POST', '/api/v1/ideas', { json: { title: '缺 requestId' } })).status).toBe(400);
    expect((await h.call('POST', '/api/v1/ideas', { json: { requestId: rid('cat'), title: 'x', category: 'nope' } })).status).toBe(400);
    const big = await h.call('POST', '/api/v1/ideas', { raw: 'x'.repeat(1024 * 1024 + 1) });
    expect(big.status).toBe(400);
  });

  it('未知路径 404，方法不对 405', async () => {
    const h = harness();
    const unknown = await h.call('GET', '/api/v1/projects');
    expect(unknown.status).toBe(404);
    expect((await json<ApiFailure>(unknown)).code).toBe('not_found');
    expect((await h.call('GET', '/api/v2/ideas')).status).toBe(404);
    expect((await h.call('GET', '/api/v1/ideas/card_missing')).status).toBe(404);
    for (const [method, path] of [
      ['DELETE', '/api/v1/ideas'],
      ['PUT', '/api/v1/ideas'],
      ['DELETE', '/api/v1/ideas/x'],
      ['GET', '/api/v1/ideas/x/star'],
      ['GET', '/api/v1/ideas/x/trash'],
      ['GET', '/api/v1/ideas/x/purge'],
      ['GET', '/api/v1/ideas/x/extensions'],
      ['GET', '/api/v1/ideas/x/extensions/y'],
      ['GET', '/api/v1/attachments'],
      ['DELETE', '/api/v1/attachments/x'],
      ['POST', '/api/v1/health'],
    ] as const) {
      const response = await h.call(method, path, method === 'GET' ? {} : { json: {} });
      expect(response.status, `${method} ${path}`).toBe(405);
      expect((await json<ApiFailure>(response)).code).toBe('method_not_allowed');
    }
  });

  it('内部错误返回 500，不带堆栈、路径和内容；日志只有错误类型', async () => {
    const dir = tempDir();
    const real = openCore({ dataDir: dir });
    cores.push(real);
    const broken: ServerCore = Object.assign(Object.create(real) as ServerCore, {
      listCards: () => {
        throw new Error(`读不到 ${dir}/store.sqlite 里的私密正文`);
      },
    });
    const h = harness({ core: broken });
    const response = await h.call('GET', '/api/v1/ideas');
    expect(response.status).toBe(500);
    const body = await json<ApiFailure>(response);
    expect(body).toEqual({ ok: false, code: 'internal', message: '服务内部错误' });
    expect(h.logs).toHaveLength(1);
    expect(h.logs[0]).not.toContain(dir);
    expect(h.logs[0]).not.toContain('私密正文');
  });
});

describe('附件接口', () => {
  async function upload(h: Harness, bytes: Buffer, query = '', contentType = 'application/octet-stream') {
    return h.call('POST', `/api/v1/attachments?requestId=${rid('upload')}${query}`, {
      raw: new Uint8Array(bytes),
      headers: { 'content-type': contentType },
    });
  }

  it('四种格式都能上传和读取，读取带正确类型与长缓存', async () => {
    const h = harness();
    const samples = [
      ['image/png', png(640, 480), '&name=a.png'],
      ['image/jpeg', jpeg(320, 200), '&name=b.jpeg'],
      ['image/gif', gif(10, 20), ''],
      ['image/webp', webp(1200, 900), '&name=d.webp'],
    ] as const;
    for (const [mime, bytes, query] of samples) {
      const response = await upload(h, bytes, query, mime);
      expect(response.status, mime).toBe(200);
      const body = await json<AttachmentUploadResponse>(response);
      expect(body.record.mime).toBe(mime);
      expect(body.record.byteSize).toBe(bytes.byteLength);
      expect(body.record.url).toBe(`/api/v1/attachments/${body.record.id}`);
      expect(Object.keys(body.record)).not.toContain('path');

      const read = await h.call('GET', body.record.url);
      expect(read.status).toBe(200);
      expect(read.headers.get('content-type')).toBe(mime);
      expect(read.headers.get('cache-control')).toBe('private, max-age=31536000, immutable');
      expect(read.headers.get('x-content-type-options')).toBe('nosniff');
      expect(Buffer.from(await read.arrayBuffer()).equals(bytes)).toBe(true);
    }
  });

  it('拒绝超大、非图片、假扩展名、类型不符和超边长', async () => {
    const h = harness();
    const tooLarge = Buffer.concat([png(10, 10), Buffer.alloc(8 * 1024 * 1024)]);
    const cases: Array<[Buffer, string, string, string]> = [
      [tooLarge, '', 'application/octet-stream', '8 MB'],
      [Buffer.from('not an image'), '', 'application/octet-stream', 'jpeg'],
      [png(10, 10), '&name=fake.jpg', 'application/octet-stream', '扩展名'],
      [png(10, 10), '', 'image/gif', '声明的类型'],
      [png(16385, 10), '', 'image/png', '16384'],
      [Buffer.alloc(0), '', 'image/png', '没有收到图片'],
    ];
    for (const [bytes, query, type, message] of cases) {
      const response = await upload(h, bytes, query, type);
      expect(response.status).toBe(400);
      const body = await json<ApiFailure>(response);
      expect(body.code).toBe('invalid_input');
      expect(body.message).toContain(message);
    }
    expect(h.core.listAttachments({ deleted: 'all' })).toHaveLength(0);
    expect(existsSync(join(h.dir, 'media')) ? readdirSync(join(h.dir, 'media')) : []).toEqual([]);

    const noRequestId = await h.call('POST', '/api/v1/attachments', { raw: new Uint8Array(png(1, 1)) });
    expect(noRequestId.status).toBe(400);
  });

  it('同一 requestId 重放上传返回 duplicate', async () => {
    const h = harness();
    const path = `/api/v1/attachments?requestId=${rid('same')}`;
    const first = await json<AttachmentUploadResponse>(await h.call('POST', path, { raw: new Uint8Array(png(4, 4)) }));
    const again = await json<AttachmentUploadResponse>(await h.call('POST', path, { raw: new Uint8Array(png(4, 4)) }));
    expect(again.duplicate).toBe(true);
    expect(again.record).toEqual(first.record);
    expect(h.core.listAttachments()).toHaveLength(1);
    const other = await h.call('POST', path, { raw: new Uint8Array(png(5, 5)) });
    expect(other.status).toBe(409);
  });

  it('绑定到灵感后详情带附件元数据；彻底删除后文件和记录都清掉', async () => {
    const h = harness();
    const uploaded = await json<AttachmentUploadResponse>(await upload(h, png(32, 16), '&name=shot.png', 'image/png'));
    const attachment = h.core.getAttachment(uploaded.record.id);
    expect(attachment).not.toBeNull();
    const file = join(h.dir, attachment?.path ?? '');
    expect(existsSync(file)).toBe(true);

    const created = await createIdea(h, { title: '带图的虚构灵感', attachmentIds: [uploaded.record.id] });
    expect(created.attachmentIds).toEqual([uploaded.record.id]);
    expect(created.attachments).toEqual([uploaded.record]);
    const detail = await json<IdeaResponse>(await h.call('GET', `/api/v1/ideas/${created.id}`));
    expect(detail.record.attachments).toEqual([uploaded.record]);

    const trashed = await json<IdeaWriteResponse>(
      await h.call('POST', `/api/v1/ideas/${created.id}/trash`, { json: { requestId: rid('trash'), rev: created.rev } }),
    );
    expect(existsSync(file)).toBe(true);
    const purged = await h.call('POST', `/api/v1/ideas/${created.id}/purge`, {
      json: { requestId: rid('purge'), rev: trashed.record.rev },
    });
    expect(purged.status).toBe(200);
    expect(existsSync(file)).toBe(false);
    expect(h.core.getAttachment(uploaded.record.id)).toBeNull();
    expect((await h.call('GET', uploaded.record.url)).status).toBe(404);
  });

  it('还被其他灵感引用的附件不随彻底删除清掉', async () => {
    const h = harness();
    const uploaded = await json<AttachmentUploadResponse>(await upload(h, png(8, 8)));
    const first = await createIdea(h, { attachmentIds: [uploaded.record.id] });
    await createIdea(h, { attachmentIds: [uploaded.record.id] });
    const trashed = await json<IdeaWriteResponse>(
      await h.call('POST', `/api/v1/ideas/${first.id}/trash`, { json: { requestId: rid('trash'), rev: first.rev } }),
    );
    await h.call('POST', `/api/v1/ideas/${first.id}/purge`, { json: { requestId: rid('purge'), rev: trashed.record.rev } });
    expect(h.core.getAttachment(uploaded.record.id)).not.toBeNull();
    expect((await h.call('GET', uploaded.record.url)).status).toBe(200);
  });
});

describe('返回体不泄露本机信息', () => {
  it('所有 JSON 返回体里没有数据目录、附件路径和口令', async () => {
    const h = harness();
    const uploaded = await json<AttachmentUploadResponse>(
      await h.call('POST', `/api/v1/attachments?requestId=${rid('u')}&name=x.png`, { raw: new Uint8Array(png(2, 2)) }),
    );
    const created = await createIdea(h, { attachmentIds: [uploaded.record.id] });
    await h.call('GET', '/api/v1/health');
    await h.call('GET', '/api/v1/ideas');
    await h.call('GET', `/api/v1/ideas?q=${encodeURIComponent('虚构')}`);
    await h.call('GET', `/api/v1/ideas/${created.id}`);
    await h.call('GET', '/api/v1/ideas', { token: 'wrong' });
    await h.call('GET', '/api/v1/ideas', { host: 'evil.example' });
    const attachmentPath = h.core.getAttachment(uploaded.record.id)?.path ?? '';
    expect(attachmentPath).not.toBe('');
    expect(h.bodies.length).toBeGreaterThan(5);
    for (const body of h.bodies) {
      expect(body).not.toContain(h.dir);
      expect(body).not.toContain(attachmentPath);
      expect(body).not.toContain('"path"');
      expect(body).not.toContain('dataDir');
      expect(body).not.toContain(TOKEN);
    }
  });
});

describe('静态网页', () => {
  it('网页没构建时 / 显示说明页', async () => {
    const h = harness({ webDir: join(tempDir(), 'missing') });
    const response = await h.call('GET', '/', { token: null });
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/html');
    expect(await response.text()).toContain('网页尚未构建，先运行');
  });

  it('带哈希的资源长缓存，index.html 不缓存，未知路径回落到 index.html，/api/ 不回落', async () => {
    const web = tempDir('bluemanta-web-');
    writeFileSync(join(web, 'index.html'), '<!doctype html><title>虚构网页</title>');
    mkdirSync(join(web, 'assets'));
    writeFileSync(join(web, 'assets', 'index-AbCd12_9.js'), 'console.log(1)');
    writeFileSync(join(web, 'favicon.svg'), '<svg></svg>');
    const h = harness({ webDir: web });

    const root = await h.call('GET', '/', { token: null });
    expect(root.status).toBe(200);
    expect(root.headers.get('cache-control')).toBe('no-store');
    expect(await root.text()).toContain('虚构网页');

    const asset = await h.call('GET', '/assets/index-AbCd12_9.js', { token: null });
    expect(asset.status).toBe(200);
    expect(asset.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');
    expect(asset.headers.get('content-type')).toContain('javascript');

    const icon = await h.call('GET', '/favicon.svg', { token: null });
    expect(icon.status).toBe(200);
    expect(icon.headers.get('cache-control')).toBe('no-cache');

    for (const path of ['/ideas', '/ideas/card_123', '/ideas/stats?x=1', '/assets/missing-AbCd1234.js']) {
      const fallback = await h.call('GET', path, { token: null });
      expect(fallback.status, path).toBe(200);
      expect(fallback.headers.get('cache-control')).toBe('no-store');
      expect(await fallback.text()).toContain('虚构网页');
    }

    const api = await h.call('GET', '/api/unknown', { token: null });
    expect(api.status).toBe(404);
    expect((await h.call('GET', '/../store.sqlite', { token: null })).status).not.toBe(500);
    expect((await h.call('POST', '/ideas', { token: null })).status).toBe(404);
  });
});
