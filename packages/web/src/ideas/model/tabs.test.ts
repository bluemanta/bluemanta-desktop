import { describe, expect, it } from 'vitest';
import { closeTab, openTab } from './tabs';

describe('详情标签', () => {
  it('最多 6 个，超出时关闭最早打开的', () => {
    let tabs: string[] = [];
    for (const id of ['a', 'b', 'c', 'd', 'e', 'f']) tabs = openTab(tabs, id);
    expect(openTab(tabs, 'c')).toEqual(['a', 'b', 'c', 'd', 'e', 'f']);
    expect(openTab(tabs, 'g')).toEqual(['b', 'c', 'd', 'e', 'f', 'g']);
  });

  it('关闭后切到右边的邻居，没有就左边', () => {
    expect(closeTab(['a', 'b', 'c'], 'b')).toEqual({ tabs: ['a', 'c'], neighbor: 'c' });
    expect(closeTab(['a', 'b', 'c'], 'c')).toEqual({ tabs: ['a', 'b'], neighbor: 'b' });
    expect(closeTab(['a'], 'a')).toEqual({ tabs: [], neighbor: null });
  });
});
