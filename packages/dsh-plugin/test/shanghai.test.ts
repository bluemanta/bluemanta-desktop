import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  dayKey,
  formatDayLabel,
  heatmapWeeks,
  mondayKey,
  relativeTime,
  summarizeCounts,
} from '../src/shanghai.js';

const NOW = Date.parse('2026-10-10T03:00:00.000Z');

describe('上海时区', () => {
  it('按上海自然日取日期，周一为一周的开始', () => {
    expect(dayKey(Date.parse('2026-10-09T16:30:00.000Z'))).toBe('2026-10-10');
    expect(dayKey(Date.parse('2026-10-09T15:30:00.000Z'))).toBe('2026-10-09');
    expect(dayKey(NOW)).toBe('2026-10-10');
    expect(mondayKey(NOW)).toBe('2026-10-05');
  });

  it('相对时间：刚刚、分钟、小时、昨天、日期', () => {
    expect(relativeTime('2026-10-10T02:59:30.000Z', NOW)).toBe('刚刚');
    expect(relativeTime('2026-10-10T02:01:00.000Z', NOW)).toBe('59 分钟前');
    expect(relativeTime('2026-10-10T02:00:00.000Z', NOW)).toBe('1 小时前');
    expect(relativeTime('2026-10-10T01:00:00.000Z', NOW)).toBe('2 小时前');
    expect(relativeTime('2026-10-09T02:00:00.000Z', NOW)).toBe('昨天');
    expect(relativeTime('2026-10-08T02:00:00.000Z', NOW)).toBe('10月8日');
    expect(relativeTime('2025-12-01T02:00:00.000Z', NOW)).toBe('2025年12月1日');
    expect(formatDayLabel('2026-10-09', NOW)).toBe('10月9日');
  });

  it('汇总本周、本月和收藏，热力图约按周排列并标出未来空格', () => {
    const cards = [
      { createdAt: '2026-10-10T01:00:00.000Z', starred: true },
      { createdAt: '2026-10-05T02:00:00.000Z', starred: false },
      { createdAt: '2026-09-30T02:00:00.000Z', starred: true },
      { createdAt: '2026-10-08T02:00:00.000Z', starred: false },
    ];
    expect(summarizeCounts(cards, NOW)).toEqual({ all: 4, week: 3, month: 3, starred: 2 });

    const weeks = heatmapWeeks(cards, 2, NOW);
    expect(weeks).toHaveLength(2);
    expect(weeks[0]?.[0]?.key).toBe('2026-09-28');
    expect(weeks[1]?.[6]?.key).toBe('2026-10-11');
    expect(weeks[1]?.[6]?.future).toBe(true);
    expect(weeks[1]?.[5]).toMatchObject({ key: '2026-10-10', count: 1, future: false });
    expect(weeks.flat().find((day) => day.key === '2026-10-08')).toMatchObject({ count: 1 });
    expect(weeks.flat().find((day) => day.key === '2026-09-30')).toMatchObject({ count: 1 });
  });

  it('浏览器端内嵌了同一套日期函数', () => {
    const root = fileURLToPath(new URL('..', import.meta.url));
    const library = readFileSync(root + 'src/shanghai.js', 'utf8').replace(/^export /gm, '');
    const client = readFileSync(root + 'client.js', 'utf8');
    const normalized = (value: string) => value.replace(/\s+/g, ' ').trim();
    expect(normalized(client).includes(normalized(library))).toBe(true);
  });
});
