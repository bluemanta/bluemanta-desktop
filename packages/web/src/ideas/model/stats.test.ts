import { describe, expect, it } from 'vitest';
import { heatLevel, HEAT_ROWS, HEAT_WEEKS, summarize } from './stats';

// 2026-10-11 10:30 上海时间
const NOW = Date.parse('2026-10-11T02:30:00Z');

function idea(createdAt: string, extras: { starred?: boolean; category?: 'product' | 'work' | 'life' | 'learning' | 'other' } = {}) {
  return { createdAt, starred: extras.starred ?? false, category: extras.category ?? 'other' };
}

describe('统计', () => {
  it('上海时区边界：UTC 16:00 前后落在不同自然日', () => {
    const summary = summarize(
      [idea('2026-10-10T15:59:00Z'), idea('2026-10-10T16:00:00Z', { starred: true, category: 'product' })],
      NOW,
    );
    expect(summary.days).toHaveLength(HEAT_WEEKS * HEAT_ROWS);
    expect(summary.days.at(-1)?.label).toBe('10月11日');
    expect(summary.days.find((cell) => cell.label === '10月10日')?.count).toBe(1);
    expect(summary.days.find((cell) => cell.label === '10月11日')?.count).toBe(1);
    expect(summary.week).toBe(2);
    expect(summary.month).toBe(2);
    expect(summary.starred).toBe(1);
    expect(summary.categories.find((category) => category.id === 'product')?.count).toBe(1);
  });

  it('近 7 天含今天、不含第 8 天；近 30 天同样按自然日', () => {
    const summary = summarize(
      [
        idea('2026-10-11T01:00:00Z'),
        idea('2026-10-05T00:00:00Z'),
        idea('2026-10-04T16:00:00Z'),
        idea('2026-09-12T00:00:00Z'),
        idea('2026-09-11T00:00:00Z'),
      ],
      NOW,
    );
    // 10-05 00:00Z = 10月5日 08:00 上海，距 10月11日 6 天，算近 7 天
    // 10-04 16:00Z = 10月5日 00:00 上海，同一天
    // 9月12日距 10月11日 29 天，算近 30 天；9月11日是第 30 天，不算
    expect(summary.week).toBe(3);
    expect(summary.month).toBe(4);
    expect(summary.total).toBe(5);
  });

  it('颜色 4 档，悬停文案用月日', () => {
    expect(heatLevel(0)).toBe(0);
    expect(heatLevel(1)).toBe(1);
    expect(heatLevel(2)).toBe(2);
    expect(heatLevel(3)).toBe(3);
    expect(heatLevel(8)).toBe(3);
    const cell = summarize([idea('2026-10-09T02:00:00Z'), idea('2026-10-09T03:00:00Z'), idea('2026-10-09T04:00:00Z')], NOW).days.find(
      (item) => item.label === '10月9日',
    );
    expect(cell?.count).toBe(3);
    expect(cell?.level).toBe(3);
    expect(`${cell?.label} · ${cell?.count} 条`).toBe('10月9日 · 3 条');
  });

  it('始终是 26 周，今天在最后一格', () => {
    const days = summarize([idea('2026-10-11T01:00:00Z')], NOW).days;
    expect(days).toHaveLength(HEAT_WEEKS * HEAT_ROWS);
    expect(days.at(-1)?.label).toBe('10月11日');
    expect(days.at(-1)?.count).toBe(1);
  });
});
