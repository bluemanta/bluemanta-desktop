import type { KnowledgeSearchHit, KnowledgeTopic } from '@bluemanta/server/api-types';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useLocation } from 'wouter';
import { describeError } from '../api/client';
import { useAppNavigate, useLaunch, useViewport } from '../app/context';
import { Highlight } from '../ideas/Highlight';
import listStyles from '../ideas/IdeaList.module.css';
import { Shell } from '../shell/Shell';
import { Banner } from '../ui/Banner';
import { Button } from '../ui/Button';
import { EmptyState } from '../ui/EmptyState';
import { useKnowledgeIndex, useKnowledgeSearch, usePersonalOsOverview } from './api';
import { FileReader } from './FileReader';
import { KnowledgeHeader, type KnowledgeSection } from './KnowledgeHeader';
import { KNOWLEDGE_MODULE } from './module';
import { filePath, libraryTarget, topicPath, type KnowledgeRoute } from './paths';
import { statusLabel, statusTone } from './shared';
import { TopicDetail } from './TopicDetail';
import styles from './Knowledge.module.css';
import { DetailArea } from './DetailArea';
import { PersonalOsPage } from './PersonalOsPage';
import { ResourceTabs } from './PersonalOsCollections';
import { PersonalOsReadWarning } from './PersonalOsReadState';
import { parsePersonalOsPath, personalOsTarget } from './personalos-paths';

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

export function TopicsView({ route }: { route: Extract<KnowledgeRoute, { view: 'topics' }> }) {
  const navigate = useAppNavigate();
  const viewport = useViewport();
  const { embed } = useLaunch();
  const libraryId = 'arsenal';
  const index = useKnowledgeIndex(libraryId);
  const [status, setStatus] = useState<StatusFilter>('all');
  const open = (path: string, anchor?: string) => navigate(libraryTarget(libraryId, path), { state: anchor ? { knowledgeHeading: anchor } : undefined });
  const heading = typeof window.history.state?.knowledgeHeading === 'string' ? window.history.state.knowledgeHeading as string : null;
  const selected = route.topic ?? (route.file ? route.file.split('/').slice(0, 2).join('/') : null);
  const hasDetail = route.topic !== null || route.file !== null;
  const full = hasDetail && (viewport === 'narrow' || embed === 'sidebar');
  const close = () => navigate('/knowledge/resources/arsenal');
  useListKeys('主题清单', hasDetail ? close : null);

  const categories = useMemo(
    () =>
      (index.data?.categories ?? [])
        .map((category) => ({ ...category, topics: category.topics.filter((topic) => matchesStatus(topic, status)) }))
        .filter((category) => category.topics.length > 0),
    [index.data, status],
  );
  const total = categories.reduce((count, category) => count + category.topics.length, 0);
  const library = index.data?.library;

  const detail = route.topic !== null ? (
    <TopicDetail key={`${libraryId}:${route.topic}`} library={libraryId} path={route.topic} onOpen={open} onTopic={(path) => navigate(topicPath(libraryId, path))} />
  ) : route.file !== null ? (
    <FileReader key={`${libraryId}:${route.file}`} library={libraryId} path={route.file} heading={heading} onOpen={open} onTopic={(path) => navigate(topicPath(libraryId, path))} />
  ) : null;

  if (full) {
    return (
      <Shell module={KNOWLEDGE_MODULE} section="resources" header={false}>
        <DetailArea full onClose={close}>
          {detail}
        </DetailArea>
      </Shell>
    );
  }

  if (embed === 'sidebar') return <Shell module={KNOWLEDGE_MODULE} section="resources" header={false}><EmptyState icon="book" title="选择一个主题查看" /></Shell>;

  let list: ReactNode;
  if (index.isPending) {
    list = <p className={styles.intro}>正在读取…</p>;
  } else if (index.isError && !index.data) {
    list = null;
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
                  onClick={() => (topic.exists ? navigate(topicPath(libraryId, topic.path)) : undefined)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' && topic.exists) navigate(topicPath(libraryId, topic.path));
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
    <Shell module={KNOWLEDGE_MODULE} section="resources" header={false}>
      <KnowledgeHeader section="resources" />
      <ResourceTabs selected="arsenal" />
      <div className={styles.bar} role="toolbar" aria-label="筛选">
        {STATUS_FILTERS.map((item) => (
          <button key={item.id} type="button" className={styles.chip} aria-pressed={status === item.id} onClick={() => setStatus(item.id)}>
            {item.label}
          </button>
        ))}
        <span className={styles.count} aria-live="polite" data-testid="topic-count">
          {index.data ? `${total} 个主题` : ''}
        </span>
      </div>
      {index.isError ? <PersonalOsReadWarning message={`主题读取失败：${describeError(index.error)}`} updatedAt={index.dataUpdatedAt} onRetry={() => void index.refetch()} retrying={index.isFetching} /> : null}
      {index.data && index.data.warnings.length > 0 ? <p className={styles.intro}>{index.data.warnings.join('；')}</p> : null}
      <div className={styles.body}>
        {list}
        {detail ? <DetailArea full={false} onClose={close}>{detail}</DetailArea> : null}
      </div>
    </Shell>
  );
}

const SOURCE_GROUPS = [
  { id: 'personalos', label: 'PersonalOS' },
  { id: 'arsenal', label: 'Arsenal' },
  { id: 'idea', label: '灵感' },
] as const;

function groupOf(hit: KnowledgeSearchHit): string {
  return hit.source === 'idea' ? 'idea' : (hit.library ?? 'other');
}

/** Root documents have no domain; the file name remains visible in every title chain. */
export function personalOsHitTitle(hit: KnowledgeSearchHit): string {
  const headings = hit.headings.filter((heading, index) => index !== 0 || heading !== hit.title);
  return [hit.domain ?? 'PersonalOS', hit.path?.split('/').at(-1) ?? hit.title, ...headings].join(' › ');
}

export function SearchView({ query }: { query: string }) {
  const navigate = useAppNavigate();
  const viewport = useViewport();
  const { embed } = useLaunch();
  const search = useKnowledgeSearch(query);
  const overview = usePersonalOsOverview();
  const [sources, setSources] = useState<ReadonlySet<string>>(new Set());
  const [opened, setOpened] = useState<KnowledgeSearchHit | null>(null);
  useEffect(() => setOpened(null), [query]);
  useListKeys('搜索结果', opened ? () => setOpened(null) : null);

  const visibleHits = (search.data?.hits ?? []).filter((hit) => SOURCE_GROUPS.some((group) => group.id === groupOf(hit)));
  const ranked = [...new Set(visibleHits.map(groupOf))];
  const groups = [...SOURCE_GROUPS].sort((a, b) => {
    const rank = (id: string) => ranked.includes(id) ? ranked.indexOf(id) : ranked.length + SOURCE_GROUPS.findIndex((group) => group.id === id);
    return rank(a.id) - rank(b.id);
  });
  const hits = visibleHits.filter((hit) => sources.size === 0 || sources.has(groupOf(hit)));
  const toggle = (id: string) => setSources((current) => {
    const next = new Set(current);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const openHit = (hit: KnowledgeSearchHit) => {
    if (hit.source === 'idea' && hit.ideaId) navigate(`/ideas/${encodeURIComponent(hit.ideaId)}`);
    else setOpened(hit);
  };
  const openedLibrary = opened?.library ?? 'personalos';
  const reader = opened?.library && opened.path ? <FileReader
    key={`${opened.library}:${opened.path}:${opened.headings.join('/')}`}
    library={openedLibrary} path={opened.path} heading={opened.headings.at(-1) ?? null}
    onOpen={(path, anchor) => navigate(openedLibrary === 'personalos' ? personalOsTarget(path, overview.data?.domains) : filePath(openedLibrary, path), { state: anchor ? { knowledgeHeading: anchor } : undefined })}
    onTopic={openedLibrary === 'arsenal' ? (path) => navigate(topicPath('arsenal', path)) : undefined}
  /> : null;
  if (reader && (viewport === 'narrow' || embed === 'sidebar')) return <Shell module={KNOWLEDGE_MODULE} section="search" header={false}><DetailArea full onClose={() => setOpened(null)}>{reader}</DetailArea></Shell>;
  if (embed === 'sidebar') return <Shell module={KNOWLEDGE_MODULE} section="search" header={false}><EmptyState icon="search" title="选择搜索结果后查看" /></Shell>;

  let content: ReactNode;
  if (query.trim() === '') content = <EmptyState icon="search" title="搜索知识和灵感">在页头输入关键词后回车。多个关键词用空格隔开。</EmptyState>;
  else if (search.isPending) content = <p className={styles.intro}>正在搜索…</p>;
  else if (hits.length === 0 && !search.isError) content = <EmptyState icon="search" title="没有找到">换个说法，或只用一两个关键词。</EmptyState>;
  else content = <div className={listStyles.list} role="listbox" aria-label="搜索结果">
    {groups.map((group) => {
      const items = hits.filter((hit) => groupOf(hit) === group.id);
      if (!items.length) return null;
      return <section key={group.id} aria-label={group.label}>
        <div className={listStyles.group}>{group.label}<span className={listStyles.groupCount}>{items.length}</span></div>
        {items.map((hit, index) => <div key={`${hit.source}:${hit.library}:${hit.path}:${hit.ideaId}:${index}`} role="option" tabIndex={0}
          aria-selected={opened !== null && opened.path === hit.path && opened.library === hit.library && opened.headings.join() === hit.headings.join()}
          className={styles.hit} onClick={() => openHit(hit)} onKeyDown={(event) => { if (event.key === 'Enter') openHit(hit); }}>
          <div className={styles.hitLine}>
            {hit.library === 'personalos' ? <span className={styles.hitTitle} data-testid="search-title-chain" title={personalOsHitTitle(hit)}>{personalOsHitTitle(hit)}</span> : <><span className={styles.hitTitle}>{hit.title}</span><span className={styles.hitHeadings}>{hit.headings.join(' › ')}</span></>}
            {hit.domain ? <span className={styles.tag} data-testid="search-domain">{hit.domain}</span> : null}
            {hit.area === 'archive' ? <span className={styles.tag}>归档</span> : null}
            {hit.library !== 'personalos' && hit.topicName ? <span className={styles.tag}>{hit.topicName}</span> : null}
          </div>
          <div className={styles.hitExcerpt}><Highlight text={hit.excerpt} query={search.data?.keywords.join(' ') ?? query} /></div>
        </div>)}
      </section>;
    })}
  </div>;
  return <Shell module={KNOWLEDGE_MODULE} section="search" header={false}>
    <KnowledgeHeader section="search" query={query} />
    <div className={styles.bar} role="toolbar" aria-label="筛选来源">
      <button type="button" className={styles.chip} aria-pressed={sources.size === 0} onClick={() => setSources(new Set())}>全部</button>
      {groups.map((group) => <button key={group.id} type="button" className={styles.chip} aria-pressed={sources.has(group.id)} onClick={() => toggle(group.id)}>{group.label}</button>)}
      <span className={styles.count} aria-live="polite" data-testid="hit-count">{search.data && query.trim() ? `${hits.length} 条` : ''}</span>
    </div>
    {search.isError ? <div className={styles.banner}><Banner onRetry={() => void search.refetch()} retrying={search.isFetching}>搜索失败：{describeError(search.error)}{search.data ? `；仍显示 ${new Date(search.dataUpdatedAt).toLocaleTimeString()} 读取的结果。` : ''}</Banner></div> : null}
    <div className={styles.body}>{content}{reader ? <DetailArea full={false} onClose={() => setOpened(null)}>{reader}</DetailArea> : null}</div>
  </Shell>;
}

/** Knowledge desk routing: PersonalOS pages plus compatible Arsenal and search views. */
export function KnowledgePage() {
  const [location] = useLocation();
  useEffect(() => {
    const previous = document.title;
    document.title = '知识台 · bluemanta';
    return () => {
      document.title = previous;
    };
  }, []);
  const route = parsePersonalOsPath(location);
  if (route.view === 'search') return <SearchView query={route.query} />;
  if (route.view === 'arsenal') return <TopicsView route={{ view: 'topics', library: 'arsenal', topic: route.topic, file: route.file }} />;
  return <PersonalOsPage route={route} />;
}

export type { KnowledgeSection };
