import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { appendFileSync, cpSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { addPeriod, nextDue, PersonalOsReader, PersonalOsWriter } from '../src/index.js';

const TODAY = '2026-11-21';
const fixture = fileURLToPath(new URL('../fixtures/home/Documents/PersonalOS', import.meta.url));
const script = fileURLToPath(new URL('../scripts/git-fixture.mjs', import.meta.url));
const sha = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex');
const saved: Record<string, string | undefined> = {};

// Commits made by the writer use the caller's git identity; give the tests a fictional one.
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
function treeHash(dir: string): string {
  const files: string[] = [];
  const walk = (d: string) => { for (const e of readdirSync(d, { withFileTypes: true })) { const p = join(d, e.name); if (e.isDirectory()) walk(p); else files.push(p); } };
  walk(dir);
  return sha(files.sort().map((f) => relative(dir, f) + ':' + createHash('sha256').update(readFileSync(f)).digest('hex')).join('\n'));
}
function setup(withGit: boolean) {
  home = mkdtempSync(join(tmpdir(), 'pos-write-'));
  root = join(home, 'Documents', 'PersonalOS');
  if (withGit) execFileSync(process.execPath, [script, root]);
  else cpSync(fixture, root, { recursive: true });
}
const writer = () => new PersonalOsWriter({ home, today: TODAY });
function todo(domain: string, match: string) {
  const found = new PersonalOsReader({ home, today: TODAY }).domain(domain).todos.find((t) => t.text.includes(match));
  if (!found) throw new Error('fixture todo missing: ' + match);
  return found;
}
const complete = (domain: string, match: string, dryRun = false) => {
  const t = todo(domain, match);
  return writer().completeTodo({ domain, line: t.line, raw: t.raw, hash: t.hash, dryRun });
};

describe('下一次日期', () => {
  it('1w、1m 跨月末、1y 遇 2-29', () => {
    expect(addPeriod('2026-11-21', '1w')).toBe('2026-11-28');
    expect(addPeriod('2026-01-31', '1m')).toBe('2026-02-28');
    expect(addPeriod('2028-01-31', '1m')).toBe('2028-02-29');
    expect(addPeriod('2028-02-29', '1y')).toBe('2029-02-28');
    expect(addPeriod('2026-11-30', '3m')).toBe('2027-02-28');
    expect(() => addPeriod('2026-11-21', '0w')).toThrow();
  });
  it('逾期好几个周期时跳到今天之后；今天到期至少加一次', () => {
    expect(nextDue('2026-10-24', '1w', TODAY)).toBe('2026-11-28');
    expect(nextDue(TODAY, '1w', TODAY)).toBe('2026-11-28');
    expect(nextDue('2026-11-25', '1m', TODAY)).toBe('2026-12-25');
  });
});

describe('完成待办（有 Git 历史的副本）', () => {
  beforeEach(() => setup(true));
  afterEach(() => rmSync(home, { recursive: true, force: true }));

  it('dry-run 不改任何文件，返回差异和提交说明', async () => {
    const before = treeHash(root);
    const result = await complete('工作', '整理试点访谈问题卡', true);
    expect(result.dryRun).toBe(true);
    expect(result.message).toBe('[工作] 完成：整理试点访谈问题卡');
    expect(result.files.map((f) => f.path)).toEqual(['领域/工作/状态.md', '日志/2026-11.md']);
    expect(result.files[0]!.lines).toContain('+- [x] 整理试点访谈问题卡 @due(2026-11-18) 2026-11-21');
    expect(result.files[1]!.lines.at(-1)).toBe('+- 2026-11-21 [工作] 完成：整理试点访谈问题卡');
    expect(treeHash(root)).toBe(before);
  });

  it('普通事项：打勾加日期、改更新于、追加日志、只提交这两个文件', async () => {
    const head = git('rev-parse', 'HEAD').trim();
    const result = await complete('工作', '整理试点访谈问题卡');
    expect(result).toMatchObject({ dryRun: false, committed: true });
    const status = read('领域/工作/状态.md');
    expect(status).toContain('- [x] 整理试点访谈问题卡 @due(2026-11-18) 2026-11-21\n');
    expect(status.split('\n')[1]).toBe('更新于：2026-11-21');
    expect(read('日志/2026-11.md').endsWith('- 2026-11-21 [工作] 完成：整理试点访谈问题卡\n')).toBe(true);
    expect(git('log', '-1', '--format=%s').trim()).toBe('[工作] 完成：整理试点访谈问题卡');
    expect(git('rev-parse', 'HEAD~1').trim()).toBe(head);
    expect(git('show', '--name-only', '--format=', 'HEAD').trim().split('\n').sort()).toEqual(['日志/2026-11.md', '领域/工作/状态.md']);
    // The fixture's own uncommitted changes stay uncommitted.
    expect(git('status', '--porcelain').split('\n').filter(Boolean).map((l) => l.slice(3)).sort()).toEqual(['我/纸船.md', '领域/写作/纸样.md']);
    expect(result.hash).toBe(sha(status));
  });

  it('其他已暂存的改动不会被带进提交', async () => {
    appendFileSync(join(root, '我/纸船.md'), '再折一只\n');
    git('add', '--', '我/纸船.md');
    await complete('工作', '整理试点访谈问题卡');
    expect(git('show', '--name-only', '--format=', 'HEAD')).not.toContain('纸船');
    expect(git('diff', '--cached', '--name-only').trim()).toBe('我/纸船.md');
  });

  it('周期事项：不打勾，@due 顺延，日志写下次日期', async () => {
    const result = await complete('副业', '回看本周书签样品记录');
    expect(result.committed).toBe(true);
    expect(read('领域/副业/状态.md')).toContain('- [ ] 回看本周书签样品记录 @every(1w) @due(2026-11-28)\n');
    expect(read('日志/2026-11.md')).toContain('- 2026-11-21 [副业] 完成：回看本周书签样品记录（下次 2026-11-28）');
  });

  it('等待中的事项也能完成；保留冒号写法', async () => {
    await complete('工作', '跟进书架场地确认');
    expect(read('领域/工作/状态.md')).toContain('- [x] 跟进书架场地确认 @wait(秦遥) @due(2026-11-20) 2026-11-21');
    await complete('写作', '复核');
    expect(read('领域/写作/状态.md').split('\n')[1]).toBe('更新于: 2026-11-21');
  });

  it('文件里有未存档改动时只写不提交', async () => {
    appendFileSync(join(root, '领域/工作/状态.md'), '\n手写的一行\n');
    const head = git('rev-parse', 'HEAD').trim();
    const result = await complete('工作', '整理试点访谈问题卡');
    expect(result).toMatchObject({ committed: false, reason: 'dirty' });
    expect(read('领域/工作/状态.md')).toContain('[x] 整理试点访谈问题卡');
    expect(git('rev-parse', 'HEAD').trim()).toBe(head);
  });

  it('409：hash 不符、行内容不符', async () => {
    const t = todo('工作', '整理试点访谈问题卡');
    await expect(writer().completeTodo({ domain: '工作', line: t.line, raw: t.raw, hash: sha('别的内容'), dryRun: false })).rejects.toMatchObject({ code: 'conflict' });
    await expect(writer().completeTodo({ domain: '工作', line: t.line, raw: t.raw + ' ', hash: t.hash, dryRun: false })).rejects.toMatchObject({ code: 'conflict' });
    await expect(writer().completeTodo({ domain: '工作', line: t.line + 1000, raw: t.raw, hash: t.hash, dryRun: false })).rejects.toMatchObject({ code: 'conflict' });
  });

  it('400：领域不存在、行不在未结事项、已完成、周期事项没有 @due', async () => {
    const t = todo('工作', '整理试点访谈问题卡');
    await expect(writer().completeTodo({ domain: '不存在', line: t.line, raw: t.raw, hash: t.hash, dryRun: true })).rejects.toMatchObject({ code: 'invalid_input' });
    const text = read('领域/工作/状态.md'); const lines = text.split('\n');
    await expect(writer().completeTodo({ domain: '工作', line: 1, raw: lines[0]!, hash: sha(text), dryRun: true })).rejects.toMatchObject({ code: 'invalid_input' });
    const done = new PersonalOsReader({ home, today: TODAY }).domain('工作').todos.find((x) => x.done)
      ?? new PersonalOsReader({ home, today: TODAY }).domain('技术').todos.find((x) => x.done);
    if (done) await expect(writer().completeTodo({ domain: done.domain, line: done.line, raw: done.raw, hash: done.hash, dryRun: true })).rejects.toMatchObject({ code: 'invalid_input' });
    writeFileSync(join(root, '领域/技术/状态.md'), read('领域/技术/状态.md').replace('@every(1m) @due(2026-11-29)', '@every(1m)'));
    await expect(complete('技术', '回顾工具箱的月度清单')).rejects.toMatchObject({ code: 'invalid_input' });
  });

  it('并发：同一文件的两个完成请求排队，后一个得到 409', async () => {
    const a = todo('工作', '整理试点访谈问题卡'); const b = todo('工作', '跟进书架场地确认');
    const w = writer();
    const results = await Promise.allSettled([
      w.completeTodo({ domain: '工作', line: a.line, raw: a.raw, hash: a.hash, dryRun: false }),
      w.completeTodo({ domain: '工作', line: b.line, raw: b.raw, hash: b.hash, dryRun: false }),
    ]);
    expect(results[0]!.status).toBe('fulfilled');
    expect(results[1]).toMatchObject({ status: 'rejected', reason: { code: 'conflict' } });
  });

  it('不留下临时文件', async () => {
    await complete('工作', '整理试点访谈问题卡');
    expect(readdirSync(join(root, '领域/工作')).filter((n) => n.endsWith('.bm-write'))).toEqual([]);
    expect(readdirSync(join(root, '日志')).filter((n) => n.endsWith('.bm-write'))).toEqual([]);
  });
});

describe('没有 Git 的副本', () => {
  beforeEach(() => setup(false));
  afterEach(() => rmSync(home, { recursive: true, force: true }));

  it('只写不提交，原因 no_repo', async () => {
    const result = await complete('工作', '整理试点访谈问题卡');
    expect(result).toMatchObject({ committed: false, reason: 'no_repo' });
    expect(read('领域/工作/状态.md')).toContain('[x] 整理试点访谈问题卡');
  });

  it('当月日志不存在时新建；没有更新于时带警告', async () => {
    rmSync(join(root, '日志/2026-11.md'));
    writeFileSync(join(root, '领域/工作/状态.md'), read('领域/工作/状态.md').replace(/更新于：\S+\n/, ''));
    const result = await complete('工作', '整理试点访谈问题卡');
    expect(read('日志/2026-11.md')).toBe('# 2026-11 日志\n\n- 2026-11-21 [工作] 完成：整理试点访谈问题卡\n');
    expect(result.warnings.map((w) => w.code)).toEqual(['no_updated_at']);
  });

  it('保留 CRLF 换行', async () => {
    writeFileSync(join(root, '领域/工作/状态.md'), read('领域/工作/状态.md').replace(/\n/g, '\r\n'));
    await complete('工作', '整理试点访谈问题卡');
    const text = read('领域/工作/状态.md');
    expect(text).toContain('- [x] 整理试点访谈问题卡 @due(2026-11-18) 2026-11-21\r\n');
    expect(text.replace(/\r\n/g, '')).not.toContain('\n');
  });

  it('速记：追加格式、补结尾换行、拒绝空文本、换行和超长、文件不存在', async () => {
    writeFileSync(join(root, '收件箱.md'), read('收件箱.md').replace(/\n+$/, ''));
    const result = await writer().quickNote('  买一卷细麻绳  ');
    expect(result.line).toBe('- 2026-11-21 买一卷细麻绳');
    expect(read('收件箱.md').endsWith('\n- 2026-11-21 买一卷细麻绳\n')).toBe(true);
    expect(new PersonalOsReader({ home, today: TODAY }).inbox().at(-1)?.text).toBe('买一卷细麻绳');
    await expect(writer().quickNote('   ')).rejects.toMatchObject({ code: 'invalid_input' });
    await expect(writer().quickNote('一\n二')).rejects.toMatchObject({ code: 'invalid_input' });
    await expect(writer().quickNote('长'.repeat(501))).rejects.toMatchObject({ code: 'invalid_input' });
    rmSync(join(root, '收件箱.md'));
    await expect(writer().quickNote('还在吗')).rejects.toMatchObject({ code: 'not_found' });
    expect(existsSync(join(root, '收件箱.md'))).toBe(false);
  });

  it('速记不改其他文件', async () => {
    const before = statSync(join(root, '领域/工作/状态.md')).mtimeMs;
    await writer().quickNote('记一笔');
    expect(statSync(join(root, '领域/工作/状态.md')).mtimeMs).toBe(before);
  });
});
