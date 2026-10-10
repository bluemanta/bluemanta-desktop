import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  CREATE_TAB_ID,
  LIST_WIDTH_DEFAULT,
  LIST_WIDTH_KEY,
  LIST_WIDTH_MIN,
  TAB_LIMIT_MESSAGE,
  clampListWidth,
  planCloseTab,
  planOpenTab,
  planReplaceCreate,
  readStoredListWidth,
  writeStoredListWidth,
} from '../src/idea-layout.js';

function tab(id: string, openedAt: number, dirty = false) {
  return { id, kind: 'detail' as const, dirty, openedAt, generation: 0 };
}

describe('列表宽度', () => {
  it('默认 380，最小 280，最大为主区域的 60%', () => {
    expect(clampListWidth(Number.NaN, 1000)).toBe(LIST_WIDTH_DEFAULT);
    expect(clampListWidth(100, 1000)).toBe(LIST_WIDTH_MIN);
    expect(clampListWidth(900, 1000)).toBe(600);
    expect(clampListWidth(400, 900)).toBe(400);
    expect(clampListWidth(500, 821)).toBe(492);
  });

  it('从本机读出偏好，无效时回到默认；写入只存数字', () => {
    const bag = new Map<string, string>();
    const storage = {
      getItem: (key: string) => bag.get(key) ?? null,
      setItem: (key: string, value: string) => { bag.set(key, value); },
    };
    expect(readStoredListWidth(storage)).toBe(LIST_WIDTH_DEFAULT);
    writeStoredListWidth(storage, 412.4);
    expect(bag.get(LIST_WIDTH_KEY)).toBe('412');
    expect(readStoredListWidth(storage)).toBe(412);
    bag.set(LIST_WIDTH_KEY, 'nope');
    expect(readStoredListWidth(storage)).toBe(LIST_WIDTH_DEFAULT);
    expect(readStoredListWidth(null)).toBe(LIST_WIDTH_DEFAULT);
    writeStoredListWidth({ setItem() { throw new Error('denied'); } }, 380);
  });
});

describe('详情 tab', () => {
  it('已打开则切换，未满则新开', () => {
    const tabs = [tab('card_a', 1)];
    expect(planOpenTab(tabs, { id: 'card_a', kind: 'detail', openedAt: 9 }).activeId).toBe('card_a');
    expect(planOpenTab(tabs, { id: 'card_a', kind: 'detail', openedAt: 9 }).tabs).toBe(tabs);
    const opened = planOpenTab(tabs, { id: 'card_b', kind: 'detail', openedAt: 2 });
    expect(opened.activeId).toBe('card_b');
    expect(opened.tabs.map((item) => item.id)).toEqual(['card_a', 'card_b']);
    expect(opened.blocked).toBe(false);
  });

  it('满 8 个时关掉最早打开且没有未保存修改的，都改过则不再新开', () => {
    const tabs = Array.from({ length: 8 }, (_, index) => tab('card_' + index, index + 1, index === 0 || index === 2));
    const opened = planOpenTab(tabs, { id: 'card_new', kind: 'detail', openedAt: 20 });
    expect(opened.blocked).toBe(false);
    expect(opened.droppedId).toBe('card_1');
    expect(opened.activeId).toBe('card_new');
    expect(opened.tabs).toHaveLength(8);
    expect(opened.tabs.some((item) => item.id === 'card_0')).toBe(true);

    const dirty = tabs.map((item) => ({ ...item, dirty: true }));
    const blocked = planOpenTab(dirty, { id: 'card_new', kind: 'detail', openedAt: 20 });
    expect(blocked.blocked).toBe(true);
    expect(blocked.tabs).toBe(dirty);
    expect(blocked.activeId).toBeNull();
    expect(TAB_LIMIT_MESSAGE).toContain('8');
  });

  it('关闭当前 tab 时切到相邻，关闭其它 tab 时保持当前', () => {
    const tabs = [tab('card_a', 1), tab('card_b', 2), tab('card_c', 3)];
    expect(planCloseTab(tabs, 'card_b', 'card_b')).toMatchObject({ activeId: 'card_c' });
    expect(planCloseTab(tabs, 'card_c', 'card_c').activeId).toBe('card_b');
    expect(planCloseTab(tabs, 'card_b', 'card_a').activeId).toBe('card_b');
    expect(planCloseTab(tabs, 'card_a', 'missing')).toMatchObject({ tabs, activeId: 'card_a' });
  });

  it('新增 tab 保存后变成这条灵感的详情 tab', () => {
    const tabs = [tab('card_a', 1), { id: CREATE_TAB_ID, kind: 'create' as const, dirty: true, openedAt: 2, generation: 3 }];
    const next = planReplaceCreate(tabs, CREATE_TAB_ID, 'card_new');
    expect(next.activeId).toBe('card_new');
    expect(next.tabs[1]).toMatchObject({ id: 'card_new', kind: 'detail', dirty: false, openedAt: 2, generation: 0 });
    expect(planReplaceCreate([tab('card_a', 1)], 'card_a', 'card_new').tabs).toHaveLength(1);
  });
});

describe('浏览器端内嵌布局函数', () => {
  it('client.js 含有同一份布局函数，并且浮层不挂到 body', () => {
    const root = fileURLToPath(new URL('..', import.meta.url));
    const library = readFileSync(root + 'src/idea-layout.js', 'utf8').replace(/^export /gm, '');
    const client = readFileSync(root + 'client.js', 'utf8');
    const normalized = (value: string) => value.replace(/\s+/g, ' ').trim();
    expect(normalized(client).includes(normalized(library))).toBe(true);
    expect(client).toContain('function IdeaDetail');
    expect(client).toContain('function IdeaCreate');
    expect(client).toContain('选一条灵感查看');
    expect(client).toContain('← 返回');
    expect(client).toContain('有未保存的修改。确定离开？');
    expect(client).not.toContain('bm-drawer');
    expect(client).not.toContain('bm-mask');
    expect(client).not.toContain('document.body');
  });
});
