import type { TopicRouting } from './types.js';

/** One row of a router table in `*_Index.md`, keyed by normalized column name. */
export interface RouterRow extends TopicRouting {
  /** The `## …` heading the table sits under, e.g. `01_业务主题`. */
  section: string;
  name: string;
  /** Raw path cell with backticks removed, e.g. `Arsenal/01_业务主题/会员体系/`. */
  rawPath: string;
}

type Column = 'name' | 'path' | 'aliases' | 'keywords' | 'questions' | 'related' | 'status' | 'reviewed' | 'notes';

const COLUMN_NAMES: ReadonlyArray<readonly [Column, readonly string[]]> = [
  ['name', ['topic', '主题']],
  ['path', ['path', '路径']],
  ['aliases', ['aliases', 'alias', '别名']],
  ['keywords', ['keywords', 'keyword', '关键词']],
  ['questions', ['typical questions', 'questions', '典型问题']],
  ['related', ['related topics', 'related', '相关主题']],
  ['status', ['status', '状态']],
  ['reviewed', ['last reviewed', 'reviewed', '最后审阅']],
  ['notes', ['notes', 'note', '备注']],
];

function columnFor(header: string): Column | null {
  const key = header.trim().toLowerCase().replace(/\s+/g, ' ');
  for (const [column, names] of COLUMN_NAMES) if (names.includes(key)) return column;
  return null;
}

/** Splits a Markdown table row, honouring `\|` escapes and an optional leading/trailing pipe. */
export function splitTableRow(line: string): string[] {
  let body = line.trim();
  if (body.startsWith('|')) body = body.slice(1);
  if (body.endsWith('|') && !body.endsWith('\\|')) body = body.slice(0, -1);
  const cells: string[] = [];
  let current = '';
  for (let i = 0; i < body.length; i += 1) {
    const char = body[i];
    if (char === '\\' && body[i + 1] === '|') {
      current += '|';
      i += 1;
    } else if (char === '|') {
      cells.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }
  cells.push(current.trim());
  return cells;
}

function isSeparatorRow(cells: readonly string[]): boolean {
  return cells.length > 0 && cells.every((cell) => /^:?-{2,}:?$/.test(cell.replace(/\s/g, '')));
}

function stripCode(value: string): string {
  return value.replace(/`/g, '').trim();
}

export function splitList(value: string, separators: RegExp): string[] {
  return stripCode(value)
    .split(separators)
    .map((item) => item.trim())
    .filter((item) => item !== '');
}

const LIST = /[,，、]/;
const QUESTIONS = /[;；]/;

function emptyToNull(value: string | undefined): string | null {
  const text = value === undefined ? '' : stripCode(value);
  return text === '' ? null : text;
}

/**
 * Parses every router table in a `*_Index.md` file. Tables are recognised by a header row that has a
 * Topic column; other tables (e.g. read-order code blocks or notes) are ignored.
 */
export function parseRouterIndex(markdown: string): RouterRow[] {
  const rows: RouterRow[] = [];
  let section = '';
  let columns: Array<Column | null> | null = null;
  let inFence = false;
  const lines = markdown.split(/\r?\n/);
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] ?? '';
    if (/^\s*(```|~~~)/.test(line)) {
      inFence = !inFence;
      columns = null;
      continue;
    }
    if (inFence) continue;
    const heading = /^##\s+(.+?)\s*#*\s*$/.exec(line);
    if (heading && !line.startsWith('###')) {
      section = (heading[1] ?? '').trim();
      columns = null;
      continue;
    }
    if (!line.trim().startsWith('|')) {
      columns = null;
      continue;
    }
    const cells = splitTableRow(line);
    if (columns === null) {
      const next = lines[i + 1];
      const mapped = cells.map(columnFor);
      if (next !== undefined && isSeparatorRow(splitTableRow(next)) && mapped.includes('name')) {
        columns = mapped;
        i += 1;
      }
      continue;
    }
    const value = (column: Column): string | undefined => {
      const index = columns?.indexOf(column) ?? -1;
      return index < 0 ? undefined : cells[index];
    };
    const name = stripCode(value('name') ?? '');
    if (name === '') continue;
    rows.push({
      section,
      name,
      rawPath: stripCode(value('path') ?? ''),
      aliases: splitList(value('aliases') ?? '', LIST),
      keywords: splitList(value('keywords') ?? '', LIST),
      typicalQuestions: splitList(value('questions') ?? '', QUESTIONS),
      relatedTopics: splitList(value('related') ?? '', LIST),
      status: emptyToNull(value('status')),
      lastReviewed: emptyToNull(value('reviewed')),
      notes: emptyToNull(value('notes')),
    });
  }
  return rows;
}
