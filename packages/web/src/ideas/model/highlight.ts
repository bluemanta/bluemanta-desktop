export type Segment = { text: string; hit: boolean };

/** 搜索词按空白切分（与 core 搜索一致），去重，长词优先，避免短词把长词切碎。 */
export function searchTerms(query: string): string[] {
  const terms = query
    .trim()
    .split(/\s+/)
    .filter((term) => term !== '');
  return [...new Set(terms.map((term) => term.toLowerCase()))].sort((a, b) => b.length - a.length);
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** 把文本按命中词切成片段，不区分大小写。 */
export function highlightSegments(text: string, query: string): Segment[] {
  const terms = searchTerms(query);
  if (terms.length === 0 || text === '') return [{ text, hit: false }];
  const pattern = new RegExp(`(${terms.map(escapeRegExp).join('|')})`, 'giu');
  const segments: Segment[] = [];
  let last = 0;
  for (const match of text.matchAll(pattern)) {
    const start = match.index;
    if (start > last) segments.push({ text: text.slice(last, start), hit: false });
    segments.push({ text: match[0], hit: true });
    last = start + match[0].length;
  }
  if (last < text.length) segments.push({ text: text.slice(last), hit: false });
  return segments.length === 0 ? [{ text, hit: false }] : segments;
}
