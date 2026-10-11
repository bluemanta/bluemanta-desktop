import type { IdeaCategory } from '@bluemanta/server/api-types';

export const CATEGORIES: readonly { id: IdeaCategory; label: string; color: string }[] = [
  { id: 'product', label: '产品想法', color: 'var(--bm-cat-product)' },
  { id: 'learning', label: '学习备忘', color: 'var(--bm-cat-learning)' },
  { id: 'work', label: '工作事务', color: 'var(--bm-cat-work)' },
  { id: 'life', label: '生活随想', color: 'var(--bm-cat-life)' },
  { id: 'other', label: '其他', color: 'var(--bm-cat-other)' },
];

const BY_ID = new Map(CATEGORIES.map((category) => [category.id, category]));

export function categoryLabel(id: IdeaCategory): string {
  return BY_ID.get(id)?.label ?? '其他';
}

export function categoryColor(id: IdeaCategory): string {
  return BY_ID.get(id)?.color ?? 'var(--bm-cat-other)';
}
