import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openCore } from '@bluemanta/core';
import { defaultKnowledgeEnv } from '@bluemanta/knowledge';
import { afterEach, describe, expect, it } from 'vitest';
import { KNOWLEDGE_INDEX_FILE, ideaDocsFrom } from '../src/knowledge-tools.js';
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
