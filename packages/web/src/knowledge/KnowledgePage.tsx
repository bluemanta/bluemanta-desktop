import type { KnowledgeSearchHit, KnowledgeTopic } from '@bluemanta/server/api-types';
import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { useLocation } from 'wouter';
import { describeError } from '../api/client';
import { useAppNavigate, useLaunch, useViewport } from '../app/context';
import { Highlight } from '../ideas/Highlight';
import { useDetailWidth } from '../ideas/detail/detailWidth';
import { Resizer } from '../ideas/detail/Resizer';
import panelStyles from '../ideas/detail/DetailPanel.module.css';
import listStyles from '../ideas/IdeaList.module.css';
import { Shell } from '../shell/Shell';
import { Banner } from '../ui/Banner';
import { Button } from '../ui/Button';
import { EmptyState } from '../ui/EmptyState';
import { Icon } from '../ui/Icon';
import { useKnowledgeIndex, useKnowledgeInbox, useKnowledgeLibraries, useKnowledgeSearch } from './api';
import { FileReader } from './FileReader';
import { KnowledgeHeader, type KnowledgeSection } from './KnowledgeHeader';
import { KNOWLEDGE_MODULE } from './module';
import { DEFAULT_LIBRARY, filePath, inboxPath, parseKnowledgePath, topicPath, topicsPath, type KnowledgeRoute } from './paths';
import { formatDate, formatSize, statusLabel, statusTone, useOpenInLibrary } from './shared';
import { TopicDetail } from './TopicDetail';
import styles from './Knowledge.module.css';

type StatusFilter = 'all' | 'active' | 'seed' | 'needs_review' | 'unregistered';

const STATUS_FILTERS: ReadonlyArray<{ id: StatusFilter; label: string }> = [
  { id: 'all', label: '全部' },
  { id: 'active', label: '活跃' },
  { id: 'seed', label: '种子' },
  { id: 'needs_review', label: '待审' },
  { id: 'unregistered', label: '未登记' },
];

function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName);
}

function matchesStatus(topic: KnowledgeTopic, filter: StatusFilter): boolean {
  if (filter === 'all') return true;
  if (filter === 'unregistered') return !topic.registered;
  return topic.status === filter;
}

/** Right-hand detail card, or a full page on narrow screens and in the dsh right sidebar. */
function DetailArea({ full, onClose, children }: { full: boolean; onClose: () => void; children: ReactNode }) {
  const [width, setWidth] = useDetailWidth();
  const panel = useRef<HTMLElement>(null);
  const { embed } = useLaunch();
  if (full) {
    return (
      <div className={styles.full}>
        {embed === 'sidebar' ? null : (
          <Button variant="ghost" size="sm" className={styles.back} onClick={onClose}>
            <Icon name="back" /> 返回
          </Button>
        )}
        {children}
      </div>
    );
  }
  const style = width === null ? undefined : ({ '--detail-width': `${width}px` } as CSSProperties);
  return (
    <>
      <Resizer width={width} measure={() => panel.current?.getBoundingClientRect().width ?? 420} onChange={setWidth} />
      <aside ref={panel} className={panelStyles.panel} style={style} aria-label="详情">
        <div className={panelStyles.scroll}>{children}</div>
      </aside>
    </>
  );
}

/** Esc closes the detail; J / K move through list rows; ↵ opens the focused row. */
function useListKeys(listLabel: string, onClose: (() => void) | null): void {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey || isTyping(event.target)) return;
      if (document.querySelector('[role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"]')) return;
      if (event.key === 'Escape' && onClose) {
        event.preventDefault();
        onClose();
        return;
      }
      const key = event.key.toLowerCase();
      if (key !== 'j' && key !== 'k' && event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
      const rows = [...document.querySelectorAll<HTMLElement>(`[role="listbox"][aria-label="${listLabel}"] [role="option"]`)];
      if (rows.length === 0) return;
      event.preventDefault();
      const current = rows.findIndex((row) => row === document.activeElement || row.getAttribute('aria-selected') === 'true');
      const step = key === 'k' || event.key === 'ArrowUp' ? -1 : 1;
      const next = rows[Math.min(rows.length - 1, Math.max(0, current < 0 ? 0 : current + step))];
      next?.focus();
      next?.click();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [listLabel, onClose]);
}

function TopicsView({ route }: { route: Extract<KnowledgeRoute, { view: 'topics' }> }) {
  const navigate = useAppNavigate();
  const viewport = useViewport();
  const { embed } = useLaunch();
  const libraries = useKnowledgeLibraries();
  const index = useKnowledgeIndex(route.library);
  const [status, setStatus] = useState<StatusFilter>('all');
  const open = useOpenInLibrary(route.library);
  const selected = route.topic ?? (route.file ? route.file.split('/').slice(0, 2).join('/') : null);
  const hasDetail = route.topic !== null || route.file !== null;
  const full = hasDetail && (viewport === 'narrow' || embed === 'sidebar');
  const close = () => navigate(topicsPath(route.library));
  useListKeys('主题清单', hasDetail ? close : null);

  const categories = useMemo(
    () =>
      (index.data?.categories ?? [])
        .map((category) => ({ ...category, topics: category.topics.filter((topic) => matchesStatus(topic, status)) }))
        .filter((category) => category.topics.length > 0),
    [index.data, status],
  );
  const total = categories.reduce((count, category) => count + category.topics.length, 0);
  const library = index.data?.library ?? libraries.data?.libraries.find((item) => item.id === route.library);

  const detail = route.topic !== null ? (
    <TopicDetail key={`${route.library}:${route.topic}`} library={route.library} path={route.topic} onOpen={open} onTopic={(path) => navigate(topicPath(route.library, path))} />
  ) : route.file !== null ? (
    <FileReader key={`${route.library}:${route.file}`} library={route.library} path={route.file} onOpen={open} onTopic={(path) => navigate(topicPath(route.library, path))} />
  ) : null;

  if (full) {
    return (
      <Shell module={KNOWLEDGE_MODULE} section="topics" header={false}>
        <DetailArea full onClose={close}>
          {detail}
        </DetailArea>
      </Shell>
    );
  }

  let list: ReactNode;
  if (index.isPending) {
    list = <p className={styles.intro}>正在读取…</p>;
  } else if (index.isError) {
    list = (
      <div className={styles.banner}>
        <Banner onRetry={() => void index.refetch()} retrying={index.isFetching}>
          读不到这个库：{describeError(index.error)}
        </Banner>
      </div>
    );
  } else if (library && !library.exists) {
    list = (
      <EmptyState icon="folder" title="没有找到这个库">
        服务按 {library.root} 查找。要换位置，在启动服务前设置 BLUEMANTA_KNOWLEDGE_HOME。
      </EmptyState>
    );
  } else if (total === 0) {
    list = (
      <EmptyState icon="book" title={status === 'all' ? '这个库还没有主题' : '没有符合筛选的主题'} action={status === 'all' ? undefined : <Button onClick={() => setStatus('all')}>清除筛选</Button>} />
    );
  } else {
    list = (
      <div className={listStyles.list} role="listbox" aria-label="主题清单">
        {categories.map((category) => (
          <section key={category.id} aria-label={category.name}>
            <div className={listStyles.group}>
              {category.name}
              <span className={listStyles.groupCount}>{category.topics.length}</span>
            </div>
            {category.topics.map((topic) => {
              const label = statusLabel(topic.status);
              return (
                <div
                  key={topic.path}
                  role="option"
                  tabIndex={0}
                  aria-selected={selected === topic.path}
                  data-missing={!topic.exists}
                  className={`${listStyles.row} ${styles.row}`}
                  title={topic.notes ?? undefined}
                  onClick={() => (topic.exists ? navigate(topicPath(route.library, topic.path)) : undefined)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' && topic.exists) navigate(topicPath(route.library, topic.path));
                  }}
                >
                  <span className={styles.rowName}>{topic.name}</span>
                  <span className={styles.aliases}>{topic.aliases.join('、')}</span>
                  {topic.exists ? null : <span className={styles.tag}>目录未建</span>}
                  {topic.registered ? null : <span className={styles.tag}>未登记</span>}
                  {label ? (
                    <span className={styles.tag} data-tone={statusTone(topic.status)}>
                      {label}
                    </span>
                  ) : null}
                  <span className={listStyles.time}>{topic.lastReviewed ?? ''}</span>
                </div>
              );
            })}
          </section>
        ))}
      </div>
    );
  }

  return (
    <Shell module={KNOWLEDGE_MODULE} section="topics" header={false}>
      <KnowledgeHeader section="topics" />
      <div className={styles.bar} role="toolbar" aria-label="筛选">
        {(libraries.data?.libraries ?? []).map((item) => (
          <button
            key={item.id}
            type="button"
            className={styles.chip}
            aria-pressed={item.id === route.library}
            disabled={!item.exists}
            title={item.exists ? item.root : `没有找到：${item.root}`}
            onClick={() => navigate(topicsPath(item.id))}
          >
            {item.name}
            {item.writable ? null : <span className={styles.tag}>只读</span>}
          </button>
        ))}
        <span className={styles.sep} aria-hidden="true" />
        {STATUS_FILTERS.map((item) => (
          <button key={item.id} type="button" className={styles.chip} aria-pressed={status === item.id} onClick={() => setStatus(item.id)}>
            {item.label}
          </button>
        ))}
        <span className={styles.count} aria-live="polite" data-testid="topic-count">
          {index.data ? `${total} 个主题` : ''}
        </span>
      </div>
      {index.data && index.data.warnings.length > 0 ? <p className={styles.intro}>{index.data.warnings.join('；')}</p> : null}
      <div className={styles.body}>
        {list}
        {detail ? <DetailArea full={false} onClose={close}>{detail}</DetailArea> : null}
      </div>
    </Shell>
  );
}

const SOURCE_GROUPS: ReadonlyArray<{ id: string; label: string }> = [
  { id: 'personal', label: '个人库' },
  { id: 'arsenal', label: 'Arsenal' },
  { id: 'idea', label: '灵感' },
];

function groupOf(hit: KnowledgeSearchHit): string {
  return hit.source === 'idea' ? 'idea' : (hit.library ?? 'other');
}

function SearchView({ query }: { query: string }) {
  const navigate = useAppNavigate();
  const viewport = useViewport();
  const libraries = useKnowledgeLibraries();
  const search = useKnowledgeSearch(query);
  const [sources, setSources] = useState<ReadonlySet<string>>(new Set());
  const [opened, setOpened] = useState<KnowledgeSearchHit | null>(null);
  useEffect(() => setOpened(null), [query]);
  useListKeys('搜索结果', opened ? () => setOpened(null) : null);

  const names = new Map((libraries.data?.libraries ?? []).map((item) => [item.id, item.name]));
  // 分组顺序跟着最相关的那条走：哪组里有排名最靠前的结果，哪组排前面。
  const ranked = [...new Set((search.data?.hits ?? []).map(groupOf))];
  const known = new Map(SOURCE_GROUPS.map((group) => [group.id, group.label]));
  const groups = [...ranked, ...SOURCE_GROUPS.map((group) => group.id).filter((id) => !ranked.includes(id))].map((id) => ({ id, label: known.get(id) ?? names.get(id) ?? id }));
  const hits = (search.data?.hits ?? []).filter((hit) => sources.size === 0 || sources.has(groupOf(hit)));
  const toggle = (id: string) =>
    setSources((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const openHit = (hit: KnowledgeSearchHit) => {
    if (hit.source === 'idea' && hit.ideaId) navigate(`/ideas/${encodeURIComponent(hit.ideaId)}`);
    else if (viewport === 'narrow' && hit.library && hit.path) navigate(filePath(hit.library, hit.path));
    else setOpened(hit);
  };

  let content: ReactNode;
  if (query.trim() === '') {
    content = <EmptyState icon="search" title="搜索知识和灵感">在页头输入关键词后回车。多个关键词用空格隔开。</EmptyState>;
  } else if (search.isError) {
    content = (
      <div className={styles.banner}>
        <Banner onRetry={() => void search.refetch()} retrying={search.isFetching}>
          搜索失败：{describeError(search.error)}
        </Banner>
      </div>
    );
  } else if (search.isPending) {
    content = <p className={styles.intro}>正在搜索…</p>;
  } else if (hits.length === 0) {
    content = <EmptyState icon="search" title="没有找到">换个说法，或只用一两个关键词。</EmptyState>;
  } else {
    content = (
      <div className={listStyles.list} role="listbox" aria-label="搜索结果">
        {groups.map((group) => {
          const items = hits.filter((hit) => groupOf(hit) === group.id);
          if (items.length === 0) return null;
          return (
            <section key={group.id} aria-label={group.label}>
              <div className={listStyles.group}>
                {group.label}
                <span className={listStyles.groupCount}>{items.length}</span>
              </div>
              {items.map((hit, i) => (
                <div
                  key={`${hit.source}:${hit.library}:${hit.path}:${hit.ideaId}:${i}`}
                  role="option"
                  tabIndex={0}
                  aria-selected={opened !== null && opened.path === hit.path && opened.library === hit.library && opened.headings.join() === hit.headings.join()}
                  className={styles.hit}
                  onClick={() => openHit(hit)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') openHit(hit);
                  }}
                >
                  <div className={styles.hitLine}>
                    <span className={styles.hitTitle}>{hit.title}</span>
                    <span className={styles.hitHeadings}>{hit.headings.join(' › ')}</span>
                    {hit.area === 'archive' ? <span className={styles.tag}>归档</span> : null}
                    {hit.topicName ? <span className={styles.tag}>{hit.topicName}</span> : null}
                  </div>
                  <div className={styles.hitExcerpt}>
                    <Highlight text={hit.excerpt} query={search.data?.keywords.join(' ') ?? query} />
                  </div>
                </div>
              ))}
            </section>
          );
        })}
      </div>
    );
  }

  const openedLibrary = opened?.library ?? DEFAULT_LIBRARY;
  return (
    <Shell module={KNOWLEDGE_MODULE} section="search" header={false}>
      <KnowledgeHeader section="search" query={query} />
      <div className={styles.bar} role="toolbar" aria-label="筛选来源">
        <button type="button" className={styles.chip} aria-pressed={sources.size === 0} onClick={() => setSources(new Set())}>
          全部
        </button>
        {groups.map((group) => (
          <button key={group.id} type="button" className={styles.chip} aria-pressed={sources.has(group.id)} onClick={() => toggle(group.id)}>
            {group.label}
          </button>
        ))}
        <span className={styles.count} aria-live="polite" data-testid="hit-count">
          {search.data && query.trim() !== '' ? `${hits.length} 条` : ''}
        </span>
      </div>
      <div className={styles.body}>
        {content}
        {opened && opened.library && opened.path ? (
          <DetailArea full={false} onClose={() => setOpened(null)}>
            <FileReader
              key={`${opened.library}:${opened.path}:${opened.headings.join('/')}`}
              library={openedLibrary}
              path={opened.path}
              heading={opened.headings.at(-1) ?? null}
              onOpen={(path) => navigate(filePath(openedLibrary, path))}
              onTopic={(path) => navigate(topicPath(openedLibrary, path))}
            />
          </DetailArea>
        ) : null}
      </div>
    </Shell>
  );
}

function InboxView({ file }: { file: string | null }) {
  const navigate = useAppNavigate();
  const viewport = useViewport();
  const inbox = useKnowledgeInbox(DEFAULT_LIBRARY);
  const open = useOpenInLibrary(DEFAULT_LIBRARY);
  const full = file !== null && viewport === 'narrow';
  useListKeys('收件箱', file !== null ? () => navigate(inboxPath()) : null);
  const reader = file !== null ? <FileReader key={file} library={DEFAULT_LIBRARY} path={file} onOpen={open} onTopic={(path) => navigate(topicPath(DEFAULT_LIBRARY, path))} /> : null;

  if (full) {
    return (
      <Shell module={KNOWLEDGE_MODULE} section="inbox" header={false}>
        <DetailArea full onClose={() => navigate(inboxPath())}>
          {reader}
        </DetailArea>
      </Shell>
    );
  }

  let list: ReactNode;
  if (inbox.isPending) list = <p className={styles.intro}>正在读取…</p>;
  else if (inbox.isError) {
    list = (
      <div className={styles.banner}>
        <Banner onRetry={() => void inbox.refetch()} retrying={inbox.isFetching}>
          读不到收件箱：{describeError(inbox.error)}
        </Banner>
      </div>
    );
  } else if (inbox.data.files.length === 0) {
    list = <EmptyState icon="folder" title="收件箱是空的">新材料先放进个人库的 _Inbox 文件夹，确认归属后再入库。</EmptyState>;
  } else {
    list = (
      <div className={listStyles.list} role="listbox" aria-label="收件箱">
        {inbox.data.files.map((entry) => (
          <div
            key={entry.path}
            role="option"
            tabIndex={0}
            aria-selected={file === entry.path}
            className={listStyles.row}
            onClick={() => (entry.kind === 'markdown' ? navigate(inboxPath(entry.path)) : undefined)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && entry.kind === 'markdown') navigate(inboxPath(entry.path));
            }}
          >
            <span className={styles.rowName}>{entry.name}</span>
            <span className={styles.aliases} />
            <span className={listStyles.time}>{formatSize(entry.size)}</span>
            <span className={listStyles.time}>{formatDate(entry.modifiedAt)}</span>
          </div>
        ))}
      </div>
    );
  }

  return (
    <Shell module={KNOWLEDGE_MODULE} section="inbox" header={false}>
      <KnowledgeHeader section="inbox" />
      <p className={styles.intro}>个人库 _Inbox 里的新材料。入库功能在下一版；现在可以先看内容，再手动整理到主题。</p>
      <div className={styles.body}>
        {list}
        {reader ? <DetailArea full={false} onClose={() => navigate(inboxPath())}>{reader}</DetailArea> : null}
      </div>
    </Shell>
  );
}

/** `/knowledge/*`：按路径分到主题、搜索、收件箱三页。 */
export function KnowledgePage() {
  const [location] = useLocation();
  useEffect(() => {
    const previous = document.title;
    document.title = '知识台 · bluemanta';
    return () => {
      document.title = previous;
    };
  }, []);
  const route = parseKnowledgePath(location);
  if (route.view === 'search') return <SearchView query={route.query} />;
  if (route.view === 'inbox') return <InboxView file={route.file} />;
  return <TopicsView route={route} />;
}

export type { KnowledgeSection };
