import {
  KnowledgeError,
  abbreviateHome,
  listInbox,
  listLibraries,
  normalizeRelPath,
  readLibraryFile,
  readLibraryIndex,
  readTopic,
  type KnowledgeEnv,
  type KnowledgeIndex,
  type LibrarySummary,
  type SearchHit,
} from '@bluemanta/knowledge';
import { Hono, type Context } from 'hono';
import { join } from 'node:path';
import type {
  ApiErrorCode,
  ApiFailure,
  KnowledgeFileResponse,
  KnowledgeInboxResponse,
  KnowledgeIndexResponse,
  KnowledgeLibrariesResponse,
  KnowledgeLibrary,
  KnowledgeRouteResponse,
  KnowledgeSearchHit,
  KnowledgeSearchResponse,
  KnowledgeTopicResponse,
} from './api-types.js';

const NO_STORE = { 'cache-control': 'no-store' };
const LIBRARY_ID = /^[a-z0-9][a-z0-9-]*$/;
const MAX_LIMIT = 50;

function failure(c: Context, status: number, code: ApiErrorCode, message: string): Response {
  return c.json({ ok: false, code, message } satisfies ApiFailure, status as 400, NO_STORE);
}

function library(value: LibrarySummary, env: KnowledgeEnv): KnowledgeLibrary {
  return { ...value, root: abbreviateHome(value.root, env.home) };
}

/** Maps package errors to HTTP. Messages never carry absolute paths (ADR 0009 decision 7). */
function knowledgeFailure(c: Context, error: unknown): Response {
  if (!(error instanceof KnowledgeError)) throw error;
  switch (error.code) {
    case 'library_not_found':
      return failure(c, 404, 'not_found', error.message);
    case 'library_missing':
      return failure(c, 404, 'knowledge_library_missing', error.message);
    case 'invalid_path':
      return failure(c, 400, 'knowledge_invalid_path', error.message);
    case 'not_a_topic':
      return failure(c, 400, 'invalid_input', error.message);
    case 'not_found':
      return failure(c, 404, 'not_found', error.message);
    default:
      return failure(c, 500, 'knowledge_read_error', error.message);
  }
}

/**
 * The library-relative path after `/…/:lib/<segment>/`, taken from the raw URL and decoded once per
 * segment so `%2F` cannot smuggle extra separators past normalization.
 */
function tailPath(c: Context, marker: string): string | null {
  const pathname = new URL(c.req.url).pathname;
  const index = pathname.indexOf(marker);
  if (index < 0) return '';
  try {
    return pathname
      .slice(index + marker.length)
      .split('/')
      .map((segment) => decodeURIComponent(segment))
      .join('/');
  } catch {
    return null;
  }
}

function limitParam(raw: string | undefined, fallback: number): number | null {
  if (raw === undefined || raw === '') return fallback;
  const value = Number(raw);
  return Number.isInteger(value) && value >= 1 && value <= MAX_LIMIT ? value : null;
}

function hitView(hit: SearchHit): KnowledgeSearchHit {
  const { chunkId: _chunkId, ...rest } = hit;
  return rest;
}

export type KnowledgeApiOptions = {
  env: KnowledgeEnv;
  /** Created on first use so requests that never search do not touch the index file. */
  index: () => KnowledgeIndex;
};

export function createKnowledgeApi(options: KnowledgeApiOptions): Hono {
  const { env } = options;
  const app = new Hono();

  const libraryId = (c: Context): string | null => {
    const id = c.req.param('lib') ?? '';
    return LIBRARY_ID.test(id) ? id : null;
  };

  app.get('/knowledge/libraries', (c) => {
    const body: KnowledgeLibrariesResponse = { ok: true, libraries: listLibraries(env).map((item) => library(item, env)) };
    return c.json(body, 200, NO_STORE);
  });

  app.get('/knowledge/libraries/:lib', (c) => {
    const id = libraryId(c);
    if (id === null) return failure(c, 400, 'invalid_input', '库 id 不合法');
    try {
      const index = readLibraryIndex(env, id);
      const body: KnowledgeIndexResponse = { ok: true, library: library(index.library, env), categories: index.categories, warnings: index.warnings };
      return c.json(body, 200, NO_STORE);
    } catch (error) {
      return knowledgeFailure(c, error);
    }
  });

  app.get('/knowledge/libraries/:lib/inbox', (c) => {
    const id = libraryId(c);
    if (id === null) return failure(c, 400, 'invalid_input', '库 id 不合法');
    try {
      const files = listInbox(env, id);
      const body: KnowledgeInboxResponse = { ok: true, library: library(readLibraryIndex(env, id).library, env), files };
      return c.json(body, 200, NO_STORE);
    } catch (error) {
      return knowledgeFailure(c, error);
    }
  });

  app.get('/knowledge/libraries/:lib/topics/*', (c) => {
    const id = libraryId(c);
    if (id === null) return failure(c, 400, 'invalid_input', '库 id 不合法');
    const path = tailPath(c, `/libraries/${id}/topics/`);
    if (path === null) return failure(c, 400, 'knowledge_invalid_path', '路径编码不合法');
    try {
      const detail = readTopic(env, id, path);
      const body: KnowledgeTopicResponse = { ok: true, ...detail, library: library(detail.library, env) };
      return c.json(body, 200, NO_STORE);
    } catch (error) {
      return knowledgeFailure(c, error);
    }
  });

  app.get('/knowledge/libraries/:lib/files/*', (c) => {
    const id = libraryId(c);
    if (id === null) return failure(c, 400, 'invalid_input', '库 id 不合法');
    const path = tailPath(c, `/libraries/${id}/files/`);
    if (path === null) return failure(c, 400, 'knowledge_invalid_path', '路径编码不合法');
    try {
      const file = readLibraryFile(env, id, path);
      const summary = readLibraryIndex(env, id).library;
      const rel = normalizeRelPath(path);
      const body: KnowledgeFileResponse = {
        ok: true,
        library: library(summary, env),
        file,
        displayPath: abbreviateHome(join(summary.root, ...rel.split('/')), env.home),
      };
      return c.json(body, 200, NO_STORE);
    } catch (error) {
      return knowledgeFailure(c, error);
    }
  });

  app.get('/knowledge/search', (c) => {
    const params = new URL(c.req.url).searchParams;
    const query = params.get('q')?.trim() ?? '';
    if (query === '') return failure(c, 400, 'invalid_input', 'q 不能为空');
    const limit = limitParam(params.get('limit') ?? undefined, 20);
    if (limit === null) return failure(c, 400, 'invalid_input', `limit 应是 1 到 ${MAX_LIMIT} 的整数`);
    const libraries = params.getAll('library');
    if (libraries.some((id) => !LIBRARY_ID.test(id))) return failure(c, 400, 'invalid_input', '库 id 不合法');
    const ideas = params.get('ideas');
    if (ideas !== null && ideas !== '0' && ideas !== '1') return failure(c, 400, 'invalid_input', 'ideas 只能是 0 或 1');
    const result = options.index().search(query, {
      limit,
      includeIdeas: ideas !== '0',
      ...(libraries.length > 0 ? { libraries } : {}),
    });
    const body: KnowledgeSearchResponse = { ok: true, query: result.query, keywords: result.keywords, hits: result.hits.map(hitView) };
    return c.json(body, 200, NO_STORE);
  });

  app.get('/knowledge/route', (c) => {
    const params = new URL(c.req.url).searchParams;
    const query = params.get('q')?.trim() ?? '';
    if (query === '') return failure(c, 400, 'invalid_input', 'q 不能为空');
    const limit = limitParam(params.get('limit') ?? undefined, 5);
    if (limit === null) return failure(c, 400, 'invalid_input', `limit 应是 1 到 ${MAX_LIMIT} 的整数`);
    const libraries = params.getAll('library');
    const candidates = options.index().route(query, { limit, ...(libraries.length > 0 ? { libraries } : {}) });
    const body: KnowledgeRouteResponse = { ok: true, query, candidates };
    return c.json(body, 200, NO_STORE);
  });

  return app;
}
