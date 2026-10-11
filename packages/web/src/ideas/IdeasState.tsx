import type { IdeaCategory } from '@bluemanta/server/api-types';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react';
import { NO_FILTERS, type IdeaFilters } from './model/listing';
import { closeTab as closeTabIn, openTab as openTabIn } from './model/tabs';

export const SEARCH_DEBOUNCE_MS = 200;

type IdeasState = {
  /** 搜索框里的原文。 */
  query: string;
  setQuery: (value: string) => void;
  /** 停顿 200ms 后、去掉首尾空白的搜索词；空字符串表示不搜索。 */
  searchQuery: string;
  filters: IdeaFilters;
  toggleStarred: () => void;
  toggleCategory: (category: IdeaCategory) => void;
  clearFilters: () => void;
  /** 打开顺序；只在内存里，刷新后不恢复（idea-ui 第 3 节）。 */
  tabs: string[];
  openTab: (id: string) => void;
  /** 返回关闭后应切换到的标签。 */
  closeTab: (id: string) => string | null;
  /** 最近一次在详情里显示的灵感，从统计或回收站切回清单时用。 */
  lastActive: RefObject<string | null>;
  /** 窄屏进入整页详情前记下的列表滚动位置。 */
  listScroll: RefObject<number | null>;
};

const Context = createContext<IdeasState | null>(null);

export function useIdeasState(): IdeasState {
  const value = useContext(Context);
  if (!value) throw new Error('useIdeasState 需要在 IdeasStateProvider 里使用');
  return value;
}

export function IdeasStateProvider({ children }: { children: ReactNode }) {
  const [query, setQuery] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [filters, setFilters] = useState<IdeaFilters>(NO_FILTERS);
  const [tabs, setTabs] = useState<string[]>([]);
  const lastActive = useRef<string | null>(null);
  const listScroll = useRef<number | null>(null);

  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed === '') {
      setSearchQuery('');
      return;
    }
    const timer = window.setTimeout(() => setSearchQuery(trimmed), SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [query]);

  const toggleStarred = useCallback(() => setFilters((current) => ({ ...current, starredOnly: !current.starredOnly })), []);
  const toggleCategory = useCallback(
    (category: IdeaCategory) =>
      setFilters((current) => {
        const categories = new Set(current.categories);
        if (categories.has(category)) categories.delete(category);
        else categories.add(category);
        return { ...current, categories };
      }),
    [],
  );
  const clearFilters = useCallback(() => setFilters(NO_FILTERS), []);

  const openTab = useCallback((id: string) => setTabs((current) => openTabIn(current, id)), []);
  const tabsRef = useRef(tabs);
  tabsRef.current = tabs;
  const closeTab = useCallback((id: string) => {
    const result = closeTabIn(tabsRef.current, id);
    tabsRef.current = result.tabs;
    setTabs(result.tabs);
    if (lastActive.current === id) lastActive.current = result.neighbor;
    return result.neighbor;
  }, []);

  const value = useMemo(
    () => ({
      query,
      setQuery,
      searchQuery,
      filters,
      toggleStarred,
      toggleCategory,
      clearFilters,
      tabs,
      openTab,
      closeTab,
      lastActive,
      listScroll,
    }),
    [query, searchQuery, filters, toggleStarred, toggleCategory, clearFilters, tabs, openTab, closeTab],
  );
  return <Context.Provider value={value}>{children}</Context.Provider>;
}
