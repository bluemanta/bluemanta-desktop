import type { PersonalOsSourcesResponse } from '@bluemanta/server/api-types';
import { useCallback, useMemo, useRef, useState, type ReactNode } from 'react';
import { useSearch } from 'wouter';
import { describeError } from '../api/client';
import { useAppNavigate } from '../app/context';
import listStyles from '../ideas/IdeaList.module.css';
import { Button } from '../ui/Button';
import { EmptyState } from '../ui/EmptyState';
import { Icon } from '../ui/Icon';
import { usePersonalOsSources, usePersonalOsTaskLog } from './api';
import { PageFrame, useNavigationKeys } from './PersonalOsPage';
import { PersonalOsReadWarning } from './PersonalOsReadState';
import { personalOsFilePath, SOURCES_PATH, TASKS_PATH, taskPath } from './personalos-paths';
import { useCopyPath } from './shared';
import common from './Knowledge.module.css';
import collections from './PersonalOsCollections.module.css';
import styles from './PersonalOsSources.module.css';

type Data = PersonalOsSourcesResponse;
type Source = Data['sources'][number];
type Task = Data['tasks'][number];
type Tone = 'ok' | 'warn' | 'bad' | 'idle';

const METHODS = ['副本', '查询', '登记', '推入'] as const;
const RUNNER: Record<Task['runner'], string> = { launchd: 'launchd', codex: 'Codex', claude: 'Claude' };
const BAD_TASK: readonly Task['state'][] = ['failed', 'signaled', 'not_loaded', 'missing', 'unreadable'];
const FRESHNESS: Record<Source['freshness']['level'], { tone: Tone; label: string }> = {
  ok: { tone: 'ok', label: '正常' }, aging: { tone: 'warn', label: '偏旧' }, stale: { tone: 'bad', label: '过期' },
  probe_missing: { tone: 'bad', label: '探针不存在' }, none: { tone: 'idle', label: '' },
};
function taskTone(task: Task): Tone {
  if (task.state === 'failed' || task.state === 'signaled' || task.state === 'unreadable') return 'bad';
  if (task.state === 'not_loaded' || task.state === 'missing') return 'warn';
  if (task.state === 'ok' || task.state === 'running' || task.state === 'active') return 'ok';
  return 'idle';
}
/** `11-24 22:28`; today shows only the time. */
export function shortTime(iso: string | null, now = new Date()): string {
  if (!iso) return '—';
  const date = new Date(iso); const pad = (value: number) => String(value).padStart(2, '0');
  const time = `${pad(date.getHours())}:${pad(date.getMinutes())}`;
  return date.toDateString() === now.toDateString() ? `今天 ${time}` : `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${time}`;
}
function sourceIssue(source: Source, tasks: ReadonlyMap<string, Task>): boolean {
  return ['aging', 'stale', 'probe_missing'].includes(source.freshness.level)
    || (source.location.kind === 'local' && source.location.exists === false)
    || source.taskRefs.some((ref) => { const task = tasks.get(ref); return !task || BAD_TASK.includes(task.state); });
}
function Dot({ tone, label }: { tone: Tone; label: string }) {
  return <span className={styles.dot} data-tone={tone} role="img" aria-label={label} title={label} />;
}

function Tabs({ tab }: { tab: 'sources' | 'tasks' }) {
  const navigate = useAppNavigate();
  return <nav className={`${common.tabs} ${collections.resourceTabs}`} aria-label="接入视图">
    <button type="button" className={common.tab} aria-pressed={tab === 'sources'} onClick={() => navigate(SOURCES_PATH)}>来源</button>
    <button type="button" className={common.tab} aria-pressed={tab === 'tasks'} onClick={() => navigate(TASKS_PATH)}>定时任务</button>
  </nav>;
}

function SourceCard({ source, tasks }: { source: Source; tasks: ReadonlyMap<string, Task> }) {
  const navigate = useAppNavigate(); const copyPath = useCopyPath();
  const fresh = FRESHNESS[source.freshness.level]; const location = source.location;
  const lastRun = source.freshness.lastRun;
  const freshTitle = [source.interval ? `预期每 ${source.interval.text} 同步一次` : '没有登记预期间隔', lastRun ? `最后运行：${shortTime(lastRun.at)} ${lastRun.status}` : null].filter(Boolean).join('；');
  return <article className={styles.card} data-pos-focus tabIndex={0} aria-label={`来源：${source.name}`} data-testid="personalos-source" data-source={source.name}>
    <header className={styles.cardTitle}>
      <span>{source.name}</span>
      <span className={styles.tag} title={source.methodRaw !== source.method ? `登记表写的是「${source.methodRaw}」，按「登记」处理` : undefined}>{source.methodRaw}</span>
    </header>
    <div className={styles.line} title={location.display}>
      {location.kind === 'local' && location.exists === false ? <span className={styles.missing} title="这个路径现在不存在" aria-label="这个路径现在不存在">●</span> : null}
      {location.kind === 'link' ? <a href={location.url} target="_blank" rel="noreferrer noopener" className={styles.ellipsis}>{location.display}</a> : <span className={styles.ellipsis}>{location.display || '—'}</span>}
      {location.kind === 'local' ? <button type="button" className={common.iconButton} onClick={() => copyPath(location.display)} title={`复制路径：${location.display}`} aria-label={`复制路径：${location.display}`}><Icon name="copy" /></button> : null}
    </div>
    {source.method === '副本' ? <div className={styles.line} data-testid="source-freshness" title={freshTitle}>
      {source.probe ? <>
        <Dot tone={fresh.tone} label={fresh.label || '没有登记预期间隔'} />
        <span>{source.freshness.level === 'probe_missing' ? `探针不存在：${source.probe.display}` : `最后同步 ${shortTime(source.freshness.lastSuccessAt)}`}</span>
        {fresh.label && source.freshness.level !== 'probe_missing' ? <span className={styles.muted}>{fresh.label}</span> : null}
      </> : <span className={styles.muted}>没有登记新鲜度探针</span>}
    </div> : null}
    {source.taskRefs.length ? <div className={styles.links}>{source.taskRefs.map((ref) => {
      const task = tasks.get(ref);
      return <button key={ref} type="button" className={styles.taskLink} onClick={() => navigate(taskPath(ref))} title={ref}>
        <Dot tone={task ? taskTone(task) : 'warn'} label={task?.resultText ?? '找不到'} />{task?.name ?? ref}
      </button>;
    })}</div> : null}
    {source.card ? <button type="button" className={styles.cardLink} onClick={() => navigate(personalOsFilePath(source.card!.path), { state: source.card!.anchor ? { knowledgeHeading: source.card!.anchor } : undefined })}>来源卡：{source.card.title}</button> : null}
  </article>;
}

function SourcesTab({ data, tasks, issuesFirst }: { data: Data; tasks: ReadonlyMap<string, Task>; issuesFirst: boolean }) {
  const [methods, setMethods] = useState<string[]>([]); const [issuesOnly, setIssuesOnly] = useState(issuesFirst);
  const rows = data.sources.filter((source) => (methods.length === 0 || methods.includes(source.method)) && (!issuesOnly || sourceIssue(source, tasks)));
  return <>
    <div className={collections.filters} role="toolbar" aria-label="来源筛选">
      <div role="group" aria-label="方式" className={collections.filterGroup}>
        <span className={collections.filterLabel}>方式</span>
        <button type="button" className={common.chip} aria-pressed={methods.length === 0} onClick={() => setMethods([])}>全部</button>
        {METHODS.map((method) => <button key={method} type="button" className={common.chip} aria-pressed={methods.includes(method)} onClick={() => setMethods(methods.includes(method) ? methods.filter((item) => item !== method) : [...methods, method])}>{method}</button>)}
      </div>
      <button type="button" className={common.chip} aria-pressed={issuesOnly} onClick={() => setIssuesOnly((value) => !value)}>只看异常</button>
      <span className={common.count} aria-live="polite" data-testid="sources-count">{rows.length} 个来源</span>
    </div>
    <div className={collections.content}>
      {rows.length ? <div className={styles.grid} role="list" aria-label="来源列表">{rows.map((source) => <div role="listitem" key={source.name}><SourceCard source={source} tasks={tasks} /></div>)}</div>
        : <EmptyState icon="folder" title={issuesOnly ? '没有异常的来源' : '没有符合条件的来源'} action={methods.length || issuesOnly ? <Button onClick={() => { setMethods([]); setIssuesOnly(false); }}>清除筛选</Button> : undefined} />}
    </div>
  </>;
}

function TaskRow({ task, selected }: { task: Task; selected: boolean }) {
  const navigate = useAppNavigate(); const open = () => navigate(taskPath(task.ref));
  return <div role="option" aria-selected={selected} tabIndex={0} data-pos-focus data-testid="personalos-task" data-task={task.ref} data-state={task.state}
    className={`${listStyles.row} ${styles.task}`} title={`${task.name}（${task.ref}）`}
    onClick={open} onKeyDown={(event) => { if (event.key === 'Enter' && event.target === event.currentTarget) { event.preventDefault(); open(); } }}>
    <Dot tone={taskTone(task)} label={task.resultText} />
    <span className={styles.taskName}>{task.name}</span>
    <span className={styles.tag}>{RUNNER[task.runner]}</span>
    <span className={styles.schedule}>{task.schedule}</span>
    <span className={styles.next} title="下次运行">{task.nextRun ? `下次 ${shortTime(task.nextRun)}` : ''}</span>
    <span className={styles.result} data-tone={taskTone(task)}>{task.resultText}</span>
    {task.sourceNames.length ? <span className={styles.muted}>{task.sourceNames.join('、')}</span> : null}
  </div>;
}

function TasksTab({ data, selected }: { data: Data; selected: string | null }) {
  const group = (label: string, items: Task[]) => <section aria-label={label}>
    <h2 className={`${listStyles.group} ${styles.group}`}>{label}<span className={listStyles.groupCount}>{items.length}</span></h2>
    {items.length ? <div role="listbox" aria-label={label}>{items.map((task) => <TaskRow key={task.ref} task={task} selected={task.ref === selected} />)}</div> : <p className={styles.none}>没有</p>}
  </section>;
  return <div className={collections.content}>
    {group('定时任务', data.tasks)}
    {data.services.length ? group('常驻服务', data.services) : null}
    {data.unregistered.length ? <section aria-label="未登记的自建任务">
      <details className={styles.unregistered} data-testid="unregistered-tasks" open={data.unregistered.some((task) => task.ref === selected) || undefined}>
        <summary>未登记的自建任务 <span>{data.unregistered.length}</span></summary>
        <p className={styles.none}>本机发现、但 <code>我/数据源.md</code> 里没有的任务。打开一个可以复制登记行；不想看到的，登记时把用途写成「忽略」。</p>
        <div role="listbox" aria-label="未登记的自建任务">{data.unregistered.map((task) => <TaskRow key={task.ref} task={task} selected={task.ref === selected} />)}</div>
      </details>
    </section> : null}
  </div>;
}

function TaskLog({ refName }: { refName: string }) {
  const log = usePersonalOsTaskLog(refName);
  if (log.isPending) return <p className={styles.none}>正在读取日志…</p>;
  if (log.isError) return <p className={styles.none}>日志读取失败：{describeError(log.error)}</p>;
  return log.data.lines.length ? <pre className={styles.log} data-testid="task-log">{log.data.lines.join('\n')}</pre> : <p className={styles.none}>日志是空的</p>;
}

function TaskDetail({ task, refName }: { task: Task | null; refName: string }) {
  const copyPath = useCopyPath(); const navigate = useAppNavigate();
  if (!task) return <div data-testid="personalos-task-detail"><EmptyState icon="alert" title="没有找到这个任务">标识：{refName}</EmptyState></div>;
  const snippet = `| ${task.name} | \`${task.ref}\` | ${task.purpose || '用途'} | — | 否 |`;
  const rows: Array<[string, ReactNode]> = [
    ['状态', <span className={styles.result} data-tone={taskTone(task)}>{task.resultText}</span>],
    ['执行方', RUNNER[task.runner]],
    ['时间', task.schedule],
    ['下次运行', task.nextRun ? shortTime(task.nextRun) : '—'],
    ['最近输出', shortTime(task.lastOutputAt)],
  ];
  if (task.purpose) rows.push(['用途', task.purpose]);
  if (task.description) rows.push(['说明', task.description]);
  if (task.sourceNames.length) rows.push(['关联来源', task.sourceNames.join('、')]);
  return <div className={styles.detail} data-testid="personalos-task-detail">
    <h2 className={styles.detailTitle}><Dot tone={taskTone(task)} label={task.resultText} />{task.name}</h2>
    <p className={styles.ref}><code>{task.ref}</code>{task.registered ? null : <span className={styles.tag}>未登记</span>}</p>
    <dl className={styles.facts}>{rows.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
    {task.configPath ? <p className={styles.pathLine}><span className={styles.muted}>配置</span><span className={styles.ellipsis} title={task.configPath}>{task.configPath}</span><button type="button" className={common.iconButton} onClick={() => copyPath(task.configPath)} aria-label={`复制路径：${task.configPath}`} title="复制路径"><Icon name="copy" /></button></p> : null}
    {task.program?.length ? <><h3 className={styles.subTitle}>程序和参数</h3><pre className={styles.log}>{task.program.join('\n')}</pre></> : null}
    {task.logPath ? <p className={styles.pathLine}><span className={styles.muted}>日志</span><span className={styles.ellipsis} title={task.logPath}>{task.logPath}</span><button type="button" className={common.iconButton} onClick={() => copyPath(task.logPath!)} aria-label={`复制路径：${task.logPath}`} title="复制路径"><Icon name="copy" /></button></p> : null}
    {task.logVisible ? <><h3 className={styles.subTitle}>日志最后 20 行</h3><TaskLog refName={task.ref} /></> : task.logPath ? <p className={styles.none}>日志可能含账号信息，登记表没有标为可显示。</p> : null}
    {!task.registered ? <><h3 className={styles.subTitle}>登记行</h3><p className={styles.none}>贴进 <code>我/数据源.md</code> 的「定时任务」表，再改任务名和用途。</p><pre className={styles.log} data-testid="task-snippet">{snippet}</pre>
      <Button size="sm" onClick={() => { void navigator.clipboard?.writeText(snippet); }}>复制登记行</Button></> : null}
    {task.sourceNames.length ? <p><Button size="sm" variant="ghost" onClick={() => navigate(SOURCES_PATH)}>看来源</Button></p> : null}
  </div>;
}

/** 接入页（ADR 0013，规格 personalos-sources 第 5 节）：只读。 */
export function PersonalOsSourcesView({ tab, task }: { tab: 'sources' | 'tasks'; task: string | null }) {
  const sources = usePersonalOsSources(); const navigate = useAppNavigate(); const list = useRef<HTMLDivElement>(null);
  const issuesFirst = new URLSearchParams(useSearch()).get('issues') === '1';
  const data = sources.data;
  const tasks = useMemo(() => new Map((data ? [...data.tasks, ...data.services, ...data.unregistered] : []).map((item) => [item.ref, item] as const)), [data]);
  const close = useCallback(() => {
    navigate(TASKS_PATH);
    if (task) requestAnimationFrame(() => list.current?.querySelector<HTMLElement>(`[data-task="${CSS.escape(task)}"]`)?.focus());
  }, [navigate, task]);
  const detail = task && data ? <TaskDetail task={tasks.get(task) ?? null} refName={task} /> : null;
  useNavigationKeys(list, tab === 'sources', detail ? close : null);
  return <PageFrame section="sources" detail={detail} onClose={close}>
    <div ref={list} className={collections.page} data-testid="personalos-sources">
      <Tabs tab={tab} />
      {sources.isError ? <PersonalOsReadWarning message={`接入状态读取失败：${describeError(sources.error)}`} updatedAt={sources.dataUpdatedAt} onRetry={() => void sources.refetch()} retrying={sources.isFetching} /> : null}
      {sources.isPending ? <p className={styles.none}>正在读取来源和定时任务…</p> : null}
      {data?.warnings.length ? <p className={styles.notice} role="status" title={data.warnings.map((warning) => warning.message).join('；')}>{data.warnings.map((warning) => warning.message).join('；')}</p> : null}
      {data && !data.registry.exists ? <div className={styles.notice} data-testid="sources-registry-missing">还没有 <code>我/数据源.md</code>。接入新来源时，先在领域的「去哪查」写来源卡，再在这个文件里登记来源和刷新任务。下面发现的任务都算未登记。</div> : null}
      {data ? tab === 'sources'
        ? data.registry.exists ? <SourcesTab data={data} tasks={tasks} issuesFirst={issuesFirst} /> : <EmptyState icon="folder" title="还没有登记来源" />
        : <TasksTab data={data} selected={task} /> : null}
    </div>
  </PageFrame>;
}

/** 今天页提醒行（规格 5.3）：有失败任务或过期来源时显示，未登记任务不触发。 */
export function SourcesAlert() {
  const sources = usePersonalOsSources(); const navigate = useAppNavigate();
  const summary = sources.data?.summary;
  if (!summary || summary.failedTasks + summary.staleSources === 0) return null;
  const parts = [summary.failedTasks ? `${summary.failedTasks} 个任务失败` : null, summary.staleSources ? `${summary.staleSources} 个来源过期` : null].filter(Boolean);
  return <button type="button" className={styles.alert} data-testid="sources-alert" onClick={() => navigate(summary.staleSources ? `${SOURCES_PATH}?issues=1` : TASKS_PATH)}>
    <Icon name="alert" /><span>{parts.join(' · ')}</span><span className={styles.alertGo}>去接入页看看</span>
  </button>;
}
