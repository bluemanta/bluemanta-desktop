import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAppNavigate, useLaunch, useViewport } from '../app/context';
import { describeError } from '../api/client';
import { useIdea, useIdeaList, useIdeaSearch } from '../api/queries';
import { Shell } from '../shell/Shell';
import { Banner } from '../ui/Banner';
import { Button } from '../ui/Button';
import { DISCARD_CONFIRM, useConfirm } from '../ui/ConfirmDialog';
import { EmptyState } from '../ui/EmptyState';
import { useToast } from '../ui/Toast';
import { QuickCapture } from './capture/QuickCapture';
import { useOpenCapture } from './capture/openCapture';
import { DetailPanel } from './detail/DetailPanel';
import { useDetailWidth } from './detail/detailWidth';
import { Resizer } from './detail/Resizer';
import { NarrowDetail } from './NarrowDetail';
import { FilterBar } from './FilterBar';
import { IdeaList, IdeaListSkeleton } from './IdeaList';
import { useIdeasState } from './IdeasState';
import { applyFilters, buildSections, hasFilters } from './model/listing';
import { formatClock } from './model/time';
import styles from './IdeasPage.module.css';

const FROM_LIST = { bmFromList: true };

/** `/ideas` 与 `/ideas/:id`：清单 + 详情；窄屏或右侧栏单条时是整页详情。 */
export function IdeasPage({ id }: { id: string | null }) {
  const viewport = useViewport();
  const { embed } = useLaunch();
  if (id !== null && (viewport === 'narrow' || embed === 'sidebar')) {
    return (
      <Shell section="list" header={false}>
        <NarrowDetail id={id} />
      </Shell>
    );
  }
  return (
    <Shell section="list">
      <IdeasBoard activeId={id} narrow={viewport === 'narrow'} />
    </Shell>
  );
}

function useNow(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);
  return now;
}

function IdeasBoard({ activeId, narrow }: { activeId: string | null; narrow: boolean }) {
  const navigate = useAppNavigate();
  const { embed } = useLaunch();
  const state = useIdeasState();
  const { searchQuery, filters, tabs, openTab, closeTab, lastActive, listScroll, setQuery, clearFilters, capture, dirtyIds, discardSessions } = state;
  const confirm = useConfirm();
  const toast = useToast();
  const openCapture = useOpenCapture();
  const list = useIdeaList();
  const search = useIdeaSearch(searchQuery);
  const active = useIdea(narrow ? null : activeId);
  const [width, setWidth] = useDetailWidth();
  const panel = useRef<HTMLElement>(null);
  const now = useNow();
  const [restoreScroll, setRestoreScroll] = useState<number | null>(() => listScroll.current);
  const onRestored = useCallback(() => {
    listScroll.current = null;
    setRestoreScroll(null);
  }, [listScroll]);

  useEffect(() => {
    if (activeId === null || narrow) return;
    const opened = openTab(activeId);
    lastActive.current = activeId;
    if (!opened) {
      toast.show('已打开的灵感都有未保存的修改，先保存或关闭一条。');
      const fallback = tabs.find((tab) => tab !== activeId) ?? null;
      navigate(fallback ? `/ideas/${encodeURIComponent(fallback)}` : '/ideas', { replace: true });
    }
  }, [activeId, narrow, openTab, lastActive, navigate, tabs, toast]);

  // 被移入回收站或彻底删除的灵感，标签自动关闭。
  useEffect(() => {
    if (!list.data || list.isError) return;
    const alive = new Set(list.data.items.map((item) => item.id));
    for (const tab of tabs) {
      if (alive.has(tab)) continue;
      const neighbor = closeTab(tab);
      discardSessions([tab]);
      if (tab === activeId) navigate(neighbor ? `/ideas/${encodeURIComponent(neighbor)}` : '/ideas');
    }
  }, [list.data, list.isError, tabs, activeId, closeTab, discardSessions, navigate]);

  const searching = searchQuery !== '';
  const source = searching ? search : list;
  const items = useMemo(() => applyFilters(source.data?.items ?? [], filters), [source.data, filters]);
  const sections = useMemo(() => buildSections(items, searching, now), [items, searching, now]);

  const titles = useMemo(() => {
    const map = new Map<string, string>();
    for (const item of list.data?.items ?? []) map.set(item.id, item.title);
    if (active.data) map.set(active.data.id, active.data.title);
    return map;
  }, [list.data, active.data]);

  const openIdea = (id: string, scrollTop: number) => {
    if (narrow) {
      listScroll.current = scrollTop;
      navigate(`/ideas/${encodeURIComponent(id)}`, { state: FROM_LIST });
    } else {
      navigate(`/ideas/${encodeURIComponent(id)}`);
    }
  };

  const onCloseTab = (id: string) => {
    const run = () => {
      discardSessions([id]);
      const neighbor = closeTab(id);
      if (id === activeId) navigate(neighbor ? `/ideas/${encodeURIComponent(neighbor)}` : '/ideas');
    };
    if (!dirtyIds.has(id)) {
      run();
      return;
    }
    void confirm(DISCARD_CONFIRM).then((ok) => {
      if (ok) run();
    });
  };

  const resetAll = () => {
    setQuery('');
    clearFilters();
  };

  const libraryEmpty = list.data?.count === 0;
  const showFiltersEmpty = !source.isPending && source.data && items.length === 0;

  let body;
  if (source.isPending && !source.data) {
    body = <IdeaListSkeleton />;
  } else if (!source.data) {
    body = (
      <div className={styles.listArea}>
        <EmptyState
          icon="alert"
          tone="danger"
          title="读取失败"
          action={
            <Button size="sm" onClick={() => void source.refetch()} disabled={source.isFetching}>
              {source.isFetching ? '重试中…' : '重试'}
            </Button>
          }
        >
          {describeError(source.error)}，还没有可以显示的内容。
        </EmptyState>
      </div>
    );
  } else if (libraryEmpty && !searching && !capture) {
    body = (
      <div className={styles.listArea}>
        <EmptyState
          icon="idea"
          title="还没有灵感"
          action={
            <Button variant="primary" size="sm" onClick={openCapture}>
              记第一条 <kbd>N</kbd>
            </Button>
          }
        >
          想到什么就记一笔。也可以让 Grok Bot 或对话里的 agent 帮你记。
        </EmptyState>
      </div>
    );
  } else if (showFiltersEmpty && !capture) {
    body = (
      <div className={styles.listArea}>
        <EmptyState
          icon="search"
          title="没有匹配的灵感"
          action={
            <Button size="sm" onClick={resetAll}>
              清除筛选
            </Button>
          }
        >
          {searching || hasFilters(filters) ? '换个关键词，或者清除筛选条件。' : null}
        </EmptyState>
      </div>
    );
  } else {
    body = (
      <IdeaList
        sections={sections}
        query={searching ? searchQuery : ''}
        selectedId={narrow ? null : activeId}
        nowMs={now}
        onOpen={openIdea}
        restoreScroll={restoreScroll}
        onRestored={onRestored}
        header={capture ? <QuickCapture /> : null}
      />
    );
  }

  return (
    <>
      <FilterBar count={source.data ? items.length : null} />
      {source.isError && source.data ? (
        <div className={styles.banner}>
          <Banner onRetry={() => void source.refetch()} retrying={source.isFetching}>
            读取失败，显示的是 {formatClock(source.dataUpdatedAt)} 的内容。{describeError(source.error)}
          </Banner>
        </div>
      ) : null}
      <div className={styles.body} data-embed={embed ?? 'none'}>
        {body}
        {narrow ? null : (
          <>
            <Resizer width={width} onChange={setWidth} measure={() => panel.current?.getBoundingClientRect().width ?? 0} />
            <DetailPanel
              ref={panel}
              tabs={tabs}
              activeId={activeId}
              titles={titles}
              dirtyIds={dirtyIds}
              width={width}
              onSelect={(id) => navigate(`/ideas/${encodeURIComponent(id)}`)}
              onClose={onCloseTab}
            />
          </>
        )}
      </div>
    </>
  );
}
