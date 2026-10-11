import { createHash, timingSafeEqual } from 'node:crypto';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { basename, join } from 'node:path';
import { serveStatic } from '@hono/node-server/serve-static';
import {
  DESKTOP_SOURCE,
  discardPurgedAttachments,
  IMAGE_EXTENSION,
  readImageUpload,
  readLimitedBody,
  readStoredFile,
  statusForCommandCode,
  writeStoredFile,
  type Card,
  type CardAddExtensionInput,
  type CardCreateInput,
  type CardDeleteExtensionInput,
  type CardRevInput,
  type CardSetStarInput,
  type CardUpdateInput,
  type CommandErrorCode,
  type CommandResult,
  type Core,
  type IdeaCard,
  type ImageMime,
} from '@bluemanta/core';
import { Hono, type Context, type MiddlewareHandler } from 'hono';
import {
  API_VERSION,
  type ApiErrorCode,
  type ApiFailure,
  type AttachmentUploadResponse,
  type HealthResponse,
  type IdeaListItem,
  type IdeaListResponse,
  type IdeaPurgeResponse,
  type IdeaResponse,
  type IdeaWriteResponse,
} from './api-types.js';
import { isEditedHistory, sortIdeas, toAttachmentMeta, toIdeaRecord } from './records.js';
import { SERVER_VERSION } from './version.js';

/** 服务只用到 core 的这些方法，测试可以换成同形状的对象。 */
export type ServerCore = Pick<
  Core,
  | 'dataDir'
  | 'card'
  | 'attachment'
  | 'getCard'
  | 'listCards'
  | 'searchCards'
  | 'getAttachment'
  | 'listHistory'
  | 'deleteUnreferencedAttachmentRecords'
>;

export type CreateAppOptions = {
  core: ServerCore;
  token: string;
  port: number;
  /** 网页构建产物目录（packages/web/dist）。不存在时 `/` 显示说明页。 */
  webDir: string | null;
  /** 内部错误的去向。只收到错误类型，不含请求体、灵感内容和口令。 */
  logError?: (line: string) => void;
};

const JSON_LIMIT_BYTES = 1024 * 1024;
const NO_STORE = { 'cache-control': 'no-store' };

const NOT_BUILT_PAGE = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>bluemanta</title>
<style>
  body { font: 15px/1.6 -apple-system, BlinkMacSystemFont, "PingFang SC", sans-serif; margin: 0; display: grid; place-items: center; min-height: 100vh; color: #1f2a26; background: #f6f7f5; }
  main { max-width: 32rem; padding: 2rem; }
  code { background: #e8ece9; padding: 0.1rem 0.35rem; border-radius: 4px; }
</style>
</head>
<body>
<main>
<h1>网页尚未构建，先运行 npm run build</h1>
<p>本地服务已在运行，但还没有找到网页文件。在仓库根目录运行 <code>npm run build</code> 后刷新本页。</p>
</main>
</body>
</html>
`;

function failure(c: Context, status: number, code: ApiErrorCode, message: string): Response {
  const body: ApiFailure = { ok: false, code, message };
  return c.json(body, status as 400, NO_STORE);
}

function commandFailure(c: Context, code: CommandErrorCode, message: string): Response {
  return failure(c, statusForCommandCode(code), code, message);
}

function tokenDigest(value: string): Buffer {
  return createHash('sha256').update(value, 'utf8').digest();
}

function bearerToken(header: string | undefined): string | null {
  if (!header) return null;
  const match = /^Bearer[ \t]+(\S+)[ \t]*$/i.exec(header);
  return match?.[1] ?? null;
}

function isHashedAsset(file: string): boolean {
  return /-[A-Za-z0-9_-]{8,}\.[A-Za-z0-9]+$/.test(basename(file));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function pick(source: Record<string, unknown>, keys: readonly string[]): Record<string, unknown> {
  const picked: Record<string, unknown> = {};
  for (const key of keys) {
    if (Object.hasOwn(source, key)) picked[key] = source[key];
  }
  return picked;
}

function singleParam(params: URLSearchParams, key: string): { ok: true; value: string | null } | { ok: false } {
  const values = params.getAll(key);
  if (values.length > 1) return { ok: false };
  return { ok: true, value: values[0] ?? null };
}

function errorKind(error: unknown): string {
  if (error instanceof Error) {
    const code = 'code' in error && typeof error.code === 'string' ? ` ${error.code}` : '';
    return `${error.name}${code}`;
  }
  return typeof error;
}

export function createApp(options: CreateAppOptions): Hono {
  const { core, port } = options;
  const expectedToken = tokenDigest(options.token);
  const allowedHosts = new Set([`127.0.0.1:${port}`, `localhost:${port}`]);
  const logError = options.logError ?? ((line: string) => process.stderr.write(`${line}\n`));
  const app = new Hono();

  app.use('*', async (c, next) => {
    await next();
    c.res.headers.set('X-Content-Type-Options', 'nosniff');
    c.res.headers.set('Referrer-Policy', 'no-referrer');
  });

  app.use('*', async (c, next) => {
    const host = c.req.header('host')?.toLowerCase() ?? '';
    if (!allowedHosts.has(host)) return failure(c, 403, 'forbidden_host', '只接受 127.0.0.1 或 localhost 的请求');
    await next();
  });

  const requireToken: MiddlewareHandler = async (c, next) => {
    if (c.req.path === '/api/v1/health') return next();
    const provided = bearerToken(c.req.header('authorization'));
    if (provided === null || !timingSafeEqual(tokenDigest(provided), expectedToken)) {
      return failure(c, 401, 'unauthorized', '缺少口令或口令不对');
    }
    await next();
  };
  app.use('/api/v1/*', requireToken);
  app.use('/api/v1', requireToken);

  app.onError((error, c) => {
    logError(`bluemanta 本地服务：内部错误（${errorKind(error)}）`);
    return failure(c, 500, 'internal', '服务内部错误');
  });

  const lookup = (id: string) => core.getAttachment(id);

  async function readJson(c: Context): Promise<{ ok: true; value: Record<string, unknown> } | { ok: false; response: Response }> {
    const limited = await readLimitedBody(c.req.raw.body, JSON_LIMIT_BYTES);
    if (!limited.ok) {
      const message = limited.reason === 'too_large' ? '请求体太大' : '请求体不是 JSON';
      return { ok: false, response: failure(c, 400, 'invalid_input', message) };
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(limited.bytes.toString('utf8'));
    } catch {
      return { ok: false, response: failure(c, 400, 'invalid_input', '请求体不是 JSON') };
    }
    if (!isRecord(parsed)) return { ok: false, response: failure(c, 400, 'invalid_input', '请求体需要是对象') };
    return { ok: true, value: parsed };
  }

  function seenRequest(requestId: unknown): boolean {
    if (typeof requestId !== 'string') return false;
    return core.listHistory().some((entry) => entry.requestId === requestId);
  }

  /** 已存在但不是灵感的卡片按不存在处理；不存在时交给 core，以便重放已彻底删除的请求。 */
  function otherCardType(id: string): boolean {
    const card = core.getCard(id);
    return card !== null && card.cardType !== 'idea';
  }

  function editedIds(): Set<string> {
    return isEditedHistory(core.listHistory());
  }

  function ideaWrite(c: Context, requestId: unknown, run: () => CommandResult<Card>): Response {
    const duplicate = seenRequest(requestId);
    const result = run();
    if (!result.ok) return commandFailure(c, result.code, result.message);
    if (result.record.cardType !== 'idea') return failure(c, 404, 'not_found', '记录不存在');
    const body: IdeaWriteResponse = {
      ok: true,
      record: toIdeaRecord(result.record, lookup, editedIds().has(result.record.id)),
      ...(duplicate ? { duplicate: true as const } : {}),
    };
    return c.json(body, 200, NO_STORE);
  }

  function methodNotAllowed(c: Context): Response {
    return failure(c, 405, 'method_not_allowed', `不支持 ${c.req.method}`);
  }

  app.get('/api/v1/health', (c) => {
    const body: HealthResponse = { service: 'bluemanta', apiVersion: API_VERSION, version: SERVER_VERSION };
    return c.json(body, 200, NO_STORE);
  });
  app.all('/api/v1/health', methodNotAllowed);

  app.get('/api/v1/ideas', (c) => {
    const params = new URL(c.req.url).searchParams;
    const scopeParam = singleParam(params, 'scope');
    if (!scopeParam.ok) return failure(c, 400, 'invalid_input', 'scope 只能出现一次');
    const scope = scopeParam.value ?? 'active';
    if (scope !== 'active' && scope !== 'trash') return failure(c, 400, 'invalid_input', 'scope 只能是 active 或 trash');
    const queryParam = singleParam(params, 'q');
    if (!queryParam.ok) return failure(c, 400, 'invalid_input', 'q 只能出现一次');
    const query = queryParam.value;
    if (query !== null && query.trim() === '') return failure(c, 400, 'invalid_input', 'q 不能为空');

    const edited = editedIds();
    let items: IdeaListItem[];
    if (query !== null) {
      items = core
        .searchCards(query, { cardType: 'idea', deleted: scope })
        .filter((hit): hit is typeof hit & { card: IdeaCard } => hit.card.cardType === 'idea')
        .map((hit) => ({
          ...toIdeaRecord(hit.card, lookup, edited.has(hit.card.id)),
          match: { field: hit.field, excerpt: hit.excerpt },
        }));
    } else {
      items = core
        .listCards({ cardType: 'idea', deleted: scope })
        .filter((card): card is IdeaCard => card.cardType === 'idea')
        .map((card) => toIdeaRecord(card, lookup, edited.has(card.id)));
    }
    items = sortIdeas(items, scope);
    const body: IdeaListResponse = { ok: true, count: items.length, items };
    return c.json(body, 200, NO_STORE);
  });

  app.post('/api/v1/ideas', async (c) => {
    const payload = await readJson(c);
    if (!payload.ok) return payload.response;
    const input = payload.value;
    return ideaWrite(c, input.requestId, () =>
      core.card.create({
        ...pick(input, ['requestId', 'title', 'body', 'attachmentIds']),
        ...(Object.hasOwn(input, 'category') ? { fields: { category: input.category } } : {}),
        cardType: 'idea',
        source: DESKTOP_SOURCE,
      } as CardCreateInput),
    );
  });
  app.all('/api/v1/ideas', methodNotAllowed);

  app.get('/api/v1/ideas/:id', (c) => {
    const card = core.getCard(c.req.param('id'));
    if (!card || card.cardType !== 'idea') return failure(c, 404, 'not_found', '记录不存在');
    const body: IdeaResponse = { ok: true, record: toIdeaRecord(card, lookup, editedIds().has(card.id)) };
    return c.json(body, 200, NO_STORE);
  });

  app.patch('/api/v1/ideas/:id', async (c) => {
    const id = c.req.param('id');
    if (otherCardType(id)) return failure(c, 404, 'not_found', '记录不存在');
    const payload = await readJson(c);
    if (!payload.ok) return payload.response;
    const input = payload.value;
    return ideaWrite(c, input.requestId, () =>
      core.card.update({
        ...pick(input, ['requestId', 'rev', 'title', 'body', 'attachmentIds']),
        ...(Object.hasOwn(input, 'category') ? { fields: { category: input.category } } : {}),
        id,
        source: DESKTOP_SOURCE,
      } as CardUpdateInput),
    );
  });
  app.all('/api/v1/ideas/:id', methodNotAllowed);

  app.put('/api/v1/ideas/:id/star', async (c) => {
    const id = c.req.param('id');
    if (otherCardType(id)) return failure(c, 404, 'not_found', '记录不存在');
    const payload = await readJson(c);
    if (!payload.ok) return payload.response;
    const input = payload.value;
    return ideaWrite(c, input.requestId, () =>
      core.card.setStar({ ...pick(input, ['requestId', 'rev', 'starred']), id, source: DESKTOP_SOURCE } as CardSetStarInput),
    );
  });
  app.all('/api/v1/ideas/:id/star', methodNotAllowed);

  for (const [action, run] of [
    ['trash', core.card.delete],
    ['restore', core.card.restore],
  ] as const) {
    app.post(`/api/v1/ideas/:id/${action}`, async (c) => {
      const id = c.req.param('id');
      if (otherCardType(id)) return failure(c, 404, 'not_found', '记录不存在');
      const payload = await readJson(c);
      if (!payload.ok) return payload.response;
      const input = payload.value;
      return ideaWrite(c, input.requestId, () =>
        run({ ...pick(input, ['requestId', 'rev']), id, source: DESKTOP_SOURCE } as CardRevInput),
      );
    });
    app.all(`/api/v1/ideas/:id/${action}`, methodNotAllowed);
  }

  app.post('/api/v1/ideas/:id/purge', async (c) => {
    const id = c.req.param('id');
    if (otherCardType(id)) return failure(c, 404, 'not_found', '记录不存在');
    const payload = await readJson(c);
    if (!payload.ok) return payload.response;
    const input = payload.value;
    const duplicate = seenRequest(input.requestId);
    const result = core.card.purge({ ...pick(input, ['requestId', 'rev']), id, source: DESKTOP_SOURCE } as CardRevInput);
    if (!result.ok) return commandFailure(c, result.code, result.message);
    discardPurgedAttachments(core, result.record.attachmentIds);
    const body: IdeaPurgeResponse = {
      ok: true,
      record: { id: result.record.id },
      ...(duplicate ? { duplicate: true as const } : {}),
    };
    return c.json(body, 200, NO_STORE);
  });
  app.all('/api/v1/ideas/:id/purge', methodNotAllowed);

  app.post('/api/v1/ideas/:id/extensions', async (c) => {
    const id = c.req.param('id');
    if (otherCardType(id)) return failure(c, 404, 'not_found', '记录不存在');
    const payload = await readJson(c);
    if (!payload.ok) return payload.response;
    const input = payload.value;
    return ideaWrite(c, input.requestId, () =>
      core.card.addExtension({
        ...pick(input, ['requestId', 'rev']),
        ...(Object.hasOwn(input, 'text') ? { body: input.text } : {}),
        id,
        source: DESKTOP_SOURCE,
      } as CardAddExtensionInput),
    );
  });
  app.all('/api/v1/ideas/:id/extensions', methodNotAllowed);

  app.delete('/api/v1/ideas/:id/extensions/:extensionId', async (c) => {
    const id = c.req.param('id');
    if (otherCardType(id)) return failure(c, 404, 'not_found', '记录不存在');
    const payload = await readJson(c);
    if (!payload.ok) return payload.response;
    const input = payload.value;
    return ideaWrite(c, input.requestId, () =>
      core.card.deleteExtension({
        ...pick(input, ['requestId', 'rev']),
        id,
        extensionId: c.req.param('extensionId'),
        source: DESKTOP_SOURCE,
      } as CardDeleteExtensionInput),
    );
  });
  app.all('/api/v1/ideas/:id/extensions/:extensionId', methodNotAllowed);

  app.post('/api/v1/attachments', async (c) => {
    const params = new URL(c.req.url).searchParams;
    const requestId = singleParam(params, 'requestId');
    if (!requestId.ok) return failure(c, 400, 'invalid_input', 'requestId 只能出现一次');
    const name = singleParam(params, 'name');
    if (!name.ok) return failure(c, 400, 'invalid_input', 'name 只能出现一次');
    if (requestId.value === null || requestId.value.trim() === '') {
      return failure(c, 400, 'invalid_input', 'requestId 不能为空');
    }

    const checked = await readImageUpload(c.req.raw.body, {
      name: name.value,
      contentType: c.req.header('content-type') ?? null,
    });
    if (!checked.ok) return failure(c, 400, 'invalid_input', checked.message);

    const duplicate = seenRequest(requestId.value);
    const created = core.attachment.create({
      requestId: requestId.value,
      source: DESKTOP_SOURCE,
      mime: checked.mime,
      byteSize: checked.byteSize,
      width: checked.width,
      height: checked.height,
      sha256: checked.sha256,
    });
    if (!created.ok) return commandFailure(c, created.code, created.message);

    try {
      writeStoredFile(core.dataDir, created.record.path, checked.bytes);
    } catch (error) {
      logError(`bluemanta 本地服务：图片没有写入（${errorKind(error)}）`);
      return failure(c, 500, 'internal', '图片没有写入');
    }
    const body: AttachmentUploadResponse = {
      ok: true,
      record: toAttachmentMeta(created.record),
      ...(duplicate ? { duplicate: true as const } : {}),
    };
    return c.json(body, 200, NO_STORE);
  });
  app.all('/api/v1/attachments', methodNotAllowed);

  app.get('/api/v1/attachments/:id', (c) => {
    const attachment = core.getAttachment(c.req.param('id'));
    if (!attachment) return failure(c, 404, 'not_found', '附件不存在');
    if (IMAGE_EXTENSION[attachment.mime as ImageMime] === undefined && !attachment.mime.startsWith('image/')) {
      return failure(c, 404, 'not_found', '附件不存在');
    }
    const bytes = readStoredFile(core.dataDir, attachment.path);
    if (!bytes) return failure(c, 404, 'not_found', '附件不存在');
    return new Response(new Uint8Array(bytes), {
      status: 200,
      headers: {
        'content-type': attachment.mime,
        'content-length': String(bytes.byteLength),
        'cache-control': 'private, max-age=31536000, immutable',
      },
    });
  });
  app.all('/api/v1/attachments/:id', methodNotAllowed);

  app.all('/api/*', (c) => failure(c, 404, 'not_found', '接口不存在'));
  app.all('/api', (c) => failure(c, 404, 'not_found', '接口不存在'));

  const webDir = options.webDir;
  const indexFile = webDir === null ? null : join(webDir, 'index.html');
  const webBuilt = () => indexFile !== null && existsSync(indexFile) && statSync(indexFile).isFile();
  let staticHandler: MiddlewareHandler | null = null;

  app.on(['GET', 'HEAD'], '*', async (c, next) => {
    if (!webBuilt() || webDir === null) {
      return c.html(NOT_BUILT_PAGE, 200, NO_STORE);
    }
    staticHandler ??= serveStatic({ root: webDir });
    const path = c.req.path;
    if (path.endsWith('/') || basename(path) === 'index.html') c.header('Cache-Control', 'no-store');
    else if (isHashedAsset(path)) c.header('Cache-Control', 'public, max-age=31536000, immutable');
    else c.header('Cache-Control', 'no-cache');
    return staticHandler(c, next);
  });

  app.on(['GET', 'HEAD'], '*', (c) => {
    if (indexFile === null) return c.html(NOT_BUILT_PAGE, 200, NO_STORE);
    return c.html(readFileSync(indexFile, 'utf8'), 200, NO_STORE);
  });

  app.notFound((c) => failure(c, 404, 'not_found', '不存在'));

  return app;
}
