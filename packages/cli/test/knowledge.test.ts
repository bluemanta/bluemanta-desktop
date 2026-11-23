import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openCore } from '@bluemanta/core';
import { defaultKnowledgeEnv, PersonalOsReader } from '@bluemanta/knowledge';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  KNOWLEDGE_INDEX_FILE,
  KNOWLEDGE_READ_MAX_CHARS,
  KNOWLEDGE_TOOL_LIBRARIES,
  ideaDocsFrom,
  personalOsToday,
  renderPersonalOsToday,
  openKnowledgeIndex,
  readKnowledge,
  renderKnowledgeRead,
  renderKnowledgeRoute,
  renderKnowledgeSearch,
  routeKnowledge,
  searchKnowledge,
} from '../src/knowledge-tools.js';
import { runKnowledge } from '../src/run-knowledge.js';

/** The old ~/Documents/Knowledge layout is no longer a default library (spec 14.1); these tests still exercise
 *  the Arsenal-structure code on the fixture's Knowledge folder, so they list it explicitly. */
const legacyEnv = (options: { home: string }) => defaultKnowledgeEnv({ home: options.home, libraries: [
  { id: 'personalos', kind: 'personalos', name: 'PersonalOS', root: join(options.home, 'Documents', 'PersonalOS'), writable: false },
  { kind: 'arsenal', id: 'personal', name: '个人', root: join(options.home, 'Documents', 'Knowledge'), writable: false },
  { kind: 'arsenal', id: 'arsenal', name: 'Arsenal', root: join(options.home, 'Documents', 'Shuyun', 'SalesOS', 'Arsenal'), writable: false },
] });


const FIXTURE_HOME = fileURLToPath(new URL('../../knowledge/fixtures/home', import.meta.url));
const knowledgeEnv = legacyEnv({ home: FIXTURE_HOME });
const dirs: string[] = [];

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'bluemanta-knowledge-cli-'));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  vi.unstubAllEnvs();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function run(argv: string[]): { code: number; out: string; err: string } {
  let out = '';
  let err = '';
  const code = runKnowledge({
    argv,
    env: {},
    knowledgeEnv,
    stdout: (text) => {
      out += text;
    },
    stderr: (text) => {
      err += text;
    },
  });
  return { code, out, err };
}

function seedIdea(dataDir: string): string {
  const core = openCore({ dataDir });
  try {
    const result = core.card.create({
      requestId: 'knowledge-cli-test-1',
      source: { kind: 'human', name: 'test' },
      cardType: 'idea',
      title: '会员分层的新想法',
      body: '按最近一次消费把会员分成三层。',
      rawInput: { status: 'present', channel: 'web', text: '原话：会员按最近消费分三层，触达频率不同' },
    });
    if (!result.ok) throw new Error(result.message);
    return result.record.id;
  } finally {
    core.close();
  }
}

describe('knowledge 命令', () => {
  it('没有命令时打印用法并返回 2；未知命令也返回 2', () => {
    expect(run([]).code).toBe(2);
    expect(run(['--help'])).toMatchObject({ code: 0 });
    expect(run(['nope']).code).toBe(2);
    expect(run(['search']).err).toContain('需要关键词');
  });

  it('search 搜到库里的段落和灵感，索引建在数据目录', () => {
    const dataDir = tempDir();
    const id = seedIdea(dataDir);
    const text = run(['search', '评分项', '--data-dir', dataDir]);
    expect(text.code).toBe(0);
    expect(text.out).toContain('售前方法 Topic Knowledge › 核心观点  [personal:02_职业与业务/售前方法/Topic_Knowledge.md]');
    expect(existsSync(join(dataDir, KNOWLEDGE_INDEX_FILE))).toBe(true);

    const json = run(['search', '会员分层', '--data-dir', dataDir, '--json']);
    const result = JSON.parse(json.out) as { hits: Array<{ source: string; ideaId: string | null }> };
    expect(result.hits[0]).toMatchObject({ source: 'idea', ideaId: id });

    const onlyArsenal = JSON.parse(run(['search', '会员', '--data-dir', dataDir, '--library', 'arsenal', '--no-ideas', '--json']).out) as {
      hits: Array<{ library: string | null }>;
    };
    expect(onlyArsenal.hits.length).toBeGreaterThan(0);
    expect(onlyArsenal.hits.every((hit) => hit.library === 'arsenal')).toBe(true);
  });

  it('灵感文档带上不同于正文的原文和追记', () => {
    const dataDir = tempDir();
    seedIdea(dataDir);
    const core = openCore({ dataDir });
    try {
      expect(ideaDocsFrom(core)[0]).toMatchObject({ title: '会员分层的新想法', extraText: '原话：会员按最近消费分三层，触达频率不同' });
    } finally {
      core.close();
    }
  });

  it('route 与 stats', () => {
    const dataDir = tempDir();
    expect(run(['route', 'Loyalty', '--data-dir', dataDir, '--no-ideas']).out).toContain('会员体系  [arsenal:01_业务主题/会员体系]  命中：Loyalty');
    const stats = run(['stats', '--data-dir', dataDir, '--no-ideas']);
    expect(stats.out).toContain('personal：19 个文件');
    expect(stats.out).toContain('arsenal：7 个文件');
  });

  it('eval 读数据目录里的测试集，报告命中数；找不到测试集返回 1', () => {
    const dataDir = tempDir();
    seedIdea(dataDir);
    expect(run(['eval', '--data-dir', dataDir]).code).toBe(1);
    writeFileSync(
      join(dataDir, 'knowledge-eval.json'),
      JSON.stringify([
        { question: '拿到 RFP 先拆什么？', expect: ['评分项'] },
        { question: '火星移民计划', expect: ['火星'] },
      ]),
    );
    const report = run(['eval', '--data-dir', dataDir]);
    expect(report.code).toBe(0);
    expect(report.out).toContain('✓ 拿到 RFP 先拆什么？（第 1 条）');
    expect(report.out).toContain('✗ 火星移民计划');
    expect(report.out).toContain('前 5 条命中：1/2');
  });

  it('参数错误返回 2', () => {
    expect(run(['search', 'x', '--limit', '0']).code).toBe(2);
    expect(run(['search', 'x', '--bogus']).code).toBe(2);
  });
});

describe('知识 agent 工具（迭代 4：PersonalOS 与 Arsenal）', () => {
  // agent 看到的是默认配置：只有 personalos 和 arsenal（规格 14.1）。
  const toolEnv = defaultKnowledgeEnv({ home: FIXTURE_HOME });
  function index(dataDir: string) {
    const core = openCore({ dataDir });
    const opened = openKnowledgeIndex({ dataDir, core, env: toolEnv });
    return { opened, close: () => { opened.close(); core.close(); } };
  }

  it('默认库只有 personalos 和 arsenal；传旧的 personal 会提示改用 personalos', () => {
    expect(toolEnv.libraries.map((library) => library.id)).toEqual(['personalos', 'arsenal']);
    expect(KNOWLEDGE_TOOL_LIBRARIES).toEqual(['personalos', 'arsenal']);
    const old = readKnowledge(toolEnv, { library: 'personal', path: 'README.md' });
    expect(old).toMatchObject({ ok: false });
    expect(!old.ok && old.error).toContain('library=personalos');
  });

  it('路由：Arsenal 按别名找主题；PersonalOS 按领域名、别名、典型问题找领域', () => {
    const dataDir = tempDir();
    const { opened, close } = index(dataDir);
    try {
      const result = routeKnowledge(opened, toolEnv, { query: 'Loyalty 怎么讲' });
      expect(result).toMatchObject({ ok: true, candidates: [{ library: 'arsenal', topicPath: '01_业务主题/会员体系', name: '会员体系' }] });
      expect(renderKnowledgeRoute(result)).toContain('读取顺序：01_业务主题/会员体系/README.md → ');
      for (const query of ['副业', '图书交换', '样品准备好了吗']) {
        const routed = routeKnowledge(opened, toolEnv, { query, library: 'personalos' });
        expect(routed.ok && routed.candidates[0]?.library, query).toBe('personalos');
      }
      const alias = routeKnowledge(opened, toolEnv, { query: '图书交换', library: 'personalos' });
      expect(alias).toMatchObject({ ok: true, candidates: [{ topicPath: '领域/工作', name: '工作', readOrder: ['领域/工作/状态.md', '领域/工作/资料登记.md'] }] });
      expect(routeKnowledge(opened, toolEnv, { query: ' ' })).toEqual({ ok: false, error: 'query 不能为空' });
      expect(routeKnowledge(opened, toolEnv, { query: 'x', library: 'nope' })).toMatchObject({ ok: false });
      expect(renderKnowledgeRoute({ ok: true, query: 'x', candidates: [] })).toContain('没有匹配的主题');
    } finally {
      close();
    }
  });

  it('搜索：灵感和两个库一起；PersonalOS 命中带领域；指定库时不含灵感', () => {
    const dataDir = tempDir();
    const id = seedIdea(dataDir);
    const { opened, close } = index(dataDir);
    try {
      const result = searchKnowledge(opened, toolEnv, { query: '会员分层' });
      expect(result.ok && result.items[0]).toMatchObject({ source: 'idea', ideaId: id });
      expect(renderKnowledgeSearch(result)).toContain(`   灵感 id：${id}`);
      const scoped = searchKnowledge(opened, toolEnv, { query: '雾灯便签', library: 'personalos' });
      expect(scoped.ok && scoped.items.length).toBeGreaterThan(0);
      expect(scoped.ok && scoped.items.every((item) => item.library === 'personalos' && item.source === 'library')).toBe(true);
      expect(scoped.ok && scoped.items.find((item) => item.path === '领域/工作/状态.md')?.domain).toBe('工作');
      expect(renderKnowledgeSearch(scoped)).toContain('   库：personalos　路径：领域/工作/状态.md　领域：工作');
      expect(searchKnowledge(opened, toolEnv, { query: '火星移民计划xyz' })).toMatchObject({ ok: true, count: 0 });
      expect(renderKnowledgeSearch({ ok: true, query: 'x', keywords: ['x'], count: 0, items: [] })).toContain('没有找到');
    } finally {
      close();
    }
  });

  it('读取：PersonalOS 领域给状态.md 和文件清单，文件给正文，隐藏路径和越界拒绝；Arsenal 照旧', () => {
    const domain = readKnowledge(toolEnv, { library: 'personalos', path: '领域/工作' });
    expect(domain).toMatchObject({ ok: true, kind: 'domain', displayPath: '~/Documents/PersonalOS/领域/工作' });
    expect(domain.ok && domain.content).toContain('# 工作');
    expect(domain.ok && domain.files).toContain('领域/工作/状态.md');
    expect(domain.ok && domain.files).toContain('领域/工作/资料登记.md');
    expect(renderKnowledgeRead(domain)).toContain('领域文件：');
    const file = readKnowledge(toolEnv, { library: 'personalos', path: '领域/工作/资料登记.md' });
    expect(file).toMatchObject({ ok: true, kind: 'markdown', nextOffset: null });
    const folder = readKnowledge(toolEnv, { library: 'personalos', path: '协议' });
    expect(folder.ok && folder.files.length).toBeGreaterThan(0);
    expect(readKnowledge(toolEnv, { library: 'personalos', path: '.claude/fixture-only.md' })).toMatchObject({ ok: false });
    expect(readKnowledge(toolEnv, { library: 'personalos', path: '../Knowledge/README.md' })).toMatchObject({ ok: false });
    expect(readKnowledge(toolEnv, { library: 'personalos', path: '没有.md' })).toMatchObject({ ok: false });
    const topic = readKnowledge(toolEnv, { library: 'arsenal', path: '01_业务主题/会员体系' });
    expect(topic).toMatchObject({ ok: true, kind: 'topic' });
    const arsenal = readKnowledge(toolEnv, { library: 'arsenal', path: '01_业务主题/会员体系/Topic_Knowledge.md' });
    expect(renderKnowledgeRead(arsenal)).toContain('积分要有消耗出口');
    expect(readKnowledge(toolEnv, { library: '', path: 'x' })).toEqual({ ok: false, error: 'library 不能为空' });
    expect(KNOWLEDGE_READ_MAX_CHARS).toBe(20000);
  });

  it('今天：分组与网页今天页一致，文本按晨间简报顺序，末尾说明外部来源', () => {
    vi.stubEnv('BLUEMANTA_TODAY', '2026-11-21');
    const result = personalOsToday(toolEnv);
    const page = new PersonalOsReader({ home: FIXTURE_HOME }).today();
    expect(result).toMatchObject({ ok: true, today: '2026-11-21' });
    if (!result.ok) throw new Error(result.error);
    expect([result.overdue.length, result.dueToday.length, result.next7.length, result.waiting.length, result.undated.total, result.laterCount])
      .toEqual([page.overdue.length, page.dueToday.length, page.next7.length, page.waiting.length, page.undated.total, page.later.count]);
    expect(result.inbox.length).toBe(page.inbox.length);
    expect(result.overdue[0]).toMatchObject({ file: expect.stringMatching(/状态\.md$/), line: expect.any(Number) });
    const text = renderPersonalOsToday(result);
    const order = ['已逾期', '今天到期', '未来 7 天', '等待中', '无日期'].map((title) => text.indexOf(title));
    expect(order.every((at) => at >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(text).toContain('逾期');
    expect(text.trim().endsWith('日历、Linear、SalesOS 等外部来源不在这里，需要另外查。')).toBe(true);
    const missing = personalOsToday(defaultKnowledgeEnv({ home: tempDir() }));
    expect(missing).toMatchObject({ ok: false });
    expect(!missing.ok && missing.error).toContain('没有找到 PersonalOS');
  });
});
