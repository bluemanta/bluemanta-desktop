import type { IdeaCategory } from '@bluemanta/server/api-types';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type Dispatch, type ReactNode, type RefObject, type SetStateAction } from 'react';
import { emptyCapture, type CaptureDraft } from './model/capture';
import { NO_FILTERS, type IdeaFilters } from './model/listing';
import { type EditSession, type EditorActions } from './model/session';
import { closeTab as closeTabIn, MAX_TABS, openTab as openTabIn } from './model/tabs';

export const SEARCH_DEBOUNCE_MS = 200;

type IdeasState = {
  query: string;
  setQuery: (value: string) => void;
  searchQuery: string;
  filters: IdeaFilters;
  toggleStarred: () => void;
  toggleCategory: (category: IdeaCategory) => void;
  clearFilters: () => void;
  tabs: string[];
  /** 打不开（6 个都有未保存修改）时返回 false。 */
  openTab: (id: string) => boolean;
  closeTab: (id: string) => string | null;
  lastActive: RefObject<string | null>;
  listScroll: RefObject<number | null>;
  capture: CaptureDraft | null;
  openCapture: () => void;
  closeCapture: () => void;
  setCapture: Dispatch<SetStateAction<CaptureDraft | null>>;
  sessions: Record<string, EditSession>;
  setSession: (id: string, session: EditSession | null) => void;
  updateSession: (id: string, patch: Partial<EditSession>) => void;
  editSession: (id: string, recipe: (session: EditSession) => EditSession) => void;
  /** 自己的写入让 rev 前进时调用，避免被当成外部冲突。 */
  bumpBaseRev: (id: string, rev: number) => void;
  dirtyIds: ReadonlySet<string>;
  /** 放弃这些灵感的编辑；不传则放弃全部。 */
  discardSessions: (ids?: readonly string[]) => void;
  editorActions: RefObject<Map<string, EditorActions>>;
  captureActions: RefObject<EditorActions | null>;
  /** 窄屏「返回」已经确认过放弃修改，下一次浏览器后退不再问。 */
  ignoreNextPop: RefObject<boolean>;
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
  const [capture, setCapture] = useState<CaptureDraft | null>(null);
  const [sessions, setSessions] = useState<Record<string, EditSession>>({});
  const lastActive = useRef<string | null>(null);
  const listScroll = useRef<number | null>(null);
  const editorActions = useRef(new Map<string, EditorActions>());
  const captureActions = useRef<EditorActions | null>(null);
  const ignoreNextPop = useRef(false);
  const tabsRef = useRef(tabs);
  tabsRef.current = tabs;
  const dirtyIds = useMemo(() => new Set(Object.entries(sessions).filter(([, session]) => session.dirty).map(([id]) => id)), [sessions]);
  const dirtyRef = useRef(dirtyIds);
  dirtyRef.current = dirtyIds;

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

  const openTab = useCallback((id: string) => {
    if (tabsRef.current.includes(id)) return true;
    const result = openTabIn(tabsRef.current, id, MAX_TABS, dirtyRef.current);
    if (!result.opened) return false;
    tabsRef.current = result.tabs;
    setTabs(result.tabs);
    return true;
  }, []);

  const closeTab = useCallback((id: string) => {
    const result = closeTabIn(tabsRef.current, id);
    tabsRef.current = result.tabs;
    setTabs(result.tabs);
    if (lastActive.current === id) lastActive.current = result.neighbor;
    return result.neighbor;
  }, []);

  const openCapture = useCallback(() => {
    setCapture((current) => current ?? emptyCapture());
  }, []);
  const closeCapture = useCallback(() => setCapture(null), []);

  const setSession = useCallback((id: string, session: EditSession | null) => {
    setSessions((current) => {
      if (session === null) {
        if (!(id in current)) return current;
        const next = { ...current };
        delete next[id];
        return next;
      }
      return { ...current, [id]: session };
    });
  }, []);

  const updateSession = useCallback((id: string, patch: Partial<EditSession>) => {
    setSessions((current) => {
      const session = current[id];
      if (!session) return current;
      return { ...current, [id]: { ...session, ...patch } };
    });
  }, []);

  const editSession = useCallback((id: string, recipe: (session: EditSession) => EditSession) => {
    setSessions((current) => {
      const session = current[id];
      if (!session) return current;
      const next = recipe(session);
      if (next === session) return current;
      return { ...current, [id]: next };
    });
  }, []);

  const bumpBaseRev = useCallback((id: string, rev: number) => {
    setSessions((current) => {
      const session = current[id];
      if (!session || session.baseRev >= rev) return current;
      return { ...current, [id]: { ...session, baseRev: rev } };
    });
  }, []);

  const discardSessions = useCallback((ids?: readonly string[]) => {
    setSessions((current) => {
      if (!ids) return {};
      const next = { ...current };
      for (const id of ids) delete next[id];
      return next;
    });
    if (ids) {
      for (const id of ids) editorActions.current.delete(id);
    } else {
      editorActions.current.clear();
    }
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
      capture,
      openCapture,
      closeCapture,
      setCapture,
      sessions,
      setSession,
      updateSession,
      editSession,
      bumpBaseRev,
      dirtyIds,
      discardSessions,
      editorActions,
      captureActions,
      ignoreNextPop,
    }),
    [
      query,
      searchQuery,
      filters,
      toggleStarred,
      toggleCategory,
      clearFilters,
      tabs,
      openTab,
      closeTab,
      capture,
      openCapture,
      closeCapture,
      sessions,
      setSession,
      updateSession,
      editSession,
      bumpBaseRev,
      dirtyIds,
      discardSessions,
    ],
  );
  return <Context.Provider value={value}>{children}</Context.Provider>;
}
