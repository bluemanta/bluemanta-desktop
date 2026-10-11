export type IdeaSection = 'list' | 'stats' | 'trash' | 'other';

export function pathnameOf(location: string): string {
  return location.split('?')[0] ?? location;
}

export function sectionOf(location: string): IdeaSection {
  const path = pathnameOf(location);
  if (path === '/ideas/stats') return 'stats';
  if (path === '/ideas/trash') return 'trash';
  if (path === '/ideas' || path.startsWith('/ideas/')) return 'list';
  return 'other';
}

export function ideaIdFromPath(location: string): string | null {
  const match = /^\/ideas\/([^/]+)$/.exec(pathnameOf(location));
  if (!match) return null;
  const id = decodeURIComponent(match[1] ?? '');
  if (id === 'stats' || id === 'trash') return null;
  return id;
}

/** 浏览器后退会离开正在编辑的灵感，或离开清单页。点另一条灵感不走这里。 */
export function backWouldDiscard(from: string, to: string, dirtyIds: ReadonlySet<string>): boolean {
  if (dirtyIds.size === 0) return false;
  if (sectionOf(from) === 'list' && sectionOf(to) !== 'list') return true;
  const fromId = ideaIdFromPath(from);
  const toId = ideaIdFromPath(to);
  return fromId !== null && dirtyIds.has(fromId) && toId !== fromId;
}
