import './silence-sqlite.js';
export * from './types.js';
export { abbreviateHome, defaultKnowledgeEnv, type KnowledgeEnvOverrides } from './env.js';
export { normalizeRelPath, resolveInLibrary, toRelPath } from './paths.js';
export { parseRouterIndex, splitTableRow, type RouterRow } from './router.js';
export {
  MAX_MARKDOWN_BYTES,
  classifyPath,
  getLibrary,
  isArchiveCategory,
  listInbox,
  listLibraries,
  readLibraryFile,
  readLibraryIndex,
  readTopic,
  walkLibrary,
} from './library.js';
export {
  DEFAULT_REFRESH_INTERVAL_MS,
  DEFAULT_SEARCH_LIMIT,
  INDEX_SCHEMA_VERSION,
  KnowledgeIndex,
  type IdeaDoc,
  type IndexStats,
  type KnowledgeIndexOptions,
  type MatchMode,
  type RefreshStats,
  type RouteCandidate,
  type SearchHit,
  type SearchOptions,
  type SearchResult,
  type SearchSource,
} from './search-index.js';
export { evaluate, type EvalCase, type EvalCaseResult, type EvalReport } from './eval.js';
export { EXCERPT_CHARS, bigrams, chunkMarkdown, excerptAround, extractKeywords, plainText, queryKeywords, type MarkdownChunk, type ParsedMarkdown } from './text.js';

export { PersonalOsReader, parseRouter, parseStatus, parseTodos, parseRegistry, parseInbox, parseLog, groupTodos, currentDate, normalizePersonalOsPath, walkPersonalOsFiles } from './personalos/index.js';
export type { Overview as PersonalOsOverview, TodayResult as PersonalOsToday, DomainSummary as PersonalOsDomainSummary, DomainDetail as PersonalOsDomain, Todo as PersonalOsTodo, RegistryRow as PersonalOsRegistryRow, LogResult as PersonalOsLog, FileContent as PersonalOsFile, DocumentFile as PersonalOsDocument, LogOptions as PersonalOsLogOptions } from './personalos/types.js';
export { gitCommit, gitCommits, type GitFile, type GitCommit, type GitListOptions } from './personalos/git.js';
