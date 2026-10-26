import './silence-sqlite.js';
import { readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import type { DatabaseSync, StatementSync } from 'node:sqlite';
import { readLibraryIndex, walkLibrary } from './library.js';
import { bigrams, chunkMarkdown, countOccurrences, excerptAround, extractKeywords, plainText, queryKeywords } from './text.js';
import type { FileArea, KnowledgeEnv } from './types.js';

/** Bump when the stored shape changes; a mismatch drops and rebuilds the index (it is derived data). */
export const INDEX_SCHEMA_VERSION = 1;
export const DEFAULT_REFRESH_INTERVAL_MS = 30_000;
export const DEFAULT_SEARCH_LIMIT = 20;
const CANDIDATE_LIMIT = 400;

/** An idea handed in by the caller (the server maps core cards to this), so this package stays core-free. */
export interface IdeaDoc {
  id: string;
  title: string;
  body: string;
  /** Raw input when it differs from the body; extensions and other text may be appended by the caller. */
  extraText?: string;
  createdAt: string;
  updatedAt: string;
}

export type SearchSource = 'library' | 'idea';
export type MatchMode = 'all' | 'any' | 'fuzzy';

export interface SearchHit {
  source: SearchSource;
  /** Library id for library hits. */
  library: string | null;
  /** Library-relative file path for library hits. */
  path: string | null;
  ideaId: string | null;
  /** File title (first H1 or file name) or idea title. */
  title: string;
  headings: string[];
  excerpt: string;
  area: FileArea | null;
  topicPath: string | null;
  topicName: string | null;
  updatedAt: string;
  score: number;
  matchMode: MatchMode;
  /** Internal chunk id; stable until the file changes. */
  chunkId: number;
}

export interface SearchOptions {
  /** Restrict library hits to these ids; ideas are controlled by `includeIdeas`. */
  libraries?: readonly string[];
  includeIdeas?: boolean;
  limit?: number;
}

export interface SearchResult {
  query: string;
  keywords: string[];
  hits: SearchHit[];
}

export interface RouteCandidate {
  library: string;
  topicPath: string;
  name: string;
  category: string;
  /** Router terms (name, alias, keyword, typical question) that matched. */
  matched: string[];
  score: number;
  /** Arsenal Router Lite read order for this topic. */
  readOrder: string[];
}

export interface RefreshStats {
  files: number;
  added: number;
  updated: number;
  removed: number;
  ideas: number;
  refreshedAt: string;
}

export interface IndexStats {
  libraries: Array<{ id: string; files: number; chunks: number }>;
  ideas: number;
  refreshedAt: string | null;
}

export interface KnowledgeIndexOptions {
  env: KnowledgeEnv;
  /** SQLite file in the Desktop data dir, or `:memory:`. */
  dbPath: string;
  /** Current ideas; omitted means ideas are not indexed. */
  ideas?: () => readonly IdeaDoc[];
  refreshIntervalMs?: number;
  now?: () => number;
}

interface ChunkRow {
  id: number;
  source: SearchSource;
  library: string | null;
  path: string | null;
  idea_id: string | null;
  title: string;
  headings: string;
  body: string;
  area: string | null;
  topic_path: string | null;
  updated_at: string;
}

interface TopicRow {
  library: string;
  path: string;
  name: string;
  category: string;
  terms: string;
}

const IDEAS = '__ideas';

const AREA_WEIGHT: Readonly<Record<FileArea, number>> = {
  topic: 1,
  root: 0.9,
  category: 0.9,
  inbox: 0.8,
  archive: 0.4,
  templates: 0.2,
};

function escapeFts(term: string): string {
  return `"${term.replace(/"/g, '""')}"`;
}

/** Trigram FTS needs at least three characters per term; shorter keywords use substring matching. */
function usesFts(keyword: string): boolean {
  return Array.from(keyword).length >= 3;
}

/**
 * Rebuildable full-text index over knowledge libraries and ideas (ADR 0009 decision 4).
 * Deleting the SQLite file loses nothing: the next refresh rebuilds it from the sources.
 */
export class KnowledgeIndex {
  private readonly db: DatabaseSync;
  private readonly env: KnowledgeEnv;
  private readonly ideas: (() => readonly IdeaDoc[]) | undefined;
  private readonly interval: number;
  private readonly now: () => number;
  private lastRefresh = 0;
  private readonly insertChunk: StatementSync;
  private readonly insertFts: StatementSync;

  constructor(options: KnowledgeIndexOptions) {
    this.env = options.env;
    this.ideas = options.ideas;
    this.interval = options.refreshIntervalMs ?? DEFAULT_REFRESH_INTERVAL_MS;
    this.now = options.now ?? Date.now;
    // 内置模块在打开时再加载：顶层 import 会在 ESM 链接阶段触发 ExperimentalWarning，早于静默过滤器（与 core 相同）。
    const { DatabaseSync: Database } = process.getBuiltinModule('node:sqlite');
    this.db = new Database(options.dbPath, { timeout: 5000 });
    this.db.exec('PRAGMA journal_mode = WAL');
    this.migrate();
    this.insertChunk = this.db.prepare(
      `INSERT INTO chunks (source, library, path, idea_id, ord, title, headings, body, area, topic_path, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    this.insertFts = this.db.prepare('INSERT INTO chunks_fts (rowid, title, headings, body) VALUES (?, ?, ?, ?)');
  }

  private migrate(): void {
    this.db.exec('CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)');
    const row = this.db.prepare("SELECT value FROM meta WHERE key = 'schema'").get() as { value: string } | undefined;
    if (row?.value === String(INDEX_SCHEMA_VERSION)) return;
    this.db.exec(`
      DROP TABLE IF EXISTS sources;
      DROP TABLE IF EXISTS chunks;
      DROP TABLE IF EXISTS chunks_fts;
      DROP TABLE IF EXISTS topics;
      CREATE TABLE sources (
        library TEXT NOT NULL,
        path TEXT NOT NULL,
        size INTEGER NOT NULL,
        mtime REAL NOT NULL,
        PRIMARY KEY (library, path)
      );
      CREATE TABLE chunks (
        id INTEGER PRIMARY KEY,
        source TEXT NOT NULL,
        library TEXT,
        path TEXT,
        idea_id TEXT,
        ord INTEGER NOT NULL,
        title TEXT NOT NULL,
        headings TEXT NOT NULL,
        body TEXT NOT NULL,
        area TEXT,
        topic_path TEXT,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX chunks_by_file ON chunks (library, path);
      CREATE INDEX chunks_by_idea ON chunks (idea_id);
      CREATE VIRTUAL TABLE chunks_fts USING fts5 (title, headings, body, tokenize = 'trigram');
      CREATE TABLE topics (
        library TEXT NOT NULL,
        path TEXT NOT NULL,
        name TEXT NOT NULL,
        category TEXT NOT NULL,
        terms TEXT NOT NULL,
        PRIMARY KEY (library, path)
      );
    `);
    this.db.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES ('schema', ?)").run(String(INDEX_SCHEMA_VERSION));
  }

  close(): void {
    this.db.close();
  }

  private deleteChunks(where: string, ...params: Array<string | null>): void {
    const ids = this.db.prepare(`SELECT id FROM chunks WHERE ${where}`).all(...params) as Array<{ id: number }>;
    const deleteFts = this.db.prepare('DELETE FROM chunks_fts WHERE rowid = ?');
    for (const { id } of ids) deleteFts.run(id);
    this.db.prepare(`DELETE FROM chunks WHERE ${where}`).run(...params);
  }

  private addChunk(values: {
    source: SearchSource;
    library: string | null;
    path: string | null;
    ideaId: string | null;
    ord: number;
    title: string;
    headings: string[];
    body: string;
    area: string | null;
    topicPath: string | null;
    updatedAt: string;
  }): void {
    const headings = values.headings.join('\n');
    const result = this.insertChunk.run(
      values.source,
      values.library,
      values.path,
      values.ideaId,
      values.ord,
      values.title,
      headings,
      values.body,
      values.area,
      values.topicPath,
      values.updatedAt,
    );
    this.insertFts.run(Number(result.lastInsertRowid), values.title, headings, values.body);
  }

  /** Re-reads changed sources. Throttled to once per interval unless `force` is set. */
  refresh(force = false): RefreshStats | null {
    const now = this.now();
    if (!force && this.lastRefresh !== 0 && now - this.lastRefresh < this.interval) return null;
    this.lastRefresh = now;
    const stats: RefreshStats = { files: 0, added: 0, updated: 0, removed: 0, ideas: 0, refreshedAt: new Date(now).toISOString() };
    this.db.exec('BEGIN');
    try {
      for (const library of this.env.libraries) this.refreshLibrary(library.id, stats);
      const configured = new Set(this.env.libraries.map((library) => library.id));
      for (const { library } of this.db.prepare('SELECT DISTINCT library FROM sources').all() as Array<{ library: string }>) {
        if (library === IDEAS || configured.has(library)) continue;
        this.deleteChunks('library = ?', library);
        this.db.prepare('DELETE FROM sources WHERE library = ?').run(library);
        this.db.prepare('DELETE FROM topics WHERE library = ?').run(library);
      }
      this.refreshIdeas(stats);
      this.db.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES ('refreshedAt', ?)").run(stats.refreshedAt);
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
    return stats;
  }

  private refreshLibrary(libraryId: string, stats: RefreshStats): void {
    const library = this.env.libraries.find((item) => item.id === libraryId);
    if (!library) return;
    const files = walkLibrary(this.env, libraryId);
    stats.files += files.length;
    const known = new Map(
      (this.db.prepare('SELECT path, size, mtime FROM sources WHERE library = ?').all(libraryId) as Array<{ path: string; size: number; mtime: number }>).map(
        (row) => [row.path, row],
      ),
    );
    const index = readLibraryIndex(this.env, libraryId);
    this.db.prepare('DELETE FROM topics WHERE library = ?').run(libraryId);
    const insertTopic = this.db.prepare('INSERT INTO topics (library, path, name, category, terms) VALUES (?, ?, ?, ?, ?)');
    for (const category of index.categories) {
      for (const topic of category.topics) {
        const terms = [topic.name, ...topic.aliases, ...topic.keywords, ...topic.typicalQuestions].join('\n');
        insertTopic.run(libraryId, topic.path, topic.name, category.id, terms);
      }
    }
    const upsertSource = this.db.prepare('INSERT OR REPLACE INTO sources (library, path, size, mtime) VALUES (?, ?, ?, ?)');
    for (const file of files) {
      const previous = known.get(file.path);
      known.delete(file.path);
      if (previous && previous.size === file.size && previous.mtime === file.modifiedMs) continue;
      let markdown: string;
      try {
        markdown = readFileSync(join(library.root, ...file.path.split('/')), 'utf8');
      } catch {
        continue;
      }
      this.deleteChunks('library = ? AND path = ?', libraryId, file.path);
      const parsed = chunkMarkdown(markdown, basename(file.path).replace(/\.(md|markdown)$/i, ''));
      const updatedAt = new Date(file.modifiedMs).toISOString();
      const chunks = parsed.chunks.length > 0 ? parsed.chunks : [{ headings: [], body: '' }];
      chunks.forEach((chunk, ord) => {
        this.addChunk({
          source: 'library',
          library: libraryId,
          path: file.path,
          ideaId: null,
          ord,
          title: parsed.title,
          headings: chunk.headings,
          body: chunk.body,
          area: file.area,
          topicPath: file.topicPath,
          updatedAt,
        });
      });
      upsertSource.run(libraryId, file.path, file.size, file.modifiedMs);
      if (previous) stats.updated += 1;
      else stats.added += 1;
    }
    for (const path of known.keys()) {
      this.deleteChunks('library = ? AND path = ?', libraryId, path);
      this.db.prepare('DELETE FROM sources WHERE library = ? AND path = ?').run(libraryId, path);
      stats.removed += 1;
    }
  }

  private refreshIdeas(stats: RefreshStats): void {
    if (!this.ideas) return;
    const ideas = this.ideas();
    stats.ideas = ideas.length;
    const known = new Map(
      (this.db.prepare('SELECT path, mtime FROM sources WHERE library = ?').all(IDEAS) as Array<{ path: string; mtime: number }>).map((row) => [row.path, row.mtime]),
    );
    const upsert = this.db.prepare('INSERT OR REPLACE INTO sources (library, path, size, mtime) VALUES (?, ?, 0, ?)');
    for (const idea of ideas) {
      const stamp = Date.parse(idea.updatedAt) || 0;
      const previous = known.get(idea.id);
      known.delete(idea.id);
      if (previous === stamp) continue;
      this.deleteChunks('idea_id = ?', idea.id);
      const body = [idea.body, idea.extraText ?? ''].filter((part) => part.trim() !== '').join('\n\n');
      this.addChunk({
        source: 'idea',
        library: null,
        path: null,
        ideaId: idea.id,
        ord: 0,
        title: idea.title,
        headings: [],
        body,
        area: null,
        topicPath: null,
        updatedAt: idea.updatedAt,
      });
      upsert.run(IDEAS, idea.id, stamp);
    }
    for (const id of known.keys()) {
      this.deleteChunks('idea_id = ?', id);
      this.db.prepare('DELETE FROM sources WHERE library = ? AND path = ?').run(IDEAS, id);
    }
  }

  stats(): IndexStats {
    const rows = this.db
      .prepare("SELECT library, COUNT(DISTINCT path) AS files, COUNT(*) AS chunks FROM chunks WHERE source = 'library' GROUP BY library")
      .all() as Array<{ library: string; files: number; chunks: number }>;
    const ideas = (this.db.prepare("SELECT COUNT(*) AS n FROM chunks WHERE source = 'idea'").get() as { n: number }).n;
    const refreshed = this.db.prepare("SELECT value FROM meta WHERE key = 'refreshedAt'").get() as { value: string } | undefined;
    return {
      libraries: this.env.libraries.map((library) => {
        const row = rows.find((item) => item.library === library.id);
        return { id: library.id, files: row?.files ?? 0, chunks: row?.chunks ?? 0 };
      }),
      ideas,
      refreshedAt: refreshed?.value ?? null,
    };
  }

  /** Router Lite: topics whose name, aliases, keywords or typical questions overlap the query. */
  route(query: string, options: { libraries?: readonly string[]; limit?: number } = {}): RouteCandidate[] {
    this.refresh();
    // 先去掉「怎么讲、之前、那个」这类口语词，否则会命中典型问题里的同样字眼。
    const extracted = extractKeywords(query);
    const keywords = extracted.length > 0 ? extracted : queryKeywords(query);
    if (keywords.length === 0) return [];
    const whole = query.trim().toLowerCase();
    const rows = this.db.prepare('SELECT library, path, name, category, terms FROM topics').all() as unknown as TopicRow[];
    const candidates: RouteCandidate[] = [];
    for (const row of rows) {
      if (options.libraries && !options.libraries.includes(row.library)) continue;
      const terms = row.terms.split('\n').filter((term) => term.trim() !== '');
      const matched = new Set<string>();
      let score = 0;
      for (const term of terms) {
        const lower = term.toLowerCase();
        const termHit = keywords.some((keyword) => lower.includes(keyword) || (Array.from(lower).length >= 2 && (keyword.includes(lower) || whole.includes(lower))));
        if (!termHit) continue;
        matched.add(term);
        score += term === row.name ? 3 : 1;
      }
      if (matched.size === 0) continue;
      candidates.push({
        library: row.library,
        topicPath: row.path,
        name: row.name,
        category: row.category,
        matched: [...matched],
        score,
        readOrder: ['README.md', 'Asset_Index.md', 'Topic_Knowledge.md', 'Topic_Log.md'].map((file) => `${row.path}/${file}`),
      });
    }
    return candidates.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name, 'zh-Hans-CN')).slice(0, options.limit ?? 5);
  }

  /**
   * Keyword search. Tries all keywords first; when that finds fewer than `limit` hits it fills with chunks
   * matching any keyword, then with a bigram fallback for long CJK keywords typed without spaces.
   */
  search(query: string, options: SearchOptions = {}): SearchResult {
    this.refresh();
    const keywords = queryKeywords(query);
    const limit = options.limit ?? DEFAULT_SEARCH_LIMIT;
    if (keywords.length === 0) return { query, keywords, hits: [] };
    const routed = new Map(this.route(query, { limit: 10 }).map((candidate) => [`${candidate.library}\n${candidate.topicPath}`, candidate.score]));
    const topicNames = new Map(
      (this.db.prepare('SELECT library, path, name FROM topics').all() as Array<{ library: string; path: string; name: string }>).map((row) => [
        `${row.library}\n${row.path}`,
        row.name,
      ]),
    );
    const seen = new Set<number>();
    const hits: SearchHit[] = [];
    const collect = (rows: ChunkRow[], mode: MatchMode, terms: readonly string[], minFraction = 0): void => {
      const scored: SearchHit[] = [];
      for (const row of rows) {
        if (seen.has(row.id) || !this.allowed(row, options)) continue;
        const hit = this.toHit(row, mode, terms, routed, topicNames, minFraction);
        if (hit) scored.push(hit);
      }
      scored.sort((a, b) => b.score - a.score || (a.updatedAt < b.updatedAt ? 1 : -1));
      for (const hit of scored) {
        seen.add(hit.chunkId);
        hits.push(hit);
      }
    };
    collect(this.candidates(keywords, 'all'), 'all', keywords);
    if (hits.length < limit && keywords.length > 1) collect(this.candidates(keywords, 'any'), 'any', keywords);
    if (hits.length < limit) {
      const pieces = [...new Set(keywords.flatMap(bigrams))];
      if (pieces.length > 0) collect(this.candidates(pieces, 'any'), 'fuzzy', pieces, 0.6);
    }
    return { query, keywords, hits: hits.slice(0, limit) };
  }

  private allowed(row: ChunkRow, options: SearchOptions): boolean {
    if (row.source === 'idea') return options.includeIdeas !== false;
    if (!options.libraries) return true;
    return row.library !== null && options.libraries.includes(row.library);
  }

  private candidates(terms: readonly string[], mode: 'all' | 'any'): ChunkRow[] {
    const ftsTerms = terms.filter(usesFts);
    const likeTerms = terms.filter((term) => !usesFts(term));
    const text = "lower(c.title || ' ' || c.headings || ' ' || c.body)";
    const columns = 'c.id, c.source, c.library, c.path, c.idea_id, c.title, c.headings, c.body, c.area, c.topic_path, c.updated_at';
    if (mode === 'all') {
      const where = likeTerms.map(() => `instr(${text}, ?) > 0`);
      if (ftsTerms.length > 0) {
        return this.db
          .prepare(
            `SELECT ${columns} FROM chunks_fts f JOIN chunks c ON c.id = f.rowid WHERE chunks_fts MATCH ?${where.map((clause) => ` AND ${clause}`).join('')} LIMIT ${CANDIDATE_LIMIT}`,
          )
          .all(ftsTerms.map(escapeFts).join(' AND '), ...likeTerms) as unknown as ChunkRow[];
      }
      return this.db
        .prepare(`SELECT ${columns} FROM chunks c WHERE ${where.join(' AND ')} LIMIT ${CANDIDATE_LIMIT}`)
        .all(...likeTerms) as unknown as ChunkRow[];
    }
    const rows = new Map<number, ChunkRow>();
    if (ftsTerms.length > 0) {
      const found = this.db
        .prepare(`SELECT ${columns} FROM chunks_fts f JOIN chunks c ON c.id = f.rowid WHERE chunks_fts MATCH ? LIMIT ${CANDIDATE_LIMIT}`)
        .all(ftsTerms.map(escapeFts).join(' OR ')) as unknown as ChunkRow[];
      for (const row of found) rows.set(row.id, row);
    }
    if (likeTerms.length > 0) {
      const found = this.db
        .prepare(`SELECT ${columns} FROM chunks c WHERE ${likeTerms.map(() => `instr(${text}, ?) > 0`).join(' OR ')} LIMIT ${CANDIDATE_LIMIT}`)
        .all(...likeTerms) as unknown as ChunkRow[];
      for (const row of found) rows.set(row.id, row);
    }
    return [...rows.values()];
  }

  private toHit(
    row: ChunkRow,
    mode: MatchMode,
    terms: readonly string[],
    routed: ReadonlyMap<string, number>,
    topicNames: ReadonlyMap<string, string>,
    minFraction: number,
  ): SearchHit | null {
    const title = row.title.toLowerCase();
    const headings = row.headings.toLowerCase();
    const body = row.body.toLowerCase();
    let score = 0;
    let matchedTerms = 0;
    for (const term of terms) {
      const inTitle = countOccurrences(title, term);
      const inHeadings = countOccurrences(headings, term);
      const inBody = countOccurrences(body, term);
      if (inTitle + inHeadings + inBody > 0) matchedTerms += 1;
      score += Math.min(inBody, 5) + 3 * Math.min(inHeadings, 2) + 4 * Math.min(inTitle, 1);
    }
    if (matchedTerms === 0) return null;
    if (minFraction > 0 && matchedTerms / terms.length < minFraction) return null;
    score *= matchedTerms / terms.length;
    const topicKey = row.library !== null && row.topic_path !== null ? `${row.library}\n${row.topic_path}` : null;
    const routeScore = topicKey ? routed.get(topicKey) : undefined;
    if (routeScore !== undefined) score += 2 + routeScore;
    const area = (row.area as FileArea | null) ?? null;
    if (area) score *= AREA_WEIGHT[area];
    // 根目录的总索引 `*_Index.md` 是一整张路由表，交给 route() 用；搜索里降权，免得表格行压过正文。
    if (area === 'root' && row.path !== null && /_Index\.md$/i.test(row.path)) score *= 0.3;
    if (mode === 'any') score *= 0.6;
    if (mode === 'fuzzy') score *= 0.4;
    const plain = plainText(row.body);
    return {
      source: row.source,
      library: row.library,
      path: row.path,
      ideaId: row.idea_id,
      title: row.title,
      headings: row.headings === '' ? [] : row.headings.split('\n'),
      excerpt: excerptAround(plain === '' ? row.title : plain, terms),
      area,
      topicPath: row.topic_path,
      topicName: topicKey ? (topicNames.get(topicKey) ?? null) : null,
      updatedAt: row.updated_at,
      score: Math.round(score * 100) / 100,
      matchMode: mode,
      chunkId: row.id,
    };
  }

  /** Full body of a chunk, for evaluation and agents that need the matched section verbatim. */
  chunkText(chunkId: number): string | null {
    const row = this.db.prepare('SELECT body FROM chunks WHERE id = ?').get(chunkId) as { body: string } | undefined;
    return row?.body ?? null;
  }
}
