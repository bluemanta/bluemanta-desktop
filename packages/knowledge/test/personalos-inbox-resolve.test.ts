import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { appendFileSync, cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PersonalOsReader, PersonalOsWriter, type InboxAction } from '../src/index.js';

// Spec 16 (ADR 0015): inbox 完成 / 不跟踪 with undo, and 不做了 for open todos. All on temporary copies.
const TODAY = '2026-11-21';
const fixture = fileURLToPath(new URL('../fixtures/home/Documents/PersonalOS', import.meta.url));
const script = fileURLToPath(new URL('../scripts/git-fixture.mjs', import.meta.url));
const sha = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex');
const saved: Record<string, string | undefined> = {};

beforeAll(() => {
  for (const [key, value] of Object.entries({ GIT_AUTHOR_NAME: '纸星', GIT_AUTHOR_EMAIL: 'paper@example.invalid', GIT_COMMITTER_NAME: '纸星', GIT_COMMITTER_EMAIL: 'paper@example.invalid', GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' })) {
    saved[key] = process.env[key]; process.env[key] = value;
  }
});
afterAll(() => { for (const [key, value] of Object.entries(saved)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } });

let home = '';
let root = '';
const git = (...args: string[]) => execFileSync('git', ['--git-dir', join(root, '.gitdata.nosync'), '--work-tree', root, '-c', 'core.quotepath=false', ...args], { encoding: 'utf8' });
const read = (path: string) => readFileSync(join(root, path), 'utf8');
const changed = () => git('show', '--name-only', '--format=', 'HEAD').trim().split('\n').sort();
const dirtyFiles = () => git('status', '--porcelain').split('\n').filter(Boolean).map((l) => l.slice(3)).sort();
function setup(withGit: boolean) {
  home = mkdtempSync(join(tmpdir(), 'pos-inbox-'));
  root = join(home, 'Documents', 'PersonalOS');
  if (withGit) execFileSync(process.execPath, [script, root]);
  else cpSync(fixture, root, { recursive: true });
}
const reader = () => new PersonalOsReader({ home, today: TODAY });
const writer = () => new PersonalOsWriter({ home, today: TODAY });
function entry(match: string) {
  const today = reader().today();
  const found = today.inbox.find((item) => item.text.includes(match));
  if (!found || !today.inboxHash) throw new Error('fixture inbox entry missing: ' + match);
  return { ...found, hash: today.inboxHash };
}
const resolve = (match: string, action: InboxAction, w = writer()) => {
  const e = entry(match);
  return w.resolveInbox({ line: e.line, raw: e.raw, hash: e.hash, action });
};
function todo(domain: string, match: string) {
  const found = reader().domain(domain).todos.find((t) => t.text.includes(match));
  if (!found) throw new Error('fixture todo missing: ' + match);
  return found;
}
const drop = (domain: string, match: string, dryRun = false) => {
  const t = todo(domain, match);
  return writer().dropTodo({ domain, line: t.line, raw: t.raw, hash: t.hash, dryRun });
};

describe('今天页的收件箱数据', () => {
  beforeEach(() => setup(false));
  afterEach(() => rmSync(home, { recursive: true, force: true }));

  it('带 inboxHash 和每条的原文', () => {
    const today = reader().today();
    expect(today.inboxHash).toBe(sha(read('收件箱.md')));
    expect(today.inbox[0]).toMatchObject({ date: '2026-11-21', line: 5, raw: '- 2026-11-21 在交换书架旁放一张让读者画表情的反馈卡。' });
    rmSync(join(root, '收件箱.md'));
    expect(reader().today()).toMatchObject({ inbox: [], inboxHash: null });
  });
});

describe('收件箱完成与不跟踪（有 Git 历史的副本）', () => {
  beforeEach(() => setup(true));
  afterEach(() => rmSync(home, { recursive: true, force: true }));

  it('完成：删掉这一行，日志记原文和条目日期，只提交两个文件', async () => {
    const before = read('收件箱.md');
    const result = await resolve('折纸书签', 'done');
    expect(read('收件箱.md')).toBe(before.replace('- 2026-11-20 把折纸书签的失败样品整理成一页制作心得。\n', ''));
    expect(read('日志/2026-11.md').endsWith('\n- 2026-11-21 完成：把折纸书签的失败样品整理成一页制作心得。（收件箱 11-20）\n')).toBe(true);
    expect(result).toMatchObject({ committed: true, message: '[收件箱] 完成：把折纸书签的失败样品整理成一页制作心得。', hash: sha(read('收件箱.md')), logHash: sha(read('日志/2026-11.md')) });
    expect(result.undo).toEqual({ line: 6, raw: '- 2026-11-20 把折纸书签的失败样品整理成一页制作心得。', logLine: '- 2026-11-21 完成：把折纸书签的失败样品整理成一页制作心得。（收件箱 11-20）' });
    expect(result.files[0]).toEqual({ path: '收件箱.md', lines: ['@@ -6,1 +5,0 @@', '-- 2026-11-20 把折纸书签的失败样品整理成一页制作心得。'] });
    expect(git('log', '-1', '--format=%s').trim()).toBe('[收件箱] 完成：把折纸书签的失败样品整理成一页制作心得。');
    expect(changed()).toEqual(['收件箱.md', '日志/2026-11.md'].sort());
    expect(dirtyFiles()).toEqual(['我/纸船.md', '领域/写作/纸样.md']);
  });

  it('不跟踪：日志写「不跟踪：」', async () => {
    const result = await resolve('安静的时间', 'drop');
    expect(read('日志/2026-11.md')).toContain('- 2026-11-21 不跟踪：试试用不同颜色标出一天里真正安静的时间。（收件箱 11-18）');
    expect(result.message).toBe('[收件箱] 不跟踪：试试用不同颜色标出一天里真正安静的时间。');
    expect(read('收件箱.md')).not.toContain('安静的时间');
  });

  it('收件箱里手机追加、还没提交的行一起提交', async () => {
    appendFileSync(join(root, '收件箱.md'), '- 2026-11-21 手机记的一条\n');
    await resolve('反馈卡', 'done');
    expect(changed()).toEqual(['收件箱.md', '日志/2026-11.md'].sort());
    expect(git('show', 'HEAD:收件箱.md')).toContain('手机记的一条');
    expect(dirtyFiles()).not.toContain('收件箱.md');
  });

  it('当月日志有别的未存档改动时只写不提交', async () => {
    appendFileSync(join(root, '日志/2026-11.md'), '- 2026-11-21 手写的一行\n');
    const head = git('rev-parse', 'HEAD').trim();
    const result = await resolve('反馈卡', 'done');
    expect(result).toMatchObject({ committed: false, reason: 'dirty' });
    expect(read('收件箱.md')).not.toContain('反馈卡');
    expect(git('rev-parse', 'HEAD').trim()).toBe(head);
  });

  it('409：hash 不符、行内容不符；400：说明行、不认识的操作；404：没有收件箱', async () => {
    const e = entry('反馈卡');
    await expect(writer().resolveInbox({ line: e.line, raw: e.raw, hash: sha('别的'), action: 'done' })).rejects.toMatchObject({ code: 'conflict' });
    await expect(writer().resolveInbox({ line: e.line, raw: e.raw + ' ', hash: e.hash, action: 'done' })).rejects.toMatchObject({ code: 'conflict' });
    await expect(writer().resolveInbox({ line: 999, raw: e.raw, hash: e.hash, action: 'done' })).rejects.toMatchObject({ code: 'conflict' });
    const lines = read('收件箱.md').split('\n');
    await expect(writer().resolveInbox({ line: 3, raw: lines[2]!, hash: e.hash, action: 'done' })).rejects.toMatchObject({ code: 'invalid_input' });
    await expect(writer().resolveInbox({ line: e.line, raw: e.raw, hash: e.hash, action: 'archive' as InboxAction })).rejects.toMatchObject({ code: 'invalid_input' });
    expect(read('收件箱.md')).toContain('反馈卡');
    rmSync(join(root, '收件箱.md'));
    await expect(writer().resolveInbox({ line: e.line, raw: e.raw, hash: e.hash, action: 'done' })).rejects.toMatchObject({ code: 'not_found' });
  });

  it('并发：同一条的两个请求，后一个得到 409', async () => {
    const e = entry('反馈卡'); const w = writer();
    const results = await Promise.allSettled([
      w.resolveInbox({ line: e.line, raw: e.raw, hash: e.hash, action: 'done' }),
      w.resolveInbox({ line: e.line, raw: e.raw, hash: e.hash, action: 'drop' }),
    ]);
    expect(results[0]!.status).toBe('fulfilled');
    expect(results[1]).toMatchObject({ status: 'rejected', reason: { code: 'conflict' } });
  });

  it('撤销：插回原行，删掉刚记的日志行，提交一次', async () => {
    const inboxBefore = read('收件箱.md'); const logBefore = read('日志/2026-11.md');
    const done = await resolve('折纸书签', 'done');
    const undone = await writer().undoInbox({ ...done.undo, hash: done.hash, logHash: done.logHash });
    expect(read('收件箱.md')).toBe(inboxBefore);
    expect(read('日志/2026-11.md')).toBe(logBefore);
    expect(undone).toMatchObject({ committed: true, warnings: [], message: '[收件箱] 撤销：把折纸书签的失败样品整理成一页制作心得。' });
    expect(changed()).toEqual(['收件箱.md', '日志/2026-11.md'].sort());
  });

  it('撤销时文件已变：条目加在最后、日志不删，各带一条警告', async () => {
    const done = await resolve('折纸书签', 'drop');
    await writer().quickNote('撤销前又记了一条');
    appendFileSync(join(root, '日志/2026-11.md'), '- 2026-11-21 [工作] 别的会话写的\n');
    const undone = await writer().undoInbox({ ...done.undo, hash: done.hash, logHash: done.logHash });
    expect(read('收件箱.md').trimEnd().split('\n').slice(-2)).toEqual(['- 2026-11-21 撤销前又记了一条', '- 2026-11-20 把折纸书签的失败样品整理成一页制作心得。']);
    expect(read('日志/2026-11.md')).toContain('不跟踪：把折纸书签');
    expect(undone.warnings.map((w) => w.code)).toEqual(['inbox_changed', 'log_changed']);
    expect(undone).toMatchObject({ committed: true });
    expect(changed()).toEqual(['收件箱.md']);
  });

  it('撤销内容不合法时 400', async () => {
    const e = entry('反馈卡');
    const base = { line: e.line, hash: e.hash, logHash: e.hash };
    await expect(writer().undoInbox({ ...base, raw: '不是条目', logLine: '- 2026-11-21 完成：x' })).rejects.toMatchObject({ code: 'invalid_input' });
    await expect(writer().undoInbox({ ...base, raw: e.raw, logLine: '没有日期' })).rejects.toMatchObject({ code: 'invalid_input' });
    await expect(writer().undoInbox({ ...base, raw: `${e.raw}\n- 2026-11-21 第二行`, logLine: '- 2026-11-21 完成：x' })).rejects.toMatchObject({ code: 'invalid_input' });
  });
});

describe('待办不做了（有 Git 历史的副本）', () => {
  beforeEach(() => setup(true));
  afterEach(() => rmSync(home, { recursive: true, force: true }));

  it('dry-run 不改文件，返回删除行的差异', async () => {
    const before = read('领域/工作/状态.md');
    const result = await drop('工作', '整理试点访谈问题卡', true);
    expect(result).toMatchObject({ dryRun: true, message: '[工作] 不做了：整理试点访谈问题卡' });
    expect(result.files[0]!.lines).toEqual(['@@ -2,1 +2,1 @@', '-更新于：2026-11-01', '+更新于：2026-11-21', '@@ -19,1 +18,0 @@', '-- [ ] 整理试点访谈问题卡 @due(2026-11-18)']);
    expect(result.files[1]!.lines.at(-1)).toBe('+- 2026-11-21 [工作] 不做了：整理试点访谈问题卡');
    expect(read('领域/工作/状态.md')).toBe(before);
  });

  it('普通事项：删掉这一行、改更新于、记日志、提交两个文件', async () => {
    const result = await drop('工作', '整理试点访谈问题卡');
    const status = read('领域/工作/状态.md');
    expect(status).not.toContain('整理试点访谈问题卡');
    expect(status).toContain('- [ ] 跟进书架场地确认');
    expect(status.split('\n')[1]).toBe('更新于：2026-11-21');
    expect(read('日志/2026-11.md').endsWith('\n- 2026-11-21 [工作] 不做了：整理试点访谈问题卡\n')).toBe(true);
    expect(result).toMatchObject({ committed: true, hash: sha(status) });
    expect(changed()).toEqual(['日志/2026-11.md', '领域/工作/状态.md']);
  });

  it('等待中和周期事项都能不做了，周期事项整行删掉', async () => {
    await drop('工作', '跟进书架场地确认');
    expect(read('领域/工作/状态.md')).not.toContain('跟进书架场地确认');
    await drop('技术', '回顾工具箱的月度清单');
    expect(read('领域/技术/状态.md')).not.toContain('回顾工具箱的月度清单');
    expect(read('日志/2026-11.md')).toContain('- 2026-11-21 [技术] 不做了：回顾工具箱的月度清单');
  });

  it('400 和 409 同完成待办', async () => {
    const t = todo('工作', '整理试点访谈问题卡');
    await expect(writer().dropTodo({ domain: '工作', line: t.line, raw: t.raw, hash: sha('别的'), dryRun: true })).rejects.toMatchObject({ code: 'conflict' });
    await expect(writer().dropTodo({ domain: '不存在', line: t.line, raw: t.raw, hash: t.hash, dryRun: true })).rejects.toMatchObject({ code: 'invalid_input' });
    const text = read('领域/工作/状态.md');
    await expect(writer().dropTodo({ domain: '工作', line: 1, raw: text.split('\n')[0]!, hash: sha(text), dryRun: true })).rejects.toMatchObject({ code: 'invalid_input' });
  });
});

describe('没有 Git 的副本', () => {
  beforeEach(() => setup(false));
  afterEach(() => rmSync(home, { recursive: true, force: true }));

  it('收件箱：保留 CRLF、当月日志不存在时新建、只写不提交', async () => {
    writeFileSync(join(root, '收件箱.md'), read('收件箱.md').replace(/\n/g, '\r\n'));
    rmSync(join(root, '日志/2026-11.md'));
    const result = await resolve('反馈卡', 'done');
    expect(result).toMatchObject({ committed: false, reason: 'no_repo' });
    const inbox = read('收件箱.md');
    expect(inbox).not.toContain('反馈卡');
    expect(inbox.replace(/\r\n/g, '')).not.toContain('\n');
    expect(inbox.endsWith('\r\n')).toBe(true);
    expect(read('日志/2026-11.md')).toBe('# 2026-11 日志\n\n- 2026-11-21 完成：在交换书架旁放一张让读者画表情的反馈卡。（收件箱 11-21）\n');
  });

  it('不改任何状态文件', async () => {
    const before = read('领域/工作/状态.md');
    await resolve('反馈卡', 'drop');
    expect(read('领域/工作/状态.md')).toBe(before);
  });
});
