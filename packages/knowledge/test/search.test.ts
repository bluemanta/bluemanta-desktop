import { cpSync, mkdtempSync, rmSync, unlinkSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import {
  KnowledgeIndex,
  bigrams,
  chunkMarkdown,
  defaultKnowledgeEnv,
  evaluate,
  excerptAround,
  extractKeywords,
  queryKeywords,
  type IdeaDoc,
} from '../src/index.js';

const FIXTURE_HOME = fileURLToPath(new URL('../fixtures/home', import.meta.url));
const temps: string[] = [];
const indexes: KnowledgeIndex[] = [];

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'bm-knowledge-index-'));
  temps.push(dir);
  return dir;
}

afterEach(() => {
  for (const index of indexes.splice(0)) index.close();
  for (const dir of temps.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const IDEAS: IdeaDoc[] = [
  {
    id: 'card_idea_1',
    title: '会员分层的新想法',
    body: '按最近一次消费把会员分成三层，分别设计触达频率。',
    createdAt: '2026-04-01T00:00:00.000Z',
    updatedAt: '2026-04-01T00:00:00.000Z',
  },
  {
    id: 'card_idea_2',
    title: '周末带孩子去露营',
    body: '提前订营地，带好防蚊用品。',
    extraText: '原话：周末想去露营',
    createdAt: '2026-05-01T00:00:00.000Z',
    updatedAt: '2026-05-01T00:00:00.000Z',
  },
];

function open(options: { home?: string; ideas?: IdeaDoc[]; dbPath?: string; now?: () => number } = {}): KnowledgeIndex {
  const index = new KnowledgeIndex({
    env: defaultKnowledgeEnv({ home: options.home ?? FIXTURE_HOME }),
    dbPath: options.dbPath ?? ':memory:',
    ideas: () => options.ideas ?? IDEAS,
    ...(options.now ? { now: options.now } : {}),
  });
  indexes.push(index);
  return index;
}

describe('切段与关键词', () => {
  it('第一个 H1 作标题，后续标题按层级切段，代码块里的 # 不算标题', () => {
    const parsed = chunkMarkdown('# 文档\n\n导语\n\n## 甲\n\n甲正文\n\n```\n# 不是标题\n```\n\n### 甲一\n\n甲一正文\n\n## 乙\n\n乙正文\n', 'fallback');
    expect(parsed.title).toBe('文档');
    expect(parsed.chunks.map((chunk) => [chunk.headings.join(' › '), chunk.body.split('\n')[0]])).toEqual([
      ['', '导语'],
      ['甲', '甲正文'],
      ['甲 › 甲一', '甲一正文'],
      ['乙', '乙正文'],
    ]);
    expect(chunkMarkdown('没有标题的正文', '文件名').title).toBe('文件名');
  });

  it('超长段落按段拆开，每段不超过 1500 字', () => {
    const long = `# 长文\n\n${Array.from({ length: 6 }, (_, i) => `${i}`.repeat(600)).join('\n\n')}`;
    const chunks = chunkMarkdown(long, 'x').chunks;
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((chunk) => chunk.body.length <= 1500)).toBe(true);
  });

  it('关键词按空白拆分、去掉两端标点、转小写去重', () => {
    expect(queryKeywords('  「会员」 RFP？ rfp  ')).toEqual(['会员', 'rfp']);
  });

  it('从口语问题里取关键词', () => {
    expect(extractKeywords('去年说的会员分层那个想法')).toEqual(['会员分层']);
    // 单个汉字（拆）太泛，丢掉；英文词保留。
    expect(extractKeywords('之前关于 RFP 怎么拆的笔记？')).toEqual(['rfp']);
  });

  it('长中文关键词拆成重叠的两字片段；短词和英文不拆', () => {
    expect(bigrams('会员等级设计')).toEqual(['会员', '员等', '等级', '级设', '设计']);
    expect(bigrams('会员')).toEqual([]);
    expect(bigrams('loyalty')).toEqual([]);
  });

  it('摘录以命中词为中心，约 120 字', () => {
    const text = `${'前'.repeat(200)}关键词${'后'.repeat(200)}`;
    const excerpt = excerptAround(text, ['关键词']);
    expect(excerpt).toContain('关键词');
    expect(Array.from(excerpt.replace(/…/g, '')).length).toBe(120);
  });
});

describe('索引刷新', () => {
  it('首次刷新索引两个库和灵感，统计正确', () => {
    const index = open();
    const stats = index.refresh(true);
    expect(stats).toMatchObject({ files: 26, added: 26, updated: 0, removed: 0, ideas: 2 });
    expect(index.stats().libraries).toEqual([
      { id: 'personal', files: 19, chunks: 28 },
      { id: 'arsenal', files: 7, chunks: 8 },
    ]);
    expect(index.stats().ideas).toBe(2);
  });

  it('30 秒内不重复刷新；文件没变时强制刷新也不重建', () => {
    let now = 1_000_000;
    const index = open({ now: () => now });
    expect(index.refresh()).not.toBeNull();
    now += 10_000;
    expect(index.refresh()).toBeNull();
    now += 30_000;
    expect(index.refresh()).toMatchObject({ added: 0, updated: 0, removed: 0 });
  });

  it('改动、删除文件后增量更新', () => {
    const home = tempDir();
    cpSync(FIXTURE_HOME, home, { recursive: true });
    const index = open({ home });
    index.refresh(true);
    const file = join(home, 'Documents', 'Knowledge', '03_AI与技术', 'AI关注', 'Topic_Knowledge.md');
    writeFileSync(file, '# AI关注 Topic Knowledge\n\n- 新增一条：多智能体协作要先定好分工边界。\n');
    utimesSync(file, new Date(), new Date(Date.now() + 5000));
    unlinkSync(join(home, 'Documents', 'Knowledge', '_Inbox', '2026-10-20-读书笔记草稿.md'));
    expect(index.refresh(true)).toMatchObject({ added: 0, updated: 1, removed: 1 });
    expect(index.search('分工边界').hits[0]?.path).toBe('03_AI与技术/AI关注/Topic_Knowledge.md');
    expect(index.search('复利思维').hits.some((hit) => hit.area === 'inbox')).toBe(false);
  });

  it('灵感删掉或改了会跟着更新', () => {
    const ideas = [...IDEAS];
    const index = open({ ideas });
    index.refresh(true);
    ideas.splice(1, 1);
    ideas[0] = { ...IDEAS[0]!, body: '改成按消费频次分层', updatedAt: '2026-06-01T00:00:00.000Z' };
    index.refresh(true);
    expect(index.stats().ideas).toBe(1);
    expect(index.search('消费频次').hits[0]?.ideaId).toBe('card_idea_1');
    expect(index.search('露营').hits).toEqual([]);
  });

  it('结构版本不一致时丢掉重建（索引是派生数据）', () => {
    const dir = tempDir();
    const dbPath = join(dir, 'knowledge-index.sqlite');
    const first = open({ dbPath });
    first.refresh(true);
    first.close();
    indexes.splice(indexes.indexOf(first), 1);
    const raw = new DatabaseSync(dbPath);
    raw.prepare("UPDATE meta SET value = '0' WHERE key = 'schema'").run();
    raw.close();
    const second = open({ dbPath });
    expect(second.stats().libraries[0]?.files).toBe(0);
    expect(second.refresh(true)?.added).toBe(26);
  });
});

describe('搜索', () => {
  it('三个字以上走全文索引，结果带库、路径、标题链、主题名和摘录', () => {
    const [hit] = open().search('评分项').hits;
    expect(hit).toMatchObject({
      source: 'library',
      library: 'personal',
      path: '02_职业与业务/售前方法/Topic_Knowledge.md',
      title: '售前方法 Topic Knowledge',
      headings: ['核心观点'],
      area: 'topic',
      topicPath: '02_职业与业务/售前方法',
      topicName: '售前方法',
      matchMode: 'all',
    });
    expect(hit?.excerpt).toContain('评分项');
  });

  it('两个字的词用子串匹配', () => {
    const paths = open().search('复盘').hits.map((hit) => hit.path);
    expect(paths).toContain('01_思考与判断/人生与成长/Topic_Knowledge.md');
  });

  it('多个关键词先取交集，不够再补只命中部分的', () => {
    const hits = open().search('会员 积分', { limit: 20 }).hits;
    expect(hits[0]).toMatchObject({ library: 'arsenal', path: '01_业务主题/会员体系/Topic_Knowledge.md', matchMode: 'all' });
    expect(hits.some((hit) => hit.matchMode === 'any')).toBe(true);
    const allIndex = hits.findIndex((hit) => hit.matchMode === 'any');
    expect(hits.slice(0, allIndex).every((hit) => hit.matchMode === 'all')).toBe(true);
  });

  it('不带空格的长中文问法走两字片段兜底', () => {
    const hits = open().search('会员等级设计').hits;
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0]?.matchMode).toBe('fuzzy');
    expect(hits.map((hit) => hit.path)).toContain('01_业务主题/会员体系/Topic_Knowledge.md');
  });

  it('命中主题别名时加权（Router Lite）', () => {
    const index = open();
    expect(index.route('Loyalty 怎么讲')[0]).toMatchObject({ library: 'arsenal', topicPath: '01_业务主题/会员体系', matched: ['Loyalty'] });
    expect(index.route('Loyalty')[0]?.readOrder).toEqual([
      '01_业务主题/会员体系/README.md',
      '01_业务主题/会员体系/Asset_Index.md',
      '01_业务主题/会员体系/Topic_Knowledge.md',
      '01_业务主题/会员体系/Topic_Log.md',
    ]);
    const hits = index.search('权益').hits;
    expect(hits[0]?.topicPath).toBe('01_业务主题/会员体系');
  });

  it('当前版本排在归档版本前面；模板排在后面', () => {
    const hits = open().search('客户研究清单').hits;
    const current = hits.findIndex((hit) => hit.path === '02_职业与业务/售前方法/客户研究清单.md');
    const archived = hits.findIndex((hit) => hit.path === '02_职业与业务/售前方法/_Archive/客户研究清单_v1.md');
    expect(current).toBeGreaterThanOrEqual(0);
    expect(archived).toBeGreaterThan(current);
    expect(hits[archived]?.area).toBe('archive');
  });

  it('总索引表格在搜索里排在主题正文后面', () => {
    const hits = open().search('会员 积分', { libraries: ['arsenal'], includeIdeas: false, limit: 20 }).hits;
    const knowledge = hits.findIndex((hit) => hit.path === '01_业务主题/会员体系/Topic_Knowledge.md');
    const index = hits.findIndex((hit) => hit.path === 'Arsenal_Index.md');
    expect(knowledge).toBe(0);
    expect(index).toBeGreaterThan(knowledge);
  });

  it('按库筛选，灵感可以排除', () => {
    const index = open();
    expect(index.search('会员', { libraries: ['personal'], includeIdeas: false }).hits.every((hit) => hit.library === 'personal')).toBe(true);
    const withIdeas = index.search('会员分层').hits;
    expect(withIdeas[0]).toMatchObject({ source: 'idea', ideaId: 'card_idea_1', title: '会员分层的新想法', library: null, path: null });
    expect(index.search('会员分层', { includeIdeas: false }).hits.some((hit) => hit.source === 'idea')).toBe(false);
    expect(index.search('原话').hits[0]?.ideaId).toBe('card_idea_2');
  });

  it('空查询、找不到都返回空列表', () => {
    const index = open();
    expect(index.search('   ').hits).toEqual([]);
    expect(index.search('完全不存在的词组合xyz').hits).toEqual([]);
  });
});

describe('真实问题评测', () => {
  it('按问题原文和提取的关键词各搜一次，合并后看前 5 条', () => {
    const report = evaluate(open(), [
      { question: '拿到 RFP 先拆什么？', expect: ['评分项'] },
      { question: '去年说的会员分层那个想法', expect: ['card_idea_1'] },
      { question: '积分要有出口那个观点', expect: ['01_业务主题/会员体系/'] },
      { question: '火星移民计划', expect: ['火星'] },
    ]);
    expect(report).toMatchObject({ total: 4, found: 3, topK: 5 });
    expect(report.results.map((result) => result.found)).toEqual([true, true, true, false]);
    expect(report.results[1]?.queries).toEqual(['去年说的会员分层那个想法', '会员分层']);
    expect(report.results[0]?.top.length).toBeLessThanOrEqual(5);
  });
});
