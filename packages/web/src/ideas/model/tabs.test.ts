import { describe, expect, it } from 'vitest';
import { closeTab, openTab } from './tabs';

describe('详情标签', () => {
  it('最多 6 个，超出时关闭最早打开且没有未保存修改的', () => {
    let tabs: string[] = [];
    for (const id of ['a', 'b', 'c', 'd', 'e', 'f']) tabs = openTab(tabs, id).tabs;
    expect(openTab(tabs, 'c')).toEqual({ tabs: ['a', 'b', 'c', 'd', 'e', 'f'], opened: true });
    expect(openTab(tabs, 'g')).toEqual({ tabs: ['b', 'c', 'd', 'e', 'f', 'g'], opened: true });
    const dirty = new Set(['a', 'b', 'c', 'd', 'e', 'f']);
    expect(openTab(tabs, 'g', 6, dirty)).toEqual({ tabs, opened: false });
    expect(openTab(tabs, 'g', 6, new Set(['a', 'b']))).toEqual({ tabs: ['a', 'b', 'd', 'e', 'f', 'g'], opened: true });
  });

  it('关闭后切到右边的邻居，没有就左边', () => {
    expect(closeTab(['a', 'b', 'c'], 'b')).toEqual({ tabs: ['a', 'c'], neighbor: 'c' });
    expect(closeTab(['a', 'b', 'c'], 'c')).toEqual({ tabs: ['a', 'b'], neighbor: 'b' });
    expect(closeTab(['a'], 'a')).toEqual({ tabs: [], neighbor: null });
  });
});
