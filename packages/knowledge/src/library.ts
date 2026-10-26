import { readdirSync, readFileSync, statSync, type Dirent, type Stats } from 'node:fs';
import { basename, join } from 'node:path';
import { normalizeRelPath, resolveInLibrary } from './paths.js';
import { parseRouterIndex, type RouterRow } from './router.js';
import {
  KnowledgeError,
  TOPIC_DOCUMENT_FILES,
  type CategorySummary,
  type FileArea,
  type FileContent,
  type FileEntry,
  type KnowledgeEnv,
  type LibraryConfig,
  type LibraryIndex,
  type LibrarySummary,
  type TopicDetail,
  type TopicDocument,
  type TopicRouting,
  type TopicSummary,
  type WalkedFile,
} from './types.js';

/** Markdown larger than this is returned truncated; libraries hold notes, not data dumps. */
export const MAX_MARKDOWN_BYTES = 1024 * 1024;

const CATEGORY = /^(\d{2})_(.+)$/;
const INDEX_FILE = /^(.+)_Index\.md$/i;
const MARKDOWN = /\.(md|markdown)$/i;
const SKIP_DIRS = new Set(['node_modules', '.git', '.obsidian', '.trash']);
const DOCUMENT_ENTRIES: readonly TopicDocument[] = ['readme', 'assetIndex', 'knowledge', 'log'];

export function getLibrary(env: KnowledgeEnv, id: string): LibraryConfig {
  const library = env.libraries.find((item) => item.id === id);
  if (!library) throw new KnowledgeError('library_not_found', `没有 id 为 ${id} 的库`);
  return library;
}

function statOrNull(path: string): Stats | null {
  try {
    return statSync(path);
  } catch {
    return null;
  }
}

function isDir(path: string): boolean {
  return statOrNull(path)?.isDirectory() === true;
}

function readDirSafe(path: string): Dirent[] {
  try {
    return readdirSync(path, { withFileTypes: true });
  } catch {
    return [];
  }
}

function visible(name: string): boolean {
  return !name.startsWith('.') && !SKIP_DIRS.has(name);
}

function byName(a: { name: string }, b: { name: string }): number {
  return a.name.localeCompare(b.name, 'zh-Hans-CN');
}

/** Category directories that hold archived material rather than live topics. */
export function isArchiveCategory(name: string): boolean {
  return name.startsWith('99_') || /archive/i.test(name);
}

function categoryName(dir: string): string {
  return CATEGORY.exec(dir)?.[2] ?? dir;
}

function categoryOrder(dir: string): number {
  const match = CATEGORY.exec(dir);
  return match ? Number(match[1]) : 1000;
}

function findIndexFile(root: string): string | null {
  const candidates = readDirSafe(root)
    .filter((entry) => entry.isFile() && INDEX_FILE.test(entry.name))
    .map((entry) => entry.name)
    .sort();
  if (candidates.length === 0) return null;
  const preferred = candidates.find((name) => name.toLowerCase() === `${basename(root).toLowerCase()}_index.md`);
  return preferred ?? candidates[0] ?? null;
}

function entryFor(root: string, relPath: string, dirent?: Dirent): FileEntry {
  const absolute = join(root, ...relPath.split('/'));
  const stat = statOrNull(absolute);
  const name = basename(relPath);
  const directory = dirent ? dirent.isDirectory() : stat?.isDirectory() === true;
  return {
    path: relPath,
    name,
    kind: directory ? 'directory' : MARKDOWN.test(name) ? 'markdown' : 'file',
    size: directory ? 0 : (stat?.size ?? 0),
    modifiedAt: (stat?.mtime ?? new Date(0)).toISOString(),
  };
}

function listEntries(root: string, relDir: string): FileEntry[] {
  const absolute = relDir === '' ? root : join(root, ...relDir.split('/'));
  return readDirSafe(absolute)
    .filter((entry) => visible(entry.name) && (entry.isFile() || entry.isDirectory()))
    .map((entry) => entryFor(root, relDir === '' ? entry.name : `${relDir}/${entry.name}`, entry))
    .sort((a, b) => (a.kind === 'directory') === (b.kind === 'directory') ? byName(a, b) : a.kind === 'directory' ? -1 : 1);
}

function inboxFiles(root: string): FileEntry[] {
  if (!isDir(join(root, '_Inbox'))) return [];
  return listEntries(root, '_Inbox').filter((entry) => entry.kind !== 'directory' && entry.name.toLowerCase() !== 'readme.md');
}

function documentsPresent(root: string, topicPath: string): Record<TopicDocument, boolean> {
  const dir = join(root, ...topicPath.split('/'));
  const result = {} as Record<TopicDocument, boolean>;
  for (const doc of DOCUMENT_ENTRIES) result[doc] = statOrNull(join(dir, TOPIC_DOCUMENT_FILES[doc]))?.isFile() === true;
  return result;
}

const EMPTY_ROUTING: TopicRouting = {
  aliases: [],
  keywords: [],
  typicalQuestions: [],
  relatedTopics: [],
  status: null,
  lastReviewed: null,
  notes: null,
};

/**
 * Router path cells usually carry the library's own folder name (`Arsenal/01_…/会员体系/`). Resolve them
 * against the library root by taking the suffix that starts at the first category segment.
 */
function resolveRouterPath(row: RouterRow): string | null {
  const segments = row.rawPath.replace(/^\.?\/+/, '').split('/').map((part) => part.trim()).filter((part) => part !== '');
  const start = segments.findIndex((part) => CATEGORY.test(part));
  if (start >= 0) {
    try {
      return normalizeRelPath(segments.slice(start).join('/'));
    } catch {
      return null;
    }
  }
  if (CATEGORY.test(row.section) && row.name !== '') {
    try {
      return normalizeRelPath(`${row.section}/${row.name}`);
    } catch {
      return null;
    }
  }
  return null;
}

function summarize(library: LibraryConfig): { summary: LibrarySummary; rows: RouterRow[]; warnings: string[] } {
  const exists = isDir(library.root);
  const indexFile = exists ? findIndexFile(library.root) : null;
  const warnings: string[] = [];
  let rows: RouterRow[] = [];
  if (indexFile) {
    try {
      rows = parseRouterIndex(readFileSync(join(library.root, indexFile), 'utf8'));
    } catch {
      warnings.push(`总索引 ${indexFile} 读取失败`);
    }
  } else if (exists) {
    warnings.push('这个库没有总索引，主题都标为未登记');
  }
  return {
    summary: {
      id: library.id,
      name: library.name,
      root: library.root,
      writable: library.writable,
      exists,
      indexFile,
      topicCount: 0,
      inboxCount: exists ? inboxFiles(library.root).length : 0,
    },
    rows,
    warnings,
  };
}

function buildCategories(library: LibraryConfig, rows: readonly RouterRow[], warnings: string[]): CategorySummary[] {
  const categories = new Map<string, CategorySummary>();
  const ensure = (id: string): CategorySummary => {
    let category = categories.get(id);
    if (!category) {
      category = { id, name: categoryName(id), order: categoryOrder(id), topics: [] };
      categories.set(id, category);
    }
    return category;
  };
  const seen = new Set<string>();
  for (const row of rows) {
    const path = resolveRouterPath(row);
    if (path === null) {
      warnings.push(`总索引里的主题「${row.name}」路径无法识别：${row.rawPath || '（空）'}`);
      continue;
    }
    const categoryId = path.split('/')[0] ?? row.section;
    if (isArchiveCategory(categoryId) || seen.has(path)) continue;
    seen.add(path);
    const exists = isDir(join(library.root, ...path.split('/')));
    ensure(categoryId).topics.push({
      path,
      name: row.name,
      category: categoryId,
      registered: true,
      exists,
      documents: exists ? documentsPresent(library.root, path) : { readme: false, assetIndex: false, knowledge: false, log: false },
      aliases: row.aliases,
      keywords: row.keywords,
      typicalQuestions: row.typicalQuestions,
      relatedTopics: row.relatedTopics,
      status: row.status,
      lastReviewed: row.lastReviewed,
      notes: row.notes,
    });
  }
  for (const dir of readDirSafe(library.root)) {
    if (!dir.isDirectory() || !CATEGORY.test(dir.name) || isArchiveCategory(dir.name)) continue;
    const category = ensure(dir.name);
    for (const topicDir of readDirSafe(join(library.root, dir.name))) {
      if (!topicDir.isDirectory() || !visible(topicDir.name) || topicDir.name.startsWith('_')) continue;
      const path = `${dir.name}/${topicDir.name}`;
      if (seen.has(path)) continue;
      seen.add(path);
      category.topics.push({
        path,
        name: topicDir.name,
        category: dir.name,
        registered: false,
        exists: true,
        documents: documentsPresent(library.root, path),
        ...EMPTY_ROUTING,
      });
    }
  }
  const sorted = [...categories.values()].sort((a, b) => a.order - b.order || a.id.localeCompare(b.id, 'zh-Hans-CN'));
  for (const category of sorted) {
    category.topics.sort((a, b) => Number(b.registered) - Number(a.registered));
  }
  return sorted;
}

export function listLibraries(env: KnowledgeEnv): LibrarySummary[] {
  return env.libraries.map((library) => readLibraryIndex(env, library.id).library);
}

export function readLibraryIndex(env: KnowledgeEnv, libraryId: string): LibraryIndex {
  const library = getLibrary(env, libraryId);
  const { summary, rows, warnings } = summarize(library);
  if (!summary.exists) return { library: summary, categories: [], warnings: [] };
  const categories = buildCategories(library, rows, warnings);
  summary.topicCount = categories.reduce((count, category) => count + category.topics.length, 0);
  return { library: summary, categories, warnings };
}

function requireLibraryRoot(library: LibraryConfig): void {
  if (!isDir(library.root)) throw new KnowledgeError('library_missing', `库目录不存在：${library.name}`);
}

/** Reads one topic directory: its default documents, other files and `_Archive` entries. */
export function readTopic(env: KnowledgeEnv, libraryId: string, topicPath: string): TopicDetail {
  const library = getLibrary(env, libraryId);
  requireLibraryRoot(library);
  const path = normalizeRelPath(topicPath);
  if (path === '') throw new KnowledgeError('not_a_topic', '没有指定主题');
  const absolute = resolveInLibrary(library.root, path);
  if (!isDir(absolute)) throw new KnowledgeError('not_found', `找不到主题：${path}`);
  const index = readLibraryIndex(env, libraryId);
  const known = index.categories.flatMap((category) => category.topics).find((topic) => topic.path === path);
  const topic: TopicSummary = known ?? {
    path,
    name: basename(path),
    category: path.split('/')[0] ?? '',
    registered: false,
    exists: true,
    documents: documentsPresent(library.root, path),
    ...EMPTY_ROUTING,
  };
  const documents: Partial<Record<TopicDocument, string>> = {};
  for (const doc of DOCUMENT_ENTRIES) {
    if (!topic.documents[doc]) continue;
    documents[doc] = readMarkdown(join(absolute, TOPIC_DOCUMENT_FILES[doc])).content;
  }
  const defaultNames = new Set(Object.values(TOPIC_DOCUMENT_FILES).map((name) => name.toLowerCase()));
  const files = listEntries(library.root, path).filter(
    (entry) => !defaultNames.has(entry.name.toLowerCase()) && entry.name !== '_Archive',
  );
  const archive = isDir(join(absolute, '_Archive')) ? listEntries(library.root, `${path}/_Archive`) : [];
  return { library: index.library, topic, documents, files, archive };
}

function readMarkdown(absolute: string): { content: string; truncated: boolean } {
  const buffer = readFileSync(absolute);
  if (buffer.length <= MAX_MARKDOWN_BYTES) return { content: buffer.toString('utf8'), truncated: false };
  return { content: buffer.subarray(0, MAX_MARKDOWN_BYTES).toString('utf8'), truncated: true };
}

/** Reads any file inside a library. Markdown comes back as text; other files only as metadata. */
export function readLibraryFile(env: KnowledgeEnv, libraryId: string, relPath: string): FileContent {
  const library = getLibrary(env, libraryId);
  requireLibraryRoot(library);
  const path = normalizeRelPath(relPath);
  if (path === '') throw new KnowledgeError('invalid_path', '没有指定文件');
  const absolute = resolveInLibrary(library.root, path);
  const stat = statOrNull(absolute);
  if (!stat || !stat.isFile()) throw new KnowledgeError('not_found', `找不到文件：${path}`);
  const entry = entryFor(library.root, path);
  if (entry.kind !== 'markdown') return { ...entry, kind: 'file' };
  try {
    return { ...entry, kind: 'markdown', ...readMarkdown(absolute) };
  } catch {
    throw new KnowledgeError('read_error', `读取失败：${path}`);
  }
}

export function listInbox(env: KnowledgeEnv, libraryId: string): FileEntry[] {
  const library = getLibrary(env, libraryId);
  requireLibraryRoot(library);
  return inboxFiles(library.root);
}

/** Classifies a library-relative path within the Arsenal layout. */
export function classifyPath(relPath: string): { area: FileArea; topicPath: string | null } {
  const segments = relPath.split('/');
  const first = segments[0] ?? '';
  if (segments.length === 1) return { area: 'root', topicPath: null };
  if (first === '_Inbox') return { area: 'inbox', topicPath: null };
  if (first === '_Templates') return { area: 'templates', topicPath: null };
  const archived = isArchiveCategory(first) || segments.some((part) => part === '_Archive');
  if (CATEGORY.test(first) && segments.length >= 3) {
    return { area: archived ? 'archive' : 'topic', topicPath: `${first}/${segments[1]}` };
  }
  return { area: archived ? 'archive' : CATEGORY.test(first) ? 'category' : 'root', topicPath: null };
}

/** Lists every Markdown file in a library (for indexing), skipping hidden and tool directories. */
export function walkLibrary(env: KnowledgeEnv, libraryId: string, maxDepth = 8): WalkedFile[] {
  const library = getLibrary(env, libraryId);
  if (!isDir(library.root)) return [];
  const result: WalkedFile[] = [];
  const visit = (relDir: string, depth: number): void => {
    if (depth > maxDepth) return;
    const absolute = relDir === '' ? library.root : join(library.root, ...relDir.split('/'));
    for (const entry of readDirSafe(absolute)) {
      if (!visible(entry.name)) continue;
      const rel = relDir === '' ? entry.name : `${relDir}/${entry.name}`;
      if (entry.isDirectory()) {
        visit(rel, depth + 1);
      } else if (entry.isFile() && MARKDOWN.test(entry.name)) {
        const stat = statOrNull(join(absolute, entry.name));
        if (!stat) continue;
        result.push({ path: rel, size: stat.size, modifiedMs: stat.mtimeMs, ...classifyPath(rel) });
      }
    }
  };
  visit('', 0);
  return result.sort((a, b) => a.path.localeCompare(b.path, 'zh-Hans-CN'));
}
