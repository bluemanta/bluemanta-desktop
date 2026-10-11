export const MAX_TABS = 6;

/**
 * 打开一个标签。已打开时不变。超出上限时关闭最早打开、且没有未保存修改的；
 * 全部都有未保存修改时不新开（`opened: false`）。
 */
export function openTab(
  tabs: readonly string[],
  id: string,
  max = MAX_TABS,
  dirty: ReadonlySet<string> = new Set(),
): { tabs: string[]; opened: boolean } {
  if (tabs.includes(id)) return { tabs: [...tabs], opened: true };
  if (tabs.length < max) return { tabs: [...tabs, id], opened: true };
  const victim = tabs.findIndex((tab) => !dirty.has(tab));
  if (victim === -1) return { tabs: [...tabs], opened: false };
  return { tabs: [...tabs.filter((_, index) => index !== victim), id], opened: true };
}

/** 关闭后应该切到哪一个：优先右边的邻居，没有就左边。 */
export function closeTab(tabs: readonly string[], id: string): { tabs: string[]; neighbor: string | null } {
  const index = tabs.indexOf(id);
  if (index === -1) return { tabs: [...tabs], neighbor: null };
  const next = tabs.filter((tab) => tab !== id);
  return { tabs: next, neighbor: next[index] ?? next[index - 1] ?? null };
}
