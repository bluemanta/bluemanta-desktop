import type { IdeaCategory } from '@bluemanta/server/api-types';
import { CATEGORIES } from './categories';
import { formatDayNumber, shanghaiDayNumber } from './time';

/** 近半年：26 周 × 7 天，结束于今天（上海自然日）。 */
export const HEAT_WEEKS = 26;
export const HEAT_ROWS = 7;

export type HeatLevel = 0 | 1 | 2 | 3;

/**
 * 数量分 4 档，对应原型的空 / l1 / l2 / l3。
 * 0 用悬停底，其余是主色由浅到深。
 */
export function heatLevel(count: number): HeatLevel {
  if (count <= 0) return 0;
  if (count === 1) return 1;
  if (count === 2) return 2;
  return 3;
}

export type DayCell = {
  day: number;
  count: number;
  label: string;
  level: HeatLevel;
};

export type StatsSummary = {
  total: number;
  week: number;
  month: number;
  starred: number;
  /** 最近 26 周，从早到晚；最后一格是今天。 */
  days: DayCell[];
  categories: { id: IdeaCategory; label: string; count: number }[];
};

type Counted = { createdAt: string; starred: boolean; category: IdeaCategory };

const WEEK_SPAN = 7;
const MONTH_SPAN = 30;

/** 用清单在网页端统计。近 7 / 30 天按上海自然日，含今天。 */
export function summarize(items: readonly Counted[], nowMs: number): StatsSummary {
  const today = shanghaiDayNumber(nowMs);
  const counts = new Map<number, number>();
  const byCategory = new Map<IdeaCategory, number>(CATEGORIES.map((category) => [category.id, 0]));
  let week = 0;
  let month = 0;
  let starred = 0;

  for (const item of items) {
    const day = shanghaiDayNumber(Date.parse(item.createdAt));
    if (Number.isFinite(day)) {
      counts.set(day, (counts.get(day) ?? 0) + 1);
      const age = today - day;
      if (age >= 0 && age < WEEK_SPAN) week += 1;
      if (age >= 0 && age < MONTH_SPAN) month += 1;
    }
    if (item.starred) starred += 1;
    byCategory.set(item.category, (byCategory.get(item.category) ?? 0) + 1);
  }

  const span = HEAT_WEEKS * HEAT_ROWS;
  const start = today - (span - 1);
  const days: DayCell[] = [];
  for (let day = start; day <= today; day += 1) {
    const count = counts.get(day) ?? 0;
    days.push({ day, count, label: formatDayNumber(day, nowMs), level: heatLevel(count) });
  }

  return {
    total: items.length,
    week,
    month,
    starred,
    days,
    categories: CATEGORIES.map((category) => ({
      id: category.id,
      label: category.label,
      count: byCategory.get(category.id) ?? 0,
    })),
  };
}
