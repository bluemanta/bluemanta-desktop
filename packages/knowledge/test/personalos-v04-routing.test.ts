import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { PersonalOsReader, PersonalOsWriter } from '../src/index.js';

/** PersonalOS v0.4 moves the routing table from AGENTS.md to README.md (spec 1.2). Fictional copies only. */
const fixture = fileURLToPath(new URL('../fixtures/home/Documents/PersonalOS', import.meta.url));
let home = '';
let root = '';
const file = (path: string) => join(root, path);
const read = (path: string) => readFileSync(file(path), 'utf8');
const reader = () => new PersonalOsReader({ home, today: '2026-11-21' });

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'pos-v04-'));
  root = join(home, 'Documents', 'PersonalOS');
  cpSync(fixture, root, { recursive: true });
});
afterEach(() => rmSync(home, { recursive: true, force: true }));

/** Split the fixture's v0.3 AGENTS.md into a v0.4 README.md (navigation + table) and a rules-only AGENTS.md. */
function splitEntry(options: { keepAboutInAgents?: boolean } = {}) {
  const agents = read('AGENTS.md');
  const table = agents.split('\n').filter((line) => line.startsWith('|')).join('\n');
  const about = /## 关于我\n([\s\S]*?)\n## /.exec(agents)?.[0].replace(/\n## $/, '') ?? '';
  writeFileSync(file('README.md'), `# 林舟的 PersonalOS\n\n虚构的导航说明。\n\n## 领域路由\n\n${table}\n`);
  let rules = agents.split('\n').filter((line) => !line.startsWith('|')).join('\n').replace('## 领域路由\n', '');
  if (!options.keepAboutInAgents) rules = rules.replace(about, '');
  writeFileSync(file('AGENTS.md'), rules);
}

it('v0.3：路由表在 AGENTS.md', () => {
  const overview = reader().overview();
  expect(overview.routerFile).toBe('AGENTS.md');
  expect(overview.domains.filter((d) => d.registered)).toHaveLength(9);
  expect(overview.about).not.toBe('');
});

it('v0.4：路由表在 README.md，领域和别名不变，AGENTS.md 里没有表也不报缺路由表', () => {
  const before = reader().overview().domains.map((d) => [d.name, d.registered, d.aliases.join('、')]);
  splitEntry();
  const overview = reader().overview();
  expect(overview.routerFile).toBe('README.md');
  expect(overview.domains.map((d) => [d.name, d.registered, d.aliases.join('、')])).toEqual(before);
  expect(overview.warnings.map((w) => w.code)).not.toContain('router_missing');
  expect(overview.about).toBe('');
  expect(reader().routing().file).toBe('README.md');
});

it('v0.4 而「关于我」还留在 AGENTS.md：照样读出', () => {
  splitEntry({ keepAboutInAgents: true });
  const overview = reader().overview();
  expect(overview.routerFile).toBe('README.md');
  expect(overview.about).not.toBe('');
});

it('README.md 没有路由表时回到 AGENTS.md', () => {
  writeFileSync(file('README.md'), '# 说明\n\n只是一段介绍。\n');
  const overview = reader().overview();
  expect(overview.routerFile).toBe('AGENTS.md');
  expect(overview.domains.filter((d) => d.registered)).toHaveLength(9);
});

it('两个文件都有路由表：以 README.md 为准，不合并', () => {
  writeFileSync(file('README.md'), '# 导航\n\n| 领域 | 路径 | 别名与关键词 | 典型问题 |\n|---|---|---|---|\n| 工作 | `领域/工作/` | 只在导航里 | 无 |\n');
  const overview = reader().overview();
  expect(overview.routerFile).toBe('README.md');
  const work = overview.domains.find((d) => d.name === '工作')!;
  expect(work.registered).toBe(true);
  expect(work.aliases).toEqual(['只在导航里']);
  expect(overview.domains.filter((d) => d.registered).map((d) => d.name)).toEqual(['工作']);
});

it('路由表的警告标在 README.md 上', () => {
  writeFileSync(file('README.md'), '# 导航\n\n| 领域 | 路径 | 别名与关键词 | 典型问题 |\n|---|---|---|---|\n| 工作 | `领域/工作/` | a | b |\n| 工作 | `领域/工作/` | a | b |\n');
  const warning = reader().routing().warnings.find((w) => w.code === 'router_duplicate');
  expect(warning?.file).toBe('README.md');
});

it('v0.4 布局下写入照常：完成待办按 README.md 的领域找到状态文件', async () => {
  splitEntry();
  const todo = reader().domain('工作').todos.find((t) => t.text === '整理试点访谈问题卡')!;
  const result = await new PersonalOsWriter({ home, today: '2026-11-21' }).completeTodo({ domain: '工作', line: todo.line, raw: todo.raw, hash: todo.hash, dryRun: true });
  expect(result.message).toBe('[工作] 完成：整理试点访谈问题卡');
});
