import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import {
  KnowledgeError,
  abbreviateHome,
  classifyPath,
  defaultKnowledgeEnv,
  listInbox,
  listLibraries,
  normalizeRelPath,
  parseRouterIndex,
  readLibraryFile,
  readLibraryIndex,
  readTopic,
  walkLibrary,
  type KnowledgeEnv,
} from '../src/index.js';

const FIXTURE_HOME = fileURLToPath(new URL('../fixtures/home', import.meta.url));
const env = defaultKnowledgeEnv({ home: FIXTURE_HOME });
const temps: string[] = [];

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'bm-knowledge-'));
  temps.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of temps.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function codeOf(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (error) {
    return error instanceof KnowledgeError ? error.code : 'other';
  }
  return undefined;
}

describe('环境', () => {
  it('默认两个库，都在 home 下，都按只读处理', () => {
    expect(env.libraries.map((library) => [library.id, library.writable])).toEqual([
      ['personal', false],
      ['arsenal', false],
    ]);
    expect(env.libraries[0]?.root).toBe(join(FIXTURE_HOME, 'Documents', 'Knowledge'));
    expect(env.libraries[1]?.root).toBe(join(FIXTURE_HOME, 'Documents', 'Shuyun', 'SalesOS', 'Arsenal'));
  });

  it('BLUEMANTA_KNOWLEDGE_HOME 覆盖 home', () => {
    const before = process.env.BLUEMANTA_KNOWLEDGE_HOME;
    process.env.BLUEMANTA_KNOWLEDGE_HOME = '/tmp/fake-home';
    try {
      expect(defaultKnowledgeEnv().home).toBe('/tmp/fake-home');
    } finally {
      if (before === undefined) delete process.env.BLUEMANTA_KNOWLEDGE_HOME;
      else process.env.BLUEMANTA_KNOWLEDGE_HOME = before;
    }
  });

  it('只缩写完整的 home 段', () => {
    expect(abbreviateHome('/Users/ann/Documents/Knowledge', '/Users/ann')).toBe('~/Documents/Knowledge');
    expect(abbreviateHome('/Users/ann-other/x', '/Users/ann')).toBe('/Users/ann-other/x');
  });
});

describe('总索引解析', () => {
  it('按表头取列，别名、问题按中英文分隔符拆分，代码块里的表格不算', () => {
    const rows = parseRouterIndex(`# X\n\n\`\`\`\n| Topic | Path |\n| --- | --- |\n| 假 | 假 |\n\`\`\`\n\n## 01_业务主题\n\n| Path | Topic | Aliases | Typical Questions | 状态 |\n| --- | --- | --- | --- | --- |\n| \`Lib/01_业务主题/甲/\` | 甲 | a，b、c, d | 问一; 问二；问三 | seed |\n| | | | | |\n`);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      section: '01_业务主题',
      name: '甲',
      rawPath: 'Lib/01_业务主题/甲/',
      aliases: ['a', 'b', 'c', 'd'],
      typicalQuestions: ['问一', '问二', '问三'],
      status: 'seed',
      keywords: [],
      lastReviewed: null,
    });
  });

  it('单元格里转义的竖线不拆列', () => {
    const rows = parseRouterIndex('## 01_a\n\n| Topic | Notes |\n| --- | --- |\n| 甲 | x \\| y |\n');
    expect(rows[0]?.notes).toBe('x | y');
  });
});

describe('库与主题', () => {
  it('列出两个库：存在、总索引文件、主题数、收件箱数', () => {
    const libraries = listLibraries(env);
    expect(libraries.map((library) => [library.id, library.exists, library.indexFile, library.topicCount, library.inboxCount])).toEqual([
      ['personal', true, 'Knowledge_Index.md', 6, 1],
      ['arsenal', true, 'Arsenal_Index.md', 2, 0],
    ]);
  });

  it('个人库：分类按编号排序，归档分类不出现；登记了没目录的、有目录没登记的都列出', () => {
    const index = readLibraryIndex(env, 'personal');
    expect(index.categories.map((category) => [category.id, category.name])).toEqual([
      ['01_思考与判断', '思考与判断'],
      ['02_职业与业务', '职业与业务'],
      ['03_AI与技术', 'AI与技术'],
      ['05_家庭与生活', '家庭与生活'],
    ]);
    const career = index.categories[1]!;
    expect(career.topics.map((topic) => [topic.name, topic.registered, topic.exists])).toEqual([
      ['售前方法', true, true],
      ['临时整理', false, true],
    ]);
    const ai = index.categories[2]!;
    expect(ai.topics.map((topic) => [topic.name, topic.exists])).toEqual([
      ['AI关注', true],
      ['自动化小工具', false],
    ]);
    expect(ai.topics[0]?.documents).toEqual({ readme: true, assetIndex: false, knowledge: true, log: false });
    expect(career.topics[0]).toMatchObject({
      path: '02_职业与业务/售前方法',
      aliases: ['售前', '方案顾问', 'Presales'],
      typicalQuestions: ['拿到 RFP 怎么拆', '第一次见客户前准备什么'],
      status: 'seed',
      lastReviewed: '2026-10-01',
    });
    expect(index.warnings).toEqual([]);
  });

  it('库目录不存在时如实报告，不抛错', () => {
    const missing: KnowledgeEnv = { home: '/nowhere', libraries: [{ id: 'x', name: 'X', root: '/nowhere/x', writable: false }] };
    expect(readLibraryIndex(missing, 'x')).toMatchObject({ library: { exists: false, topicCount: 0 }, categories: [] });
    expect(codeOf(() => readTopic(missing, 'x', '01_a/b'))).toBe('library_missing');
    expect(codeOf(() => readLibraryIndex(env, 'nope'))).toBe('library_not_found');
  });

  it('没有总索引时按目录列主题并给出提示', () => {
    const root = tempDir();
    mkdirSync(join(root, '01_甲', '主题一'), { recursive: true });
    writeFileSync(join(root, '01_甲', '主题一', 'README.md'), '# 主题一\n');
    const noIndex: KnowledgeEnv = { home: root, libraries: [{ id: 'n', name: 'N', root, writable: false }] };
    const index = readLibraryIndex(noIndex, 'n');
    expect(index.library.indexFile).toBeNull();
    expect(index.categories[0]?.topics.map((topic) => [topic.name, topic.registered])).toEqual([['主题一', false]]);
    expect(index.warnings).toEqual(['这个库没有总索引，主题都标为未登记']);
  });

  it('读主题：四个默认文件的正文、其他文件（目录在前）、归档', () => {
    const detail = readTopic(env, 'personal', '02_职业与业务/售前方法/');
    expect(Object.keys(detail.documents).sort()).toEqual(['assetIndex', 'knowledge', 'readme']);
    expect(detail.documents.knowledge).toContain('拿到 RFP 先拆评分项');
    // 中文按拼音排序：方案（fang）在客户（ke）前面。
    expect(detail.files.map((file) => [file.name, file.kind])).toEqual([
      ['方案框架_v1.pptx', 'file'],
      ['客户研究清单.md', 'markdown'],
    ]);
    expect(detail.archive.map((file) => file.path)).toEqual(['02_职业与业务/售前方法/_Archive/客户研究清单_v1.md']);

    const arsenal = readTopic(env, 'arsenal', '02_产品能力/标签');
    expect(arsenal.topic.registered).toBe(true);
    expect(arsenal.files.map((file) => [file.name, file.kind])).toEqual([['原型资料', 'directory']]);
  });

  it('没登记的目录也能当主题读（含归档分类）', () => {
    const detail = readTopic(env, 'personal', '99_Archive/旧主题');
    expect(detail.topic).toMatchObject({ name: '旧主题', category: '99_Archive', registered: false });
    expect(codeOf(() => readTopic(env, 'personal', '02_职业与业务/没有这个'))).toBe('not_found');
    expect(codeOf(() => readTopic(env, 'personal', ''))).toBe('not_a_topic');
  });

  it('读文件：Markdown 给正文，其他文件只给元信息', () => {
    const markdown = readLibraryFile(env, 'personal', '02_职业与业务/售前方法/客户研究清单.md');
    expect(markdown).toMatchObject({ kind: 'markdown', name: '客户研究清单.md', truncated: false });
    if (markdown.kind === 'markdown') expect(markdown.content).toContain('一页客户画像');
    const binary = readLibraryFile(env, 'personal', '02_职业与业务/售前方法/方案框架_v1.pptx');
    expect(binary).toMatchObject({ kind: 'file', name: '方案框架_v1.pptx' });
    expect('content' in binary).toBe(false);
    expect(codeOf(() => readLibraryFile(env, 'personal', '02_职业与业务/售前方法'))).toBe('not_found');
  });

  it('收件箱不含 README', () => {
    expect(listInbox(env, 'personal').map((file) => file.name)).toEqual(['2026-10-20-读书笔记草稿.md']);
    expect(listInbox(env, 'arsenal')).toEqual([]);
  });
});

describe('路径安全', () => {
  it('拒绝绝对路径、..、反斜杠和 NUL', () => {
    expect(normalizeRelPath('/a/b/')).toBe('a/b');
    for (const bad of ['../x', 'a/../../x', 'a\\b', 'a\0b', 'C:/x']) {
      expect(codeOf(() => normalizeRelPath(bad)), bad).toBe('invalid_path');
    }
    expect(codeOf(() => readLibraryFile(env, 'personal', '../Shuyun/SalesOS/Arsenal/README.md'))).toBe('invalid_path');
  });

  it('不跟随指向库外的软链', () => {
    const root = tempDir();
    const outside = tempDir();
    writeFileSync(join(outside, 'secret.md'), '# 库外\n');
    symlinkSync(join(outside, 'secret.md'), join(root, 'link.md'));
    const linked: KnowledgeEnv = { home: root, libraries: [{ id: 'l', name: 'L', root, writable: false }] };
    expect(codeOf(() => readLibraryFile(linked, 'l', 'link.md'))).toBe('invalid_path');
  });
});

describe('遍历', () => {
  it('列出全部 Markdown，并标出所在区域和主题', () => {
    const files = walkLibrary(env, 'personal');
    const byPath = new Map(files.map((file) => [file.path, file]));
    expect(byPath.get('Knowledge_Index.md')).toMatchObject({ area: 'root', topicPath: null });
    expect(byPath.get('_Inbox/2026-10-20-读书笔记草稿.md')).toMatchObject({ area: 'inbox' });
    expect(byPath.get('_Templates/Topic_README_Template.md')).toMatchObject({ area: 'templates' });
    expect(byPath.get('02_职业与业务/售前方法/客户研究清单.md')).toMatchObject({ area: 'topic', topicPath: '02_职业与业务/售前方法' });
    expect(byPath.get('02_职业与业务/售前方法/_Archive/客户研究清单_v1.md')).toMatchObject({ area: 'archive', topicPath: '02_职业与业务/售前方法' });
    expect(byPath.get('99_Archive/旧主题/README.md')).toMatchObject({ area: 'archive' });
    expect(files.some((file) => file.path.endsWith('.pptx'))).toBe(false);
  });

  it('区域分类', () => {
    expect(classifyPath('README.md')).toEqual({ area: 'root', topicPath: null });
    expect(classifyPath('01_a/README.md')).toEqual({ area: 'category', topicPath: null });
    expect(classifyPath('01_a/t/sub/x.md')).toEqual({ area: 'topic', topicPath: '01_a/t' });
    expect(classifyPath('99_Archive/t/x.md')).toEqual({ area: 'archive', topicPath: '99_Archive/t' });
  });
});
