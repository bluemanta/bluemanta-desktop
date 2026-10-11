export const MAX_TABS = 6;

/** 打开一个标签。已打开时不变；超出上限时关闭最早打开的（T13 起跳过有未保存修改的）。 */
export function openTab(tabs: readonly string[], id: string, max = MAX_TABS): string[] {
  if (tabs.includes(id)) return [...tabs];
  const next = [...tabs, id];
  return next.length > max ? next.slice(next.length - max) : next;
}

/** 关闭后应该切到哪一个：优先右边的邻居，没有就左边。 */
export function closeTab(tabs: readonly string[], id: string): { tabs: string[]; neighbor: string | null } {
  const index = tabs.indexOf(id);
  if (index === -1) return { tabs: [...tabs], neighbor: null };
  const next = tabs.filter((tab) => tab !== id);
  return { tabs: next, neighbor: next[index] ?? next[index - 1] ?? null };
}
