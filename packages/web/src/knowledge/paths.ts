/** URL layout of the knowledge desk (knowledge-ui §1). Library paths are encoded segment by segment. */

export const DEFAULT_LIBRARY = 'personal';

export type KnowledgeRoute =
  | { view: 'topics'; library: string; topic: string | null; file: string | null }
  | { view: 'search'; query: string }
  | { view: 'inbox'; file: string | null };

export function encodePath(path: string): string {
  return path
    .split('/')
    .filter((segment) => segment !== '')
    .map(encodeURIComponent)
    .join('/');
}

function decodeSegments(segments: readonly string[]): string | null {
  try {
    return segments.map((segment) => decodeURIComponent(segment)).join('/');
  } catch {
    return null;
  }
}

export function topicsPath(library: string = DEFAULT_LIBRARY): string {
  return library === DEFAULT_LIBRARY ? '/knowledge' : `/knowledge/lib/${encodeURIComponent(library)}`;
}

export function topicPath(library: string, topic: string): string {
  return `/knowledge/lib/${encodeURIComponent(library)}/topic/${encodePath(topic)}`;
}

export function filePath(library: string, path: string): string {
  return `/knowledge/lib/${encodeURIComponent(library)}/file/${encodePath(path)}`;
}

export function searchPath(query = ''): string {
  return query.trim() === '' ? '/knowledge/search' : `/knowledge/search/${encodeURIComponent(query.trim())}`;
}

export function inboxPath(file: string | null = null): string {
  return file === null ? '/knowledge/inbox' : `/knowledge/inbox/file/${encodePath(file)}`;
}

/** Parses a pathname (without query) under `/knowledge`. Unknown shapes fall back to the topics page. */
export function parseKnowledgePath(pathname: string): KnowledgeRoute {
  const segments = pathname.split('/').filter((segment) => segment !== '');
  const fallback: KnowledgeRoute = { view: 'topics', library: DEFAULT_LIBRARY, topic: null, file: null };
  if (segments[0] !== 'knowledge') return fallback;
  const [, section, ...rest] = segments;
  if (section === undefined) return fallback;
  if (section === 'search') return { view: 'search', query: decodeSegments(rest) ?? '' };
  if (section === 'inbox') {
    if (rest[0] === 'file' && rest.length > 1) return { view: 'inbox', file: decodeSegments(rest.slice(1)) };
    return { view: 'inbox', file: null };
  }
  if (section === 'lib' && rest[0] !== undefined) {
    const library = decodeSegments([rest[0]]) ?? DEFAULT_LIBRARY;
    const [kind, ...tail] = rest.slice(1);
    const path = tail.length > 0 ? decodeSegments(tail) : null;
    if (kind === 'topic' && path) return { view: 'topics', library, topic: path, file: null };
    if (kind === 'file' && path) return { view: 'topics', library, topic: null, file: path };
    return { view: 'topics', library, topic: null, file: null };
  }
  return fallback;
}

/** A link inside a library file: paths with an extension are files, the rest are treated as topic folders. */
export function libraryTarget(library: string, path: string): string {
  return /\.[A-Za-z0-9]{1,8}$/.test(path) ? filePath(library, path) : topicPath(library, path);
}
