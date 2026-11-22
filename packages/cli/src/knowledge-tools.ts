import { join } from 'node:path';
import type { Core } from '@bluemanta/core';
import {
  KnowledgeError,
  KnowledgeIndex,
  PersonalOsReader,
  TOPIC_DOCUMENT_FILES,
  abbreviateHome,
  defaultKnowledgeEnv,
  getLibrary,
  normalizeRelPath,
  readLibraryFile,
  readTopic,
  walkPersonalOsFiles,
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
    // Agents search PersonalOS too (spec 14.1), like the web search.
    includePersonalOs: true,
    ...(core ? { ideas: () => ideaDocsFrom(core) } : {}),
    ...(options.refreshIntervalMs === undefined ? {} : { refreshIntervalMs: options.refreshIntervalMs }),
  });
}

// ---- agent 工具（KB5，迭代 4 改用 PersonalOS）：MCP 和 dsh 插件共用。只读，不写任何库。 ----

export const KNOWLEDGE_ROUTE_TOOL = 'bluemanta_knowledge_route';
export const KNOWLEDGE_SEARCH_TOOL = 'bluemanta_knowledge_search';
export const KNOWLEDGE_READ_TOOL = 'bluemanta_knowledge_read';
export const PERSONALOS_TODAY_TOOL = 'bluemanta_personalos_today';
/** The `library` values the agent tools accept (spec 14.1). */
export const KNOWLEDGE_TOOL_LIBRARIES = ['personalos', 'arsenal'] as const;

export const KNOWLEDGE_SEARCH_LIMIT_DEFAULT = 10;
export const KNOWLEDGE_SEARCH_LIMIT_MAX = 30;
/** Text returned by the read tool is capped so one call cannot flood the context. */
export const KNOWLEDGE_READ_MAX_CHARS = 20_000;

const LIBRARIES_EXPLAINED =
  '两个库：personalos 是用户的 PersonalOS（个人状态和知识的正本：九个生活领域，每个领域一份「状态.md」写现状、未结事项、近期变化、去哪查，另有资料登记、收件箱、按月日志）；' +
  'arsenal 是售前主题库（业务主题、产品能力、行业场景、模板素材）。';

export const KNOWLEDGE_LIMITATION =
  '这些工具只读，不新建、修改或移动文件。要更新 PersonalOS 时，按 PersonalOS 根目录 AGENTS.md 和「协议/更新.md」的约定直接改文件；Arsenal 的入库由用户操作。';

export const KNOWLEDGE_ROUTE_DESCRIPTION =
  '回答和用户个人情况、生活领域、售前主题相关的问题时，先用这个工具定位（Router Lite）。' + LIBRARIES_EXPLAINED +
  'PersonalOS 按路由表的领域名、别名与关键词、典型问题比对，返回领域和读取顺序（状态.md → 资料登记.md）；Arsenal 按总索引比对，返回主题和读取顺序（README → Asset_Index → Topic_Knowledge → Topic_Log）。' +
  '命中后用 bluemanta_knowledge_read 按顺序读，不要扫描整个库。query 是用户的问题或关键词；library 可选，只查 personalos 或 arsenal。' +
  KNOWLEDGE_LIMITATION;

export const KNOWLEDGE_SEARCH_DESCRIPTION =
  '在 PersonalOS、Arsenal 和灵感里全文搜索，用来找回以前的想法、记录、讲法和材料，例如「我之前关于 X 想过什么」「某份资料在哪」。' +
  'query 用关键词，按空白分开；全部命中的排前面，不够时补只命中部分的。中文按字匹配，不是语义搜索：没找到时换同义词、拆短一点再搜几次。' +
  'library 可选（personalos、arsenal），includeIdeas 默认 true；limit 默认 10，最大 30。结果给出库、路径、标题链、领域和摘录，要看全文用 bluemanta_knowledge_read。' +
  '回答时注明出处（库和路径，或灵感 id）。' +
  KNOWLEDGE_LIMITATION;

export const KNOWLEDGE_READ_DESCRIPTION =
  '读取 PersonalOS 或 Arsenal 里的一个文件、领域或主题。library 是 personalos 或 arsenal；path 是库内相对路径（来自路由或搜索结果）。' +
  'personalos 的 path 是领域目录（如「领域/工作」）时，返回该领域的状态.md 和目录里的 Markdown 文件清单；arsenal 的 path 是主题目录时，返回 README 和文件清单。' +
  'path 是 Markdown 文件时返回正文（过长会截断，可用 offset 接着读）；其他文件只返回大小和位置。' +
  KNOWLEDGE_LIMITATION;

export const PERSONALOS_TODAY_DESCRIPTION =
  '读取用户 PersonalOS 里「今天」的事项：已逾期、今天到期、未来 7 天、等待中、无日期（前几条）、更晚的条数，以及过期没更新的领域和收件箱里未分拣的条目。' +
  '用户问「今天要做什么」「有什么逾期了」，或做晨间简报时先调用它。每件事项给出领域、截止日期、等待对象、周期和所在文件与行号，要看上下文再用 bluemanta_knowledge_read。' +
  '日历、Linear、SalesOS 等外部来源不在这里，需要另外查。' +
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
  /** PersonalOS domain of the hit; empty elsewhere. */
  domain: string;
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
      kind: 'markdown' | 'file' | 'topic' | 'domain';
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
  if (library.trim() === 'personal') return '旧个人库 personal 已不再使用，个人内容在 PersonalOS：请用 library=personalos';
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
      domain: hit.domain ?? '',
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
    // getLibrary only knows Arsenal-structure libraries; PersonalOS is looked up directly.
    const config = env.libraries.find((item) => item.id === library && item.kind === 'personalos') ?? getLibrary(env, library);
    const root = config.root;
    const displayPath = abbreviateHome(join(root, ...path.split('/')), env.home);
    if (config.kind === 'personalos') return readPersonalOs(env, root, library, path, displayPath, offset);
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

/** PersonalOS read (spec 14.2): a domain directory gives its 状态.md plus its Markdown files; files read like the web reader. */
function readPersonalOs(env: KnowledgeEnv, root: string, library: string, path: string, displayPath: string, offset: number): KnowledgeReadResult {
  const reader = new PersonalOsReader({ home: env.home, root });
  const route = reader.routing().domains.find((domain) => domain.path === path);
  if (route) {
    const status = reader.file(`${route.path}/状态.md`);
    const files = walkPersonalOsFiles(root, route.path).filter((file) => file.kind === 'markdown').map((file) => file.path);
    const content = status.content ?? status.message ?? '（这个领域没有状态.md）';
    return { ok: true, library, path, kind: 'domain', displayPath, content: content.slice(0, KNOWLEDGE_READ_MAX_CHARS), offset: 0, nextOffset: null, files };
  }
  let file;
  try { file = reader.file(path); }
  catch (error) {
    // A directory such as 协议 or 日志: list its Markdown files instead.
    if (!(error instanceof KnowledgeError) || error.code !== 'not_found') throw error;
    let files: string[] = [];
    try { files = walkPersonalOsFiles(root, path).filter((item) => item.kind === 'markdown').map((item) => item.path); } catch { /* not a directory either */ }
    if (files.length === 0) throw error;
    return { ok: true, library, path, kind: 'file', displayPath, content: `这是一个目录，里面有 ${files.length} 个 Markdown 文件，见文件清单。`, offset: 0, nextOffset: null, files };
  }
  if (file.availability === 'icloud') return { ok: true, library, path, kind: 'file', displayPath, content: `${file.name} 尚未从 iCloud 下载，读不到正文。`, offset: 0, nextOffset: null, files: [] };
  if (file.kind !== 'markdown' || file.content === undefined) {
    return { ok: true, library, path, kind: 'file', displayPath, content: `${file.name}，${file.size} 字节，不能读取正文。`, offset: 0, nextOffset: null, files: [] };
  }
  const end = offset + KNOWLEDGE_READ_MAX_CHARS;
  return { ok: true, library, path, kind: 'markdown', displayPath, content: file.content.slice(offset, end), offset, nextOffset: end < file.content.length ? end : null, files: [] };
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
    else lines.push(`   库：${item.library}　路径：${item.path}${item.domain ? `　领域：${item.domain}` : ''}${item.topic && item.topic !== item.domain ? `　主题：${item.topic}` : ''}${item.archived ? '　（归档）' : ''}`);
    lines.push(`   摘录：${item.excerpt.replace(/\s+/g, ' ')}`);
  });
  return lines.join('\n');
}

export function renderKnowledgeRead(result: KnowledgeReadResult): string {
  if (!result.ok) return `没有读取：${result.error}`;
  const head = [`库：${result.library}　路径：${result.path}`, `位置：${result.displayPath}`];
  if (result.kind === 'topic') head.push(`主题文件：${result.files.join('、') || '无'}`);
  if (result.kind === 'domain') head.push(`领域文件：${result.files.join('、') || '无'}`);
  if (result.kind === 'file' && result.files.length) head.push(`文件：${result.files.join('、')}`);
  if (result.nextOffset !== null) head.push(`（只显示了一部分，接着读用 offset=${result.nextOffset}）`);
  return `${head.join('\n')}\n---\n${result.content}`;
}

// ---- 今天（迭代 4，规格 14.3） ----

export type PersonalOsTodayItem = { domain: string; text: string; due: string | null; wait: string | null; every: string | null; file: string; line: number };
export type PersonalOsTodayToolResult =
  | {
      ok: true;
      today: string;
      overdue: PersonalOsTodayItem[];
      dueToday: PersonalOsTodayItem[];
      next7: PersonalOsTodayItem[];
      waiting: PersonalOsTodayItem[];
      undated: { items: PersonalOsTodayItem[]; total: number };
      laterCount: number;
      staleDomains: Array<{ name: string; staleDays: number | null }>;
      inbox: Array<{ date: string; text: string }>;
    }
  | KnowledgeToolFailure;

export function personalOsToday(env: KnowledgeEnv): PersonalOsTodayToolResult {
  const library = env.libraries.find((item) => item.kind === 'personalos');
  if (!library) return { ok: false, error: '没有配置 PersonalOS' };
  try {
    const reader = new PersonalOsReader({ home: env.home, root: library.root });
    const data = reader.today();
    const item = (todo: (typeof data.overdue)[number]): PersonalOsTodayItem => ({ domain: todo.domain, text: todo.text, due: todo.due, wait: todo.wait, every: todo.every, file: todo.file, line: todo.line });
    return {
      ok: true,
      today: data.today,
      overdue: data.overdue.map(item),
      dueToday: data.dueToday.map(item),
      next7: data.next7.map(item),
      waiting: data.waiting.map(item),
      undated: { items: data.undated.items.map(item), total: data.undated.total },
      laterCount: data.later.count,
      staleDomains: data.staleDomains.map((domain) => ({ name: domain.name, staleDays: domain.staleDays })),
      inbox: data.inbox.map((entry) => ({ date: entry.date, text: entry.text })),
    };
  } catch (error) {
    if (error instanceof KnowledgeError && error.code === 'library_missing') return { ok: false, error: `没有找到 PersonalOS（${abbreviateHome(library.root, env.home)}）` };
    return failure(error);
  }
}

function todayLine(item: PersonalOsTodayItem, today: string): string {
  const marks: string[] = [];
  if (item.due) {
    const days = Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${item.due}T00:00:00Z`)) / 86_400_000);
    marks.push(days > 0 ? `截止 ${item.due}，逾期 ${days} 天` : days === 0 ? '今天截止' : `截止 ${item.due}`);
  }
  if (item.wait !== null) marks.push(`等待：${item.wait || '未写对象'}`);
  if (item.every) marks.push(`每 ${item.every}`);
  return `- [${item.domain}] ${item.text}${marks.length ? `（${marks.join('；')}）` : ''}　${item.file}:${item.line}`;
}

export function renderPersonalOsToday(result: PersonalOsTodayToolResult): string {
  if (!result.ok) return `没有读取：${result.error}`;
  const lines = [`PersonalOS 今天：${result.today}`];
  const group = (title: string, items: PersonalOsTodayItem[], more = 0) => {
    if (!items.length) return;
    lines.push('', `${title}（${items.length + more}）`, ...items.map((item) => todayLine(item, result.today)));
    if (more) lines.push(`- 还有 ${more} 条无日期事项`);
  };
  group('已逾期', result.overdue);
  group('今天到期', result.dueToday);
  group('未来 7 天', result.next7);
  group('等待中', result.waiting);
  group('无日期', result.undated.items, result.undated.total - result.undated.items.length);
  if (result.laterCount) lines.push('', `更晚：${result.laterCount} 件`);
  if (!result.overdue.length && !result.dueToday.length && !result.next7.length && !result.waiting.length && !result.undated.total) lines.push('', '没有到期或等待中的事。');
  if (result.staleDomains.length) lines.push('', '需要留意：' + result.staleDomains.map((domain) => `${domain.name}（${domain.staleDays === null ? '没有更新日期' : `${domain.staleDays} 天未更新`}）`).join('、'));
  if (result.inbox.length) lines.push('', `收件箱未分拣（${result.inbox.length}）`, ...result.inbox.map((entry) => `- ${entry.date} ${entry.text}`));
  lines.push('', '日历、Linear、SalesOS 等外部来源不在这里，需要另外查。');
  return lines.join('\n');
}
