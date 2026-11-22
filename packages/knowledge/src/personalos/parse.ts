import { splitTableRow } from '../router.js';
import type { Change, DomainSummary, InboxEntry, LogEntry, Mount, ParsedStatus, RegistryRow, Router, Section, SectionKind, StatFunction, Todo, TodoBucket, TodayGroups, Warning } from './types.js';

const DAY = 86_400_000;
export function validDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split('-').map(Number);
  const date = new Date(0);
  date.setUTCFullYear(y!, m! - 1, d!); date.setUTCHours(0, 0, 0, 0);
  return date.getUTCFullYear() === y && date.getUTCMonth() === m! - 1 && date.getUTCDate() === d;
}
function dateNumber(value: string): number { return Date.parse(`${value}T00:00:00Z`); }
export function dateDistance(from: string, to: string): number { return Math.round((dateNumber(to) - dateNumber(from)) / DAY); }
export function addDays(value: string, count: number): string { return new Date(dateNumber(value) + count * DAY).toISOString().slice(0, 10); }
/** Calendar date in the host time zone. A valid BLUEMANTA_TODAY makes tests deterministic. */
export function currentDate(now = new Date(), override = process.env.BLUEMANTA_TODAY): string {
  if (override && validDate(override)) return override;
  return `${String(now.getFullYear()).padStart(4, '0')}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}
function visibleLines(markdown: string): Array<{ text: string; line: number; fenced: boolean }> {
  let fence: string | null = null;
  return markdown.split(/\r?\n/).map((text, index) => {
    const marker = /^\s{0,3}(`{3,}|~{3,})/.exec(text)?.[1];
    const fenced = fence !== null || marker !== undefined;
    if (marker) {
      if (fence === null) fence = marker;
      else if (marker[0] === fence[0] && marker.length >= fence.length && /^\s{0,3}(?:`+|~+)\s*$/.test(text)) fence = null;
    }
    return { text, line: index + 1, fenced };
  });
}
function tables(markdown: string): Array<{ headers: string[]; rows: string[][]; line: number }> {
  const lines = visibleLines(markdown); const result: Array<{ headers: string[]; rows: string[][]; line: number }> = [];
  for (let i = 0; i + 1 < lines.length; i += 1) {
    const head = lines[i]!; const next = lines[i + 1]!;
    if (head.fenced || next.fenced || !head.text.trim().startsWith('|')) continue;
    const separator = splitTableRow(next.text);
    if (!next.text.trim().startsWith('|') || !separator.every((cell) => /^:?-{2,}:?$/.test(cell.replace(/\s/g, '')))) continue;
    const table = { headers: splitTableRow(head.text).map((cell) => cell.trim()), rows: [] as string[][], line: head.line };
    i += 2;
    for (; i < lines.length; i += 1) {
      const row = lines[i]!;
      if (row.fenced || !row.text.trim().startsWith('|')) break;
      table.rows.push(splitTableRow(row.text));
    }
    i -= 1; result.push(table);
  }
  return result;
}
/** Remove blank boundary lines without changing Markdown indentation on the first content line. */
function trimBlankLines(markdown: string): string {
  const lines = markdown.split('\n');
  let start = 0; let end = lines.length;
  while (start < end && lines[start]!.trim() === '') start += 1;
  while (end > start && lines[end - 1]!.trim() === '') end -= 1;
  return lines.slice(start, end).join('\n');
}
function sections(markdown: string): Array<{ title: string; markdown: string; line: number }> {
  const lines = visibleLines(markdown); const result: Array<{ title: string; markdown: string; line: number }> = [];
  let title = ''; let start = 0; let headingLine = 1;
  const push = (end: number): void => {
    const body = trimBlankLines(lines.slice(start, end).map((line) => line.text).join('\n'));
    if (title !== '' || body !== '') result.push({ title, markdown: body, line: headingLine });
  };
  for (let i = 0; i < lines.length; i += 1) {
    const row = lines[i]!; const heading = row.fenced ? null : /^##\s+(.+?)\s*#*\s*$/.exec(row.text);
    if (!heading) continue;
    push(i); title = heading[1]!.trim(); start = i + 1; headingLine = row.line;
  }
  push(lines.length); return result;
}
const splitTerms = (text: string): string[] => text.split(/[、；;，,]/).map((term) => term.trim()).filter(Boolean);
export function parseRouter(markdown: string, file: 'README.md' | 'AGENTS.md' = 'AGENTS.md'): Router {
  const table = tables(markdown).find((item) => item.headers.includes('领域') && item.headers.includes('路径'));
  const result: Router = { about: sections(markdown).find((section) => section.title === '关于我')?.markdown ?? '', domains: [], warnings: [], file };
  if (!table) { result.warnings.push({ code: 'router_missing', message: '没有找到领域路由表', file }); return result; }
  const names = new Set<string>();
  for (const row of table.rows) {
    const value = (key: string): string => (row[table.headers.indexOf(key)] ?? '').trim();
    const name = value('领域').replace(/`/g, '').trim(); const path = value('路径').replace(/`/g, '').replace(/\/+$/, '').trim();
    if (!name || !path) { result.warnings.push({ code: 'router_row', message: '路由表有缺少领域或路径的行', file }); continue; }
    if (names.has(name)) { result.warnings.push({ code: 'router_duplicate', message: `路由表重复登记了领域「${name}」`, file }); continue; }
    names.add(name);
    const terms = splitTerms(value('别名与关键词'));
    result.domains.push({ id: name, name, path, aliases: terms, keywords: terms, typicalQuestions: splitTerms(value('典型问题')), registered: true });
  }
  return result;
}
export function parseTodos(markdown: string, options: { domain: string; file: string; startLine?: number }): Todo[] {
  const result: Todo[] = [];
  for (const row of visibleLines(markdown)) {
    const match = row.fenced ? null : /^\s*[-*] \[( |x|X)\]\s+(.*)$/.exec(row.text);
    if (!match) continue;
    const line = row.line + (options.startLine ?? 1) - 1; const warnings: Warning[] = []; const tags: string[] = [];
    let due: string | null = null; let wait: string | null = null; let every: string | null = null;
    const done = match[1]!.toLowerCase() === 'x';
    let text = match[2]!.replace(/@([^\s@()]+)\(([^)]*)\)/g, (raw: string, name: string, value: string) => {
      if (name === 'due') {
        if (validDate(value)) due = value;
        else { due = null; warnings.push({ code: 'invalid_due', message: `截止日期不合法：${value}`, file: options.file, line }); }
      } else if (name === 'wait') wait = value.trim();
      else if (name === 'every' && /^\d+[wmy]$/.test(value)) every = value;
      else tags.push(raw);
      return '';
    }).trim();
    let doneAt: string | null = null;
    if (done) {
      const completed = /(?:^|\s)(\d{4}-\d{2}-\d{2})\s*$/.exec(text);
      if (completed && validDate(completed[1]!)) { doneAt = completed[1]!; text = text.slice(0, completed.index).trim(); }
    }
    result.push({ id: `${options.file}:${line}`, domain: options.domain, file: options.file, line, text, done, doneAt, due, wait, every, tags, bucket: done ? 'done' : 'undated', warnings, raw: row.text, hash: '' });
  }
  return result;
}
const KINDS: Record<string, SectionKind> = { 现状: 'current', 未结事项: 'todos', 近期变化: 'changes', 去哪查: 'references', 我是谁: 'identity', 长期方向与价值取向: 'direction', 当前重点: 'focus', 现实约束: 'constraints', '和 AI 协作的偏好': 'preferences' };
function references(markdown: string): { links: string; mounts: Mount[] } {
  const rows = visibleLines(markdown); const mounts: Mount[] = []; let links = ''; let current: Mount | null = null;
  for (const row of rows) {
    const heading = row.fenced ? null : /^###\s+(.+?)\s*#*\s*$/.exec(row.text);
    if (heading) { if (current) mounts.push({ ...current, markdown: trimBlankLines(current.markdown) }); current = { title: heading[1]!.trim(), markdown: '' }; }
    else if (current) current.markdown += `${row.text}\n`; else links += `${row.text}\n`;
  }
  if (current) mounts.push({ ...current, markdown: trimBlankLines(current.markdown) });
  return { links: trimBlankLines(links), mounts };
}
export function parseStatus(markdown: string, options: { domain: string; file: string }): ParsedStatus {
  const result: ParsedStatus = { updatedAt: null, sections: [], todos: [], changes: [], links: '', mounts: [], focus: [], gapCount: (markdown.match(/待补充/g) ?? []).length, warnings: [], markdown };
  const updated = markdown.split(/\r?\n/).slice(0, 10).join('\n').match(/更新于[：:]\s*(\d{4}-\d{2}-\d{2})/);
  if (updated) {
    if (validDate(updated[1]!)) result.updatedAt = updated[1]!;
    else result.warnings.push({ code: 'invalid_updated_at', message: '更新日期不合法', file: options.file });
  }
  for (const raw of sections(markdown)) {
    // Keep the preamble, including unusual content, as an ordinary section instead of discarding it.
    const section: Section = { ...raw, kind: KINDS[raw.title] ?? 'other', empty: /^(暂无|待补充)$/.test(raw.markdown.trim()) };
    result.sections.push(section);
    if (section.kind === 'todos') result.todos.push(...parseTodos(section.markdown, { ...options, startLine: section.line + 1 + leadingBlankLines(markdown, section.line) }));
    if (section.kind === 'changes') {
      for (const row of visibleLines(section.markdown)) {
        const match = row.fenced ? null : /^\s*- (\d{4}-\d{2}-\d{2})\s+(.+)$/.exec(row.text);
        if (match && validDate(match[1]!)) result.changes.push({ date: match[1]!, text: match[2]!, line: section.line + row.line + leadingBlankLines(markdown, section.line) });
      }
    }
    if (section.kind === 'references') {
      const found = references(section.markdown); result.links = [result.links, found.links].filter(Boolean).join('\n\n'); result.mounts.push(...found.mounts);
    }
    if (section.kind === 'focus') result.focus.push(...visibleLines(section.markdown).filter((row) => !row.fenced).map((row) => /^\s*[-*]\s+(.+)$/.exec(row.text)?.[1]).filter((item): item is string => item !== undefined));
  }
  result.warnings.push(...result.todos.flatMap((todo) => todo.warnings)); return result;
}
function leadingBlankLines(markdown: string, headingLine: number): number {
  const lines = markdown.split(/\r?\n/); let count = 0;
  for (let i = headingLine; i < lines.length && lines[i]!.trim() === ''; i += 1) count += 1;
  return count;
}
export function todoBucket(todo: Pick<Todo, 'done' | 'due' | 'wait'>, today: string): TodoBucket {
  if (todo.done) return 'done';
  if (todo.due && validDate(todo.due)) {
    if (todo.due < today) return 'overdue';
    if (todo.due === today) return 'dueToday';
    if (todo.due <= addDays(today, 7)) return 'next7';
  }
  if (todo.wait !== null) return 'waiting';
  return todo.due && validDate(todo.due) ? 'later' : 'undated';
}
export function groupTodos(todos: readonly Todo[], domains: readonly DomainSummary[], today: string): TodayGroups {
  const order = new Map(domains.map((domain, index) => [domain.id, index]));
  const groups: Record<Exclude<TodoBucket, 'done'>, Todo[]> = { overdue: [], dueToday: [], next7: [], waiting: [], undated: [], later: [] };
  for (const todo of todos) { const bucket = todoBucket(todo, today); if (bucket !== 'done') groups[bucket].push({ ...todo, bucket }); }
  for (const items of Object.values(groups)) items.sort((a, b) => (a.due ?? '9999-99-99').localeCompare(b.due ?? '9999-99-99') || (order.get(a.domain) ?? Number.MAX_SAFE_INTEGER) - (order.get(b.domain) ?? Number.MAX_SAFE_INTEGER) || a.line - b.line);
  const staleDomains = domains.filter((domain) => !domain.updatedAt || !validDate(domain.updatedAt) || dateDistance(domain.updatedAt, today) > 14);
  return { overdue: groups.overdue, dueToday: groups.dueToday, next7: groups.next7, waiting: groups.waiting, undated: { items: groups.undated.slice(0, 3), total: groups.undated.length }, later: { count: groups.later.length, items: groups.later }, staleDomains };
}
export function parseRegistry(markdown: string, options: { domain: string; file: string; home: string; stat: StatFunction }): RegistryRow[] {
  const result: RegistryRow[] = []; const required = ['主题', '资料', '位置', '用途', '状态'];
  for (const table of tables(markdown).filter((item) => required.every((header) => item.headers.includes(header)))) {
    for (const row of table.rows) {
      const value = (name: string): string => (row[table.headers.indexOf(name)] ?? '').trim();
      const location = value('位置'); const local = /`((?:~\/|\/)[^`]+)`/.exec(location); const link = /\[([^\]]*)\]\((https?:\/\/[^\s)]+)\)/.exec(location);
      let parsed: RegistryRow['location'];
      if (local) {
        const raw = local[1]!; const absolute = raw.startsWith('~/') ? `${options.home}/${raw.slice(2)}` : raw;
        let exists = false; try { const info = options.stat(absolute); exists = info !== false && info !== null && info !== undefined; } catch { /* Missing or inaccessible is represented explicitly. */ }
        const display = absolute === options.home ? '~' : absolute.startsWith(`${options.home}/`) ? `~/${absolute.slice(options.home.length + 1)}` : absolute;
        parsed = { kind: 'local', display, exists };
      } else if (link) parsed = { kind: 'link', display: link[1]!, url: link[2]! };
      else parsed = { kind: 'other', display: location };
      result.push({ domain: options.domain, topic: value('主题'), title: value('资料'), location: parsed, purpose: value('用途'), status: value('状态'), source: options.file });
    }
  }
  return result;
}
export function parseInbox(markdown: string): InboxEntry[] {
  return visibleLines(markdown).flatMap((row) => {
    const match = row.fenced ? null : /^\s*- (\d{4}-\d{2}-\d{2})\s+(.+)$/.exec(row.text);
    return match && validDate(match[1]!) ? [{ date: match[1]!, text: match[2]!, line: row.line }] : [];
  });
}
export function parseLog(markdown: string, file: string, domainNames: readonly string[] = []): LogEntry[] {
  const result: LogEntry[] = []; const rows = visibleLines(markdown); const month = /(?:^|\/)(\d{4}-\d{2})\.md$/.exec(file)?.[1] ?? '';
  const domains = new Set(['我', ...domainNames]);
  const classify = (tag: string | undefined): Pick<LogEntry, 'domain' | 'tag'> =>
    tag !== undefined && domains.has(tag) ? { domain: tag } : { domain: null, ...(tag === undefined ? {} : { tag }) };
  let section: LogEntry | null = null;
  const flush = (): void => { if (section) { section.markdown = trimBlankLines(section.markdown ?? ''); result.push(section); section = null; } };
  for (const row of rows) {
    const heading = row.fenced ? null : /^#{2,3}\s+(.+?)\s*#*\s*$/.exec(row.text);
    if (heading) {
      flush(); const title = heading[1]!.trim(); const stamp = /\d{4}-\d{2}-\d{2}/.exec(title)?.[0];
      section = { id: `${file}:${row.line}`, kind: 'section', date: stamp && validDate(stamp) ? stamp : month, ...classify(/\[([^\]]+)\]/.exec(title)?.[1]), title, text: title, markdown: '', file, line: row.line }; continue;
    }
    // Appended entries may occur anywhere between headings, even between ordinary list items.
    const entry = row.fenced ? null : /^- (\d{4}-\d{2}-\d{2})\s+(?:\[([^\]]+)\]\s*)?(.+)$/.exec(row.text);
    if (entry && validDate(entry[1]!)) {
      result.push({ id: `${file}:${row.line}`, kind: 'entry', date: entry[1]!, ...classify(entry[2]), text: entry[3]!, file, line: row.line });
      continue;
    }
    if (section) section.markdown += `${row.text}\n`;
  }
  flush(); return result.sort((a, b) => b.date.localeCompare(a.date) || a.line - b.line);
}
