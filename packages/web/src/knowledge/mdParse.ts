/**
 * A small Markdown parser for knowledge files (knowledge-ui §4). It covers what Arsenal-style notes use —
 * headings, paragraphs, lists, tables, code, quotes, rules, links, emphasis — and never passes raw HTML
 * through: HTML in the source is shown as text.
 */

export type Inline =
  | { type: 'text'; text: string }
  | { type: 'code'; text: string }
  | { type: 'strong'; children: Inline[] }
  | { type: 'em'; children: Inline[] }
  | { type: 'link'; href: string; children: Inline[] };

export type ListItem = { children: Inline[]; checked: boolean | null; nested: Block[] };

export type Block =
  | { type: 'heading'; level: number; children: Inline[]; text: string }
  | { type: 'paragraph'; children: Inline[] }
  | { type: 'list'; ordered: boolean; items: ListItem[] }
  | { type: 'table'; header: Inline[][]; rows: Inline[][][] }
  | { type: 'code'; lang: string; text: string }
  | { type: 'quote'; children: Block[] }
  | { type: 'rule' };

const FENCE = /^(\s*)(```+|~~~+)\s*([\w+-]*)\s*$/;
const HEADING = /^(#{1,6})\s+(.*?)\s*#*\s*$/;
const RULE = /^\s{0,3}([-*_])(\s*\1){2,}\s*$/;
const BULLET = /^(\s*)([-*+]|\d{1,9}[.)])\s+(.*)$/;
const TASK = /^\[([ xX])\]\s+(.*)$/;

function splitRow(line: string): string[] {
  let body = line.trim();
  if (body.startsWith('|')) body = body.slice(1);
  if (body.endsWith('|') && !body.endsWith('\\|')) body = body.slice(0, -1);
  const cells: string[] = [];
  let current = '';
  let inCode = false;
  for (let i = 0; i < body.length; i += 1) {
    const char = body[i];
    if (char === '`') inCode = !inCode;
    if (char === '\\' && body[i + 1] === '|') {
      current += '|';
      i += 1;
    } else if (char === '|' && !inCode) {
      cells.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }
  cells.push(current.trim());
  return cells;
}

function isTableSeparator(line: string | undefined): boolean {
  if (line === undefined || !line.includes('-')) return false;
  const cells = splitRow(line);
  return cells.length > 0 && cells.every((cell) => /^:?-{1,}:?$/.test(cell.replace(/\s/g, '')));
}

function stripFrontmatter(lines: string[]): string[] {
  if (lines[0]?.trim() !== '---') return lines;
  const end = lines.findIndex((line, index) => index > 0 && line.trim() === '---');
  return end < 0 ? lines : lines.slice(end + 1);
}

/** Plain text of inline nodes (for heading ids and table-cell titles). */
export function inlineText(nodes: readonly Inline[]): string {
  return nodes.map((node) => (node.type === 'text' || node.type === 'code' ? node.text : inlineText(node.children))).join('');
}

/** Parses inline Markdown: `code`, **strong**, *em* / _em_, [text](href), ![alt](src) (shown as a link). */
export function parseInline(source: string): Inline[] {
  const nodes: Inline[] = [];
  let text = '';
  const flush = (): void => {
    if (text !== '') nodes.push({ type: 'text', text });
    text = '';
  };
  let i = 0;
  while (i < source.length) {
    const char = source[i] ?? '';
    const rest = source.slice(i);
    if (char === '\\' && i + 1 < source.length && /[\\`*_[\]()#+\-.!|<>]/.test(source[i + 1] ?? '')) {
      text += source[i + 1];
      i += 2;
      continue;
    }
    if (char === '`') {
      const ticks = /^`+/.exec(rest)?.[0] ?? '`';
      const end = source.indexOf(ticks, i + ticks.length);
      if (end > i) {
        flush();
        nodes.push({ type: 'code', text: source.slice(i + ticks.length, end).trim() });
        i = end + ticks.length;
        continue;
      }
    }
    if ((char === '*' || char === '_') && rest.startsWith(char.repeat(2))) {
      const marker = char.repeat(2);
      const end = source.indexOf(marker, i + 2);
      if (end > i + 2) {
        flush();
        nodes.push({ type: 'strong', children: parseInline(source.slice(i + 2, end)) });
        i = end + 2;
        continue;
      }
    }
    if (char === '*' || (char === '_' && !/\w/.test(source[i - 1] ?? ''))) {
      const end = source.indexOf(char, i + 1);
      if (end > i + 1 && source[i + 1] !== ' ' && (char === '*' || !/\w/.test(source[end + 1] ?? ''))) {
        flush();
        nodes.push({ type: 'em', children: parseInline(source.slice(i + 1, end)) });
        i = end + 1;
        continue;
      }
    }
    const link = /^!?\[([^\]]*)\]\(\s*<?([^)\s>]*)>?(?:\s+"[^"]*")?\s*\)/.exec(rest);
    if (char === '[' || (char === '!' && rest.startsWith('!['))) {
      if (link) {
        flush();
        const label = link[1] ?? '';
        nodes.push({ type: 'link', href: link[2] ?? '', children: label === '' ? [{ type: 'text', text: link[2] ?? '' }] : parseInline(label) });
        i += link[0].length;
        continue;
      }
    }
    // 网址只收 ASCII 字符，遇到中文或全角标点就结束；结尾的英文标点不算网址。
    const auto = /^https?:\/\/[A-Za-z0-9\-._~:/?#[\]@!$&*+,;=%]*[A-Za-z0-9\-_~/#=&%]/.exec(rest);
    if (char === 'h' && auto && !/[\w/]/.test(source[i - 1] ?? '')) {
      flush();
      nodes.push({ type: 'link', href: auto[0], children: [{ type: 'text', text: auto[0] }] });
      i += auto[0].length;
      continue;
    }
    text += char;
    i += 1;
  }
  flush();
  return nodes;
}

function indentOf(line: string): number {
  return (/^\s*/.exec(line)?.[0] ?? '').replace(/\t/g, '    ').length;
}

function parseList(lines: string[], start: number): { block: Block; next: number } {
  const first = BULLET.exec(lines[start] ?? '');
  const baseIndent = indentOf(lines[start] ?? '');
  const ordered = /\d/.test(first?.[2] ?? '');
  const items: ListItem[] = [];
  let i = start;
  while (i < lines.length) {
    const line = lines[i] ?? '';
    const match = BULLET.exec(line);
    if (!match || indentOf(line) !== baseIndent || /\d/.test(match[2] ?? '') !== ordered) break;
    let content = match[3] ?? '';
    let checked: boolean | null = null;
    const task = TASK.exec(content);
    if (task) {
      checked = task[1] !== ' ';
      content = task[2] ?? '';
    }
    i += 1;
    const childLines: string[] = [];
    while (i < lines.length) {
      const next = lines[i] ?? '';
      if (next.trim() === '') {
        const after = lines[i + 1];
        if (after !== undefined && indentOf(after) > baseIndent && after.trim() !== '') {
          childLines.push('');
          i += 1;
          continue;
        }
        break;
      }
      if (indentOf(next) > baseIndent) {
        // 子块开始前，缩进的普通文字是本项的续行（CommonMark 的惰性续行）。
        if (childLines.length === 0 && !BULLET.exec(next) && !FENCE.test(next) && !next.trim().startsWith('|')) {
          content += ` ${next.trim()}`;
        } else {
          childLines.push(next);
        }
        i += 1;
        continue;
      }
      if (!BULLET.exec(next) && !HEADING.test(next) && !FENCE.test(next) && !next.trim().startsWith('|') && !next.trim().startsWith('>')) {
        content += ` ${next.trim()}`;
        i += 1;
        continue;
      }
      break;
    }
    const minIndent = Math.min(...childLines.filter((line) => line.trim() !== '').map(indentOf));
    const nested = childLines.length > 0 ? parseBlocks(childLines.map((line) => line.slice(Number.isFinite(minIndent) ? Math.min(minIndent, indentOf(line)) : 0))) : [];
    items.push({ children: parseInline(content), checked, nested });
  }
  return { block: { type: 'list', ordered, items }, next: i };
}

function parseBlocks(lines: string[]): Block[] {
  const blocks: Block[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i] ?? '';
    if (line.trim() === '') {
      i += 1;
      continue;
    }
    const fence = FENCE.exec(line);
    if (fence) {
      const marker = fence[2] ?? '```';
      const body: string[] = [];
      i += 1;
      while (i < lines.length && !(lines[i] ?? '').trim().startsWith(marker)) {
        body.push(lines[i] ?? '');
        i += 1;
      }
      i += 1;
      blocks.push({ type: 'code', lang: fence[3] ?? '', text: body.join('\n') });
      continue;
    }
    const heading = HEADING.exec(line);
    if (heading) {
      const children = parseInline(heading[2] ?? '');
      blocks.push({ type: 'heading', level: heading[1]?.length ?? 1, children, text: inlineText(children) });
      i += 1;
      continue;
    }
    if (RULE.test(line)) {
      blocks.push({ type: 'rule' });
      i += 1;
      continue;
    }
    if (line.trim().startsWith('>')) {
      const quoted: string[] = [];
      while (i < lines.length && (lines[i] ?? '').trim().startsWith('>')) {
        quoted.push((lines[i] ?? '').trim().replace(/^>\s?/, ''));
        i += 1;
      }
      blocks.push({ type: 'quote', children: parseBlocks(quoted) });
      continue;
    }
    if (line.includes('|') && isTableSeparator(lines[i + 1])) {
      const header = splitRow(line).map(parseInline);
      const rows: Inline[][][] = [];
      i += 2;
      while (i < lines.length && (lines[i] ?? '').includes('|') && (lines[i] ?? '').trim() !== '') {
        const cells = splitRow(lines[i] ?? '').map(parseInline);
        while (cells.length < header.length) cells.push([]);
        rows.push(cells.slice(0, Math.max(header.length, 1)));
        i += 1;
      }
      blocks.push({ type: 'table', header, rows });
      continue;
    }
    if (BULLET.test(line)) {
      const { block, next } = parseList(lines, i);
      blocks.push(block);
      i = next;
      continue;
    }
    const paragraph: string[] = [];
    while (i < lines.length) {
      const current = lines[i] ?? '';
      if (current.trim() === '' || FENCE.test(current) || HEADING.test(current) || RULE.test(current) || current.trim().startsWith('>') || BULLET.test(current)) break;
      if (current.includes('|') && isTableSeparator(lines[i + 1])) break;
      paragraph.push(current.trim());
      i += 1;
    }
    blocks.push({ type: 'paragraph', children: parseInline(paragraph.join('\n')) });
  }
  return blocks;
}

export function parseMarkdown(source: string): Block[] {
  return parseBlocks(stripFrontmatter(source.replace(/\r\n?/g, '\n').split('\n')));
}

/** Where a link in a library file points. */
export type LinkTarget =
  | { kind: 'external'; href: string }
  | { kind: 'library'; path: string; anchor: string | null }
  | { kind: 'none' };

/** Resolves a link relative to the file that contains it. Only http(s) and mailto leave the library. */
export function resolveLink(href: string, fromPath: string): LinkTarget {
  const trimmed = href.trim();
  if (trimmed === '') return { kind: 'none' };
  if (/^(https?:|mailto:)/i.test(trimmed)) return { kind: 'external', href: trimmed };
  if (/^[a-z][a-z0-9+.-]*:/i.test(trimmed) || trimmed.startsWith('//')) return { kind: 'none' };
  const [rawPath, rawAnchor] = trimmed.split('#', 2);
  let decoded: string;
  try {
    decoded = decodeURIComponent(rawPath ?? '');
  } catch {
    decoded = rawPath ?? '';
  }
  if (decoded === '') return { kind: 'none' };
  if (decoded.startsWith('~') || decoded.startsWith('/')) return { kind: 'none' };
  const base = fromPath.split('/').slice(0, -1);
  for (const part of decoded.split('/')) {
    if (part === '' || part === '.') continue;
    if (part === '..') {
      if (base.length === 0) return { kind: 'none' };
      base.pop();
    } else {
      base.push(part);
    }
  }
  return { kind: 'library', path: base.join('/').replace(/\/$/, ''), anchor: rawAnchor ? rawAnchor : null };
}
