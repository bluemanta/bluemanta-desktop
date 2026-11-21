import { encodePath } from './paths';

export type PersonalOsRoute =
  | { view: 'redirect'; to: string }
  | { view: 'today' }
  | { view: 'domains'; domain: string | null }
  | { view: 'file'; file: string }
  | { view: 'resources' | 'activity' }
  | { view: 'arsenal'; topic: string | null; file: string | null }
  | { view: 'search'; query: string };

export const TODAY_PATH = '/knowledge/today';
export const DOMAINS_PATH = '/knowledge/domains';
export const domainPath = (id: string): string => `${DOMAINS_PATH}/${encodeURIComponent(id)}`;
export const personalOsFilePath = (path: string): string => `/knowledge/pos/file/${encodePath(path)}`;

function decode(segments: string[]): string | null {
  try { return segments.map(decodeURIComponent).join('/'); } catch { return null; }
}

/** PersonalOS owns the desk routes; Arsenal deep links remain compatible with dsh tool cards. */
export function parsePersonalOsPath(pathname: string): PersonalOsRoute {
  const [base, page, ...rest] = pathname.split('?')[0]!.split('/').filter(Boolean);
  const redirect: PersonalOsRoute = { view: 'redirect', to: TODAY_PATH };
  if (base !== 'knowledge') return redirect;
  if (page === 'today' && rest.length === 0) return { view: 'today' };
  if (page === 'domains') {
    if (rest.length === 0) return { view: 'domains', domain: null };
    const id = decode(rest);
    return rest.length === 1 && id && !id.startsWith('.') && !/[/\\\0]/.test(id) ? { view: 'domains', domain: id } : redirect;
  }
  if (page === 'pos' && rest[0] === 'file') {
    const file = decode(rest.slice(1));
    return file ? { view: 'file', file } : redirect;
  }
  if (page === 'search') return { view: 'search', query: decode(rest) ?? '' };
  if (page === 'resources' && rest.length === 0) return { view: 'resources' };
  if (page === 'resources' && rest[0] === 'arsenal' && rest.length === 1) return { view: 'arsenal', topic: null, file: null };
  if (page === 'activity' && rest.length === 0) return { view: 'activity' };
  if (page === 'lib' && decode(rest.slice(0, 1)) === 'arsenal') {
    const path = decode(rest.slice(2));
    if (rest[1] === 'topic' && path) return { view: 'arsenal', topic: path, file: null };
    if (rest[1] === 'file' && path) return { view: 'arsenal', topic: null, file: path };
    return { view: 'arsenal', topic: null, file: null };
  }
  return redirect;
}

/** A state file opens its domain card; other documents open the shared reader. */
export function personalOsTarget(path: string, domains: readonly { id: string; path: string }[] = []): string {
  const domain = domains.find((item) => path === `${item.path}/状态.md` || path === item.path);
  if (domain) return domainPath(domain.id);
  if (path === '我/状态.md') return domainPath('我');
  const match = /^领域\/([^/]+)\/状态\.md$/.exec(path);
  return match?.[1] ? domainPath(match[1]) : personalOsFilePath(path);
}
