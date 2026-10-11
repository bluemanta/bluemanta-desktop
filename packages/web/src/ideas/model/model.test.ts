import type { IdeaListItem } from '@bluemanta/server/api-types';
import { describe, expect, it } from 'vitest';
import { highlightSegments, searchTerms } from './highlight';
import { applyFilters, buildSections, displayTitle, excerptOf, matchLabel } from './listing';
import { sourceLabel } from './sources';
import { dayGroup, formatFullTime, formatListTime, shanghaiDayNumber } from './time';

// 2026-10-11 10:30 上海时间
const NOW = Date.parse('2026-10-11T02:30:00Z');

function item(overrides: Partial<IdeaListItem>): IdeaListItem {
  return {
    id: 'card_x',
    rev: 1,
    createdAt: '2026-10-11T01:00:00Z',
    updatedAt: '2026-10-11T01:00:00Z',
    createdBy: { kind: 'human', name: 'desktop' },
    updatedBy: { kind: 'human', name: 'desktop' },
    deletedAt: null,
    title: '虚构标题',
    titleOrigin: 'user',
    body: '虚构正文',
    rawInput: { status: 'legacy' },
    showRaw: false,
    starred: false,
    tags: [],
    category: 'other',
    categorySource: 'auto',
    captureGroupId: null,
    extensions: [],
    attachmentIds: [],
    attachments: [],
    edited: false,
    ...overrides,
  };
}

describe('上海时区', () => {
  it('按上海自然日分组：UTC 前一天 16:00 之后已是上海的今天', () => {
    expect(dayGroup('2026-10-10T16:00:00Z', NOW)).toBe('today');
    expect(dayGroup('2026-10-10T15:59:00Z', NOW)).toBe('yesterday');
    expect(dayGroup('2026-10-05T12:00:00Z', NOW)).toBe('week');
    expect(dayGroup('2026-10-04T12:00:00Z', NOW)).toBe('earlier');
  });

  it('列表时间：今天和昨天显示时刻，更早显示日期，跨年带年份', () => {
    expect(formatListTime('2026-10-11T01:05:00Z', NOW)).toBe('09:05');
    expect(formatListTime('2026-10-10T06:05:00Z', NOW)).toBe('14:05');
    expect(formatListTime('2026-10-03T06:05:00Z', NOW)).toBe('10月3日');
    expect(formatListTime('2025-12-31T06:05:00Z', NOW)).toBe('2025年12月31日');
  });

  it('完整时间', () => {
    expect(formatFullTime('2026-10-10T16:42:00Z')).toBe('2026-10-11 00:42');
  });
});

describe('筛选与分组', () => {
  const items = [
    item({ id: 'a', category: 'product', starred: true }),
    item({ id: 'b', category: 'work' }),
    item({ id: 'c', category: 'life', starred: true, createdAt: '2026-10-09T01:00:00Z' }),
  ];

  it('收藏与分类叠加，分类之间是或', () => {
    expect(applyFilters(items, { starredOnly: true, categories: new Set(), day: null }).map((x) => x.id)).toEqual(['a', 'c']);
    expect(applyFilters(items, { starredOnly: false, categories: new Set(['work', 'life']), day: null }).map((x) => x.id)).toEqual(['b', 'c']);
    expect(applyFilters(items, { starredOnly: true, categories: new Set(['work', 'life']), day: null }).map((x) => x.id)).toEqual(['c']);
    const day = shanghaiDayNumber(Date.parse('2026-10-09T01:00:00Z'));
    expect(applyFilters(items, { starredOnly: true, categories: new Set(), day }).map((x) => x.id)).toEqual(['c']);
  });

  it('按日期分组，搜索时只有一组', () => {
    expect(buildSections(items, false, NOW).map((s) => [s.label, s.items.length])).toEqual([
      ['今天', 2],
      ['本周', 1],
    ]);
    expect(buildSections(items, true, NOW).map((s) => [s.label, s.items.length])).toEqual([['搜索结果', 3]]);
    expect(buildSections([], false, NOW)).toEqual([]);
    const serverOrder = [item({ id: 'old', createdAt: '2026-10-11T00:00:00Z' }), item({ id: 'new', createdAt: '2026-10-11T02:00:00Z' })];
    expect(buildSections(serverOrder, false, NOW)[0]?.items.map((x) => x.id)).toEqual(['old', 'new']);
  });

  it('命中字段与摘要', () => {
    expect(matchLabel(item({ match: { field: 'title', excerpt: 't' } }))).toBeNull();
    expect(matchLabel(item({ match: { field: 'rawInput', excerpt: 'r' } }))).toBe('匹配原文');
    expect(excerptOf(item({ body: '正文\n  第二行', match: { field: 'body', excerpt: '…摘录…' } }))).toBe('…摘录…');
    expect(excerptOf(item({ body: '正文\n  第二行' }))).toBe('正文 第二行');
    expect(displayTitle('  ')).toBe('未命名灵感');
  });
});

describe('高亮', () => {
  it('多词、不区分大小写、长词优先', () => {
    expect(searchTerms(' MVP  mvp 产品 ')).toEqual(['mvp', '产品']);
    expect(highlightSegments('做一个 MVP 产品', 'mvp 产品')).toEqual([
      { text: '做一个 ', hit: false },
      { text: 'MVP', hit: true },
      { text: ' ', hit: false },
      { text: '产品', hit: true },
    ]);
    expect(highlightSegments('a.b', '.')).toEqual([
      { text: 'a', hit: false },
      { text: '.', hit: true },
      { text: 'b', hit: false },
    ]);
    expect(highlightSegments('无命中', '')).toEqual([{ text: '无命中', hit: false }]);
  });
});

describe('来源', () => {
  it('常见来源的短名', () => {
    expect(sourceLabel({ kind: 'agent', name: 'bot' })).toBe('Grok Bot');
    expect(sourceLabel({ kind: 'agent', name: 'dsh-agent' })).toBe('对话 agent');
    expect(sourceLabel({ kind: 'agent', name: 'mcp' })).toBe('MCP');
    expect(sourceLabel({ kind: 'human', name: 'desktop' })).toBe('灵感台');
    expect(sourceLabel({ kind: 'human', name: 'legacy_unknown' })).toBe('导入');
    expect(sourceLabel({ kind: 'agent', name: 'claude-code' })).toBe('claude-code');
  });
});
