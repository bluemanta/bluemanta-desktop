import { createHash } from 'node:crypto';
import { cpSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PersonalOsReader, aboutSources, aboutTree, documentSummary, parseAboutChangelog, redirectTarget, TREE_LIMIT, type DocumentFile } from '../src/personalos/index.js';

/** 规格第 15 节：关于页。虚构 fixture 的副本，不碰真实 PersonalOS。 */
const FIXTURE = fileURLToPath(new URL('../fixtures/home/Documents/PersonalOS', import.meta.url));
const SOURCES = fileURLToPath(new URL('../fixtures/sources/home/Documents/PersonalOS/我/数据源.md', import.meta.url));
let home = ''; let root = '';
const reader = () => new PersonalOsReader({ home, today: '2026-11-21' });
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'pos-about-')); root = join(home, 'Documents', 'PersonalOS');
  cpSync(FIXTURE, root, { recursive: true });
});
afterEach(() => rmSync(home, { recursive: true, force: true }));

function snapshot(dir: string): Record<string, string> {
  const result: Record<string, string> = {};
  const walk = (path: string): void => {
    for (const entry of readdirSync(path, { withFileTypes: true })) {
      const full = join(path, entry.name);
      if (entry.isDirectory()) walk(full);
      else result[full] = `${createHash('sha256').update(readFileSync(full)).digest('hex')}:${statSync(full).mtimeMs}`;
    }
  };
  walk(dir); return result;
}

describe('更新记录', () => {
  it('按日期和版本排序，日期不合法的排最后且不当成当前版本', () => {
    const parsed = parseAboutChangelog(readFileSync(join(FIXTURE, '我/关于.md'), 'utf8'));
    expect(parsed.found).toBe(true);
    expect(parsed.changelog.map((item) => item.version)).toEqual(['v1.2', 'v1.1', 'v1.0', 'v2.0']);
    expect(parsed.current).toMatchObject({ version: 'v1.2', date: '2026-11-26', text: '架构图加上记录一列' });
    expect(parsed.changelog.at(-1)).toMatchObject({ version: 'v2.0', date: null });
  });
  it('「内容」「说明」列也认；v1.10 比 v1.9 新；没有表时 found 为 false', () => {
    const parsed = parseAboutChangelog('| 版本 | 说明 | 日期 |\n|---|---|---|\n| v1.9 | 九 | 2026-12-01 |\n| v1.10 | 十 | 2026-12-01 |\n');
    expect(parsed.current).toMatchObject({ version: 'v1.10', text: '十' });
    expect(parseAboutChangelog('# 关于\n\n还没写表。').found).toBe(false);
  });
});

describe('文件摘要', () => {
  it('取一级标题和正文第一句，去掉链接与格式，跳过元数据行', () => {
    expect(documentSummary('# 晨间\n更新于：2026-11-01\n\n先读[导航](README.md)，再看 `状态.md`。后面不要。')).toEqual({ title: '晨间', summary: '先读导航，再看 状态.md。' });
    expect(documentSummary(`# 长\n\n${'字'.repeat(80)}`).summary).toHaveLength(60);
    expect(redirectTarget('@AGENTS.md\n')).toBe('AGENTS.md');
    expect(redirectTarget('# 标题\n@AGENTS.md')).toBeNull();
  });
});

describe('PersonalOsReader.about', () => {
  it('AGENTS.md 有路由表：入口角色、领域、记录、目录结构', () => {
    const about = reader().about();
    expect(about.exists).toBe(true);
    expect(about.routerFile).toBe('AGENTS.md');
    expect(about.about).toMatchObject({ file: '我/关于.md', exists: true, current: { version: 'v1.2' } });
    expect(about.entries.map((entry) => [entry.path, entry.role])).toEqual([['AGENTS.md', 'router'], ['CLAUDE.md', 'redirect'], ['协议/阅读.md', 'protocol']]);
    expect(about.entries[0]).toMatchObject({ title: '林舟的个人记录', summary: '本目录是完全虚构的产品经理林舟的演示资料，所有人名、经历与事项均为原创样例。' });
    expect(about.entries[1]!.redirect).toBe('AGENTS.md');
    expect(about.domains.map((domain) => domain.name)).toEqual(['我', '工作', '副业', '写作', '技术', '家庭', '健康', '财务', '生活事务', '园艺']);
    expect(about.domains.find((domain) => domain.name === '财务')).toMatchObject({ registered: true, exists: false, children: [] });
    expect(about.domains.find((domain) => domain.name === '园艺')).toMatchObject({ registered: false, exists: true });
    expect(about.domains.find((domain) => domain.name === '技术')!.children.map((child) => child.name)).toEqual(['知识.md', '状态.md', '资料登记.md']);
    expect(about.domains[0]!.aliasCount).toBe(3);
    expect(about.records.inbox).toEqual({ exists: true, count: 3 });
    expect(about.records.logs).toEqual({ count: 2, latest: '2026-11' });
    expect(about.records.blueprints).toEqual([{ path: '蓝图/目录说明.md', title: '这份虚构记录的目录说明', date: null }]);
    expect(about.sources).toMatchObject({ exists: false, items: [], tasks: { total: 0 } });
    const names = JSON.stringify(about.tree);
    expect(names).not.toMatch(/"\.claude"|\.DS_Store|\.icloud|fixture-only/);
    const domains = about.tree.find((node) => node.name === '领域')!;
    const work = domains.children!.find((node) => node.name === '工作')!;
    expect(work.children!.map((node) => node.name)).toContain('状态.md');
    expect(work.children!.find((node) => node.name === '事项')).toMatchObject({ kind: 'directory', children: [], more: 2 });
  });

  it('README.md 有路由表时它是路由入口，AGENTS.md 成为协作规则', () => {
    const agents = readFileSync(join(root, 'AGENTS.md'), 'utf8');
    writeFileSync(join(root, 'README.md'), `# 导航\n\n虚构导航。\n\n${agents.split('\n').filter((line) => line.startsWith('|')).join('\n')}\n`);
    writeFileSync(join(root, 'AGENTS.md'), '# 协作规则\n\n先读导航。\n');
    const about = reader().about();
    expect(about.routerFile).toBe('README.md');
    expect(about.entries.slice(0, 2).map((entry) => [entry.path, entry.role])).toEqual([['README.md', 'router'], ['AGENTS.md', 'rules']]);
  });

  it('数据源登记表：来源、方式、刷新任务数，任务按执行方计数，忽略的不计，不返回外部路径', () => {
    cpSync(SOURCES, join(root, '我/数据源.md'));
    const { sources } = reader().about();
    expect(sources.exists).toBe(true);
    expect(sources.items).toEqual([
      { name: '示例聊天', method: '副本', taskCount: 1 }, { name: '示例笔记', method: '副本', taskCount: 0 }, { name: '示例社区', method: '查询', taskCount: 0 },
      { name: '示例书签', method: '副本', taskCount: 1 }, { name: '示例推送', method: '手动', taskCount: 0 },
    ]);
    expect(sources.tasks).toEqual({ total: 10, launchd: 4, codex: 5, claude: 0, other: 1 });
    expect(JSON.stringify(sources)).not.toContain('vault');
    expect(aboutSources(null)).toMatchObject({ exists: false, file: '我/数据源.md' });
  });

  it('没有 我/关于.md 时其他部分照常；有文件没有表时给提示', () => {
    rmSync(join(root, '我/关于.md'));
    let about = reader().about();
    expect(about.about).toEqual({ file: '我/关于.md', exists: false, current: null, changelog: [] });
    expect(about.domains.length).toBeGreaterThan(0);
    writeFileSync(join(root, '我/关于.md'), '# 关于\n\n还没写表。\n');
    about = reader().about();
    expect(about.about.exists).toBe(true);
    expect(about.warnings.map((warning) => warning.code)).toContain('about_table_missing');
  });

  it('PersonalOS 不存在时 exists 为 false', () => {
    rmSync(root, { recursive: true, force: true });
    expect(reader().about()).toMatchObject({ exists: false, entries: [], domains: [], tree: [] });
  });

  it('只读：前后文件哈希和修改时间不变', () => {
    const before = snapshot(root); reader().about(); expect(snapshot(root)).toEqual(before);
  });
});

describe('目录结构', () => {
  it('每个目录最多列 20 项，多的计入 more', () => {
    const many = (path: string): DocumentFile[] => path === '' ? [{ path: 'd', name: 'd', kind: 'directory', size: 0, modifiedAt: null, availability: 'available' }]
      : Array.from({ length: TREE_LIMIT + 3 }, (_, index) => ({ path: `d/${index}.md`, name: `${index}.md`, kind: 'markdown' as const, size: 0, modifiedAt: null, availability: 'available' as const }));
    const tree = aboutTree(many);
    expect(tree.nodes[0]!.children).toHaveLength(TREE_LIMIT);
    expect(tree.nodes[0]!.more).toBe(3);
    expect(tree.more).toBe(0);
  });
});
