import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { KnowledgeError } from '../src/types.js';
import {
  PersonalOsReader, currentDate, groupTodos, parseInbox, parseLog, parseRegistry,
  parseRouter, parseStatus, parseTodos, walkPersonalOsFiles,
  type DomainSummary,
} from '../src/personalos/index.js';

const FIXTURE_HOME = fileURLToPath(new URL('../fixtures/home', import.meta.url));
const FIXTURE_ROOT = join(FIXTURE_HOME, 'Documents', 'PersonalOS');
const TODAY = '2026-11-21';
const DOMAIN_ORDER = ['我', '工作', '副业', '写作', '技术', '家庭', '健康', '财务', '生活事务'];
const temporary: string[] = [];
const fixture = () => new PersonalOsReader({ home: FIXTURE_HOME, today: TODAY });
const source = (path: string) => readFileSync(join(FIXTURE_ROOT, path), 'utf8');

function sandbox(copy = false) {
  const home = mkdtempSync(join(tmpdir(), 'bm-personalos-test-'));
  temporary.push(home);
  const root = join(home, 'Documents', 'PersonalOS');
  if (copy) cpSync(FIXTURE_ROOT, root, { recursive: true });
  else mkdirSync(root, { recursive: true });
  return { home, root, reader: new PersonalOsReader({ home, today: TODAY }) };
}
function put(root: string, path: string, content: string) {
  const full = join(root, path);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, content);
}
function errorCode(run: () => unknown): string | undefined {
  try { run(); } catch (error) { return error instanceof KnowledgeError ? error.code : 'unexpected'; }
  return undefined;
}
afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
  for (const home of temporary.splice(0)) rmSync(home, { recursive: true, force: true });
});

describe('PersonalOS fixture（规格第 9 节）', () => {
  it('九行路由按表格顺序，财务标目录不存在，园艺追加为未登记', () => {
    const overview = fixture().overview();
    expect(overview.exists).toBe(true);
    expect(overview.root).toBe('~/Documents/PersonalOS');
    expect(overview.domains.map((domain) => domain.id)).toEqual([...DOMAIN_ORDER, '园艺']);
    expect(overview.domains.filter((domain) => domain.registered)).toHaveLength(9);
    expect(overview.domains.find((domain) => domain.id === '财务')).toMatchObject({ exists: false, registered: true });
    expect(overview.domains.at(-1)).toMatchObject({ id: '园艺', registered: false, exists: true });
    expect(overview.about).toContain('**最近想练习的事**');
    expect(overview.about).not.toContain('## 领域路由');
    expect(overview.focus).toHaveLength(3);
    expect(fixture().domain('我').sections.filter((section) => section.kind === 'focus')[0]?.markdown).toContain('收集下一次复盘');
  });

  it('今天分组为 2 / 1 / 2 / 1 / 5 / 1，每件事只出现一次且无日期只显示前三条', () => {
    const today = fixture().today();
    const counts = { overdue: today.overdue.length, dueToday: today.dueToday.length, next7: today.next7.length,
      waiting: today.waiting.length, undated: today.undated.total, later: today.later.count };
    expect(counts).toEqual({ overdue: 2, dueToday: 1, next7: 2, waiting: 1, undated: 5, later: 1 });
    console.log('PersonalOS fixture 今天分组：', counts);
    expect(today.undated.items.map((todo) => todo.domain)).toEqual(['我', '工作', '副业']);
    const displayed = [...today.overdue, ...today.dueToday, ...today.next7, ...today.waiting, ...today.undated.items, ...today.later.items];
    expect(new Set(displayed.map((todo) => todo.id)).size).toBe(displayed.length);
    expect(displayed.every((todo) => !todo.done)).toBe(true);
    expect(today.overdue[1]).toMatchObject({ due: '2026-11-20', wait: '秦遥', bucket: 'overdue' });
    expect(today.waiting[0]).toMatchObject({ wait: '夏禾', due: null });
    expect(today.next7.map((todo) => todo.due)).toEqual(['2026-11-23', '2026-11-28']);
    expect(today.later.items[0]).toMatchObject({ due: '2026-11-29', every: '1m' });
  });

  it('待办保存完成日期、周期、未知标签、无效日期警告、Markdown 链接和原文件行号', () => {
    const reader = fixture();
    const todos = reader.overview().domains.flatMap((domain) => reader.domain(domain.id).todos);
    expect(todos.filter((todo) => todo.wait !== null)).toHaveLength(2);
    expect(todos.filter((todo) => todo.every !== null).map((todo) => todo.every)).toEqual(['1w', '1m']);
    expect(todos.filter((todo) => todo.done).map((todo) => todo.doneAt)).toEqual(['2026-11-20', null]);
    expect(todos.find((todo) => todo.tags.length > 0)).toMatchObject({ text: '补充读者引导语候选', tags: ['@effort(短)'] });
    const invalid = todos.find((todo) => todo.warnings.length > 0)!;
    expect(invalid).toMatchObject({ domain: '写作', due: null, bucket: 'undated' });
    expect(invalid.warnings[0]).toMatchObject({ code: 'invalid_due', file: invalid.file, line: invalid.line });
    expect(todos.find((todo) => todo.text.includes('[书架观察提纲]'))?.text).toContain('[书架观察提纲](../../领域/工作/事项/访谈方案.md)');
    for (const todo of todos) {
      expect(source(todo.file).split('\n')[todo.line - 1]).toMatch(/^\s*[-*] \[[ xX]\]/);
      expect(todo.id).toBe(`${todo.file}:${todo.line}`);
    }
  });

  it('三份状态超过十四天，缺日期单独标记，暂无与待补充为空节', () => {
    const reader = fixture();
    const domains = reader.overview().domains;
    expect(domains.filter((domain) => domain.exists && domain.updatedAt !== null && domain.stale).map((domain) => domain.id)).toEqual(['工作', '写作', '健康']);
    expect(domains.filter((domain) => domain.exists && domain.updatedAt === null).map((domain) => domain.id)).toEqual(['园艺']);
    expect(domains.find((domain) => domain.id === '园艺')).toMatchObject({ stale: true, staleDays: null });
    for (const [id, text] of [['健康', '暂无'], ['生活事务', '待补充']] as const) {
      expect(reader.domain(id).sections.find((section) => section.title === '未结事项')).toMatchObject({ empty: true, markdown: text });
      expect(reader.domain(id).todos).toEqual([]);
    }
  });

  it('非标准节、小标题、加粗、变化备注和两张挂接卡片不丢失', () => {
    const work = fixture().domain('工作');
    expect(work.sections.find((section) => section.title === '现状')?.markdown).toContain('### 社区图书交换试点');
    expect(work.sections.find((section) => section.title === '现状')?.markdown).toContain('**雾灯便签**');
    expect(work.sections.at(-1)).toMatchObject({ title: '留给下一轮的问题', kind: 'other' });
    expect(work.changes).toHaveLength(1);
    expect(work.sections.find((section) => section.kind === 'changes')?.markdown).toContain('这段备注保留为普通 Markdown');
    expect(work.links).toContain('[访谈方案](事项/访谈方案.md)');
    expect(work.links).not.toContain('外部记录簿');
    expect(work.mounts.map((mount) => mount.title)).toEqual(['社区试点记录簿', '书架反馈汇总']);
    expect(work.mounts[1]?.markdown).toContain('| 读者原话 |');
    expect(work.markdown).toContain('（推断）');
    expect(work.markdown).toContain('未核验');
    expect(fixture().domain('我').gapCount).toBeGreaterThan(0);
  });

  it('三个领域九条资料登记包含两张表、本机存在与缺失、链接、其他及未知状态', () => {
    const rows = fixture().registry();
    expect(rows).toHaveLength(9);
    expect([...new Set(rows.map((row) => row.domain))]).toEqual(['我', '工作', '技术']);
    expect(rows.filter((row) => row.domain === '技术')).toHaveLength(3);
    expect(new Set(rows.map((row) => row.location.kind))).toEqual(new Set(['local', 'link', 'other']));
    expect(rows.filter((row) => row.location.kind === 'local').map((row) => row.location.exists)).toEqual([true, false, true, false, true]);
    expect(rows.filter((row) => row.location.kind === 'local').every((row) => row.location.display.startsWith('~/'))).toBe(true);
    expect(rows.find((row) => row.title === '场地问答入口')?.status).toBe('待核对');
    expect(rows.find((row) => row.title === '示例接口说明')?.location).toMatchObject({ kind: 'link', url: 'https://example.org/linzhou/catalog-api' });
  });

  it('收件箱三条；跨月日志保留无领域条目和两份交付说明，支持更早与领域筛选', () => {
    const reader = fixture();
    expect(reader.overview().inbox).toBe(3);
    expect(reader.inbox()).toHaveLength(3);
    expect(reader.inbox()[0]).toMatchObject({ date: TODAY, line: 5 });
    const recent = reader.log();
    expect(recent.hasMore).toBe(true);
    expect(recent.items.some((entry) => entry.kind === 'entry' && entry.domain === null)).toBe(true);
    const all = reader.log({ days: 90 }).items;
    expect(new Set(all.map((entry) => entry.file))).toEqual(new Set(['日志/2026-11.md', '日志/2026-10.md']));
    expect(all.filter((entry) => entry.kind === 'section' && entry.title?.includes('交付说明'))).toHaveLength(2);
    expect(all.find((entry) => entry.title?.includes('回看要点'))?.markdown).toContain('两个失败样例');
    expect(all.map((entry) => entry.date)).toEqual(all.map((entry) => entry.date).sort().reverse());
    expect(reader.log({ domains: ['工作'], days: 90 }).items.map((entry) => entry.domain)).toEqual(['工作', '工作']);
    expect(reader.log({ before: '2026-11-01', days: 30 }).items.every((entry) => entry.date < '2026-11-01')).toBe(true);
  });

  it('追加日志条目独立显示且从小节正文移除；未归领域筛选包含普通标签和小节', () => {
    const reader = fixture();
    const recent = reader.log().items;
    expect(recent).toHaveLength(9);
    expect(reader.log({ days: 90 }).items).toHaveLength(11);
    const section = recent.find((entry) => entry.title?.includes('索引实验交付说明'))!;
    for (const text of ['将访谈顺序改成先观察后提问', '为纸面记录预留一栏失败假设', '为演示输入补上重复书名样例']) {
      expect(recent.some((entry) => entry.kind === 'entry' && entry.text.includes(text))).toBe(true);
      expect(section.markdown).not.toContain(text);
    }
    expect(section.markdown).toContain('- 空书名应得到提示。\n- 相同输入应得到同样顺序。');
    expect(recent.find((entry) => entry.tag === '蓝图')).toMatchObject({ domain: null, kind: 'entry' });
    const unassigned = reader.log({ includeUnassigned: true });
    expect(unassigned.items).toHaveLength(4);
    expect(unassigned.items.every((entry) => entry.domain === null)).toBe(true);
    expect(unassigned.items.filter((entry) => entry.kind === 'section')).toHaveLength(2);
    expect(reader.log({ domains: ['技术'], includeUnassigned: true }).items).toHaveLength(6);
    expect(reader.log({ domains: ['蓝图'] }).items).toEqual([]);
  });

  it('事项文件、事项目录入口、知识文件以及协议和蓝图按需发现', () => {
    const reader = fixture();
    const work = reader.domain('工作');
    expect(work.matters.map((matter) => matter.name).sort()).toEqual(['交换书架', '访谈方案']);
    expect(work.matters.find((matter) => matter.name === '交换书架')).toMatchObject({ entry: '领域/工作/事项/交换书架/README.md' });
    expect(work.matters.find((matter) => matter.name === '交换书架')?.files).toHaveLength(2);
    expect(reader.domain('技术').knowledge.map((file) => file.path)).toEqual(['领域/技术/知识.md']);
    expect(reader.domain('家庭').matters).toEqual([]);
    expect(reader.domain('家庭').knowledge).toEqual([]);
    const documents = reader.documents().map((file) => file.path);
    expect(documents).toEqual(expect.arrayContaining(['AGENTS.md', '协议/阅读.md', '蓝图/目录说明.md']));
    expect(documents).not.toContain('CLAUDE.md');
    expect(source('CLAUDE.md').trim()).toBe('@AGENTS.md');
  });

  it('iCloud 占位使用逻辑名称且明确未下载，隐藏文件不列出也不能读', () => {
    const reader = fixture();
    const cloud = reader.file('领域/工作/待下载资料.md');
    expect(cloud).toMatchObject({ path: '领域/工作/待下载资料.md', availability: 'icloud', message: '尚未从 iCloud 下载' });
    expect(cloud.content).toBeUndefined();
    expect(reader.domain('工作').files.find((file) => file.name === '待下载资料.md')?.availability).toBe('icloud');
    expect(existsSync(join(FIXTURE_ROOT, '.claude'))).toBe(true);
    expect(existsSync(join(FIXTURE_ROOT, '.DS_Store'))).toBe(true);
    const paths = walkPersonalOsFiles(FIXTURE_ROOT).map((file) => file.path);
    expect(paths.some((path) => path.split('/').some((part) => part.startsWith('.')))).toBe(false);
    for (const path of ['.claude/fixture-only.md', '.DS_Store', '领域/工作/.待下载资料.md.icloud']) {
      expect(errorCode(() => reader.file(path))).toBe('invalid_path');
    }
  });
});

describe('PersonalOS 宽容解析与日历边界', () => {
  it('路由只取第一张匹配表，忽略代码样例，保留关于我 Markdown 与分隔词顺序', () => {
    const result = parseRouter('## 关于我\n\n**演示人物**\n\n```md\n| 领域 | 路径 |\n|---|---|\n| 伪造 | 伪造/ |\n```\n\n## 路由\n| 路径 | 领域 | 别名与关键词 | 典型问题 |\n|---|---|---|---|\n| `领域/乙/` | 乙 | 甲、乙；丙;丁，戊 | 问一、问二 |\n| `我/` | 我 | 自我 | 方向 |\n\n| 领域 | 路径 |\n|---|---|\n| 不选 | 领域/不选 |');
    expect(result.domains.map((domain) => [domain.id, domain.path])).toEqual([['乙', '领域/乙'], ['我', '我']]);
    expect(result.domains[0]?.aliases).toEqual(['甲', '乙', '丙', '丁', '戊']);
    expect(result.domains[0]?.typicalQuestions).toEqual(['问一', '问二']);
    expect(result.about).toContain('**演示人物**');
    expect(parseRouter('没有表格').domains).toEqual([]);
  });

  it('只解析未结事项，保留未知节；空行、CRLF 与代码块不破坏真实行号', () => {
    const markdown = ['# 演示', '更新于：2026-11-20', '## 现状', '- [ ] 这是引用，不是待办', '## 未结事项', '', '', '- [ ] 真事项 @due(2026-11-21)', '```md', '- [ ] 示例', '## 伪标题', '```', '  * [X] 已完成 2026-11-19', '## 未知标题', '自由文本', '### 子节', '**仍须保留**'].join('\r\n');
    const parsed = parseStatus(markdown, { domain: '演示', file: '领域/演示/状态.md' });
    expect(parsed.todos.map((todo) => [todo.text, todo.line, todo.done, todo.doneAt])).toEqual([['真事项', 8, false, null], ['已完成', 13, true, '2026-11-19']]);
    expect(parsed.sections.at(-1)).toMatchObject({ title: '未知标题', kind: 'other', markdown: '自由文本\n### 子节\n**仍须保留**' });
  });

  it('未知节、挂接卡片和日志保留首行 Markdown 缩进，缩进待办仍指向原行', () => {
    const markdown = ['# 演示', '## 未知节', '', '    缩进代码', '', '## 未结事项', '', '    - [ ] 缩进待办', '', '## 去哪查', '', '    [参考](说明.md)', '', '### 挂接说明', '', '    卡片代码', ''].join('\n');
    const parsed = parseStatus(markdown, { domain: '演示', file: '领域/演示/状态.md' });
    expect(parsed.sections.find((section) => section.title === '未知节')?.markdown).toBe('    缩进代码');
    expect(parsed.sections.find((section) => section.kind === 'todos')?.markdown).toBe('    - [ ] 缩进待办');
    expect(parsed.todos).toHaveLength(1);
    expect(parsed.todos[0]).toMatchObject({ text: '缩进待办', line: 8, file: '领域/演示/状态.md' });
    expect(parsed.links).toBe('    [参考](说明.md)');
    expect(parsed.mounts).toEqual([{ title: '挂接说明', markdown: '    卡片代码' }]);
    const log = parseLog('## 2026-11-21 交付\n\n    日志代码\n\n### 后续回看\n\n    后续代码\n', '日志/2026-11.md');
    expect(log.map((entry) => entry.markdown)).toEqual(['    日志代码', '    后续代码']);
  });

  it('更新日期只看前十行第一个，非法日期不滚动到下月', () => {
    const parse = (text: string) => parseStatus(text, { domain: '示例', file: '状态.md' });
    expect(parse('更新于: 2026-11-01\n更新于：2026-11-20').updatedAt).toBe('2026-11-01');
    expect(parse(`${'\n'.repeat(10)}更新于：2026-11-21`).updatedAt).toBeNull();
    expect(parse('更新于：2026-02-30')).toMatchObject({ updatedAt: null, warnings: [{ code: 'invalid_updated_at', file: '状态.md', message: '更新日期不合法' }] });
    const todos = parseTodos('- [ ] 闰日 @due(2024-02-29)\n- [ ] 错误闰日 @due(2026-02-29)\n- [ ] 未知周期 @every(2d) @priority(高)', { domain: '示例', file: '状态.md' });
    expect(todos[0]?.due).toBe('2024-02-29');
    expect(todos[1]).toMatchObject({ due: null, warnings: [{ code: 'invalid_due', file: '状态.md', line: 2, message: '截止日期不合法：2026-02-29' }] });
    expect(todos[2]).toMatchObject({ every: null, tags: ['@every(2d)', '@priority(高)'] });
  });

  it('第七天包含、第八天更晚；等待在逾期/今天/七天后才归组，不修改输入', () => {
    const todos = parseTodos('- [ ] 七天 @due(2026-11-28)\n- [ ] 八天 @due(2026-11-29)\n- [ ] 逾期等待 @wait(甲) @due(2026-11-20)\n- [ ] 今天等待 @wait(乙) @due(2026-11-21)\n- [ ] 七天等待 @wait(丙) @due(2026-11-28)\n- [ ] 八天等待 @wait(丁) @due(2026-11-29)\n- [ ] 无日等待 @wait(戊)\n- [x] 完成但逾期 @due(2026-11-01)', { domain: '我', file: '我/状态.md' });
    const before = structuredClone(todos);
    const groups = groupTodos(todos, fixture().overview().domains, TODAY);
    expect(groups.overdue.map((todo) => todo.text)).toEqual(['逾期等待']);
    expect(groups.dueToday.map((todo) => todo.text)).toEqual(['今天等待']);
    expect(groups.next7.map((todo) => todo.text)).toEqual(['七天', '七天等待']);
    expect(groups.waiting.map((todo) => todo.text)).toEqual(['八天等待', '无日等待']);
    expect(groups.later.items.map((todo) => todo.text)).toEqual(['八天']);
    expect(todos).toEqual(before);
  });

  it('排序由日期、路由顺序与行号决定；十四天不过期，十五天和缺日期过期', () => {
    const base = fixture().overview().domains[0]!;
    const domains: DomainSummary[] = [
      { ...base, id: '乙', updatedAt: '2026-11-07' },
      { ...base, id: '甲', updatedAt: '2026-11-06' },
      { ...base, id: '丙', updatedAt: null },
    ];
    const a = parseTodos('- [ ] 甲同日 @due(2026-11-22)\n- [ ] 甲无日', { domain: '甲', file: '甲/状态.md' });
    const b = parseTodos('- [ ] 乙更早 @due(2026-11-21)\n- [ ] 乙同日一 @due(2026-11-22)\n- [ ] 乙同日二 @due(2026-11-22)\n- [ ] 乙无日', { domain: '乙', file: '乙/状态.md' });
    const groups = groupTodos([...a, ...b].reverse(), domains, TODAY);
    expect(groups.next7.map((todo) => todo.text)).toEqual(['乙同日一', '乙同日二', '甲同日']);
    expect(groups.undated.items.map((todo) => todo.text)).toEqual(['乙无日', '甲无日']);
    expect(groups.staleDomains.map((domain) => domain.id)).toEqual(['甲', '丙']);
  });

  it('资料登记支持重排列与多表，外部位置仅交给 stat，异常作为不存在', () => {
    const stat = vi.fn((path: string) => { if (path.endsWith('missing.md')) throw new Error('not found'); return {}; });
    const markdown = '| 位置 | 主题 | 资料 | 状态 | 用途 |\n|---|---|---|---|---|\n| `/fixture/home/exists.md` | 甲 | 已有 | 引用 | 看位置 |\n| `~/missing.md` | 乙 | 缺少 | 待核验 | 看位置 |\n\n## 第二表\n| 主题 | 资料 | 位置 | 用途 | 状态 |\n|---|---|---|---|---|\n| 网页 | 示例 | [站点](https://example.org/) | 参考 | 引用 |\n| 工具 | 示例 | MCP 只读调用说明 | 参考 | 引用 |';
    const rows = parseRegistry(markdown, { home: '/fixture/home', domain: '演示', file: '资料登记.md', stat });
    expect(rows).toHaveLength(4);
    expect(stat.mock.calls.map(([path]) => path)).toEqual(['/fixture/home/exists.md', '/fixture/home/missing.md']);
    expect(rows[0]?.location).toEqual({ kind: 'local', display: '~/exists.md', exists: true });
    expect(rows[1]?.location).toEqual({ kind: 'local', display: '~/missing.md', exists: false });
    expect(rows[1]?.status).toBe('待核验');
    expect(rows[3]?.location.kind).toBe('other');
    expect(rows.every((row) => row.source === '资料登记.md')).toBe(true);
  });

  it('收件箱忽略说明与代码；二三级日志小节保留正文，缺日期归月份', () => {
    expect(parseInbox('说明\n- 2026-11-20 一条\n```\n- 2026-11-21 假条目\n```\n- 2026-02-30 无效')).toEqual([{ date: '2026-11-20', text: '一条', line: 2, raw: '- 2026-11-20 一条' }]);
    const log = parseLog('- 2026-11-21 无领域\n## 2026-11-20 [工作] 交付\n正文\n\n### 无日期回顾\n**备注**\n```md\n## 不分节\n```', '日志/2026-11.md', ['工作']);
    expect(log.map((entry) => [entry.kind, entry.date, entry.domain])).toEqual([['entry', '2026-11-21', null], ['section', '2026-11-20', '工作'], ['section', '2026-11', null]]);
    expect(log[2]?.markdown).toContain('## 不分节');
    expect(log[2]?.markdown).toContain('**备注**');
  });

  it('日志条目可紧跟标题或夹在列表中；空节保留，缩进/代码/非法日期仍是正文', () => {
    const lines = [
      '## 2026-11-21 开头', '- 2026-11-21 [工作] 第一个条目', '- 2026-11-21 [蓝图] 第二个条目',
      '### 列表边界', '', '- 普通列表前半', '- 2026-11-20 [我] 中间条目', '- 普通列表后半',
      '  - 2026-11-21 [工作] 缩进的说明', '```md', '- 2026-11-21 [工作] 代码示例', '```',
      '- 2026-02-30 [工作] 无效日期原文', '### 空节', '- 2026-11-19 [阶段 3] 最后条目', '',
    ];
    const log = parseLog(lines.join('\r\n'), '日志/2026-11.md', ['工作']);
    const entries = log.filter((entry) => entry.kind === 'entry');
    expect(entries.map((entry) => [entry.line, entry.domain, entry.tag])).toEqual([[2, '工作', undefined], [3, null, '蓝图'], [7, '我', undefined], [15, null, '阶段 3']]);
    expect(entries[3]?.id).toBe('日志/2026-11.md:15');
    expect(log.find((entry) => entry.title === '2026-11-21 开头')?.markdown).toBe('');
    expect(log.find((entry) => entry.title === '空节')?.markdown).toBe('');
    expect(log.find((entry) => entry.title === '列表边界')?.markdown).toBe(lines.slice(5, 13).filter((_, index) => index !== 1).join('\n'));
  });

  it('日志只按当前路由表的领域名归类，不把别名、目录名或未登记目录当成领域', () => {
    const { root, reader } = sandbox(true);
    put(root, '日志/2026-11.md', '- 2026-11-21 [工作] 原名\n- 2026-11-21 [职业记录] 登记名\n- 2026-11-21 [纸舟实验] 别名\n- 2026-11-21 [园艺] 未登记\n- 2026-11-21 [我] 自己');
    put(root, 'AGENTS.md', source('AGENTS.md').replace('| 工作 |', '| 职业记录 |'));
    const items = reader.log({ days: 21 }).items;
    expect(items.map(({ domain, tag }) => [domain, tag])).toEqual([[null, '工作'], ['职业记录', undefined], [null, '纸舟实验'], [null, '园艺'], ['我', undefined]]);
    expect(reader.log({ domains: ['职业记录'] }).items).toHaveLength(1);
    expect(reader.log({ includeUnassigned: true }).items).toHaveLength(3);
  });

  it('BLUEMANTA_TODAY 固定日期，无效覆盖回退本机日历而非 UTC 日期', () => {
    vi.stubEnv('TZ', 'Pacific/Kiritimati');
    const instant = new Date('2026-11-20T12:30:00Z');
    vi.stubEnv('BLUEMANTA_TODAY', '2026-12-03');
    expect(currentDate(instant)).toBe('2026-12-03');
    vi.stubEnv('BLUEMANTA_TODAY', '2026-02-30');
    expect(currentDate(instant)).toBe('2026-11-21');
    vi.stubEnv('BLUEMANTA_TODAY', '');
    expect(currentDate(instant)).toBe('2026-11-21');
    vi.stubEnv('BLUEMANTA_TODAY', TODAY);
    expect(new PersonalOsReader({ home: FIXTURE_HOME }).today().today).toBe(TODAY);
  });
});

describe('PersonalOS 文件边界与每次重新读取', () => {
  it('根目录缺失概览可读，其余读取明确 library_missing；领域与文件缺失不混淆', () => {
    const { home, root } = sandbox();
    const missing = new PersonalOsReader({ home, root: join(root, 'missing'), today: TODAY });
    expect(missing.overview()).toMatchObject({ exists: false, root: '~/Documents/PersonalOS/missing', domains: [] });
    for (const run of [() => missing.today(), () => missing.domain('我'), () => missing.registry(), () => missing.log(), () => missing.file('AGENTS.md')]) expect(errorCode(run)).toBe('library_missing');
    expect(fixture().domain('财务')).toMatchObject({ exists: false, todos: [], sections: [] });
    expect(errorCode(() => fixture().domain('没有此领域'))).toBe('not_found');
    expect(errorCode(() => fixture().file('缺失.md'))).toBe('not_found');
  });

  it('同一 reader 再请求时看到路由、状态、收件箱、资料和日志的最新内容', () => {
    const { root, reader } = sandbox(true);
    expect(reader.today().overdue).toHaveLength(2);
    put(root, '领域/工作/状态.md', '# 工作\n更新于：2026-11-21\n## 未结事项\n- [ ] 新待办 @due(2026-11-21)');
    put(root, '收件箱.md', '- 2026-11-21 最新收件');
    put(root, '领域/工作/资料登记.md', '# 暂无登记');
    put(root, '日志/2026-11.md', '- 2026-11-21 [工作] 最新修改');
    put(root, 'AGENTS.md', source('AGENTS.md').replace('| 工作 |', '| 工作新名 |'));
    expect(reader.overview().domains[1]?.id).toBe('工作新名');
    expect(reader.today().overdue).toHaveLength(0);
    expect(reader.today().dueToday.map((todo) => todo.text)).toContain('新待办');
    expect(reader.inbox().map((entry) => entry.text)).toEqual(['最新收件']);
    expect(reader.registry().filter((row) => row.domain === '工作新名')).toEqual([]);
    expect(reader.log().items[0]?.text).toBe('最新修改');
    expect(reader.file('领域/工作/状态.md').content).toContain('新待办');
  });

  it.each(['../outside.md', '/absolute.md', '领域/工作/../../outside.md', '.git', '.gitdata.nosync/config', '.claude/config.md', '领域/.hidden.md', '领域/工作/./状态.md', 'C:\\outside.md', '领域\\工作\\状态.md', 'bad\0.md'])('拒绝越界或隐藏路径 %s', (path) => {
    expect(errorCode(() => fixture().file(path))).toBe('invalid_path');
  });

  it('软链到库外、隐藏目标、断链或库外目录下缺失文件均拒绝，正常库内软链可读', () => {
    const { home, root, reader } = sandbox();
    put(home, 'outside/secret.md', '不应读到的库外文本');
    put(root, '.private/secret.md', '不应读到的隐藏文本');
    put(root, '公开.md', '# 可以读取');
    symlinkSync(join(home, 'outside', 'secret.md'), join(root, '外部.md'));
    symlinkSync(join(home, 'outside'), join(root, '外部目录'));
    symlinkSync(join(root, '.private', 'secret.md'), join(root, '隐藏别名.md'));
    symlinkSync(join(home, 'missing.md'), join(root, '断链.md'));
    symlinkSync(join(root, '公开.md'), join(root, '内部.md'));
    for (const path of ['外部.md', '外部目录/secret.md', '外部目录/不存在.md', '隐藏别名.md', '断链.md']) expect(errorCode(() => reader.file(path))).toBe('invalid_path');
    expect(reader.file('内部.md').content).toBe('# 可以读取');
    expect(walkPersonalOsFiles(root).map((file) => file.name).sort()).toEqual(['公开.md', '内部.md']);
  });

  it('损坏或恶意领域文件只影响该领域；安全领域仍可查看，递归软链不死循环', () => {
    const { home, root, reader } = sandbox(true);
    put(home, 'outside/状态.md', '秘密 @due(2026-11-21)');
    rmSync(join(root, '领域', '工作', '状态.md'));
    symlinkSync(join(home, 'outside', '状态.md'), join(root, '领域', '工作', '状态.md'));
    symlinkSync(join(root, '领域', '技术'), join(root, '领域', '技术', '循环'));
    const work = reader.domain('工作');
    expect(work.availability).toBe('unreadable');
    expect(work.markdown).not.toContain('秘密');
    expect(work.warnings.some((warning) => warning.code === 'file_unreadable')).toBe(true);
    expect(reader.domain('技术').todos).toHaveLength(2);
    expect(reader.today().dueToday).toHaveLength(1);
    expect(reader.overview().domains).toHaveLength(10);
  });

  it('状态 iCloud 占位不伪装为空文件，下载完成后重新读取实际内容', () => {
    const { root, reader } = sandbox(true);
    rmSync(join(root, '领域', '技术', '状态.md'));
    put(root, '领域/技术/.状态.md.icloud', '');
    expect(reader.domain('技术')).toMatchObject({ exists: true, availability: 'icloud' });
    expect(reader.domain('技术').warnings.some((warning) => warning.code === 'icloud_pending')).toBe(true);
    put(root, '领域/技术/状态.md', '# 技术\n更新于：2026-11-21\n## 未结事项\n- [ ] 已下载后的事项');
    const loaded = reader.domain('技术');
    expect(loaded.availability).toBe('available');
    expect(loaded.todos[0]?.text).toBe('已下载后的事项');
    expect(loaded.files.filter((file) => file.name === '状态.md')).toHaveLength(1);
  });
});
