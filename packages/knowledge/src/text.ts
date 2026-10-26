/** Text helpers shared by indexing, search and evaluation. */

export const EXCERPT_CHARS = 120;
/** Chunks longer than this are split at paragraph boundaries so excerpts and scores stay local. */
export const MAX_CHUNK_CHARS = 1500;

export interface MarkdownChunk {
  /** Heading chain below the document title, e.g. `['常见客户问题', 'Q: 会员等级怎么设计？']`. */
  headings: string[];
  body: string;
}

export interface ParsedMarkdown {
  title: string;
  chunks: MarkdownChunk[];
}

const HEADING = /^(#{1,6})\s+(.+?)\s*#*\s*$/;
const FENCE = /^\s*(```|~~~)/;

function stripFrontmatter(markdown: string): string {
  if (!markdown.startsWith('---')) return markdown;
  const end = markdown.indexOf('\n---', 3);
  return end < 0 ? markdown : markdown.slice(end + 4);
}

function splitLong(body: string): string[] {
  if (body.length <= MAX_CHUNK_CHARS) return [body];
  const parts: string[] = [];
  let current = '';
  for (const paragraph of body.split(/\n{2,}/)) {
    if (current !== '' && current.length + paragraph.length + 2 > MAX_CHUNK_CHARS) {
      parts.push(current);
      current = '';
    }
    if (paragraph.length > MAX_CHUNK_CHARS) {
      for (let i = 0; i < paragraph.length; i += MAX_CHUNK_CHARS) parts.push(paragraph.slice(i, i + MAX_CHUNK_CHARS));
      continue;
    }
    current = current === '' ? paragraph : `${current}\n\n${paragraph}`;
  }
  if (current !== '') parts.push(current);
  return parts;
}

/**
 * Splits Markdown into heading sections. The first H1 becomes the document title (falling back to the
 * file name); every later heading starts a new chunk whose heading chain keeps its ancestors.
 */
export function chunkMarkdown(markdown: string, fallbackTitle: string): ParsedMarkdown {
  const lines = stripFrontmatter(markdown).split(/\r?\n/);
  let title = '';
  const stack: Array<{ level: number; text: string }> = [];
  const chunks: MarkdownChunk[] = [];
  let buffer: string[] = [];
  let inFence = false;
  const flush = (): void => {
    const body = buffer.join('\n').trim();
    buffer = [];
    if (body === '') return;
    const headings = stack.map((item) => item.text);
    for (const part of splitLong(body)) chunks.push({ headings, body: part });
  };
  for (const line of lines) {
    if (FENCE.test(line)) inFence = !inFence;
    const heading = inFence ? null : HEADING.exec(line);
    if (!heading) {
      buffer.push(line);
      continue;
    }
    const level = heading[1]?.length ?? 1;
    const text = (heading[2] ?? '').trim();
    if (level === 1 && title === '' && chunks.length === 0 && buffer.join('').trim() === '') {
      title = text;
      continue;
    }
    flush();
    while (stack.length > 0 && (stack[stack.length - 1]?.level ?? 0) >= level) stack.pop();
    stack.push({ level, text });
  }
  flush();
  return { title: title || fallbackTitle, chunks };
}

const EDGE_PUNCTUATION = /^[\s"'“”‘’「」『』《》()（）[\]【】,，.。!！?？:：;；、·…~～-]+|[\s"'“”‘’「」『』《》()（）[\]【】,，.。!！?？:：;；、·…~～-]+$/g;

/** Splits a typed query into keywords on whitespace, trimming punctuation; lower-cased, deduplicated. */
export function queryKeywords(query: string): string[] {
  const seen = new Set<string>();
  for (const raw of query.split(/\s+/u)) {
    const keyword = raw.replace(EDGE_PUNCTUATION, '').toLowerCase();
    if (keyword !== '') seen.add(keyword);
  }
  return [...seen];
}

/**
 * Words that carry no topic in a spoken question ("去年说的那个想法"). Used only to turn a natural
 * question into keywords for evaluation and for agents that pass a whole sentence.
 */
const QUESTION_NOISE = [
  '有没有', '是不是', '能不能', '怎么样', '为什么', '怎么办', '是什么', '什么样',
  '半年前', '几个月前', '之前', '以前', '去年', '前年', '上次', '那次', '最近', '当时', '一下',
  '我们', '我的', '你们', '他们', '自己', '那个', '这个', '那些', '这些', '一个', '一些', '哪些', '哪个',
  '关于', '有关', '提到', '说过', '说的', '讲的', '记得', '记过', '写过', '写的', '想过', '想到', '找回', '找到', '帮我', '给我',
  '想法', '东西', '内容', '资料', '事情', '问题', '笔记',
  '怎么', '如何', '什么', '哪里',
  // 单字只收语气词和「的」：「有、在、是、和」这类常出现在词语里（有赞、在线、是否、和平），去掉会拆坏关键词。
  '吗', '呢', '吧', '啊', '呀', '了', '的',
];

/** Turns a natural-language question into keywords by removing question noise and splitting there. */
export function extractKeywords(question: string): string[] {
  let text = ` ${question.toLowerCase()} `;
  text = text.replace(/[\s"'“”‘’「」『』《》()（）[\]【】,，.。!！?？:：;；、·…~～]+/g, ' ');
  for (const noise of [...QUESTION_NOISE].sort((a, b) => b.length - a.length)) text = text.split(noise).join(' ');
  return queryKeywords(text).filter((keyword) => Array.from(keyword).length >= 2 || /[a-z0-9]/.test(keyword));
}

const CJK = /[㐀-鿿豈-﫿]/;

/** Overlapping two-character pieces of a long CJK keyword, for the fuzzy fallback. */
export function bigrams(keyword: string): string[] {
  const chars = Array.from(keyword);
  if (chars.length < 4 || !chars.every((char) => CJK.test(char))) return [];
  const result = new Set<string>();
  for (let i = 0; i + 1 < chars.length; i += 1) result.add(`${chars[i]}${chars[i + 1]}`);
  return [...result];
}

/** Removes Markdown punctuation that only adds noise to excerpts. */
export function plainText(markdown: string): string {
  return markdown
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/gm, ' ')
    // 下划线不删：topic_id、Arsenal_Index.md 这类标识符要原样保留。
    .replace(/[|*`>#]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Counts case-insensitive occurrences of `needle` in `haystack` (both already lower-cased). */
export function countOccurrences(haystack: string, needle: string): number {
  if (needle === '') return 0;
  let count = 0;
  let index = haystack.indexOf(needle);
  while (index >= 0) {
    count += 1;
    index = haystack.indexOf(needle, index + needle.length);
  }
  return count;
}

/** A window of about EXCERPT_CHARS characters around the earliest keyword hit. */
export function excerptAround(text: string, keywords: readonly string[]): string {
  const chars = Array.from(text);
  if (chars.length <= EXCERPT_CHARS) return text;
  const lower = text.toLowerCase();
  let earliest = -1;
  let length = 1;
  for (const keyword of keywords) {
    const index = lower.indexOf(keyword);
    if (index >= 0 && (earliest < 0 || index < earliest)) {
      earliest = index;
      length = Array.from(keyword).length;
    }
  }
  if (earliest < 0) return chars.slice(0, EXCERPT_CHARS).join('');
  const start = Array.from(text.slice(0, earliest)).length;
  let from = Math.max(0, start - Math.floor((EXCERPT_CHARS - length) / 2));
  const to = Math.min(chars.length, from + EXCERPT_CHARS);
  from = Math.max(0, to - EXCERPT_CHARS);
  return `${from > 0 ? '…' : ''}${chars.slice(from, to).join('')}${to < chars.length ? '…' : ''}`;
}
