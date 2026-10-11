import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { renderCapture, renderGet, renderSearch } from '../src/idea-tools.js';
import {
  IDEA_CAPTURE_NAME,
  IDEA_GET_NAME,
  IDEA_SEARCH_NAME,
  IDEA_TAB_ID,
  IDEA_TAB_KIND,
  ideaParams,
  ideaToolCard,
  openIdeaTab,
  parseToolArgs,
  planRailClaim,
  planRailClose,
  planRailOpen,
  sidebarIsMounted,
  subscribeSidebarMounted,
  tabIsOpen,
  toolResultText,
} from '../src/idea-sidebar.js';

function sidebar(snapshot: unknown, openTab?: (kind: string, options: unknown) => void) {
  return {
    mounted: {
      getSnapshot: () => snapshot,
      subscribe: (listener: () => void) => {
        listener();
        return () => undefined;
      },
    },
    openTab,
  };
}

describe('右侧栏是否存在', () => {
  it('没有 mounted 会话时不调用 openTab，调用方抛错时也不再抛出', () => {
    expect(sidebarIsMounted(null)).toBe(false);
    expect(sidebarIsMounted({})).toBe(false);
    expect(sidebarIsMounted({ mounted: { getSnapshot: () => undefined } })).toBe(false);
    expect(sidebarIsMounted({ mounted: { getSnapshot: () => '' } })).toBe(false);
    expect(sidebarIsMounted({ mounted: { getSnapshot: () => { throw new Error('boom'); } } })).toBe(false);

    const hidden = sidebar(undefined, () => { throw new Error('不应打开'); });
    expect(openIdeaTab(hidden, { id: 'card_1', title: '标题' })).toBe(false);
    expect(openIdeaTab(sidebar('session-1'), { id: '  ' })).toBe(false);

    const calls: unknown[] = [];
    const visible = sidebar('session-1', (kind, options) => { calls.push({ kind, options }); });
    expect(openIdeaTab(visible, { id: ' card_1 ', title: ' 海边 ' })).toBe(true);
    expect(calls).toEqual([{ kind: IDEA_TAB_KIND, options: { params: { id: 'card_1', title: '海边' } } }]);

    const throwing = sidebar('session-1', () => { throw new Error('surface'); });
    expect(openIdeaTab(throwing, { id: 'card_1' })).toBe(false);

    let seen = 0;
    const stop = subscribeSidebarMounted(visible, () => { seen += 1; });
    expect(seen).toBe(1);
    stop();
    expect(subscribeSidebarMounted(null, () => undefined)).toBeTypeOf('function');
  });

  it('从导航参数读出灵感 id', () => {
    expect(ideaParams(undefined)).toEqual({ id: '', title: '' });
    expect(ideaParams({ params: { id: ' card_9 ', title: ' 标题 ' } })).toEqual({ id: 'card_9', title: '标题' });
    expect(ideaParams({ params: { id: 1 } })).toEqual({ id: '', title: '' });
  });
});

describe('对话工具卡片', () => {
  it('记录成功显示标题和分类，失败与进行中不带打开目标', () => {
    const ok = renderCapture({ ok: true, id: 'card_01', title: '带」号', category: '产品想法', fallbackTitle: false });
    expect(ideaToolCard(IDEA_CAPTURE_NAME, 'result', null, ok, false)).toEqual({
      kind: 'capture',
      title: '带」号',
      category: '产品想法',
      id: 'card_01',
    });
    const fallback = renderCapture({ ok: true, id: 'card_02', title: '兜底标题', category: '其他', fallbackTitle: true });
    expect(ideaToolCard(IDEA_CAPTURE_NAME, 'result', null, fallback, false)).toMatchObject({
      kind: 'capture',
      title: '兜底标题',
      category: '其他',
      id: 'card_02',
    });
    const failed = renderCapture({ ok: false, error: '标题和正文都是空的' });
    expect(ideaToolCard(IDEA_CAPTURE_NAME, 'result', null, failed, false)).toEqual({
      kind: 'error',
      message: '标题和正文都是空的',
    });
    expect(ideaToolCard(IDEA_CAPTURE_NAME, 'start', null, '', false)).toEqual({
      kind: 'pending',
      label: '正在记下灵感…',
    });
  });

  it('查找列出每条命中，空结果与非法文本分开', () => {
    const found = renderSearch({
      ok: true,
      count: 1,
      limit: 10,
      message: '',
      items: [{
        id: 'card_03',
        title: '带」的标题',
        category: '学习备忘',
        createdAt: '2026-10-10',
        field: 'body',
        excerpt: '第一行\n第二行',
      }],
    });
    expect(ideaToolCard(IDEA_SEARCH_NAME, 'result', null, found, false)).toEqual({
      kind: 'search',
      empty: false,
      items: [{
        id: 'card_03',
        title: '带」的标题',
        category: '学习备忘',
        date: '2026-10-10',
        excerpt: '第一行\n第二行',
      }],
    });
    const empty = renderSearch({ ok: true, count: 0, limit: 10, message: '没有找到', items: [] });
    expect(ideaToolCard(IDEA_SEARCH_NAME, 'result', null, empty, false)).toEqual({
      kind: 'search',
      items: [],
      empty: true,
    });
    expect(ideaToolCard(IDEA_SEARCH_NAME, 'result', null, 'query 不能为空', false)).toMatchObject({ kind: 'error' });
  });

  it('读取显示标题和摘要，id 来自参数', () => {
    const body = '甲'.repeat(130);
    const got = renderGet({
      ok: true,
      id: 'card_04',
      title: '海边',
      body: '第一行\n' + body,
      category: '生活随想',
      starred: false,
      createdAt: '2026-10-10T01:02:03.000Z',
      createdAtLocal: '2026-10-10 09:02',
      inTrash: true,
      notice: '在回收站中',
      extensions: [],
      rawInput: { status: 'legacy', note: '无原文' },
    });
    const card = ideaToolCard(IDEA_GET_NAME, 'result', { id: 'card_04' }, got, false);
    expect(card).toMatchObject({ kind: 'get', id: 'card_04', title: '海边' });
    if (card.kind !== 'get') throw new Error('expected get');
    expect(card.excerpt.endsWith('…')).toBe(true);
    expect(Array.from(card.excerpt).length).toBe(121);
    expect(ideaToolCard(IDEA_GET_NAME, 'result', { id: 'card_04' }, '没有找到这条灵感', false)).toEqual({
      kind: 'error',
      message: '没有找到这条灵感',
    });
    expect(ideaToolCard(IDEA_GET_NAME, 'result', { id: 'card_04' }, got, true)).toMatchObject({ kind: 'error' });
  });

  it('从工具结果块取出文本，参数不是对象时丢掉', () => {
    expect(toolResultText({ content: [{ type: 'text', text: '已记下' }, { type: 'image' }] })).toBe('已记下');
    expect(toolResultText(null)).toBe('');
    expect(parseToolArgs('{"id":"card_1"}')).toEqual({ id: 'card_1' });
    expect(parseToolArgs('[1]')).toBeNull();
    expect(parseToolArgs('not-json')).toBeNull();
  });
});

describe('右侧栏不重复打开', () => {
  const open = [
    { sessionId: 'session-1', tabId: 'tab-list', kind: 'bluemanta.idea', contentId: 'sidebar://bluemanta.idea/list' },
    { sessionId: 'session-1', tabId: 'tab-idea', kind: 'bluemanta.idea', contentId: 'sidebar://bluemanta.idea/1' },
    { sessionId: 'session-2', tabId: 'tab-other', kind: 'bluemanta.idea', contentId: 'sidebar://bluemanta.idea/2' },
  ];

  it('已打开的标签聚焦，没有则新开；别的会话里的不算', () => {
    expect(tabIsOpen(open, 'session-1', 'tab-idea')).toBe(true);
    expect(tabIsOpen(open, 'session-1', 'tab-other')).toBe(false);
    expect(planRailOpen('tab-idea', open, 'session-1')).toEqual({ action: 'focus', tabId: 'tab-idea' });
    expect(planRailOpen('', open, 'session-1')).toEqual({ action: 'open' });
    expect(planRailOpen('tab-other', open, 'session-1')).toEqual({ action: 'open' });
  });

  it('后打开的重复标签让位，精简列表同样只留已有的一个', () => {
    expect(planRailClaim('tab-list', open, 'session-1', 'tab-new')).toEqual({
      action: 'focus-existing',
      tabId: 'tab-list',
    });
    expect(planRailClaim('', open, 'session-1', 'tab-new')).toEqual({ action: 'keep', tabId: 'tab-new' });
    expect(planRailClaim('tab-list', open, 'session-1', 'tab-list')).toEqual({ action: 'keep', tabId: 'tab-list' });
  });

  it('未保存时拦截关闭，已经确认过则放行', () => {
    expect(planRailClose(null)).toBe('allow');
    expect(planRailClose({ dirty: false, allow: false })).toBe('allow');
    expect(planRailClose({ dirty: true, allow: false })).toBe('confirm');
    expect(planRailClose({ dirty: true, allow: true })).toBe('allow');
  });
});

describe('浏览器端注册', () => {
  it('client.js 含有同一份纯函数，并注册右侧栏与工具卡片', () => {
    const root = fileURLToPath(new URL('..', import.meta.url));
    const library = readFileSync(root + 'src/idea-sidebar.js', 'utf8').replace(/^export /gm, '');
    const client = readFileSync(root + 'client.js', 'utf8');
    const normalized = (value: string) => value.replace(/\s+/g, ' ').trim();
    expect(normalized(client).includes(normalized(library))).toBe(true);
    expect(client).toContain('ctx.sidebarRightTabs.register');
    expect(client).toContain('sidebar.right.pane.tab');
    expect(client).toContain('tool.call.toolview');
    expect(client).toContain(IDEA_TAB_ID);
    expect(client).toContain(IDEA_CAPTURE_NAME);
    expect(client).toContain(IDEA_SEARCH_NAME);
    expect(client).toContain(IDEA_GET_NAME);
    expect(client).toContain('灵感台');
    expect(client).toContain('已记录灵感：');
    expect(client).toContain('ctx.sidebarRight.mounted');
    expect(client).toContain("inject: ['slots', 'sidebarRightTabs', 'sidebarRight']");
  });
});
