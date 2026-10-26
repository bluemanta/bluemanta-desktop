import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { renderKnowledgeRead, renderKnowledgeRoute, renderKnowledgeSearch } from '@bluemanta/cli/knowledge-tools';
import { describe, expect, it } from 'vitest';
import {
  KNOWLEDGE_PANEL_ID,
  KNOWLEDGE_READ_NAME,
  KNOWLEDGE_ROUTE_NAME,
  KNOWLEDGE_SEARCH_NAME,
  KNOWLEDGE_TAB_KIND,
  knowledgeFrameName,
  knowledgeFrameUrl,
  knowledgeParams,
  knowledgeToolCard,
  knowledgeWebPath,
  openKnowledgeTab,
} from '../src/knowledge-sidebar.js';

describe('知识 tab 地址与框名', () => {
  it('导航参数只认字符串，kind 只认 topic / file', () => {
    expect(knowledgeParams({ params: { library: ' arsenal ', path: '01_a/b', kind: 'topic', title: '会员' } })).toEqual({
      library: 'arsenal',
      path: '01_a/b',
      kind: 'topic',
      title: '会员',
    });
    expect(knowledgeParams({ params: { library: 1, kind: 'x' } })).toEqual({ library: '', path: '', kind: '', title: '' });
    expect(knowledgeParams(null)).toEqual({ library: '', path: '', kind: '', title: '' });
  });

  it('网页路径按段编码，去掉 .. 和空段；库 id 不合法时回主题页', () => {
    expect(knowledgeWebPath({ library: 'arsenal', path: '01_业务主题/会员体系', kind: 'topic' })).toBe(
      '/knowledge/lib/arsenal/topic/01_%E4%B8%9A%E5%8A%A1%E4%B8%BB%E9%A2%98/%E4%BC%9A%E5%91%98%E4%BD%93%E7%B3%BB',
    );
    expect(knowledgeWebPath({ library: 'personal', path: '../a//b.md' })).toBe('/knowledge/lib/personal/file/a/b.md');
    expect(knowledgeWebPath({ library: 'Bad Lib', path: 'a.md' })).toBe('/knowledge');
    expect(knowledgeWebPath({})).toBe('/knowledge');
  });

  it('嵌入地址带模式、口令和父窗口 origin；只接受 /knowledge 开头的路径', () => {
    expect(knowledgeFrameUrl('http://127.0.0.1:4310/', 't k', 'dsh-app://app', 'sidebar', '/knowledge/lib/a/file/x.md')).toBe(
      'http://127.0.0.1:4310/knowledge/lib/a/file/x.md?embed=sidebar#token=t%20k&parent=dsh-app%3A%2F%2Fapp',
    );
    expect(knowledgeFrameUrl('http://127.0.0.1:4310', 't', 'o', 'main', '/ideas')).toBe('http://127.0.0.1:4310/knowledge?embed=main#token=t&parent=o');
    expect(knowledgeFrameUrl('not a url', 't', 'o', 'main', '/knowledge')).toBe('');
  });

  it('框名与灵感台分开，不同 tab 不同名', () => {
    expect(knowledgeFrameName('main')).toBe('bluemanta-knowledge-main');
    expect(knowledgeFrameName('sidebar', 'tab-1')).toBe('bluemanta-knowledge-sidebar-tab-1');
    expect(knowledgeFrameName('sidebar', 'a/b')).not.toBe(knowledgeFrameName('sidebar', 'a_b'));
  });

  it('有右侧栏时开 tab，没有时返回 false 不抛错', () => {
    const opened: unknown[] = [];
    const sidebar = { mounted: { getSnapshot: () => 'session-1' }, openTab: (kind: string, options: unknown) => opened.push([kind, options]) };
    expect(openKnowledgeTab(sidebar, { library: 'personal', path: 'a.md', kind: 'file' })).toBe(true);
    expect(opened).toEqual([[KNOWLEDGE_TAB_KIND, { params: { library: 'personal', path: 'a.md', kind: 'file' } }]]);
    expect(openKnowledgeTab({ mounted: { getSnapshot: () => undefined }, openTab: () => { throw new Error('不应打开'); } }, {})).toBe(false);
    expect(openKnowledgeTab({ mounted: { getSnapshot: () => { throw new Error('boom'); } } }, {})).toBe(false);
    expect(openKnowledgeTab(null, {})).toBe(false);
  });
});

describe('知识工具卡片解析 cli 的输出文字', () => {
  it('进行中与失败', () => {
    expect(knowledgeToolCard(KNOWLEDGE_SEARCH_NAME, 'start', null, '', false)).toEqual({ kind: 'pending', label: '正在搜索知识库…' });
    expect(knowledgeToolCard(KNOWLEDGE_READ_NAME, 'result', null, renderKnowledgeRead({ ok: false, error: '路径不能越出库目录' }), false)).toEqual({
      kind: 'error',
      message: '路径不能越出库目录',
    });
    expect(knowledgeToolCard(KNOWLEDGE_ROUTE_NAME, 'result', null, 'boom', true)).toEqual({ kind: 'error', message: 'boom' });
  });

  it('路由', () => {
    const text = renderKnowledgeRoute({
      ok: true,
      query: 'Loyalty',
      candidates: [{ library: 'arsenal', topicPath: '01_业务主题/会员体系', name: '会员体系', category: '01_业务主题', matched: ['Loyalty', '会员'], readOrder: ['01_业务主题/会员体系/README.md'] }],
    });
    expect(knowledgeToolCard(KNOWLEDGE_ROUTE_NAME, 'result', null, text, false)).toEqual({
      kind: 'route',
      empty: false,
      items: [{ name: '会员体系', library: 'arsenal', path: '01_业务主题/会员体系', matched: 'Loyalty、会员' }],
    });
    expect(knowledgeToolCard(KNOWLEDGE_ROUTE_NAME, 'result', null, renderKnowledgeRoute({ ok: true, query: 'x', candidates: [] }), false)).toEqual({
      kind: 'route',
      items: [],
      empty: true,
    });
  });

  it('搜索：库内结果和灵感结果', () => {
    const text = renderKnowledgeSearch({
      ok: true,
      query: '会员',
      keywords: ['会员'],
      count: 2,
      items: [
        { source: 'library', library: 'personal', path: '02_a/售前方法/Topic_Knowledge.md', ideaId: '', title: '售前方法 Topic Knowledge', headings: ['核心观点'], topic: '售前方法', archived: true, excerpt: '会员 分层\n第二行' },
        { source: 'idea', library: '', path: '', ideaId: 'card_1', title: '会员分层的新想法', headings: [], topic: '', archived: false, excerpt: '按最近消费' },
      ],
    });
    expect(knowledgeToolCard(KNOWLEDGE_SEARCH_NAME, 'result', null, text, false)).toEqual({
      kind: 'search',
      empty: false,
      items: [
        { source: 'library', title: '售前方法 Topic Knowledge › 核心观点', ideaId: '', library: 'personal', path: '02_a/售前方法/Topic_Knowledge.md', excerpt: '会员 分层 第二行' },
        { source: 'idea', title: '会员分层的新想法', ideaId: 'card_1', library: '', path: '', excerpt: '按最近消费' },
      ],
    });
    expect(knowledgeToolCard(KNOWLEDGE_SEARCH_NAME, 'result', null, renderKnowledgeSearch({ ok: true, query: 'x', keywords: ['x'], count: 0, items: [] }), false)).toEqual({
      kind: 'search',
      items: [],
      empty: true,
    });
  });

  it('读取：文件和主题', () => {
    const file = renderKnowledgeRead({ ok: true, library: 'arsenal', path: '01_业务主题/会员体系/Topic_Knowledge.md', kind: 'markdown', displayPath: '~/x', content: '# 正文', offset: 0, nextOffset: null, files: [] });
    expect(knowledgeToolCard(KNOWLEDGE_READ_NAME, 'result', null, file, false)).toEqual({
      kind: 'read',
      library: 'arsenal',
      path: '01_业务主题/会员体系/Topic_Knowledge.md',
      topic: false,
      title: 'Topic_Knowledge.md',
    });
    const topic = renderKnowledgeRead({ ok: true, library: 'personal', path: '02_a/售前方法', kind: 'topic', displayPath: '~/y', content: '# 售前', offset: 0, nextOffset: null, files: ['02_a/售前方法/README.md'] });
    expect(knowledgeToolCard(KNOWLEDGE_READ_NAME, 'result', null, topic, false)).toMatchObject({ kind: 'read', topic: true, title: '售前方法' });
  });
});

describe('client.js', () => {
  it('内嵌同一份纯函数，注册知识台入口、右侧栏知识 tab 和三个工具卡片', () => {
    const root = fileURLToPath(new URL('..', import.meta.url));
    const library = readFileSync(root + 'src/knowledge-sidebar.js', 'utf8').replace(/^export /gm, '');
    const client = readFileSync(root + 'client.js', 'utf8');
    const normalized = (value: string) => value.replace(/\s+/g, ' ').trim();
    expect(normalized(client).includes(normalized(library))).toBe(true);
    expect(client).toContain("id: KNOWLEDGE_PANEL_ID, order: 11, label: '知识台'");
    expect(client).toContain('kind: KNOWLEDGE_TAB_KIND');
    expect(client).toContain('for (const name of [KNOWLEDGE_ROUTE_NAME, KNOWLEDGE_SEARCH_NAME, KNOWLEDGE_READ_NAME])');
    expect(client).toContain('...(path ? { name: knowledgeFrameName(embed, tabId) } : {})');
    expect(KNOWLEDGE_PANEL_ID).toBe('bluemanta.knowledge');
  });
});
