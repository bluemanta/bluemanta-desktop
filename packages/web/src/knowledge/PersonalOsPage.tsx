import type { PersonalOsOverviewResponse, PersonalOsTodayResponse } from '@bluemanta/server/api-types';
import { useCallback, useEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { describeError } from '../api/client';
import { useAppNavigate, useLaunch, useViewport } from '../app/context';
import listStyles from '../ideas/IdeaList.module.css';
import { Shell } from '../shell/Shell';
import { EmptyState } from '../ui/EmptyState';
import { usePersonalOsOverview, usePersonalOsToday } from './api';
import { DetailArea } from './DetailArea';
import { FileReader } from './FileReader';
import { KnowledgeHeader, type KnowledgeSection } from './KnowledgeHeader';
import { InlineMarkdown } from './Markdown';
import { KNOWLEDGE_MODULE } from './module';
import { PersonalOsDomainDetail } from './PersonalOsDomainDetail';
import { CommitView } from './PersonalOsGit';
import { PersonalOsActivity, PersonalOsResources } from './PersonalOsCollections';
import { PersonalOsMissing as Missing, PersonalOsReadWarning as ReadWarning } from './PersonalOsReadState';
import { useSearch } from 'wouter';
import { QuickNote, TodoCheck, useCompleteTodo } from './PersonalOsWrite';
import { DOMAINS_PATH, domainPath, personalOsFilePath, personalOsTarget, type PersonalOsRoute } from './personalos-paths';
import shared from './Knowledge.module.css';
import styles from './PersonalOsPages.module.css';

type Todo = PersonalOsTodayResponse['overdue'][number];
type Overview = PersonalOsOverviewResponse;
type PageRoute = Exclude<PersonalOsRoute, { view: 'search' | 'arsenal' }>;
type Selected = { domain: string; todoId?: string } | null;
const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
const week = (date: string) => WEEKDAYS[new Date(`${date}T12:00:00`).getDay()] ?? '';

function dueLabel(todo: Todo, today: string): string {
  if (!todo.due) return '';
  if (todo.due < today) return `逾期 ${Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${todo.due}T00:00:00Z`)) / 86400000)} 天`;
  if (todo.due === today) return '今天';
  return `${week(todo.due)} ${todo.due.slice(5)}`;
}

/** Move to the nearest card in the adjacent visual row; layout may change when a detail opens. */
export function gridMoveIndex(points: readonly { top: number; left: number }[], current: number, key: string): number {
  if (!points.length || current < 0) return 0;
  if (key === 'h' || key === 'ArrowLeft') return Math.max(0, current - 1);
  if (key === 'l' || key === 'ArrowRight') return Math.min(points.length - 1, current + 1);
  const point = points[current];
  if (!point) return 0;
  const up = key === 'k' || key === 'ArrowUp';
  const rows = points.map((candidate) => candidate.top).filter((top) => up ? top < point.top : top > point.top);
  if (!rows.length) return current;
  const nextTop = up ? Math.max(...rows) : Math.min(...rows);
  let best = current; let distance = Infinity;
  points.forEach((candidate, index) => {
    if (candidate.top === nextTop && Math.abs(candidate.left - point.left) < distance) { best = index; distance = Math.abs(candidate.left - point.left); }
  });
  return best;
}

export function useNavigationKeys(root: RefObject<HTMLDivElement | null>, grid: boolean, onClose: (() => void) | null) {
  useEffect(() => {
    const handle = (event: KeyboardEvent) => {
      const target = event.target;
      if (event.defaultPrevented || event.isComposing || event.metaKey || event.ctrlKey || event.altKey) return;
      if (target instanceof HTMLElement && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))) return;
      if (document.querySelector('[role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"]')) return;
      if (event.key === 'Escape' && onClose) { event.preventDefault(); onClose(); return; }
      if (target instanceof Element && target.closest('aside[aria-label="详情"], [data-testid="personalos-domain-detail"]')) return;
      const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
      if (!(grid ? ['j', 'k', 'h', 'l', 'ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight'] : ['j', 'k', 'ArrowDown', 'ArrowUp']).includes(key)) return;
      const rows = [...(root.current?.querySelectorAll<HTMLElement>('[data-pos-focus]') ?? [])].filter((row) => row.getClientRects().length > 0);
      if (!rows.length) return;
      const current = rows.findIndex((row) => row === document.activeElement || row.contains(document.activeElement));
      const next = grid ? gridMoveIndex(rows.map((row) => ({ top: row.offsetTop, left: row.offsetLeft })), current, key)
        : current < 0 ? 0 : Math.min(rows.length - 1, Math.max(0, current + (key === 'k' || key === 'ArrowUp' ? -1 : 1)));
      event.preventDefault(); rows[next]?.focus(); rows[next]?.scrollIntoView({ block: 'nearest' });
    };
    document.addEventListener('keydown', handle);
    return () => document.removeEventListener('keydown', handle);
  }, [root, grid, onClose]);
}

export function PageFrame({ section, detail, onClose, children, sidebarFallback }: { section: KnowledgeSection; detail?: ReactNode; onClose: () => void; children: ReactNode; sidebarFallback?: ReactNode }) {
  const viewport = useViewport(); const { embed } = useLaunch();
  const full = Boolean(detail) && (viewport === 'narrow' || embed === 'sidebar');
  if (full) return <Shell module={KNOWLEDGE_MODULE} section={section} header={false}><DetailArea full onClose={onClose}>{detail}</DetailArea></Shell>;
  if (embed === 'sidebar') return <Shell module={KNOWLEDGE_MODULE} section={section} header={false}>{sidebarFallback ?? <EmptyState icon="book" title="选择一个领域查看" />}</Shell>;
  return <Shell module={KNOWLEDGE_MODULE} section={section} header={false}>
    <KnowledgeHeader section={section} />
    <div className={shared.body}>{children}{detail ? <DetailArea full={false} onClose={onClose}>{detail}</DetailArea> : null}</div>
  </Shell>;
}

function TodoRow({ todo, today, selected, onOpen, onFile, onComplete }: { todo: Todo; today: string; selected: boolean; onOpen: () => void; onFile: (path: string, anchor?: string) => void; onComplete: (todo: Todo) => void }) {
  return <div role="option" aria-selected={selected} tabIndex={0} data-pos-focus data-testid="personalos-todo" data-todo-id={todo.id}
    className={`${listStyles.row} ${styles.todo}`} title={todo.text}
    onClick={(event) => { if (!(event.target instanceof Element && event.target.closest('a'))) onOpen(); }}
    onKeyDown={(event) => {
      if (event.target !== event.currentTarget) return;
      if (event.key === 'Enter') { event.preventDefault(); onOpen(); }
      if (event.key === 'x' && !event.metaKey && !event.ctrlKey && !event.altKey) { event.preventDefault(); onComplete(todo); }
    }}>
    <TodoCheck todo={todo} onComplete={onComplete} />
    <span className={styles.todoText}><InlineMarkdown source={todo.text} basePath={todo.file} onOpen={onFile} /></span>
    {todo.wait !== null ? <span className={styles.badge} title="等了多久：未记录">等待：{todo.wait}</span> : null}
    {todo.every ? <span className={styles.badge}>每 {todo.every}</span> : null}
    {todo.tags.map((tag, index) => <span key={`${tag}:${index}`} className={styles.badge} title="未识别标签，保留原文">{tag}</span>)}
    {todo.warnings.length ? <span className={styles.warn} title={todo.warnings.map((warning) => warning.message).join('；')}>日期待核对</span> : null}
    <span className={styles.due} data-overdue={todo.bucket === 'overdue'}>{dueLabel(todo, today)}</span>
    <span className={styles.domainTag}>{todo.domain}</span>
  </div>;
}

function TodayView() {
  const overview = usePersonalOsOverview(); const today = usePersonalOsToday();
  const [selected, setSelected] = useState<Selected>(null); const list = useRef<HTMLDivElement>(null);
  const navigate = useAppNavigate(); const complete = useCompleteTodo();
  const noteFocus = new URLSearchParams(useSearch()).get('note') === '1';
  const close = useCallback(() => {
    const id = selected?.todoId;
    setSelected(null);
    if (id) requestAnimationFrame(() => list.current?.querySelector<HTMLElement>(`[data-todo-id="${CSS.escape(id)}"]`)?.focus());
  }, [selected]);
  useNavigationKeys(list, false, selected ? close : null);
  const data = today.data;
  const openFile = (path: string, anchor?: string) => navigate(personalOsTarget(path, overview.data?.domains), { state: anchor ? { knowledgeHeading: anchor } : undefined });
  const detail = selected ? <PersonalOsDomainDetail id={selected.domain} todoId={selected.todoId} onOpen={openFile} onReadFile={(path) => navigate(personalOsFilePath(path))} /> : null;
  const renderGroup = (label: string, items: Todo[], total = items.length) => items.length ? <section key={label} aria-label={label}>
    <h2 className={`${listStyles.group} ${styles.group}`} data-overdue={label === '已逾期'}>{label}<span className={listStyles.groupCount}>{total}</span></h2>
    <div role="listbox" aria-label={`${label}事项`}>
      {items.map((todo) => <TodoRow key={todo.id} todo={todo} today={data?.today ?? ''} selected={selected?.todoId === todo.id} onOpen={() => setSelected({ domain: todo.domain, todoId: todo.id })} onFile={openFile} onComplete={complete.start} />)}
    </div>
    {total > items.length ? <p className={styles.more}>还有 {total - items.length} 条</p> : null}
  </section> : null;
  const count = data ? data.overdue.length + data.dueToday.length : 0;
  const allCount = data ? count + data.next7.length + data.waiting.length + data.undated.total + data.later.count : 0;
  return <PageFrame section="today" detail={overview.data?.exists === false ? null : detail} onClose={close} sidebarFallback={overview.data?.exists === false ? <Missing root={overview.data.root} /> : undefined}>
    <div ref={list} className={`${listStyles.list} ${styles.column}`} data-testid="personalos-today">
      {overview.isError ? <ReadWarning message={`概览读取失败：${describeError(overview.error)}`} updatedAt={overview.dataUpdatedAt} onRetry={() => void overview.refetch()} retrying={overview.isFetching} /> : null}
      {overview.data?.exists === false ? <Missing root={overview.data.root} /> : <>
        {overview.data?.focus.length ? <div className={styles.focus} data-testid="personalos-focus"><span className={styles.focusLabel}>当前重点</span>{overview.data.focus.slice(0, 3).map((focus, index) => <button key={index} title={focus} onClick={() => setSelected({ domain: overview.data?.domains.find((domain) => domain.path === '我')?.id ?? '我' })}>{focus}</button>)}</div> : null}
        {today.isError ? <ReadWarning message={`今天事项读取失败：${describeError(today.error)}`} updatedAt={today.dataUpdatedAt} onRetry={() => void today.refetch()} retrying={today.isFetching} /> : null}
        {today.isPending ? <p className={styles.note}>正在读取今天的事项…</p> : null}
        {data ? <>
          <div className={styles.summary} data-testid="personalos-summary"><span>{data.today} {week(data.today)}</span><span>{count} 件到期或逾期</span><span>{data.waiting.length} 件等待中</span><span>收件箱 {data.inbox.length} 条未分拣</span></div>
          {data.warnings.length ? <p className={styles.notice} role="status">有 {data.warnings.length} 项资料需要核对，详情中保留了原文与读取说明。</p> : null}
          {allCount === 0 ? <EmptyState icon="book" title="没有到期的事" /> : null}
          {renderGroup('已逾期', data.overdue)}
          {renderGroup('今天到期', data.dueToday)}
          {renderGroup('未来 7 天', data.next7)}
          {renderGroup('等待中', data.waiting)}
          {renderGroup('无日期', data.undated.items, data.undated.total)}
          {data.later.count ? <section aria-label="更晚"><details className={styles.later}><summary>更晚 <span>{data.later.count}</span></summary><div role="listbox" aria-label="更晚事项">{data.later.items.map((todo) => <TodoRow key={todo.id} todo={todo} today={data.today} selected={selected?.todoId === todo.id} onOpen={() => setSelected({ domain: todo.domain, todoId: todo.id })} onFile={openFile} onComplete={complete.start} />)}</div></details></section> : null}
          {data.staleDomains.length ? <section aria-label="需要留意"><h2 className={`${listStyles.group} ${styles.group}`}>需要留意</h2><div className={styles.stale}>{data.staleDomains.map((domain) => <button key={domain.id} className={styles.staleItem} onClick={() => setSelected({ domain: domain.id })}>{domain.name}<span>{domain.staleDays === null ? '没有更新日期' : `${domain.staleDays} 天未更新`}</span>{domain.exists ? null : <span>目录不存在</span>}</button>)}</div></section> : null}
          <section aria-label="收件箱"><h2 className={`${listStyles.group} ${styles.group}`}>收件箱<span className={listStyles.groupCount}>{data.inbox.length}</span></h2><QuickNote today={data.today} focus={noteFocus} /><p className={styles.note}>晨间简报时由 agent 分拣</p>{data.inbox.length ? <ul className={styles.inbox}>{data.inbox.map((entry) => <li key={`${entry.date}:${entry.line}`}><time>{entry.date}</time><span>{entry.text}</span></li>)}</ul> : null}</section>
        </> : null}
      </>}
    </div>
  {complete.dialog}
  </PageFrame>;
}

function DomainGrid({ overview, selected, onOpen }: { overview: Overview; selected: string | null; onOpen: (path: string) => void }) {
  const navigate = useAppNavigate();
  const domains = [...overview.domains.filter((domain) => domain.path === '我'), ...overview.domains.filter((domain) => domain.path !== '我')];
  return <>
    <div className={styles.grid} role="listbox" aria-label="领域列表" data-testid="personalos-domains">
      {domains.map((domain) => <button key={domain.id} type="button" role="option" aria-selected={domain.id === selected} aria-label={`领域：${domain.name}`} data-domain-id={domain.id} data-pos-focus className={styles.card} onClick={() => navigate(domainPath(domain.id))}>
        <span className={styles.cardTitle}>{domain.name}{domain.registered ? null : <span className={styles.badge}>未登记</span>}{domain.exists ? null : <span className={styles.badge}>目录不存在</span>}</span>
        <span className={styles.updated} data-stale={domain.stale}>{domain.updatedAt ? `更新于 ${domain.updatedAt}${domain.stale ? ` · ${domain.staleDays} 天前` : ''}` : '没有更新日期'}</span>
        <span className={styles.cardCounts}>{domain.openCount} 件未结事项{domain.overdueCount ? <span className={styles.warn}>其中 {domain.overdueCount} 件逾期</span> : null}{domain.gapCount ? <span>待补充 {domain.gapCount} 处</span> : null}</span>
        {domain.latestChange ? <span className={styles.change} title={`${domain.latestChange.date} ${domain.latestChange.text}`}>{domain.latestChange.date} {domain.latestChange.text}</span> : null}
      </button>)}
    </div>
    {overview.documents.length ? <nav className={styles.about} aria-label="关于 PersonalOS"><span>关于 PersonalOS：</span>{[...overview.documents.filter((file) => file.path === 'README.md' && overview.routerFile === 'README.md'), ...overview.documents.filter((file) => file.path === 'AGENTS.md' || file.path.startsWith('协议/') || file.path.startsWith('蓝图/'))].map((file) => <button key={file.path} onClick={() => onOpen(file.path)}>{file.path === 'README.md' ? '导航' : file.path === 'AGENTS.md' ? (overview.routerFile === 'README.md' ? '工作约定' : '入口说明') : file.path.replace(/\.md$/i, '')}</button>)}</nav> : null}
  </>;
}

function DomainsView({ route }: { route: Extract<PageRoute, { view: 'domains' | 'file' }> }) {
  const overview = usePersonalOsOverview(); const navigate = useAppNavigate(); const list = useRef<HTMLDivElement>(null);
  const selected = route.view === 'domains' ? route.domain : null;
  const close = useCallback(() => {
    navigate(DOMAINS_PATH);
    if (selected) requestAnimationFrame(() => list.current?.querySelector<HTMLElement>(`[data-domain-id="${CSS.escape(selected)}"]`)?.focus());
  }, [navigate, selected]);
  const open = (path: string, anchor?: string) => navigate(personalOsTarget(path, overview.data?.domains), { state: anchor ? { knowledgeHeading: anchor } : undefined });
  const heading = typeof window.history.state?.knowledgeHeading === 'string' ? window.history.state.knowledgeHeading as string : null;
  const detail = route.view === 'file' ? <FileReader library="personalos" path={route.file} heading={heading} onOpen={open} /> : selected ? <PersonalOsDomainDetail id={selected} heading={heading} onOpen={open} onReadFile={(path) => navigate(personalOsFilePath(path))} /> : null;
  useNavigationKeys(list, true, detail ? close : null);
  return <PageFrame section="domains" detail={overview.data?.exists === false ? null : detail} onClose={close} sidebarFallback={overview.data?.exists === false ? <Missing root={overview.data.root} /> : undefined}>
    <div ref={list} className={`${listStyles.list} ${styles.column}`}>
      {overview.isError ? <ReadWarning message={`领域读取失败：${describeError(overview.error)}`} updatedAt={overview.dataUpdatedAt} onRetry={() => void overview.refetch()} retrying={overview.isFetching} /> : null}
      {overview.isPending ? <p className={styles.note}>正在读取领域…</p> : null}
      {overview.data ? overview.data.exists ? <DomainGrid overview={overview.data} selected={selected} onOpen={open} /> : <Missing root={overview.data.root} /> : null}
    </div>
  </PageFrame>;
}

function Redirect({ to }: { to: string }) {
  const navigate = useAppNavigate();
  useEffect(() => navigate(to, { replace: true }), [navigate, to]);
  return null;
}

export function PersonalOsPage({ route }: { route: PageRoute }) {
  if (route.view === 'redirect') return <Redirect to={route.to} />;
  if (route.view === 'commits') return <CommitView sha={route.sha} />;
  if (route.view === 'today') return <TodayView />;
  if (route.view === 'domains' || route.view === 'file') return <DomainsView route={route} />;
  return <PageFrame section={route.view} onClose={() => {}}>{route.view === 'resources' ? <PersonalOsResources /> : <PersonalOsActivity />}</PageFrame>;
}
