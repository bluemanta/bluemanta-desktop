import { join } from 'node:path';
import type { Core } from '@bluemanta/core';
import {
  KnowledgeError,
  KnowledgeIndex,
  TOPIC_DOCUMENT_FILES,
  abbreviateHome,
  defaultKnowledgeEnv,
  getLibrary,
  normalizeRelPath,
  readLibraryFile,
  readTopic,
  type IdeaDoc,
  type KnowledgeEnv,
} from '@bluemanta/knowledge';

/** Derived full-text index in the Desktop data dir (ADR 0009 decision 4); safe to delete. */
export const KNOWLEDGE_INDEX_FILE = 'knowledge-index.sqlite';

/** Active idea cards as index documents: body plus raw input (when different) and extensions. */
export function ideaDocsFrom(core: Pick<Core, 'listCards'>): IdeaDoc[] {
  return core.listCards({ cardType: 'idea', deleted: 'active' }).map((card) => {
    const extra: string[] = [];
    if (card.rawInput.status === 'present' && card.rawInput.text.trim() !== card.body.trim()) extra.push(card.rawInput.text);
    for (const extension of card.extensions) extra.push(extension.body);
    return {
      id: card.id,
      title: card.title,
      body: card.body,
      ...(extra.length > 0 ? { extraText: extra.join('\n\n') } : {}),
      createdAt: card.createdAt,
      updatedAt: card.updatedAt,
    };
  });
}

export type OpenKnowledgeIndexOptions = {
  dataDir: string;
  /** When given, active ideas are indexed alongside the libraries. */
  core?: Pick<Core, 'listCards'>;
  env?: KnowledgeEnv;
  refreshIntervalMs?: number;
};

export function openKnowledgeIndex(options: OpenKnowledgeIndexOptions): KnowledgeIndex {
  const core = options.core;
  return new KnowledgeIndex({
    env: options.env ?? defaultKnowledgeEnv(),
    dbPath: join(options.dataDir, KNOWLEDGE_INDEX_FILE),
    ...(core ? { ideas: () => ideaDocsFrom(core) } : {}),
    ...(options.refreshIntervalMs === undefined ? {} : { refreshIntervalMs: options.refreshIntervalMs }),
  });
}

// ---- agent 工具（KB5）：MCP 和 dsh 插件共用。只读，不写任何库。 ----

export const KNOWLEDGE_ROUTE_TOOL = 'bluemanta_knowledge_route';
export const KNOWLEDGE_SEARCH_TOOL = 'bluemanta_knowledge_search';
export const KNOWLEDGE_READ_TOOL = 'bluemanta_knowledge_read';

export const KNOWLEDGE_SEARCH_LIMIT_DEFAULT = 10;
export const KNOWLEDGE_SEARCH_LIMIT_MAX = 30;
/** Text returned by the read tool is capped so one call cannot flood the context. */
export const KNOWLEDGE_READ_MAX_CHARS = 20_000;

export const KNOWLEDGE_LIMITATION = '知识库只读：不能新建、修改或移动文件，入库需要用户在知识台或文件夹里操作。';

export const KNOWLEDGE_ROUTE_DESCRIPTION =
  '回答和用户个人知识、售前主题相关的问题时，先用这个工具定位主题（Router Lite）。' +
  '它按两个库的总索引（个人库 personal：思考、职业、AI、内容、家庭；Arsenal：售前业务主题、产品能力、行业场景、模板素材）比对主题名、别名、关键词和典型问题，' +
  '返回候选主题和读取顺序（README → Asset_Index → Topic_Knowledge → Topic_Log）。命中后用 bluemanta_knowledge_read 按顺序读，不要直接扫描整个库。' +
  'query 是用户的问题或关键词；library 可选，只查 personal 或 arsenal。' +
  KNOWLEDGE_LIMITATION;

export const KNOWLEDGE_SEARCH_DESCRIPTION =
  '在用户的知识库（个人库、Arsenal）和灵感里全文搜索，用来找回以前的想法、笔记、讲法和材料，例如「我之前关于 X 想过什么」。' +
  'query 用关键词，按空白分开；全部命中的排前面，不够时补只命中部分的。中文按字匹配，不是语义搜索：没找到时换同义词、拆短一点再搜几次。' +
  'library 可选（personal、arsenal），includeIdeas 默认 true；limit 默认 10，最大 30。结果给出库、路径、标题链和摘录，要看全文用 bluemanta_knowledge_read。' +
  '回答时注明出处（库和路径，或灵感 id）。' +
  KNOWLEDGE_LIMITATION;

export const KNOWLEDGE_READ_DESCRIPTION =
  '读取知识库里的一个文件或一个主题。library 是 personal 或 arsenal；path 是库内相对路径（来自路由或搜索结果）。' +
  'path 是主题目录时，返回主题的 README 正文和目录里的文件清单；是 Markdown 文件时返回正文（过长会截断，可用 offset 接着读）；其他文件只返回大小和位置。' +
  KNOWLEDGE_LIMITATION;

export type KnowledgeToolFailure = { ok: false; error: string };

export type KnowledgeRouteInput = { query: string; library?: string; limit?: number };
export type KnowledgeRouteResult =
  | { ok: true; query: string; candidates: Array<{ library: string; topicPath: string; name: string; category: string; matched: string[]; readOrder: string[] }> }
  | KnowledgeToolFailure;

export type KnowledgeSearchInput = { query: string; library?: string; includeIdeas?: boolean; limit?: number };
export type KnowledgeSearchItem = {
  source: 'library' | 'idea';
  library: string;
  path: string;
  ideaId: string;
  title: string;
  headings: string[];
  topic: string;
  archived: boolean;
  excerpt: string;
};
export type KnowledgeSearchResult = { ok: true; query: string; keywords: string[]; count: number; items: KnowledgeSearchItem[] } | KnowledgeToolFailure;

export type KnowledgeReadInput = { library: string; path: string; offset?: number };
export type KnowledgeReadResult =
  | {
      ok: true;
      library: string;
      path: string;
      kind: 'markdown' | 'file' | 'topic';
      displayPath: string;
      content: string;
      offset: number;
      nextOffset: number | null;
      files: string[];
    }
  | KnowledgeToolFailure;

function failure(error: unknown): KnowledgeToolFailure {
  if (error instanceof KnowledgeError) return { ok: false, error: error.message };
  return { ok: false, error: error instanceof Error && error.message !== '' ? error.message : '读取失败' };
}

function checkLibrary(env: KnowledgeEnv, library: string | undefined): string | null {
  if (library === undefined || library.trim() === '') return null;
  return env.libraries.some((item) => item.id === library.trim()) ? null : `没有 ${library} 这个库，可用：${env.libraries.map((item) => item.id).join('、')}`;
}

export function routeKnowledge(index: KnowledgeIndex, env: KnowledgeEnv, input: KnowledgeRouteInput): KnowledgeRouteResult {
  const query = input.query?.trim() ?? '';
  if (query === '') return { ok: false, error: 'query 不能为空' };
  const bad = checkLibrary(env, input.library);
  if (bad) return { ok: false, error: bad };
  try {
    const candidates = index.route(query, {
      limit: Math.min(Math.max(Math.trunc(input.limit ?? 5), 1), 10),
      ...(input.library ? { libraries: [input.library.trim()] } : {}),
    });
    return { ok: true, query, candidates: candidates.map(({ score: _score, ...rest }) => rest) };
  } catch (error) {
    return failure(error);
  }
}

export function searchKnowledge(index: KnowledgeIndex, env: KnowledgeEnv, input: KnowledgeSearchInput): KnowledgeSearchResult {
  const query = input.query?.trim() ?? '';
  if (query === '') return { ok: false, error: 'query 不能为空' };
  const bad = checkLibrary(env, input.library);
  if (bad) return { ok: false, error: bad };
  const limit = Math.min(Math.max(Math.trunc(input.limit ?? KNOWLEDGE_SEARCH_LIMIT_DEFAULT), 1), KNOWLEDGE_SEARCH_LIMIT_MAX);
  try {
    const result = index.search(query, {
      limit,
      includeIdeas: input.includeIdeas !== false && !input.library,
      ...(input.library ? { libraries: [input.library.trim()] } : {}),
    });
    const items = result.hits.map((hit) => ({
      source: hit.source,
      library: hit.library ?? '',
      path: hit.path ?? '',
      ideaId: hit.ideaId ?? '',
      title: hit.title,
      headings: hit.headings,
      topic: hit.topicName ?? '',
      archived: hit.area === 'archive',
      excerpt: hit.excerpt,
    }));
    return { ok: true, query, keywords: result.keywords, count: items.length, items };
  } catch (error) {
    return failure(error);
  }
}

export function readKnowledge(env: KnowledgeEnv, input: KnowledgeReadInput): KnowledgeReadResult {
  const library = input.library?.trim() ?? '';
  if (library === '') return { ok: false, error: 'library 不能为空' };
  const bad = checkLibrary(env, library);
  if (bad) return { ok: false, error: bad };
  const offset = Math.max(0, Math.trunc(input.offset ?? 0));
  try {
    const path = normalizeRelPath(input.path ?? '');
    if (path === '') return { ok: false, error: 'path 不能为空' };
    const root = getLibrary(env, library).root;
    const displayPath = abbreviateHome(join(root, ...path.split('/')), env.home);
    let detail;
    try {
      detail = readTopic(env, library, path);
    } catch (error) {
      if (!(error instanceof KnowledgeError) || error.code !== 'not_found') throw error;
    }
    if (detail) {
      const files = [
        ...(['readme', 'assetIndex', 'knowledge', 'log'] as const).filter((doc) => detail.topic.documents[doc]).map((doc) => `${path}/${TOPIC_DOCUMENT_FILES[doc]}`),
        ...detail.files.map((file) => (file.kind === 'directory' ? `${file.path}/` : file.path)),
      ];
      const content = detail.documents.readme ?? '（这个主题没有 README.md）';
      return { ok: true, library, path, kind: 'topic', displayPath, content: content.slice(0, KNOWLEDGE_READ_MAX_CHARS), offset: 0, nextOffset: null, files };
    }
    const file = readLibraryFile(env, library, path);
    if (file.kind !== 'markdown') {
      return { ok: true, library, path, kind: 'file', displayPath, content: `${file.name}，${file.size} 字节，不能读取正文。`, offset: 0, nextOffset: null, files: [] };
    }
    const end = offset + KNOWLEDGE_READ_MAX_CHARS;
    const content = file.content.slice(offset, end);
    return { ok: true, library, path, kind: 'markdown', displayPath, content, offset, nextOffset: end < file.content.length ? end : null, files: [] };
  } catch (error) {
    return failure(error);
  }
}

export function renderKnowledgeRoute(result: KnowledgeRouteResult): string {
  if (!result.ok) return `没有路由：${result.error}`;
  if (result.candidates.length === 0) return '没有匹配的主题。可以直接用 bluemanta_knowledge_search 搜关键词。';
  const lines = [`候选主题 ${result.candidates.length} 个：`];
  result.candidates.forEach((item, i) => {
    lines.push(`${i + 1}. ${item.name}`);
    lines.push(`   库：${item.library}　路径：${item.topicPath}`);
    lines.push(`   命中：${item.matched.join('、')}`);
    lines.push(`   读取顺序：${item.readOrder.join(' → ')}`);
  });
  return lines.join('\n');
}

export function renderKnowledgeSearch(result: KnowledgeSearchResult): string {
  if (!result.ok) return `没有搜索：${result.error}`;
  if (result.items.length === 0) return '没有找到。换个说法，或只用一两个关键词再搜。';
  const lines = [`找到 ${result.count} 条（关键词：${result.keywords.join(' ')}）：`];
  result.items.forEach((item, i) => {
    const heading = item.headings.length > 0 ? ` › ${item.headings.join(' › ')}` : '';
    lines.push(`${i + 1}. ${item.title}${heading}`);
    if (item.source === 'idea') lines.push(`   灵感 id：${item.ideaId}`);
    else lines.push(`   库：${item.library}　路径：${item.path}${item.topic ? `　主题：${item.topic}` : ''}${item.archived ? '　（归档）' : ''}`);
    lines.push(`   摘录：${item.excerpt.replace(/\s+/g, ' ')}`);
  });
  return lines.join('\n');
}

export function renderKnowledgeRead(result: KnowledgeReadResult): string {
  if (!result.ok) return `没有读取：${result.error}`;
  const head = [`库：${result.library}　路径：${result.path}`, `位置：${result.displayPath}`];
  if (result.kind === 'topic') head.push(`主题文件：${result.files.join('、') || '无'}`);
  if (result.nextOffset !== null) head.push(`（只显示了一部分，接着读用 offset=${result.nextOffset}）`);
  return `${head.join('\n')}\n---\n${result.content}`;
}
