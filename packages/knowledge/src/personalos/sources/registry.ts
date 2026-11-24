import { tables } from '../parse.js';
import type { RegistryLocation, StatFunction, Warning } from '../types.js';
import type { RegisteredSource, RegisteredTask, Runner, SourceMethod, SourcesRegistry } from './types.js';

export const REGISTRY_FILE = '我/数据源.md';
const METHODS: readonly SourceMethod[] = ['查询', '副本', '登记', '推入'];
const RUNNERS: readonly Runner[] = ['launchd', 'codex', 'claude'];
const UNIT_MS: Record<string, number> = { 分钟: 60_000, 小时: 3_600_000, 天: 86_400_000, 周: 604_800_000 };

export function expandHome(path: string, home: string): string { return path === '~' ? home : path.startsWith('~/') ? `${home}/${path.slice(2)}` : path; }
export function shortenHome(path: string, home: string): string { return path === home ? '~' : path.startsWith(`${home}/`) ? `~/${path.slice(home.length + 1)}` : path; }
const empty = (text: string): boolean => text === '' || /^[—–-]+$/.test(text);
const backticked = (text: string): string[] => [...text.matchAll(/`([^`]+)`/g)].map((match) => match[1]!.trim());
const localPath = (text: string): string | null => backticked(text).find((item) => item.startsWith('~/') || item.startsWith('/')) ?? null;

/** `launchd:label` → runner + label; anything else keeps the text with a null runner so it shows as 找不到. */
export function parseTaskRef(text: string): { ref: string; runner: Runner | null; label: string } {
  const match = /^([a-z]+):(.+)$/.exec(text.trim());
  const runner = match && (RUNNERS as readonly string[]).includes(match[1]!) ? match[1] as Runner : null;
  return { ref: text.trim(), runner, label: runner ? match![2]!.trim() : text.trim() };
}
export function parseInterval(text: string): { text: string; ms: number } | null {
  const match = /^(\d+)\s*(分钟|小时|天|周)$/.exec(text.trim());
  if (!match || Number(match[1]) <= 0) return null;
  return { text: `${Number(match[1])} ${match[2]}`, ms: Number(match[1]) * UNIT_MS[match[2]!]! };
}
function location(cell: string, home: string, stat: StatFunction): RegistryLocation {
  const local = localPath(cell); const link = /\[([^\]]*)\]\((https?:\/\/[^\s)]+)\)/.exec(cell);
  if (local) {
    let exists = false; try { const info = stat(expandHome(local, home)); exists = info !== false && info !== null && info !== undefined; } catch { /* Missing or unreadable. */ }
    return { kind: 'local', display: shortenHome(expandHome(local, home), home), exists };
  }
  if (link) return { kind: 'link', display: link[1]!, url: link[2]! };
  return { kind: 'other', display: cell };
}
function card(cell: string): RegisteredSource['card'] {
  const match = /\[([^\]]*)\]\(([^)\s]+)\)/.exec(cell);
  if (!match || /^https?:/.test(match[2]!)) return null;
  const [target, anchor] = match[2]!.split('#', 2) as [string, string | undefined];
  // Links are written relative to 我/ (the registry's own folder).
  const parts = `我/${target}`.split('/'); const resolved: string[] = [];
  for (const part of parts) { if (part === '..') resolved.pop(); else if (part !== '.' && part !== '') resolved.push(part); }
  let decoded = anchor ?? null; try { decoded = anchor ? decodeURIComponent(anchor) : null; } catch { /* Keep raw anchor. */ }
  return { title: match[1]!, path: resolved.join('/'), anchor: decoded };
}

/** Spec personalos-sources 1.1–1.3: tables are found by their headers, columns in any order, missing columns are empty. */
export function parseSourcesRegistry(markdown: string, options: { home: string; stat: StatFunction }): SourcesRegistry {
  const warnings: Warning[] = []; const sources: RegisteredSource[] = []; const tasks: RegisteredTask[] = [];
  for (const table of tables(markdown)) {
    const has = (name: string): boolean => table.headers.includes(name);
    table.rows.forEach((row, index) => {
      const value = (name: string): string => (has(name) ? row[table.headers.indexOf(name)] ?? '' : '').trim();
      const line = table.line + 2 + index;
      if (has('来源') && has('方式')) {
        const name = value('来源'); if (empty(name)) return;
        const methodRaw = value('方式'); const method = (METHODS as readonly string[]).includes(methodRaw) ? methodRaw as SourceMethod : '登记';
        const marks = value('成功标记');
        sources.push({
          name, method, methodRaw, location: location(value('位置'), options.home, options.stat),
          taskRefs: backticked(value('刷新任务')).filter((item) => item.includes(':')),
          interval: parseInterval(value('预期间隔')), probe: localPath(value('新鲜度探针')),
          successMarks: empty(marks) ? ['成功'] : marks.split(/[、,，]/).map((item) => item.trim()).filter(Boolean),
          card: card(value('来源卡')), line,
        });
      } else if (has('任务') && has('标识')) {
        const id = backticked(value('标识'))[0] ?? value('标识'); if (empty(id)) return;
        const parsed = parseTaskRef(id); const purpose = value('用途');
        if (!parsed.runner) warnings.push({ code: 'task_ref_invalid', message: `任务标识「${id}」不是 执行方:标识 的写法`, file: REGISTRY_FILE, line });
        tasks.push({ ...parsed, name: empty(value('任务')) ? parsed.label : value('任务'), purpose, ignored: purpose === '忽略', log: localPath(value('日志')), logVisible: value('日志可显示') === '是', line });
      }
    });
  }
  return { exists: true, sources, tasks, warnings };
}
