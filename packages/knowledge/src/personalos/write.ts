import { execFile } from 'node:child_process';
import { existsSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { promisify } from 'node:util';
import { KnowledgeError } from '../types.js';
import { resolvePersonalOsPath } from './files.js';
import { locateRepository } from './git.js';
import { currentDate, parseStatus, validDate } from './parse.js';
import { contentHash, PersonalOsReader } from './reader.js';
import type { Warning } from './types.js';

/**
 * The only two writes the board makes (spec 13, ADR 0011 decision 5): append a quick note to 收件箱.md,
 * and complete one todo the way 协议/更新.md describes. Paths are built here from fixed names and the
 * routing table, never taken from a request.
 */
const exec = promisify(execFile);
const MAX_NOTE = 500;
const MAX_MESSAGE = 72;

export interface WriteFileChange { path: string; lines: string[] }
export interface QuickNoteResult { line: string; hash: string }
export interface CompleteTodoInput { domain: string; line: number; raw: string; hash: string; dryRun: boolean }
export interface CompleteTodoResult {
  dryRun: boolean; files: WriteFileChange[]; message: string; hash: string; warnings: Warning[];
  committed?: boolean; reason?: 'dirty' | 'no_repo' | 'git_missing' | 'git_error'; sha?: string;
}
export interface PersonalOsWriterOptions { home: string; root?: string; today?: string; git?: string }

/** Add one period to a date. Months clamp to the month's last day; a 2-29 a year on becomes 2-28. */
export function addPeriod(date: string, every: string): string {
  const match = /^(\d+)([wmy])$/.exec(every);
  if (!match || Number(match[1]) < 1) throw new KnowledgeError('invalid_input', '周期写法不合法');
  const count = Number(match[1]); const unit = match[2]!;
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  if (unit === 'w') return new Date(Date.UTC(y, m - 1, d + 7 * count)).toISOString().slice(0, 10);
  const months = unit === 'm' ? count : count * 12;
  const first = new Date(Date.UTC(y, m - 1 + months, 1));
  const last = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
  return new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth(), Math.min(d, last))).toISOString().slice(0, 10);
}

/** Advance from the old due date one period at a time until it is after today; at least once. */
export function nextDue(due: string, every: string, today: string): string {
  let next = addPeriod(due, every);
  while (next <= today) next = addPeriod(next, every);
  return next;
}

function splitLines(content: string): { lines: string[]; eol: string } {
  return { lines: content.split(/\r?\n/), eol: content.includes('\r\n') ? '\r\n' : '\n' };
}

/** Write next to the target under a hidden name, then rename over it, so readers never see half a file. */
function atomicWrite(path: string, content: string): void {
  const temp = join(dirname(path), `.${basename(path)}.bm-write`);
  try { writeFileSync(temp, content, 'utf8'); renameSync(temp, path); }
  catch (error) { rmSync(temp, { force: true }); throw error; }
}

function hunk(lineNumber: number, before: string | null, after: string): string[] {
  return before === null
    ? [`@@ -${lineNumber - 1},0 +${lineNumber},1 @@`, `+${after}`]
    : [`@@ -${lineNumber},1 +${lineNumber},1 @@`, `-${before}`, `+${after}`];
}

function appendLine(content: string, line: string): { content: string; lineNumber: number } {
  const { eol } = splitLines(content);
  const base = content === '' || content.endsWith('\n') ? content : content + eol;
  const lineNumber = base === '' ? 1 : base.split(/\r?\n/).length;
  return { content: `${base}${line}${eol}`, lineNumber };
}

function truncateMessage(message: string): string {
  const chars = Array.from(message);
  return chars.length > MAX_MESSAGE ? `${chars.slice(0, MAX_MESSAGE - 1).join('')}…` : message;
}

export class PersonalOsWriter {
  private readonly reader: PersonalOsReader;
  private readonly todayOverride: string | undefined;
  private readonly git: string;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(options: PersonalOsWriterOptions) {
    this.reader = new PersonalOsReader({ home: options.home, ...(options.root === undefined ? {} : { root: options.root }), ...(options.today === undefined ? {} : { today: options.today }) });
    this.todayOverride = options.today;
    this.git = options.git ?? 'git';
  }

  get root(): string { return this.reader.root; }
  private today(): string { return currentDate(new Date(), this.todayOverride ?? process.env.BLUEMANTA_TODAY); }

  /** Writes run one at a time; a failed write does not block the next. */
  private serial<T>(task: () => Promise<T>): Promise<T> {
    const run = this.queue.then(task, task);
    this.queue = run.catch(() => undefined);
    return run;
  }

  private read(path: string): string {
    try { return readFileSync(path, 'utf8'); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw new KnowledgeError('not_found', '文件不存在');
      throw new KnowledgeError('read_error', '文件读取失败');
    }
  }

  quickNote(input: string): Promise<QuickNoteResult> {
    const text = typeof input === 'string' ? input.trim() : '';
    if (!text) return Promise.reject(new KnowledgeError('invalid_input', '速记不能为空'));
    if (/[\r\n]/.test(text)) return Promise.reject(new KnowledgeError('invalid_input', '速记只能是一行'));
    if (Array.from(text).length > MAX_NOTE) return Promise.reject(new KnowledgeError('invalid_input', `速记最长 ${MAX_NOTE} 字`));
    return this.serial(async () => {
      this.reader.routing(); // library_missing when PersonalOS is gone
      const path = resolvePersonalOsPath(this.root, '收件箱.md');
      const before = this.read(path);
      const line = `- ${this.today()} ${text}`;
      const after = appendLine(before, line).content;
      atomicWrite(path, after);
      return { line, hash: contentHash(after) };
    });
  }

  completeTodo(input: CompleteTodoInput): Promise<CompleteTodoResult> {
    return this.serial(() => this.complete(input));
  }

  private async complete(input: CompleteTodoInput): Promise<CompleteTodoResult> {
    const route = this.reader.routing().domains.find((domain) => domain.id === input.domain);
    if (!route) throw new KnowledgeError('invalid_input', '没有这个领域');
    const statusRel = `${route.path}/状态.md`;
    const statusPath = resolvePersonalOsPath(this.root, statusRel);
    const before = this.read(statusPath);
    if (contentHash(before) !== input.hash) throw new KnowledgeError('conflict', '文件刚被改过');
    const { lines, eol } = splitLines(before);
    const index = input.line - 1;
    if (!Number.isInteger(input.line) || index < 0 || index >= lines.length || lines[index] !== input.raw) throw new KnowledgeError('conflict', '这一行已经变了');
    const todo = parseStatus(before, { domain: route.id, file: statusRel }).todos.find((item) => item.line === input.line);
    if (!todo) throw new KnowledgeError('invalid_input', '这一行不在「未结事项」里');
    if (todo.done) throw new KnowledgeError('invalid_input', '这件事已经完成了');

    const today = this.today();
    const warnings: Warning[] = [];
    const statusLines = [...lines];
    const statusDiff: string[] = [];
    let logText = `完成：${todo.text}`;
    if (todo.every) {
      if (!todo.due || !validDate(todo.due)) throw new KnowledgeError('invalid_input', '周期事项缺少截止日期');
      const next = nextDue(todo.due, todo.every, today);
      statusLines[index] = lines[index]!.replace(`@due(${todo.due})`, `@due(${next})`);
      logText = `完成：${todo.text}（下次 ${next}）`;
    } else {
      statusLines[index] = `${lines[index]!.replace(/\[ \]/, '[x]').replace(/\s+$/, '')} ${today}`;
    }
    const updatedIndex = statusLines.slice(0, 10).findIndex((line) => /更新于[：:]\s*\d{4}-\d{2}-\d{2}/.test(line));
    if (updatedIndex >= 0) statusLines[updatedIndex] = statusLines[updatedIndex]!.replace(/(更新于[：:]\s*)\d{4}-\d{2}-\d{2}/, `$1${today}`);
    else warnings.push({ code: 'no_updated_at', message: '这个文件没有「更新于」，没有改日期', file: statusRel });
    for (const i of [updatedIndex, index].filter((value) => value >= 0).sort((a, b) => a - b)) {
      if (statusLines[i] !== lines[i]) statusDiff.push(...hunk(i + 1, lines[i]!, statusLines[i]!));
    }
    const statusAfter = statusLines.join(eol);

    const logRel = `日志/${today.slice(0, 7)}.md`;
    const logPath = resolvePersonalOsPath(this.root, logRel);
    const logExisted = existsSync(logPath);
    const logBefore = logExisted ? this.read(logPath) : `# ${today.slice(0, 7)} 日志\n\n`;
    const logLine = `- ${today} [${route.name}] ${logText}`;
    const appended = appendLine(logBefore, logLine);
    const logDiff = logExisted ? hunk(appended.lineNumber, null, logLine)
      : ['@@ -0,0 +1,3 @@', `+# ${today.slice(0, 7)} 日志`, '+', `+${logLine}`];

    const message = truncateMessage(`[${route.name}] 完成：${todo.text}`);
    const files = [{ path: statusRel, lines: statusDiff }, { path: logRel, lines: logDiff }];
    if (input.dryRun) return { dryRun: true, files, message, hash: input.hash, warnings };

    const dirty = await this.dirty([statusRel, logRel]);
    atomicWrite(statusPath, statusAfter);
    atomicWrite(logPath, appended.content);
    const result: CompleteTodoResult = { dryRun: false, files, message, hash: contentHash(statusAfter), warnings };
    if (dirty !== false) return { ...result, committed: false, reason: dirty };
    try {
      const sha = await this.commit([statusRel, logRel], message);
      return { ...result, committed: true, sha };
    } catch (error) {
      return { ...result, committed: false, reason: (error as NodeJS.ErrnoException).code === 'ENOENT' ? 'git_missing' : 'git_error' };
    }
  }

  private async runGit(locks: boolean, ...args: string[]): Promise<string> {
    const repository = locateRepository(this.root);
    if (!repository) throw Object.assign(new Error('no_repo'), { code: 'NO_REPO' });
    // The user's own git identity applies, like an agent commit; hooks are off and pathspecs are literal.
    const { stdout } = await exec(this.git, ['-c', 'core.quotepath=false', '-c', 'core.fsmonitor=false', '-c', 'core.hooksPath=/dev/null', '--no-pager', ...args], {
      cwd: repository.cwd, timeout: 15_000, maxBuffer: 1024 * 1024,
      env: { ...process.env, GIT_DIR: repository.dir, GIT_WORK_TREE: repository.cwd, GIT_LITERAL_PATHSPECS: '1', GIT_TERMINAL_PROMPT: '0', ...(locks ? {} : { GIT_OPTIONAL_LOCKS: '0' }) },
    });
    return stdout;
  }

  /** false when both files are clean; otherwise why we must not commit. */
  private async dirty(paths: string[]): Promise<false | 'dirty' | 'no_repo' | 'git_missing' | 'git_error'> {
    try {
      if (!locateRepository(this.root)) return 'no_repo';
      return (await this.runGit(false, 'status', '--porcelain=v1', '-z', '--', ...paths)) === '' ? false : 'dirty';
    } catch (error) {
      return (error as NodeJS.ErrnoException).code === 'ENOENT' ? 'git_missing' : 'git_error';
    }
  }

  /** Commit exactly these paths; anything else already staged stays staged and out of this commit. */
  private async commit(paths: string[], message: string): Promise<string> {
    await this.runGit(true, 'add', '--', ...paths);
    await this.runGit(true, 'commit', '--quiet', '-m', message, '--', ...paths);
    return (await this.runGit(false, 'rev-parse', 'HEAD')).trim();
  }
}
