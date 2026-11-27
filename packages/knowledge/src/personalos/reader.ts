import { createHash } from 'node:crypto';
import { statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { KnowledgeError } from '../types.js';
import { abbreviateHome } from '../env.js';
import { addDays, currentDate, dateDistance, groupTodos, parseInbox, parseLog, parseRegistry, parseRouter, parseStatus, todoBucket, validDate } from './parse.js';
import { isPersonalOsDirectory, listPersonalOsFiles, normalizePersonalOsPath, personalOsExists, readPersonalOsFile, walkPersonalOsFiles } from './files.js';
import { ABOUT_FILE, aboutDomain, aboutSources, aboutTree, blueprintInfo, documentSummary, entryRole, parseAboutChangelog, redirectTarget, type AboutEntry, type PersonalOsAbout } from './about.js';
import { REGISTRY_FILE } from './sources/registry.js';
import type { Availability, DocumentFile, DomainDetail, InboxEntry, LogOptions, LogResult, Matter, Overview, PersonalOsReaderOptions, RegistryRow, Route, Router, StatFunction, TodayResult, Warning } from './types.js';

export function contentHash(content: string): string { return createHash('sha256').update(content, 'utf8').digest('hex'); }

export class PersonalOsReader {
  readonly home: string;
  readonly root: string;
  private readonly todayOverride: string | undefined;
  private readonly stat: StatFunction;
  constructor(options: PersonalOsReaderOptions) {
    this.home = resolve(options.home); this.root = resolve(options.root ?? join(this.home, 'Documents', 'PersonalOS'));
    this.todayOverride = options.today; this.stat = options.stat ?? statSync;
  }
  private date(): string { return currentDate(new Date(), this.todayOverride ?? process.env.BLUEMANTA_TODAY); }
  private requireRoot(): void { if (!personalOsExists(this.root)) throw new KnowledgeError('library_missing', '没有找到 PersonalOS'); }
  private markdown(path: string, warnings: Warning[], optional = false): { content: string; availability: Availability } {
    try {
      const file = readPersonalOsFile(this.root, path);
      if (file.availability === 'icloud') warnings.push({ code: 'icloud_pending', message: '尚未从 iCloud 下载', file: path });
      if (file.truncated) warnings.push({ code: 'file_truncated', message: '文件过长，仅解析前 1 MB', file: path });
      return { content: file.content ?? '', availability: file.availability };
    } catch (error) {
      const missing = error instanceof KnowledgeError && error.code === 'not_found';
      if (!optional || !missing) warnings.push({ code: missing ? 'file_missing' : 'file_unreadable', message: missing ? '文件不存在' : '文件无法安全读取', ...(safePath(path) ? { file: path } : {}) });
      return { content: '', availability: missing ? 'missing' : 'unreadable' };
    }
  }
  /** PersonalOS v0.4 keeps the routing table in README.md; v0.3 in AGENTS.md. README.md wins when it has one (spec 1.2). */
  private router(warnings: Warning[]): Router {
    const readme = this.markdown('README.md', warnings, true).content;
    const fromReadme = readme ? parseRouter(readme, 'README.md') : null;
    if (fromReadme && !fromReadme.warnings.some((warning) => warning.code === 'router_missing')) {
      const about = fromReadme.about || parseRouter(this.markdown('AGENTS.md', [], true).content).about;
      return { ...fromReadme, about };
    }
    const agents = parseRouter(this.markdown('AGENTS.md', warnings).content, 'AGENTS.md');
    return { ...agents, about: agents.about || (fromReadme?.about ?? '') };
  }
  private routes(warnings: Warning[]): Router {
    const parsed = this.router(warnings); warnings.push(...parsed.warnings); const file = parsed.file;
    const domains: Route[] = []; const paths = new Set<string>();
    for (const route of parsed.domains) {
      try {
        const path = normalizePersonalOsPath(route.path);
        if (!path) throw new Error('empty');
        // Only a domain-shaped directory may be registered, never a protocol or a file.
        if (path !== '我' && !/^领域\/[^/]+$/.test(path)) throw new Error('not domain');
        if (paths.has(path)) { warnings.push({ code: 'router_duplicate', message: '路由表重复登记了领域目录', file }); continue; }
        paths.add(path); domains.push({ ...route, path });
      } catch { warnings.push({ code: 'router_path', message: '路由表有无法安全读取的领域路径', file }); }
    }
    const candidates = [
      ...(isPersonalOsDirectory(this.root, '我') ? [{ name: '我', path: '我' }] : []),
      ...listPersonalOsFiles(this.root, '领域', warnings).filter((entry) => entry.kind === 'directory').map((entry) => ({ name: entry.name, path: entry.path })),
    ];
    for (const item of candidates) {
      if (paths.has(item.path) || domains.some((domain) => domain.id === item.name)) continue;
      paths.add(item.path); domains.push({ id: item.name, name: item.name, path: item.path, aliases: [], keywords: [], typicalQuestions: [], registered: false });
    }
    return { about: parsed.about, domains, warnings: [], file };
  }
  /** Routing metadata without reading domain documents or checking external registry locations. */
  routing(): Router {
    this.requireRoot(); const warnings: Warning[] = [];
    return { ...this.routes(warnings), warnings };
  }
  private registryFor(route: Route, warnings: Warning[]): RegistryRow[] {
    const file = `${route.path}/资料登记.md`; const input = this.markdown(file, warnings, true);
    return parseRegistry(input.content, { domain: route.id, file, home: this.home, stat: this.stat });
  }
  private detail(route: Route, today: string): DomainDetail {
    const warnings: Warning[] = []; const exists = isPersonalOsDirectory(this.root, route.path); const file = `${route.path}/状态.md`;
    const input = exists ? this.markdown(file, warnings) : { content: '', availability: 'missing' as const };
    if (!exists) warnings.push({ code: 'domain_missing', message: '目录不存在' });
    const parsed = parseStatus(input.content, { domain: route.id, file }); warnings.push(...parsed.warnings);
    const hash = contentHash(input.content); const lines = input.content.split(/\r?\n/);
    const todos = parsed.todos.map((todo) => ({ ...todo, bucket: todoBucket(todo, today), raw: lines[todo.line - 1] ?? todo.raw, hash }));
    const staleDays = parsed.updatedAt ? dateDistance(parsed.updatedAt, today) : null;
    const files = exists ? walkPersonalOsFiles(this.root, route.path, warnings) : [];
    const children = exists ? listPersonalOsFiles(this.root, route.path, warnings) : [];
    const knowledge = children.filter((entry) => entry.name === '知识.md' && entry.kind === 'markdown');
    const knowledgeDir = children.find((entry) => entry.name === '知识' && entry.kind === 'directory');
    if (knowledgeDir) knowledge.push(...listPersonalOsFiles(this.root, knowledgeDir.path, warnings).filter((entry) => entry.kind === 'markdown'));
    const matters: Matter[] = [];
    for (const entry of listPersonalOsFiles(this.root, `${route.path}/事项`, warnings)) {
      if (entry.kind === 'markdown') matters.push({ name: entry.name.replace(/\.md$/i, ''), path: entry.path, entry: entry.path, files: [entry] });
      else if (entry.kind === 'directory') {
        const matterFiles = walkPersonalOsFiles(this.root, entry.path, warnings); const preferred = matterFiles.find((item) => item.path === `${entry.path}/${entry.name}.md`) ?? matterFiles.find((item) => item.path === `${entry.path}/README.md`);
        matters.push({ name: entry.name, path: entry.path, entry: preferred?.path ?? matterFiles[0]?.path ?? null, files: matterFiles });
      }
    }
    return { ...route, exists, updatedAt: parsed.updatedAt, stale: staleDays === null || staleDays > 14, staleDays, openCount: todos.filter((todo) => !todo.done).length,
      overdueCount: todos.filter((todo) => todo.bucket === 'overdue').length, gapCount: parsed.gapCount, latestChange: parsed.changes[0] ?? null, availability: input.availability,
      warnings, file, sections: parsed.sections, todos, changes: parsed.changes, links: parsed.links, mounts: parsed.mounts,
      registry: exists ? this.registryFor(route, warnings) : [], matters, knowledge, files, markdown: parsed.markdown };
  }
  private snapshot(): { today: string; about: string; routerFile: Router['file']; domains: DomainDetail[]; inbox: InboxEntry[]; warnings: Warning[] } {
    this.requireRoot(); const today = this.date(); const warnings: Warning[] = []; const routes = this.routes(warnings);
    const domains = routes.domains.map((route) => this.detail(route, today)); warnings.push(...domains.flatMap((domain) => domain.warnings));
    const inbox = parseInbox(this.markdown('收件箱.md', warnings, true).content);
    return { today, about: routes.about, routerFile: routes.file, domains, inbox, warnings };
  }
  overview(): Overview {
    if (!personalOsExists(this.root)) return { root: abbreviateHome(this.root, this.home), exists: false, today: this.date(), about: '', routerFile: 'AGENTS.md', focus: [], domains: [], inbox: 0, warnings: [{ code: 'library_missing', message: '没有找到 PersonalOS' }] };
    const state = this.snapshot(); const self = state.domains.find((domain) => domain.path === '我');
    const focus = self ? parseStatus(self.markdown, { domain: self.id, file: self.file }).focus.slice(0, 3) : [];
    return { root: abbreviateHome(this.root, this.home), exists: true, today: state.today, about: state.about, routerFile: state.routerFile, focus, domains: state.domains.map(summary), inbox: state.inbox.length, warnings: state.warnings };
  }
  today(): TodayResult {
    const state = this.snapshot();
    return { ...groupTodos(state.domains.flatMap((domain) => domain.todos), state.domains.map(summary), state.today), inbox: state.inbox, today: state.today, warnings: state.warnings };
  }
  domain(id: string): DomainDetail {
    this.requireRoot(); const warnings: Warning[] = []; const route = this.routes(warnings).domains.find((domain) => domain.id === id);
    if (!route) throw new KnowledgeError('not_found', '没有找到这个领域');
    const detail = this.detail(route, this.date()); detail.warnings.unshift(...warnings); return detail;
  }
  registry(): RegistryRow[] { return this.snapshot().domains.flatMap((domain) => domain.registry); }
  inbox(): InboxEntry[] { this.requireRoot(); return parseInbox(this.markdown('收件箱.md', [], true).content); }
  log(options: LogOptions = {}): LogResult {
    this.requireRoot(); const warnings: Warning[] = []; const entries = listPersonalOsFiles(this.root, '日志', warnings).filter((entry) => /^\d{4}-\d{2}\.md$/.test(entry.name));
    const domainNames = this.routes(warnings).domains.filter((domain) => domain.registered).map((domain) => domain.name);
    let items = entries.flatMap((entry) => parseLog(this.markdown(entry.path, warnings).content, entry.path, domainNames));
    if (options.domains?.length || options.includeUnassigned) items = items.filter((item) => item.domain === null ? options.includeUnassigned : options.domains?.includes(item.domain));
    const before = options.before && validDate(options.before) ? options.before : addDays(this.date(), 1);
    const days = Number.isInteger(options.days) && (options.days ?? 0) > 0 ? options.days! : 30;
    const start = addDays(before, -days);
    const dateOf = (date: string): string => date.length === 7 ? `${date}-01` : date;
    const eligible = items.filter((item) => dateOf(item.date) < before).sort((a, b) => b.date.localeCompare(a.date) || a.file.localeCompare(b.file) || a.line - b.line);
    return { items: eligible.filter((item) => dateOf(item.date) >= start), hasMore: eligible.some((item) => dateOf(item.date) < start), warnings };
  }
  file(path: string): ReturnType<typeof readPersonalOsFile> { this.requireRoot(); return readPersonalOsFile(this.root, path); }
  /** 关于页（规格第 15 节）：只读 PersonalOS 内的文件，不跑子进程、不碰外部路径。 */
  about(): PersonalOsAbout {
    const generatedAt = new Date().toISOString(); const root = abbreviateHome(this.root, this.home);
    if (!personalOsExists(this.root)) {
      return { root, exists: false, generatedAt, routerFile: 'README.md', about: { file: ABOUT_FILE, exists: false, current: null, changelog: [] }, entries: [], domains: [],
        sources: aboutSources(null), records: { inbox: { exists: false, count: 0 }, logs: { count: 0, latest: null }, blueprints: [] }, tree: [], treeMore: 0,
        warnings: [{ code: 'library_missing', message: '没有找到 PersonalOS' }] };
    }
    const warnings: Warning[] = []; const routes = this.routes(warnings); warnings.push(...routes.warnings);
    const optional = (path: string): string | null => { const file = this.markdown(path, warnings, true); return file.availability === 'missing' ? null : file.content; };
    const list = (path: string) => listPersonalOsFiles(this.root, path, warnings);

    const aboutText = optional(ABOUT_FILE); const changelog = parseAboutChangelog(aboutText ?? '');
    if (aboutText !== null && !changelog.found) warnings.push({ code: 'about_table_missing', message: '没有找到含「版本」「日期」的更新记录表', file: ABOUT_FILE });

    const order: AboutEntry['role'][] = ['router', 'rules', 'document', 'redirect', 'protocol'];
    const entries = [...list('').filter((file) => file.kind === 'markdown' && file.name !== '收件箱.md'), ...list('协议').filter((file) => file.kind === 'markdown')].map((file): AboutEntry => {
      const content = this.markdown(file.path, warnings).content; const redirect = redirectTarget(content);
      return { path: file.path, name: file.name, ...documentSummary(content), role: entryRole(file.path, routes.file, redirect), redirect };
    }).sort((a, b) => order.indexOf(a.role) - order.indexOf(b.role));

    const domains = routes.domains.map((route) => {
      const exists = isPersonalOsDirectory(this.root, route.path);
      return aboutDomain(route, exists, exists ? list(route.path) : []);
    });
    const inbox = optional('收件箱.md');
    const logs = list('日志').filter((file) => /^\d{4}-\d{2}\.md$/.test(file.name)).map((file) => file.name.slice(0, 7)).sort();
    const blueprints = list('蓝图').filter((file) => file.kind === 'markdown').map((file) => blueprintInfo(file.path, this.markdown(file.path, warnings).content));
    const tree = aboutTree(list);
    return {
      root, exists: true, generatedAt, routerFile: routes.file,
      about: { file: ABOUT_FILE, exists: aboutText !== null, current: changelog.current, changelog: changelog.changelog },
      entries, domains, sources: aboutSources(optional(REGISTRY_FILE)),
      records: { inbox: { exists: inbox !== null, count: inbox === null ? 0 : parseInbox(inbox).length }, logs: { count: logs.length, latest: logs.at(-1) ?? null }, blueprints },
      tree: tree.nodes, treeMore: tree.more, warnings,
    };
  }
  /** Root-level explanatory documents, without hidden paths or the CLAUDE.md redirect. */
  documents(): DocumentFile[] {
    this.requireRoot(); const roots = listPersonalOsFiles(this.root).filter((entry) => entry.kind === 'markdown' && entry.name !== 'CLAUDE.md');
    return [...roots, ...walkPersonalOsFiles(this.root, '协议'), ...walkPersonalOsFiles(this.root, '蓝图')];
  }
}
function safePath(path: string): boolean { try { normalizePersonalOsPath(path); return true; } catch { return false; } }
function summary(detail: DomainDetail): Overview['domains'][number] {
  const { id, name, path, aliases, keywords, typicalQuestions, registered, exists, updatedAt, stale, staleDays, openCount, overdueCount, gapCount, latestChange, availability, warnings } = detail;
  return { id, name, path, aliases, keywords, typicalQuestions, registered, exists, updatedAt, stale, staleDays, openCount, overdueCount, gapCount, latestChange, availability, warnings };
}
