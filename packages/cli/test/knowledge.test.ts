import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openCore } from '@bluemanta/core';
import { defaultKnowledgeEnv } from '@bluemanta/knowledge';
import { afterEach, describe, expect, it } from 'vitest';
import {
  KNOWLEDGE_INDEX_FILE,
  KNOWLEDGE_READ_MAX_CHARS,
  ideaDocsFrom,
  openKnowledgeIndex,
  readKnowledge,
  renderKnowledgeRead,
  renderKnowledgeRoute,
  renderKnowledgeSearch,
  routeKnowledge,
  searchKnowledge,
} from '../src/knowledge-tools.js';
import { runKnowledge } from '../src/run-knowledge.js';

const FIXTURE_HOME = fileURLToPath(new URL('../../knowledge/fixtures/home', import.meta.url));
const knowledgeEnv = defaultKnowledgeEnv({ home: FIXTURE_HOME });
const dirs: string[] = [];

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'bluemanta-knowledge-cli-'));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
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

describe('知识 agent 工具', () => {
  function index(dataDir: string) {
    const core = openCore({ dataDir });
    const opened = openKnowledgeIndex({ dataDir, core, env: knowledgeEnv });
    return { opened, close: () => { opened.close(); core.close(); } };
  }

  it('路由：按别名找主题，输出带库、路径和读取顺序', () => {
    const dataDir = tempDir();
    const { opened, close } = index(dataDir);
    try {
      const result = routeKnowledge(opened, knowledgeEnv, { query: 'Loyalty 怎么讲' });
      expect(result).toMatchObject({ ok: true, candidates: [{ library: 'arsenal', topicPath: '01_业务主题/会员体系', name: '会员体系' }] });
      const text = renderKnowledgeRoute(result);
      expect(text).toContain('1. 会员体系\n   库：arsenal　路径：01_业务主题/会员体系');
      expect(text).toContain('读取顺序：01_业务主题/会员体系/README.md → ');
      expect(routeKnowledge(opened, knowledgeEnv, { query: ' ' })).toEqual({ ok: false, error: 'query 不能为空' });
      expect(routeKnowledge(opened, knowledgeEnv, { query: 'x', library: 'nope' })).toMatchObject({ ok: false });
      expect(renderKnowledgeRoute({ ok: true, query: 'x', candidates: [] })).toContain('没有匹配的主题');
    } finally {
      close();
    }
  });

  it('搜索：库和灵感一起，指定库时不含灵感；输出可按行解析', () => {
    const dataDir = tempDir();
    const id = seedIdea(dataDir);
    const { opened, close } = index(dataDir);
    try {
      const result = searchKnowledge(opened, knowledgeEnv, { query: '会员分层' });
      expect(result.ok && result.items[0]).toMatchObject({ source: 'idea', ideaId: id });
      const text = renderKnowledgeSearch(result);
      expect(text).toMatch(/^找到 \d+ 条（关键词：会员分层）：/);
      expect(text).toContain(`   灵感 id：${id}`);
      const scoped = searchKnowledge(opened, knowledgeEnv, { query: '评分项', library: 'personal' });
      expect(scoped.ok && scoped.items.every((item) => item.library === 'personal')).toBe(true);
      expect(renderKnowledgeSearch(scoped)).toContain('   库：personal　路径：02_职业与业务/售前方法/Topic_Knowledge.md　主题：售前方法');
      expect(searchKnowledge(opened, knowledgeEnv, { query: '火星移民计划xyz' })).toMatchObject({ ok: true, count: 0 });
      expect(renderKnowledgeSearch({ ok: true, query: 'x', keywords: ['x'], count: 0, items: [] })).toContain('没有找到');
    } finally {
      close();
    }
  });

  it('读取：主题给 README 和文件清单，文件给正文，越界拒绝', () => {
    const topic = readKnowledge(knowledgeEnv, { library: 'personal', path: '02_职业与业务/售前方法' });
    expect(topic).toMatchObject({ ok: true, kind: 'topic', displayPath: '~/Documents/Knowledge/02_职业与业务/售前方法' });
    expect(topic.ok && topic.files).toEqual([
      '02_职业与业务/售前方法/README.md',
      '02_职业与业务/售前方法/Asset_Index.md',
      '02_职业与业务/售前方法/Topic_Knowledge.md',
      '02_职业与业务/售前方法/方案框架_v1.pptx',
      '02_职业与业务/售前方法/客户研究清单.md',
    ]);
    const file = readKnowledge(knowledgeEnv, { library: 'arsenal', path: '01_业务主题/会员体系/Topic_Knowledge.md' });
    expect(file).toMatchObject({ ok: true, kind: 'markdown', nextOffset: null });
    expect(renderKnowledgeRead(file)).toContain('积分要有消耗出口');
    expect(readKnowledge(knowledgeEnv, { library: 'personal', path: '02_职业与业务/售前方法/方案框架_v1.pptx' })).toMatchObject({ ok: true, kind: 'file' });
    expect(readKnowledge(knowledgeEnv, { library: 'personal', path: '../Shuyun/SalesOS/Arsenal/README.md' })).toMatchObject({ ok: false });
    expect(readKnowledge(knowledgeEnv, { library: '', path: 'x' })).toEqual({ ok: false, error: 'library 不能为空' });
    expect(readKnowledge(knowledgeEnv, { library: 'personal', path: '没有.md' })).toMatchObject({ ok: false });
    expect(KNOWLEDGE_READ_MAX_CHARS).toBe(20000);
  });
});
