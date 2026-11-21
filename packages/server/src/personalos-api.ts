import { join } from 'node:path';
import { KnowledgeError, PersonalOsReader, abbreviateHome, type KnowledgeEnv } from '@bluemanta/knowledge';
import { Hono, type Context } from 'hono';
import type {
  ApiErrorCode, ApiFailure, PersonalOsDomainResponse, PersonalOsFileResponse, PersonalOsLogResponse,
  PersonalOsOverviewResponse, PersonalOsRegistryResponse, PersonalOsTodayResponse,
} from './api-types.js';

const NO_STORE = { 'cache-control': 'no-store' };

function failure(c: Context, status: number, code: ApiErrorCode, message: string): Response {
  return c.json({ ok: false, code, message } satisfies ApiFailure, status as 400, NO_STORE);
}
function readFailure(c: Context, error: unknown): Response {
  if (error instanceof KnowledgeError) {
    switch (error.code) {
      case 'library_missing': return failure(c, 404, 'library_missing', '没有找到 PersonalOS');
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
export function createPersonalOsApi(env: KnowledgeEnv): Hono {
  const root = env.libraries.find((library) => library.kind === 'personalos' || library.id === 'personalos')?.root;
  const reader = new PersonalOsReader({ home: env.home, ...(root === undefined ? {} : { root }) });
  const app = new Hono();

  app.get('/personalos', (c) => {
    try {
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

  app.get('/personalos/files/*', (c) => {
    const path = tailPath(c, '/personalos/files/');
    if (path === null || path === '') return failure(c, 400, 'invalid_path', '文件路径或编码不合法');
    try {
      const file = reader.file(path);
      const body: PersonalOsFileResponse = {
        ok: true,
        library: { id: 'personalos', name: 'PersonalOS', root: abbreviateHome(reader.root, env.home), writable: false, exists: true, indexFile: 'AGENTS.md', topicCount: 0, inboxCount: reader.inbox().length },
        file,
        displayPath: abbreviateHome(join(reader.root, ...file.path.split('/')), env.home),
      };
      return c.json(body, 200, NO_STORE);
    } catch (error) { return readFailure(c, error); }
  });

  for (const path of ['/personalos', '/personalos/today', '/personalos/domains/:id', '/personalos/registry', '/personalos/log', '/personalos/files/*']) {
    app.all(path, (c) => failure(c, 405, 'method_not_allowed', `不支持 ${c.req.method}`));
  }
  return app;
}
