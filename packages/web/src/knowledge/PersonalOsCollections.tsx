import type { PersonalOsLogResponse, PersonalOsOverviewResponse } from '@bluemanta/server/api-types';
import { useEffect, useState } from 'react';
import { describeError } from '../api/client';
import { useAppNavigate } from '../app/context';
import listStyles from '../ideas/IdeaList.module.css';
import { Button } from '../ui/Button';
import { EmptyState } from '../ui/EmptyState';
import { Icon } from '../ui/Icon';
import { usePersonalOsLog, usePersonalOsOverview, usePersonalOsRegistry } from './api';
import { InlineMarkdown, Markdown, type MarkdownProps } from './Markdown';
import { PersonalOsRegistryTable, PERSONAL_OS_GAP_TERMS } from './PersonalOsDomainDetail';
import { PersonalOsMissing, PersonalOsReadWarning } from './PersonalOsReadState';
import { personalOsTarget } from './personalos-paths';
import common from './Knowledge.module.css';
import styles from './PersonalOsCollections.module.css';

type Domain = PersonalOsOverviewResponse['domains'][number];
type LogEntry = PersonalOsLogResponse['items'][number];
type Page = { data: PersonalOsLogResponse; updatedAt: number };
type LocationKind = 'all' | 'local' | 'link' | 'other';

export function ResourceTabs({ selected }: { selected: 'registry' | 'arsenal' }) {
  const navigate = useAppNavigate();
  return <nav className={`${common.tabs} ${styles.resourceTabs}`} aria-label="资料视图">
    <button type="button" className={common.tab} aria-pressed={selected === 'registry'} onClick={() => navigate('/knowledge/resources')}>资料登记</button>
    <button type="button" className={common.tab} aria-pressed={selected === 'arsenal'} onClick={() => navigate('/knowledge/resources/arsenal')}>Arsenal</button>
  </nav>;
}

/** Domain selection uses route order, with any otherwise unlisted source domains appended. */
function domainOptions(domains: readonly Domain[], extra: readonly string[] = []): Array<{ id: string; name: string }> {
  return [...domains.map(({ id, name }) => ({ id, name })), ...[...new Set(extra)].filter((id) => !domains.some((domain) => domain.id === id)).map((id) => ({ id, name: id }))];
}

function DomainFilters({ options, selected, onChange, unassigned }: { options: Array<{ id: string; name: string }>; selected: readonly string[]; onChange: (ids: string[]) => void; unassigned?: { selected: boolean; onChange: (value: boolean) => void } }) {
  return <div role="group" aria-label="领域" className={styles.filterGroup}>
    <span className={styles.filterLabel}>领域</span>
    <button type="button" className={common.chip} aria-pressed={selected.length === 0 && !unassigned?.selected} onClick={() => { onChange([]); unassigned?.onChange(false); }}>全部</button>
    {options.map((domain) => <button key={domain.id} type="button" className={common.chip} aria-pressed={selected.includes(domain.id)} onClick={() => onChange(selected.includes(domain.id) ? selected.filter((id) => id !== domain.id) : [...selected, domain.id])}>{domain.name}</button>)}
    {unassigned ? <button type="button" className={common.chip} aria-pressed={unassigned.selected} onClick={() => unassigned.onChange(!unassigned.selected)}>未归领域</button> : null}
  </div>;
}

export function PersonalOsResources() {
  const overview = usePersonalOsOverview(); const registry = usePersonalOsRegistry(); const navigate = useAppNavigate();
  const [domains, setDomains] = useState<string[]>([]);
  const [locationKind, setLocationKind] = useState<LocationKind>('all');
  const [missingOnly, setMissingOnly] = useState(false);
  const rows = (registry.data?.items ?? []).filter((row) => (domains.length === 0 || domains.includes(row.domain)) && (locationKind === 'all' || row.location.kind === locationKind) && (!missingOnly || (row.location.kind === 'local' && row.location.exists === false)));
  const open: MarkdownProps['onOpen'] = (path, anchor) => navigate(personalOsTarget(path, overview.data?.domains), { state: anchor ? { knowledgeHeading: anchor } : undefined });
  const clear = () => { setDomains([]); setLocationKind('all'); setMissingOnly(false); };
  return <div className={styles.page} data-testid="personalos-resources">
    <ResourceTabs selected="registry" />
    {overview.isError ? <PersonalOsReadWarning message={`概览读取失败：${describeError(overview.error)}`} updatedAt={overview.dataUpdatedAt} onRetry={() => void overview.refetch()} retrying={overview.isFetching} /> : null}
    {overview.data?.exists === false ? <PersonalOsMissing root={overview.data.root} /> : <>
      <div className={styles.filters} role="toolbar" aria-label="资料筛选">
        <DomainFilters options={domainOptions(overview.data?.domains ?? [], (registry.data?.items ?? []).map((row) => row.domain))} selected={domains} onChange={setDomains} />
        <div role="group" aria-label="位置类型" className={styles.filterGroup}><span className={styles.filterLabel}>位置</span>{([{ id: 'all', label: '全部' }, { id: 'local', label: '本机' }, { id: 'link', label: '链接' }, { id: 'other', label: '其他' }] as const).map((kind) => <button key={kind.id} type="button" className={common.chip} aria-pressed={locationKind === kind.id} onClick={() => setLocationKind(kind.id)}>{kind.label}</button>)}</div>
        <button type="button" className={common.chip} aria-pressed={missingOnly} onClick={() => setMissingOnly((value) => !value)}>本机路径不存在</button>
        <span className={common.count} aria-live="polite" data-testid="registry-count">{registry.data ? `${rows.length} 条资料` : ''}</span>
      </div>
      {registry.isError ? <PersonalOsReadWarning message={`资料读取失败：${describeError(registry.error)}`} updatedAt={registry.dataUpdatedAt} onRetry={() => void registry.refetch()} retrying={registry.isFetching} /> : null}
      <div className={styles.content}>
        {registry.isPending ? <p className={common.none}>正在读取资料登记…</p> : registry.data ? rows.length ? <PersonalOsRegistryTable rows={rows} onOpen={open} /> : <EmptyState icon="book" title="没有符合条件的资料" action={domains.length || locationKind !== 'all' || missingOnly ? <Button onClick={clear}>清除筛选</Button> : undefined} /> : null}
      </div>
    </>}
  </div>;
}

function shiftDate(date: string, days: number): string {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function dateLabel(date: string): string {
  if (date.length !== 10) return date;
  return `${date.slice(5)} ${['周日', '周一', '周二', '周三', '周四', '周五', '周六'][new Date(`${date}T00:00:00Z`).getUTCDay()]}`;
}

function ActivityEntry({ entry, onOpen }: { entry: LogEntry; onOpen: MarkdownProps['onOpen'] }) {
  const content = <>{entry.domain ? <span className={common.tag}>{entry.domain}</span> : entry.tag !== undefined ? <span className={common.tag} data-testid="personalos-log-tag">{entry.tag}</span> : null}<span className={styles.entryText}><InlineMarkdown source={entry.title ?? entry.text} basePath={entry.file} onOpen={onOpen} highlightTerms={PERSONAL_OS_GAP_TERMS} /></span></>;
  if (entry.kind === 'section') return <details className={styles.logSection} data-testid="personalos-log-entry" data-log-id={entry.id}>
    <summary className={styles.entry} title={entry.title ?? entry.text}><Icon name="right" />{content}</summary>
    <div className={styles.sectionBody}><Markdown source={entry.markdown ?? ''} basePath={entry.file} onOpen={onOpen} highlightTerms={PERSONAL_OS_GAP_TERMS} /></div>
  </details>;
  return <div className={styles.entry} data-testid="personalos-log-entry" data-log-id={entry.id} title={entry.text}>{content}</div>;
}

/** Each cursor owns a 30-day window, including empty windows; older records cannot create gaps. */
function ActivityTimeline({ domains, includeUnassigned, today, onOpen }: { domains: readonly string[]; includeUnassigned: boolean; today: string; onOpen: MarkdownProps['onOpen'] }) {
  const [before, setBefore] = useState(() => shiftDate(today, 1));
  const [pages, setPages] = useState<Record<string, Page>>({});
  const query = usePersonalOsLog(domains, before, includeUnassigned);
  useEffect(() => {
    if (query.data) setPages((current) => ({ ...current, [before]: { data: query.data!, updatedAt: query.dataUpdatedAt } }));
  }, [before, query.data, query.dataUpdatedAt]);
  const loaded = { ...pages, ...(query.data ? { [before]: { data: query.data, updatedAt: query.dataUpdatedAt } } : {}) };
  const unique = new Map<string, LogEntry>();
  for (const page of Object.values(loaded)) for (const item of page.data.items) unique.set(item.id, item);
  const items = [...unique.values()].sort((a, b) => b.date.localeCompare(a.date) || a.file.localeCompare(b.file) || a.line - b.line);
  const dates = [...new Set(items.map((item) => item.date))];
  const updatedAt = Math.max(0, ...Object.values(loaded).map((page) => page.updatedAt));
  const warnings = [...new Map(Object.values(loaded).flatMap((page) => page.data.warnings).map((warning) => [JSON.stringify(warning), warning])).values()];
  return <>
    {query.isError ? <PersonalOsReadWarning message={`动态读取失败：${describeError(query.error)}`} updatedAt={updatedAt} onRetry={() => void query.refetch()} retrying={query.isFetching} /> : null}
    <div className={`${listStyles.list} ${styles.timeline}`}>
      {query.isPending ? <p className={common.none}>正在读取动态…</p> : null}
      {warnings.length ? <details className={styles.warnings}><summary>读取提示（{warnings.length}）</summary><ul>{warnings.map((warning, index) => <li key={index}>{warning.message}</li>)}</ul></details> : null}
      {dates.map((date) => <section key={date} aria-label={date}><h2 className={`${listStyles.group} ${styles.dateGroup}`}><time dateTime={date}>{dateLabel(date)}</time></h2>{items.filter((item) => item.date === date).map((entry) => <ActivityEntry key={entry.id} entry={entry} onOpen={onOpen} />)}</section>)}
      {query.data && items.length === 0 ? <EmptyState icon="book" title="这段时间没有动态" /> : null}
      {query.data?.hasMore ? <div className={styles.loadMore}><Button disabled={query.isFetching || query.isError} onClick={() => setBefore((current) => shiftDate(current, -30))}>加载更早</Button></div> : null}
    </div>
  </>;
}

export function PersonalOsActivity() {
  const overview = usePersonalOsOverview(); const navigate = useAppNavigate(); const [domains, setDomains] = useState<string[]>([]);
  const [includeUnassigned, setIncludeUnassigned] = useState(false);
  const open: MarkdownProps['onOpen'] = (path, anchor) => navigate(personalOsTarget(path, overview.data?.domains), { state: anchor ? { knowledgeHeading: anchor } : undefined });
  return <div className={styles.page} data-testid="personalos-activity">
    {overview.isError ? <PersonalOsReadWarning message={`概览读取失败：${describeError(overview.error)}`} updatedAt={overview.dataUpdatedAt} onRetry={() => void overview.refetch()} retrying={overview.isFetching} /> : null}
    {overview.isPending ? <p className={common.none}>正在读取动态…</p> : null}
    {overview.data ? overview.data.exists ? <>
      <div className={styles.filters} role="toolbar" aria-label="动态筛选"><DomainFilters options={domainOptions(overview.data.domains.filter((domain) => domain.registered || domain.name === '我'))} selected={domains} onChange={setDomains} unassigned={{ selected: includeUnassigned, onChange: setIncludeUnassigned }} /><span className={common.count}>最近 30 天起</span></div>
      <ActivityTimeline key={JSON.stringify([overview.data.today, [...domains].sort(), includeUnassigned])} domains={domains} includeUnassigned={includeUnassigned} today={overview.data.today} onOpen={open} />
    </> : <PersonalOsMissing root={overview.data.root} /> : null}
  </div>;
}
