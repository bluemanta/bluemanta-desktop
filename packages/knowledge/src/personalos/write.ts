import { execFile } from 'node:child_process';
import { existsSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { promisify } from 'node:util';
import { KnowledgeError } from '../types.js';
import { resolvePersonalOsPath } from './files.js';
import { locateRepository } from './git.js';
import { currentDate, parseInbox, parseStatus, validDate } from './parse.js';
import { contentHash, PersonalOsReader } from './reader.js';
import type { Warning } from './types.js';

/**
 * The writes the board makes (spec 13 and 16, ADR 0011 decision 5 as amended by ADR 0015): append a quick
 * note to 收件箱.md; resolve or undo one inbox entry; complete or drop one todo the way 协议/更新.md
 * describes. Paths are built here from fixed names and the routing table, never taken from a request.
 */
const exec = promisify(execFile);
const MAX_NOTE = 500;
const MAX_MESSAGE = 72;
const INBOX = '收件箱.md';

export interface WriteFileChange { path: string; lines: string[] }
export interface QuickNoteResult { line: string; hash: string }
export interface CompleteTodoInput { domain: string; line: number; raw: string; hash: string; dryRun: boolean }
export type CommitReason = 'dirty' | 'no_repo' | 'git_missing' | 'git_error';
export interface CommitOutcome { committed?: boolean; reason?: CommitReason; sha?: string }
export interface CompleteTodoResult extends CommitOutcome {
  dryRun: boolean; files: WriteFileChange[]; message: string; hash: string; warnings: Warning[];
}
export type InboxAction = 'done' | 'drop';
export interface ResolveInboxInput { line: number; raw: string; hash: string; action: InboxAction }
export interface InboxUndo { line: number; raw: string; logLine: string }
export interface ResolveInboxResult extends CommitOutcome {
  files: WriteFileChange[]; message: string; hash: string; logHash: string; undo: InboxUndo; warnings: Warning[];
}
export interface UndoInboxInput extends InboxUndo { hash: string; logHash: string }
export interface UndoInboxResult extends CommitOutcome {
  files: WriteFileChange[]; message: string; hash: string; logHash: string | null; warnings: Warning[];
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
    return this.serial(() => this.changeTodo(input, 'complete'));
  }

  /** 不做了 (spec 16.3): delete the open todo line, touch 更新于, log it. */
  dropTodo(input: CompleteTodoInput): Promise<CompleteTodoResult> {
    return this.serial(() => this.changeTodo(input, 'drop'));
  }

  /** 完成 / 不跟踪 for one inbox entry (spec 16.1): delete the line and log the original text. */
  resolveInbox(input: ResolveInboxInput): Promise<ResolveInboxResult> {
    return this.serial(() => this.resolve(input));
  }

  /** Put a resolved inbox entry back and remove its log line when nothing else has touched them (spec 16.2). */
  undoInbox(input: UndoInboxInput): Promise<UndoInboxResult> {
    return this.serial(() => this.undo(input));
  }

  private async changeTodo(input: CompleteTodoInput, kind: 'complete' | 'drop'): Promise<CompleteTodoResult> {
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
    let logText = `${kind === 'drop' ? '不做了' : '完成'}：${todo.text}`;
    if (kind === 'drop') {
      // Deleted below, after 更新于 is located on the original numbering.
    } else if (todo.every) {
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
    const statusDiff: string[] = [];
    let shift = 0;
    for (const i of [updatedIndex, index].filter((value) => value >= 0).sort((a, b) => a - b)) {
      if (kind === 'drop' && i === index) { statusDiff.push(`@@ -${i + 1},1 +${i + shift},0 @@`, `-${lines[i]!}`); shift -= 1; continue; }
      if (statusLines[i] !== lines[i]) statusDiff.push(...hunk(i + 1, lines[i]!, statusLines[i]!).map((line, n) => n === 0 && shift ? `@@ -${i + 1},1 +${i + 1 + shift},1 @@` : line));
    }
    if (kind === 'drop') statusLines.splice(index, 1);
    const statusAfter = statusLines.join(eol);

    const log = this.logAppend(today, `- ${today} [${route.name}] ${logText}`);
    const message = truncateMessage(`[${route.name}] ${kind === 'drop' ? '不做了' : '完成'}：${todo.text}`);
    const files = [{ path: statusRel, lines: statusDiff }, { path: log.rel, lines: log.diff }];
    if (input.dryRun) return { dryRun: true, files, message, hash: input.hash, warnings };

    const dirty = await this.dirty([statusRel, log.rel]);
    atomicWrite(statusPath, statusAfter);
    atomicWrite(log.path, log.content);
    const result: CompleteTodoResult = { dryRun: false, files, message, hash: contentHash(statusAfter), warnings };
    return { ...result, ...(await this.commitIfClean(dirty, [statusRel, log.rel], message)) };
  }

  private async resolve(input: ResolveInboxInput): Promise<ResolveInboxResult> {
    if (input.action !== 'done' && input.action !== 'drop') throw new KnowledgeError('invalid_input', '不认识的操作');
    this.reader.routing();
    const inboxPath = resolvePersonalOsPath(this.root, INBOX);
    const before = this.read(inboxPath);
    if (contentHash(before) !== input.hash) throw new KnowledgeError('conflict', '收件箱刚被改过');
    const { lines, eol } = splitLines(before);
    const index = input.line - 1;
    if (!Number.isInteger(input.line) || index < 0 || index >= lines.length || lines[index] !== input.raw) throw new KnowledgeError('conflict', '这一行已经变了');
    const entry = parseInbox(before).find((item) => item.line === input.line);
    if (!entry) throw new KnowledgeError('invalid_input', '这一行不是收件箱条目');

    const today = this.today();
    const label = input.action === 'done' ? '完成' : '不跟踪';
    const after = [...lines.slice(0, index), ...lines.slice(index + 1)].join(eol);
    const logLine = `- ${today} ${label}：${entry.text}（收件箱 ${entry.date.slice(5)}）`;
    const log = this.logAppend(today, logLine);
    const message = truncateMessage(`[收件箱] ${label}：${entry.text}`);
    const files = [{ path: INBOX, lines: [`@@ -${input.line},1 +${input.line - 1},0 @@`, `-${input.raw}`] }, { path: log.rel, lines: log.diff }];

    // Lines the phone appended to the inbox may ride along (ADR 0014/0015); only the log must be clean.
    const dirty = await this.dirty([log.rel]);
    atomicWrite(inboxPath, after);
    atomicWrite(log.path, log.content);
    const commit = await this.commitIfClean(dirty, [INBOX, log.rel], message);
    return { files, message, hash: contentHash(after), logHash: contentHash(log.content), undo: { line: input.line, raw: input.raw, logLine }, warnings: [], ...commit };
  }

  private async undo(input: UndoInboxInput): Promise<UndoInboxResult> {
    const entry = /[\r\n]/.test(input.raw) ? undefined : parseInbox(input.raw)[0];
    const logMonth = /^- (\d{4}-\d{2})-\d{2} /.exec(input.logLine)?.[1];
    if (!entry || !logMonth || /[\r\n]/.test(input.logLine) || !Number.isSafeInteger(input.line) || input.line < 1) throw new KnowledgeError('invalid_input', '撤销内容不合法');
    this.reader.routing();
    const warnings: Warning[] = [];
    const inboxPath = resolvePersonalOsPath(this.root, INBOX);
    const before = this.read(inboxPath);
    const { lines, eol } = splitLines(before);
    let after: string; let inboxDiff: string[];
    if (contentHash(before) === input.hash && input.line - 1 <= lines.length) {
      after = [...lines.slice(0, input.line - 1), input.raw, ...lines.slice(input.line - 1)].join(eol);
      inboxDiff = [`@@ -${input.line - 1},0 +${input.line},1 @@`, `+${input.raw}`];
    } else {
      const appended = appendLine(before, input.raw);
      after = appended.content; inboxDiff = hunk(appended.lineNumber, null, input.raw);
      warnings.push({ code: 'inbox_changed', message: '收件箱刚被改过，条目已加在最后', file: INBOX });
    }

    const logRel = `日志/${logMonth}.md`;
    const logPath = resolvePersonalOsPath(this.root, logRel);
    let logAfter: string | null = null; let logDiff: string[] = [];
    const logBefore = existsSync(logPath) ? this.read(logPath) : null;
    if (logBefore !== null && contentHash(logBefore) === input.logHash) {
      const split = splitLines(logBefore);
      const last = split.lines.at(-1) === '' ? split.lines.length - 2 : split.lines.length - 1;
      if (last >= 0 && split.lines[last] === input.logLine) {
        logAfter = [...split.lines.slice(0, last), ...split.lines.slice(last + 1)].join(split.eol);
        logDiff = [`@@ -${last + 1},1 +${last},0 @@`, `-${input.logLine}`];
      }
    }
    if (logAfter === null) warnings.push({ code: 'log_changed', message: '日志刚被改过，那一行没有删', file: logRel });

    const message = truncateMessage(`[收件箱] 撤销：${entry.text}`);
    const paths = logAfter === null ? [INBOX] : [INBOX, logRel];
    const files = [{ path: INBOX, lines: inboxDiff }, ...(logAfter === null ? [] : [{ path: logRel, lines: logDiff }])];
    const dirty = logAfter === null ? await this.dirty([]) : await this.dirty([logRel]);
    atomicWrite(inboxPath, after);
    if (logAfter !== null) atomicWrite(logPath, logAfter);
    const commit = await this.commitIfClean(dirty, paths, message);
    return { files, message, hash: contentHash(after), logHash: logAfter === null ? (logBefore === null ? null : contentHash(logBefore)) : contentHash(logAfter), warnings, ...commit };
  }

  /** The line appended to this month's log, creating the file with its heading when needed. */
  private logAppend(today: string, logLine: string): { rel: string; path: string; content: string; diff: string[] } {
    const rel = `日志/${today.slice(0, 7)}.md`;
    const path = resolvePersonalOsPath(this.root, rel);
    const existed = existsSync(path);
    const before = existed ? this.read(path) : `# ${today.slice(0, 7)} 日志\n\n`;
    const appended = appendLine(before, logLine);
    const diff = existed ? hunk(appended.lineNumber, null, logLine) : ['@@ -0,0 +1,3 @@', `+# ${today.slice(0, 7)} 日志`, '+', `+${logLine}`];
    return { rel, path, content: appended.content, diff };
  }

  private async commitIfClean(dirty: false | CommitReason, paths: string[], message: string): Promise<Pick<CompleteTodoResult, 'committed' | 'reason' | 'sha'>> {
    if (dirty !== false) return { committed: false, reason: dirty };
    try { return { committed: true, sha: await this.commit(paths, message) }; }
    catch (error) { return { committed: false, reason: (error as NodeJS.ErrnoException).code === 'ENOENT' ? 'git_missing' : 'git_error' }; }
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
  private async dirty(paths: string[]): Promise<false | CommitReason> {
    try {
      if (!locateRepository(this.root)) return 'no_repo';
      if (paths.length === 0) return false;
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
