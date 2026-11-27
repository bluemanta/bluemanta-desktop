import { join } from 'node:path';
import { gitCommits, gitCommit, KnowledgeError, PersonalOsReader, PersonalOsWriter, SourcesReader, abbreviateHome, type PersonalOsVersion, type KnowledgeEnv } from '@bluemanta/knowledge';
import { Hono, type Context } from 'hono';
import type {
  ApiErrorCode, ApiFailure, PersonalOsDomainResponse, PersonalOsFileResponse, PersonalOsLogResponse,
  PersonalOsOverviewResponse, PersonalOsRegistryResponse, PersonalOsTodayResponse, PersonalOsQuickNoteResponse, PersonalOsCompleteResponse,
  PersonalOsSourcesResponse, PersonalOsTaskLogResponse, PersonalOsAboutResponse,
} from './api-types.js';

const NO_STORE = { 'cache-control': 'no-store' };

function failure(c: Context, status: number, code: ApiErrorCode, message: string): Response {
  return c.json({ ok: false, code, message } satisfies ApiFailure, status as 400, NO_STORE);
}
function readFailure(c: Context, error: unknown): Response {
  if (error instanceof KnowledgeError) {
    switch (error.code) {
      case 'library_missing': return failure(c, 404, 'library_missing', '没有找到 PersonalOS');
      case 'conflict': return failure(c, 409, 'conflict', '文件刚被改过，已刷新，请再试一次');
      case 'invalid_input': return failure(c, 400, 'invalid_input', error.message);
      case 'forbidden': return failure(c, 403, 'forbidden', error.message);
      case 'invalid_path': return failure(c, 400, 'invalid_path', '路径不能越界或包含隐藏内容');
      case 'library_not_found':
      case 'not_found': return failure(c, 404, 'not_found', '没有找到这个领域或文件');
      default: return failure(c, 500, 'read_error', 'PersonalOS 读取失败，请重试');
    }
  }
  // Do not return filesystem errors: their messages can contain private absolute paths.
  return failure(c, 500, 'read_error', 'PersonalOS 读取失败，请重试');
}
/** Decode exactly once; validate the resulting logical path in the data layer. */
const BODY_LIMIT = 16 * 1024;
async function readBody(c: Context): Promise<Record<string, unknown> | null> {
  try {
    const text = await c.req.text();
    if (Buffer.byteLength(text, 'utf8') > BODY_LIMIT) return null;
    const value: unknown = JSON.parse(text);
    return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
  } catch { return null; }
}
/** Writes that fail after validation: never echo filesystem messages, they can hold absolute paths. */
function writeFailure(c: Context, error: unknown): Response {
  if (error instanceof KnowledgeError) return readFailure(c, error);
  return failure(c, 500, 'write_error', 'PersonalOS 写入失败，文件没有改动或只改了一部分，请刷新后查看');
}
function tailPath(c: Context, marker: string): string | null {
  const pathname = new URL(c.req.url).pathname;
  const start = pathname.indexOf(marker);
  if (start < 0) return null;
  try { return pathname.slice(start + marker.length).split('/').map((segment) => decodeURIComponent(segment)).join('/'); }
  catch { return null; }
}
function validDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

/** Registered below the server's shared Host and Bearer-token middleware. Construction does no I/O. */
export function createPersonalOsApi(env: KnowledgeEnv, monitor: PersonalOsVersion): Hono {
  const root = env.libraries.find((library) => library.kind === 'personalos' || library.id === 'personalos')?.root;
  const reader = new PersonalOsReader({ home: env.home, ...(root === undefined ? {} : { root }) });
  const writer = new PersonalOsWriter({ home: env.home, ...(root === undefined ? {} : { root }) });
  // 接入页（ADR 0013）：只读；唯一的子进程是 `launchctl list`。
  const sources = new SourcesReader({ home: env.home, ...(root === undefined ? {} : { root }) });
  const app = new Hono();
  app.use('/personalos/*', async (_c,next) => { monitor.current(); await next(); });
  app.get('/personalos/version',c=>c.json({ok:true,...monitor.current()},200,NO_STORE));

  app.get('/personalos', (c) => {
    try {
      monitor.current();
      const overview = reader.overview();
      const body: PersonalOsOverviewResponse = { ok: true, ...overview, documents: overview.exists ? reader.documents() : [] };
      return c.json(body, 200, NO_STORE);
    } catch (error) { return readFailure(c, error); }
  });

  app.get('/personalos/today', (c) => {
    try { const body: PersonalOsTodayResponse = { ok: true, ...reader.today() }; return c.json(body, 200, NO_STORE); }
    catch (error) { return readFailure(c, error); }
  });

  app.get('/personalos/domains/:id', (c) => {
    const id = tailPath(c, '/personalos/domains/');
    if (id === null || id.trim() === '' || id.startsWith('.') || /[/\\\0]/.test(id)) return failure(c, 400, 'invalid_path', '领域名称不合法');
    try { const body: PersonalOsDomainResponse = { ok: true, ...reader.domain(id) }; return c.json(body, 200, NO_STORE); }
    catch (error) { return readFailure(c, error); }
  });

  app.get('/personalos/registry', (c) => {
    try { const body: PersonalOsRegistryResponse = { ok: true, items: reader.registry() }; return c.json(body, 200, NO_STORE); }
    catch (error) { return readFailure(c, error); }
  });

  app.get('/personalos/log', (c) => {
    const params = new URL(c.req.url).searchParams;
    if (['before', 'days', 'unassigned'].some((name) => params.getAll(name).length > 1)) return failure(c, 400, 'invalid_input', 'before、days 和 unassigned 只能出现一次');
    const before = params.get('before') || undefined;
    if (before !== undefined && !validDate(before)) return failure(c, 400, 'invalid_input', 'before 必须是有效的 YYYY-MM-DD 日期');
    const rawDays = params.get('days'); const days = rawDays === null || rawDays === '' ? 30 : Number(rawDays);
    if (!Number.isSafeInteger(days) || days < 1 || days * 86_400_000 > 8.64e15) return failure(c, 400, 'invalid_input', 'days 必须是有效的正整数天数');
    const domains = params.getAll('domain').map((domain) => domain.trim()).filter(Boolean);
    const unassigned = params.get('unassigned');
    if (unassigned !== null && unassigned !== '0' && unassigned !== '1') return failure(c, 400, 'invalid_input', 'unassigned 只能是 0 或 1');
    try {
      const body: PersonalOsLogResponse = { ok: true, ...reader.log({ days, includeUnassigned: unassigned === '1', ...(before === undefined ? {} : { before }), ...(domains.length ? { domains } : {}) }) };
      return c.json(body, 200, NO_STORE);
    } catch (error) { return readFailure(c, error); }
  });

  app.get('/personalos/git/commits', async c => {
    try {
      const overview = reader.overview();
      if (!overview.exists) return failure(c,404,'library_missing','没有找到 PersonalOS');
      const params = new URL(c.req.url).searchParams;
      const domains = (params.get('domain') || '').split(',').filter(Boolean);
      const skip = Number(params.get('skip') ?? 0);
      const limit = Number(params.get('limit') ?? 30);
      const unassigned = params.get('unassigned') ?? '0';
      if (!Number.isSafeInteger(skip) || skip < 0 || !Number.isInteger(limit) || limit < 1 || limit > 100 ||
          !['0','1'].includes(unassigned) || domains.some(d => !overview.domains.some(r => r.name === d))) {
        return failure(c,400,'invalid_input','提交筛选或分页参数无效');
      }
      const result = await gitCommits(reader.root,overview.domains,{domains,skip,limit,unassigned:unassigned === '1'});
      return c.json({ok:true,...result},200,NO_STORE);
    } catch (error) { return readFailure(c,error); }
  });
  app.get('/personalos/git/commits/:sha', async c => {
    try {
      const overview = reader.overview();
      if (!overview.exists) return failure(c,404,'library_missing','没有找到 PersonalOS');
      const result = await gitCommit(reader.root,overview.domains,c.req.param('sha'));
      return c.json({ok:true,...result},200,NO_STORE);
    } catch (error) { return readFailure(c,error); }
  });

  /** 关于页（规格第 15 节）：只读 PersonalOS 内的文件。 */
  app.get('/personalos/about', (c) => {
    try { const body: PersonalOsAboutResponse = { ok: true, ...reader.about() }; return c.json(body, 200, NO_STORE); }
    catch (error) { return readFailure(c, error); }
  });

  app.get('/personalos/sources', async (c) => {
    try { const body: PersonalOsSourcesResponse = { ok: true, ...(await sources.collect()) }; return c.json(body, 200, NO_STORE); }
    catch (error) { return readFailure(c, error); }
  });
  /** `ref` is one URL-encoded segment such as `launchd%3Alocal.example`; the log path always comes from the registry. */
  app.get('/personalos/sources/tasks/:ref/log', (c) => {
    const ref = tailPath(c, '/personalos/sources/tasks/')?.replace(/\/log$/, '') ?? null;
    if (ref === null || ref === '' || ref.length > 200 || /[\/\\\0]/.test(ref)) return failure(c, 400, 'invalid_input', '任务标识不合法');
    try { const body: PersonalOsTaskLogResponse = { ok: true, ...sources.taskLog(ref) }; return c.json(body, 200, NO_STORE); }
    catch (error) { return readFailure(c, error); }
  });

  app.post('/personalos/inbox', async (c) => {
    const body = await readBody(c);
    if (!body || typeof body.text !== 'string') return failure(c, 400, 'invalid_input', '请求体需要 { text }');
    try { const result = await writer.quickNote(body.text); return c.json({ ok: true, ...result } satisfies PersonalOsQuickNoteResponse, 200, NO_STORE); }
    catch (error) { return writeFailure(c, error); }
  });

  app.post('/personalos/todos/complete', async (c) => {
    const body = await readBody(c);
    if (!body || typeof body.domain !== 'string' || !Number.isSafeInteger(body.line) || typeof body.raw !== 'string'
      || typeof body.hash !== 'string' || !/^[0-9a-f]{64}$/.test(body.hash) || typeof body.dryRun !== 'boolean') {
      return failure(c, 400, 'invalid_input', '请求体需要 { domain, line, raw, hash, dryRun }');
    }
    try {
      const result = await writer.completeTodo({ domain: body.domain, line: body.line as number, raw: body.raw, hash: body.hash, dryRun: body.dryRun });
      return c.json({ ok: true, ...result } satisfies PersonalOsCompleteResponse, 200, NO_STORE);
    } catch (error) { return writeFailure(c, error); }
  });

  app.get('/personalos/files/*', (c) => {
    const path = tailPath(c, '/personalos/files/');
    if (path === null || path === '') return failure(c, 400, 'invalid_path', '文件路径或编码不合法');
    try {
      const file = reader.file(path);
      const body: PersonalOsFileResponse = {
        ok: true,
        library: { id: 'personalos', name: 'PersonalOS', root: abbreviateHome(reader.root, env.home), writable: false, exists: true, indexFile: reader.routing().file, topicCount: 0, inboxCount: reader.inbox().length },
        file,
        displayPath: abbreviateHome(join(reader.root, ...file.path.split('/')), env.home),
      };
      return c.json(body, 200, NO_STORE);
    } catch (error) { return readFailure(c, error); }
  });

  for (const path of ['/personalos', '/personalos/today', '/personalos/domains/:id', '/personalos/registry', '/personalos/log', '/personalos/files/*', '/personalos/git/commits', '/personalos/git/commits/:sha', '/personalos/about', '/personalos/sources', '/personalos/sources/tasks/:ref/log', '/personalos/inbox', '/personalos/todos/complete']) {
    app.all(path, (c) => failure(c, 405, 'method_not_allowed', `不支持 ${c.req.method}`));
  }
  return app;
}
