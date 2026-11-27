import { tables, validDate } from './parse.js';
import { parseSourcesRegistry, REGISTRY_FILE } from './sources/registry.js';
import type { DocumentFile, Route, Router, Warning } from './types.js';

/** Spec personalos-ui 第 15 节：关于页。只读 PersonalOS 内的文件，不启动子进程。 */
export const ABOUT_FILE = '我/关于.md';
export const TREE_DEPTH = 3;
export const TREE_LIMIT = 20;

export interface AboutChange { version: string; date: string | null; text: string; line: number }
export interface AboutVersion { file: string; exists: boolean; current: AboutChange | null; changelog: AboutChange[] }
export type AboutEntryRole = 'router' | 'rules' | 'redirect' | 'protocol' | 'document';
export interface AboutEntry { path: string; name: string; title: string; summary: string; role: AboutEntryRole; redirect: string | null }
export interface AboutDomain { id: string; name: string; path: string; registered: boolean; exists: boolean; aliasCount: number; children: { name: string; kind: DocumentFile['kind'] }[] }
export interface AboutSources {
  file: string; exists: boolean;
  items: { name: string; method: string; taskCount: number }[];
  tasks: { total: number; launchd: number; codex: number; claude: number; other: number };
}
export interface AboutRecords {
  inbox: { exists: boolean; count: number };
  logs: { count: number; latest: string | null };
  blueprints: { path: string; title: string; date: string | null }[];
}
export interface AboutTreeNode { name: string; path: string; kind: DocumentFile['kind']; children?: AboutTreeNode[]; more?: number }
export interface PersonalOsAbout {
  root: string; exists: boolean; generatedAt: string; routerFile: Router['file'];
  about: AboutVersion; entries: AboutEntry[]; domains: AboutDomain[]; sources: AboutSources; records: AboutRecords;
  tree: AboutTreeNode[]; treeMore: number; warnings: Warning[];
}

const versionParts = (version: string): number[] => (version.match(/\d+/g) ?? []).map(Number);
function compareVersion(a: string, b: string): number {
  const left = versionParts(a); const right = versionParts(b);
  for (let i = 0; i < Math.max(left.length, right.length); i += 1) {
    const diff = (left[i] ?? 0) - (right[i] ?? 0);
    if (diff) return diff;
  }
  return 0;
}

/** 15.3：表头含「版本」「日期」的第一张表；新的在前，日期不合法的排最后且不当成当前版本。 */
export function parseAboutChangelog(markdown: string): { found: boolean; changelog: AboutChange[]; current: AboutChange | null } {
  const table = tables(markdown).find((item) => item.headers.includes('版本') && item.headers.includes('日期'));
  if (!table) return { found: false, changelog: [], current: null };
  const textColumn = ['更新内容', '内容', '说明'].find((name) => table.headers.includes(name));
  const changelog: AboutChange[] = [];
  table.rows.forEach((row, index) => {
    const cell = (name: string | undefined): string => (name === undefined ? '' : row[table.headers.indexOf(name)] ?? '').trim();
    const version = cell('版本').replace(/`/g, '').trim(); if (!version) return;
    const date = cell('日期');
    changelog.push({ version, date: validDate(date) ? date : null, text: cell(textColumn), line: table.line + 2 + index });
  });
  changelog.sort((a, b) => {
    if (a.date === null || b.date === null) return a.date === b.date ? a.line - b.line : a.date === null ? 1 : -1;
    return b.date.localeCompare(a.date) || compareVersion(b.version, a.version) || a.line - b.line;
  });
  return { found: true, changelog, current: changelog.find((item) => item.date !== null) ?? null };
}

/** 正文第一句：跳过标题、表格、元数据行，去掉链接和格式，最多 60 字。 */
export function documentSummary(markdown: string): { title: string; summary: string } {
  const lines = markdown.split(/\r?\n/);
  const title = lines.find((line) => /^#\s+/.test(line))?.replace(/^#\s+/, '').trim() ?? '';
  let fenced = false; let summary = '';
  for (const raw of lines) {
    const line = raw.trim();
    if (/^(```|~~~)/.test(line)) { fenced = !fenced; continue; }
    if (fenced || !line || /^(#|\||>|<!--|---)/.test(line) || /^(更新于|日期|状态|格式)[:：]/.test(line)) continue;
    const plain = line.replace(/^[-*+]\s+/, '').replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/[`*_]/g, '').trim();
    if (!plain) continue;
    const sentence = /^.*?[。！？!?](?=\s|$|[^。！？!?])/.exec(plain)?.[0] ?? plain;
    summary = sentence.length > 60 ? `${sentence.slice(0, 59)}…` : sentence;
    break;
  }
  return { title, summary };
}

export function redirectTarget(markdown: string): string | null {
  const match = /^\s*@(\S+)\s*$/.exec(markdown);
  return match ? match[1]! : null;
}

export function entryRole(path: string, routerFile: Router['file'], redirect: string | null): AboutEntryRole {
  if (redirect) return 'redirect';
  if (path === routerFile) return 'router';
  if (path === 'AGENTS.md') return 'rules';
  if (path.startsWith('协议/')) return 'protocol';
  return 'document';
}

export function aboutSources(markdown: string | null): AboutSources {
  const tasks = { total: 0, launchd: 0, codex: 0, claude: 0, other: 0 };
  if (markdown === null) return { file: REGISTRY_FILE, exists: false, items: [], tasks };
  // 关于页不碰外部路径：位置是否存在交给接入页判断。
  const registry = parseSourcesRegistry(markdown, { home: '/', stat: () => undefined });
  for (const task of registry.tasks) {
    if (task.ignored) continue;
    tasks.total += 1; tasks[task.runner ?? 'other'] += 1;
  }
  return { file: REGISTRY_FILE, exists: true, items: registry.sources.map((source) => ({ name: source.name, method: source.methodRaw || source.method, taskCount: source.taskRefs.length })), tasks };
}

export function aboutDomain(route: Route, exists: boolean, children: DocumentFile[]): AboutDomain {
  return { id: route.id, name: route.name, path: route.path, registered: route.registered, exists, aliasCount: route.aliases.length, children: children.map((child) => ({ name: child.name, kind: child.kind })) };
}

export function blueprintInfo(path: string, markdown: string): AboutRecords['blueprints'][number] {
  const date = /^日期[:：]\s*(\d{4}-\d{2}-\d{2})/m.exec(markdown)?.[1] ?? null;
  return { path, title: documentSummary(markdown).title || path.replace(/^.*\//, '').replace(/\.md$/i, ''), date: date && validDate(date) ? date : null };
}

/** 15.2 目录结构：往下三层，每个目录最多 20 项，第三层的目录只给项数。 */
export function aboutTree(list: (path: string) => DocumentFile[], path = '', depth = 1): { nodes: AboutTreeNode[]; more: number } {
  const entries = list(path);
  const nodes = entries.slice(0, TREE_LIMIT).map((entry): AboutTreeNode => {
    const base = { name: entry.name, path: entry.path, kind: entry.kind };
    if (entry.kind !== 'directory') return base;
    if (depth >= TREE_DEPTH) { const count = list(entry.path).length; return { ...base, children: [], ...(count ? { more: count } : {}) }; }
    const sub = aboutTree(list, entry.path, depth + 1);
    return { ...base, children: sub.nodes, ...(sub.more ? { more: sub.more } : {}) };
  });
  return { nodes, more: Math.max(0, entries.length - TREE_LIMIT) };
}
