import { execFile } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { KnowledgeError } from '../../types.js';
import type { StatFunction, Warning } from '../types.js';
import { discoverClaude, discoverCodex } from './agents.js';
import { measureFreshness, tailLines } from './freshness.js';
import { discoverLaunchd, parseLaunchctlList, type LaunchctlRow } from './launchd.js';
import { expandHome, parseSourcesRegistry, parseTaskRef, REGISTRY_FILE, shortenHome } from './registry.js';
import type { DiscoveredTask, RegisteredTask, SourcesRegistry, SourcesResult, SourceView, TaskState, TaskView } from './types.js';

export * from './types.js';
export { parseSourcesRegistry, parseTaskRef, parseInterval, REGISTRY_FILE } from './registry.js';
export { measureFreshness, parseRunLog, levelFor } from './freshness.js';
export { parsePlist } from './plist.js';
export { parseLaunchctlList, isSelfBuilt, redactArgument, discoverLaunchd } from './launchd.js';
export { discoverCodex, discoverClaude, readCodexFields, CODEX_KEYS } from './agents.js';
export { describeCalendar, nextCalendarRun, parseRrule, describeRrule, nextRruleRun } from './schedule.js';

/** The only child process the 接入 page runs (spec 3.2): `launchctl list`, no arguments, 3 s timeout. */
export function runLaunchctlList(): Promise<string | null> {
  return new Promise((done) => {
    execFile('launchctl', ['list'], { timeout: 3000, maxBuffer: 4 * 1024 * 1024 }, (error, stdout) => done(error ? null : stdout));
  });
}

export interface SourcesReaderOptions {
  home: string; root?: string; now?: () => Date; stat?: StatFunction;
  /** Directory overrides; default to the env variables of spec 3, then the home layout. */
  launchAgentsDir?: string; codexDir?: string; claudeDir?: string;
  /** Text of `launchctl list`; null means unavailable. Defaults to BLUEMANTA_LAUNCHCTL_LIST_FILE, then the real command. */
  launchctlList?: () => Promise<string | null>;
}

const FAILED: readonly TaskState[] = ['failed', 'signaled'];
const ORDER: Record<string, number> = { failed: 0, signaled: 0, not_loaded: 1, missing: 2 };
const RESULT_TEXT: Record<TaskState, (exit: number | null) => string> = {
  running: () => '运行中', ok: () => '上次正常', failed: (exit) => `失败（退出码 ${exit}）`, signaled: (exit) => `被信号 ${Math.abs(exit ?? 0)} 终止`,
  not_loaded: () => '未加载', unknown: () => '未知', unreadable: () => '无法读取', active: () => '运行记录未接入', paused: () => '已暂停',
  ended: () => '已结束', managed: () => '运行记录未接入', missing: () => '找不到',
};

export class SourcesReader {
  readonly home: string; readonly root: string;
  private readonly now: () => Date; private readonly stat: StatFunction;
  private readonly dirs: { launchd: string; codex: string; claude: string };
  private readonly launchctlList: () => Promise<string | null>;
  constructor(options: SourcesReaderOptions) {
    this.home = resolve(options.home); this.root = resolve(options.root ?? join(this.home, 'Documents', 'PersonalOS'));
    this.now = options.now ?? (() => new Date()); this.stat = options.stat ?? statSync;
    this.dirs = {
      launchd: options.launchAgentsDir ?? process.env.BLUEMANTA_LAUNCHAGENTS_DIR ?? join(this.home, 'Library', 'LaunchAgents'),
      codex: options.codexDir ?? process.env.BLUEMANTA_CODEX_AUTOMATIONS_DIR ?? join(this.home, '.codex', 'automations'),
      claude: options.claudeDir ?? process.env.BLUEMANTA_CLAUDE_TASKS_DIR ?? join(this.home, '.claude', 'scheduled-tasks'),
    };
    const listFile = process.env.BLUEMANTA_LAUNCHCTL_LIST_FILE;
    this.launchctlList = options.launchctlList ?? (listFile ? async () => { try { return readFileSync(listFile, 'utf8'); } catch { return null; } } : runLaunchctlList);
  }

  registry(): SourcesRegistry {
    let markdown: string;
    try { markdown = readFileSync(join(this.root, REGISTRY_FILE), 'utf8'); } catch { return { exists: false, sources: [], tasks: [], warnings: [] }; }
    return parseSourcesRegistry(markdown, { home: this.home, stat: this.stat });
  }

  async collect(): Promise<SourcesResult> {
    const now = this.now(); const registry = this.registry(); const warnings: Warning[] = [...registry.warnings];
    const listText = await this.launchctlList();
    if (listText === null) warnings.push({ code: 'launchctl_unavailable', message: '读不到 launchctl list，launchd 任务的状态显示为未知' });
    const list: Map<string, LaunchctlRow> | null = listText === null ? null : parseLaunchctlList(listText);
    const discovered = [
      ...discoverLaunchd(this.dirs.launchd, { home: this.home, now, list }),
      ...discoverCodex(this.dirs.codex, { home: this.home, now }),
      ...discoverClaude(this.dirs.claude, { home: this.home }),
    ];
    const found = new Map(discovered.map((task) => [task.ref, task]));
    const registered = new Map<string, RegisteredTask>();
    for (const task of registry.tasks) if (!registered.has(task.ref)) registered.set(task.ref, task);
    const sourcesFor = (ref: string): string[] => registry.sources.filter((source) => source.taskRefs.includes(ref)).map((source) => source.name);
    const view = (task: DiscoveredTask, entry: RegisteredTask | undefined): TaskView => {
      const { outputPaths, ...rest } = task; const log = entry?.log ? expandHome(entry.log, this.home) : null;
      let lastOutputAt = rest.lastOutputAt;
      if (log) { try { const mtime = statSync(log).mtime.toISOString(); if (!lastOutputAt || mtime > lastOutputAt) lastOutputAt = mtime; } catch { /* Missing log. */ } }
      return {
        ...rest, name: entry?.name ?? rest.name, lastOutputAt, registered: !!entry, purpose: entry?.purpose ?? '', sourceNames: sourcesFor(task.ref),
        logPath: log ? shortenHome(log, this.home) : outputPaths[1] ? shortenHome(outputPaths[1], this.home) : null,
        logVisible: !!entry?.logVisible && !!log, resultText: RESULT_TEXT[rest.state](rest.lastExit),
      };
    };
    // Registry refs that were not found at any runner, plus refs named only by sources (spec 1.3).
    const missing = new Map<string, RegisteredTask>();
    for (const entry of registered.values()) if (!entry.ignored && !found.has(entry.ref)) missing.set(entry.ref, entry);
    for (const source of registry.sources) for (const ref of source.taskRefs) {
      if (!found.has(ref) && !missing.has(ref) && !registered.get(ref)?.ignored) { const parsed = parseTaskRef(ref); missing.set(ref, { ...parsed, name: parsed.label, purpose: '', ignored: false, log: null, logVisible: false, line: source.line }); }
    }
    const tasks: TaskView[] = []; const services: TaskView[] = []; const unregistered: TaskView[] = [];
    for (const task of discovered) {
      const entry = registered.get(task.ref); if (entry?.ignored) continue;
      const item = view(task, entry);
      if (task.kind === '常驻') { if (task.selfBuilt || entry) services.push(item); }
      else if (entry || item.sourceNames.length > 0) tasks.push(item);
      // Unreadable plists cannot be judged, so they surface for a human to decide (spec 3.1).
      else if (task.selfBuilt || task.state === 'unreadable') unregistered.push(item);
    }
    for (const entry of missing.values()) {
      tasks.push({
        ref: entry.ref, runner: entry.runner ?? 'launchd', label: entry.label, name: entry.name, kind: '其他', schedule: '—', nextRun: null, state: 'missing',
        lastExit: null, lastOutputAt: null, selfBuilt: true, configPath: '', program: null, registered: registered.has(entry.ref), purpose: entry.purpose,
        sourceNames: sourcesFor(entry.ref), logPath: entry.log, logVisible: false, resultText: RESULT_TEXT.missing(null),
      });
    }
    const byName = (a: TaskView, b: TaskView): number => (ORDER[a.state] ?? 3) - (ORDER[b.state] ?? 3) || a.name.localeCompare(b.name, 'zh-Hans-CN');
    tasks.sort(byName); services.sort(byName); unregistered.sort(byName);
    const sources: SourceView[] = registry.sources.map(({ probe, ...source }) => {
      const absolute = probe ? expandHome(probe, this.home) : null;
      let exists = false; if (absolute) { try { statSync(absolute); exists = true; } catch { /* Missing probe. */ } }
      const freshness = source.method === '副本' && absolute
        ? measureFreshness(absolute, { intervalMs: source.interval?.ms ?? null, successMarks: source.successMarks, now })
        : { level: 'none' as const, lastSuccessAt: null, lastRun: null, mode: null };
      return { ...source, probe: absolute ? { display: shortenHome(absolute, this.home), exists } : null, freshness };
    });
    return {
      registry: { exists: registry.exists, path: REGISTRY_FILE }, sources, tasks, services, unregistered,
      summary: {
        failedTasks: [...tasks, ...services].filter((task) => FAILED.includes(task.state)).length,
        staleSources: sources.filter((source) => source.freshness.level === 'stale' || source.freshness.level === 'probe_missing').length,
        unregistered: unregistered.length,
      },
      generatedAt: now.toISOString(), warnings,
    };
  }

  /** Spec 4: last 20 lines of a registered task's log, only when the registry marks it 日志可显示. */
  taskLog(ref: string): { ref: string; path: string; lines: string[] } {
    const entry = this.registry().tasks.find((task) => task.ref === ref && !task.ignored);
    if (!entry?.log || !entry.logVisible) throw new KnowledgeError('forbidden', '这个任务的日志没有登记为可显示');
    const path = expandHome(entry.log, this.home);
    try { return { ref, path: shortenHome(path, this.home), lines: tailLines(path, 20) }; }
    catch { throw new KnowledgeError('not_found', '日志文件不存在'); }
  }
}
