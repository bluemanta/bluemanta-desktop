/** A Markdown library laid out like SalesOS Arsenal (ADR 0009). */
export interface LibraryConfig {
  /** Stable id used in URLs and tool arguments, e.g. `personal`, `arsenal`. */
  id: string;
  name: string;
  /** Absolute root directory. */
  root: string;
  /** First version is read-only everywhere; Arsenal stays read-only for good. */
  writable: boolean;
}

export interface KnowledgeEnv {
  home: string;
  libraries: readonly LibraryConfig[];
}

export type KnowledgeErrorCode =
  | 'library_not_found'
  | 'library_missing'
  | 'invalid_path'
  | 'not_found'
  | 'not_a_topic'
  | 'read_error';

export class KnowledgeError extends Error {
  readonly code: KnowledgeErrorCode;
  constructor(code: KnowledgeErrorCode, message: string) {
    super(message);
    this.name = 'KnowledgeError';
    this.code = code;
  }
}

/** Where a file sits in the Arsenal layout. Archive, inbox and templates are hidden from default browsing. */
export type FileArea = 'root' | 'topic' | 'category' | 'archive' | 'inbox' | 'templates';

export interface FileEntry {
  /** Path relative to the library root, `/`-separated. */
  path: string;
  name: string;
  kind: 'markdown' | 'file' | 'directory';
  size: number;
  /** ISO timestamp. */
  modifiedAt: string;
}

export interface LibrarySummary {
  id: string;
  name: string;
  root: string;
  writable: boolean;
  exists: boolean;
  /** Relative path of the `*_Index.md` router file, when present. */
  indexFile: string | null;
  topicCount: number;
  inboxCount: number;
}

/** The four default topic documents of the Arsenal layout. */
export type TopicDocument = 'readme' | 'assetIndex' | 'knowledge' | 'log';

export const TOPIC_DOCUMENT_FILES: Readonly<Record<TopicDocument, string>> = {
  readme: 'README.md',
  assetIndex: 'Asset_Index.md',
  knowledge: 'Topic_Knowledge.md',
  log: 'Topic_Log.md',
};

export interface TopicRouting {
  aliases: string[];
  keywords: string[];
  typicalQuestions: string[];
  relatedTopics: string[];
  status: string | null;
  lastReviewed: string | null;
  notes: string | null;
}

export interface TopicSummary extends TopicRouting {
  /** Relative path of the topic directory (no trailing slash); doubles as the topic id within a library. */
  path: string;
  name: string;
  /** Category directory name, e.g. `01_业务主题`. */
  category: string;
  /** Listed in the router index. */
  registered: boolean;
  /** Directory exists on disk. */
  exists: boolean;
  documents: Readonly<Record<TopicDocument, boolean>>;
}

export interface CategorySummary {
  /** Directory name, e.g. `01_业务主题`. */
  id: string;
  /** Display name without the numeric prefix, e.g. `业务主题`. */
  name: string;
  order: number;
  topics: TopicSummary[];
}

export interface LibraryIndex {
  library: LibrarySummary;
  categories: CategorySummary[];
  warnings: string[];
}

export interface TopicDetail {
  library: LibrarySummary;
  topic: TopicSummary;
  /** Markdown text of each default document that exists. */
  documents: Partial<Record<TopicDocument, string>>;
  /** Other entries in the topic root (excluding the default documents and `_Archive`). */
  files: FileEntry[];
  /** Entries inside the topic's `_Archive/`, one level deep. */
  archive: FileEntry[];
}

export type FileContent =
  | (FileEntry & { kind: 'markdown'; content: string; truncated: boolean })
  | (FileEntry & { kind: 'file' });

/** A Markdown file found while walking a library, for indexing. */
export interface WalkedFile {
  path: string;
  size: number;
  modifiedMs: number;
  area: FileArea;
  /** Topic directory this file belongs to, if any. */
  topicPath: string | null;
}
