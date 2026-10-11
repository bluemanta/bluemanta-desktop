import type { IdeaCategory, IdeaListItem, IdeaSearchField } from '@bluemanta/server/api-types';
import { DAY_GROUP_LABEL, dayGroup, shanghaiDayNumber, type DayGroup } from './time';

export type IdeaFilters = {
  starredOnly: boolean;
  /** 多个分类之间是「或」；空集合表示不按分类筛。 */
  categories: ReadonlySet<IdeaCategory>;
  /** 上海自然日序号。从统计页点某天进来；`null` 表示不按日期筛。 */
  day: number | null;
};

export const NO_FILTERS: IdeaFilters = { starredOnly: false, categories: new Set(), day: null };

export function hasFilters(filters: IdeaFilters): boolean {
  return filters.starredOnly || filters.categories.size > 0 || filters.day !== null;
}

type Filterable = { starred: boolean; category: IdeaCategory; createdAt: string };

/** 收藏、分类、日期叠加（与）；分类之间（或）。日期按上海自然日。 */
export function passesFilters(item: Filterable, filters: IdeaFilters): boolean {
  if (filters.starredOnly && !item.starred) return false;
  if (filters.categories.size > 0 && !filters.categories.has(item.category)) return false;
  if (filters.day !== null && shanghaiDayNumber(Date.parse(item.createdAt)) !== filters.day) return false;
  return true;
}

/** 收藏与分类叠加（与）；分类之间（或）；日期胶囊再叠一层。 */
export function applyFilters<T extends IdeaListItem>(items: readonly T[], filters: IdeaFilters): T[] {
  return items.filter((item) => passesFilters(item, filters));
}

export type ListSection = {
  key: string;
  label: string;
  items: IdeaListItem[];
};

/** 非搜索时按上海自然日分组；顺序沿用接口（创建时间倒序），网页不再重排。搜索时只有一组「搜索结果」。 */
export function buildSections(items: readonly IdeaListItem[], searching: boolean, nowMs: number): ListSection[] {
  if (items.length === 0) return [];
  if (searching) return [{ key: 'search', label: '搜索结果', items: [...items] }];
  const order: DayGroup[] = ['today', 'yesterday', 'week', 'earlier'];
  const buckets = new Map<DayGroup, IdeaListItem[]>();
  for (const item of items) {
    const group = dayGroup(item.createdAt, nowMs);
    const bucket = buckets.get(group);
    if (bucket) bucket.push(item);
    else buckets.set(group, [item]);
  }
  return order
    .filter((group) => buckets.has(group))
    .map((group) => ({ key: group, label: DAY_GROUP_LABEL[group], items: buckets.get(group) ?? [] }));
}

const FIELD_LABEL: Record<Exclude<IdeaSearchField, 'title'>, string> = {
  body: '匹配正文',
  rawInput: '匹配原文',
  category: '匹配分类',
};

/** 命中字段不是标题时，行内显示「匹配正文 / 原文 / 分类」。 */
export function matchLabel(item: IdeaListItem): string | null {
  const field = item.match?.field;
  if (!field || field === 'title') return null;
  return FIELD_LABEL[field];
}

/** 摘要：命中正文或原文时用接口的摘录，否则用正文开头。 */
export function excerptOf(item: IdeaListItem): string {
  const field = item.match?.field;
  if (item.match && (field === 'body' || field === 'rawInput')) return item.match.excerpt;
  return item.body.replace(/\s+/g, ' ').trim();
}

export function displayTitle(title: string): string {
  return title.trim() === '' ? '未命名灵感' : title;
}
