import type { PersonalOsDomainResponse } from '@bluemanta/server/api-types';
import { Fragment, useEffect, useRef, useState, type ReactNode } from 'react';
import { describeError } from '../api/client';
import { Banner } from '../ui/Banner';
import { Icon } from '../ui/Icon';
import { usePersonalOsDomain, usePersonalOsOverview } from './api';
import { InlineMarkdown, Markdown, scrollToHeading, type MarkdownProps } from './Markdown';
import { resolveLink } from './mdParse';
import { formatDate, formatSize, useCopyPath } from './shared';
import common from './Knowledge.module.css';
import styles from './PersonalOsDetail.module.css';

type Domain = PersonalOsDomainResponse;
type Todo = Domain['todos'][number];
type Section = Domain['sections'][number];
type FileEntry = Domain['files'][number];
type OpenFile = MarkdownProps['onOpen'];
import { DomainCommits, useDomainCommits } from './PersonalOsGit';
type Tab = 'status' | 'registry' | 'matters' | 'knowledge' | 'files' | 'commits';
export const PERSONAL_OS_GAP_TERMS = ['待补充', '（推断）', '未核验'] as const;

type PersonalOsDomainDetailProps = { id: string; todoId?: string | null; heading?: string | null; onOpen: OpenFile; onReadFile?: (path: string) => void };

function dueLabel(todo: Todo, today: string): string | null {
  if (!todo.due) return null;
  const days = Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${todo.due}T00:00:00Z`)) / 86_400_000);
  if (!todo.done && days > 0) return `逾期 ${days} 天`;
  if (days === 0) return '今天';
  const day = new Date(`${todo.due}T12:00:00`).getDay();
  return `${['周日', '周一', '周二', '周三', '周四', '周五', '周六'][day]} ${todo.due.slice(5)}`;
}

function TodoRow({ todo, today, onOpen, onAnchor }: { todo: Todo; today: string; onOpen: OpenFile; onAnchor: (anchor: string) => void }) {
  return <div className={styles.todo} data-todo-id={todo.id} data-done={todo.done} tabIndex={-1}>
    <span className={styles.circle} aria-label={todo.done ? '已完成（只读）' : '未完成（只读）'}>{todo.done ? '✓' : '○'}</span>
    <span className={styles.todoText}><InlineMarkdown source={todo.text} basePath={todo.file} onOpen={onOpen} onAnchor={onAnchor} highlightTerms={PERSONAL_OS_GAP_TERMS} /></span>
    <span className={styles.todoMeta}>
      {todo.wait !== null ? <span className={common.tag} title="等了多久：未记录">等待：{todo.wait || '未记录对象'}</span> : null}
      {todo.every ? <span className={common.tag}>每 {todo.every}</span> : null}
      {todo.tags.map((tag, index) => <span key={index} className={common.tag}>{tag}</span>)}
      {todo.due ? <time dateTime={todo.due} data-overdue={!todo.done && todo.due < today} title={todo.due}>{dueLabel(todo, today)}</time> : null}
      {todo.doneAt ? <time dateTime={todo.doneAt}>完成于 {todo.doneAt}</time> : null}
      {todo.warnings.map((warning, index) => <span key={index} className={styles.warning}>{warning.message}</span>)}
    </span>
  </div>;
}

/** Replace only the server-parsed source lines; retain all other Markdown in place. */
function structuredSection(data: Domain, sectionIndex: number, renderLine: (line: number) => ReactNode | null, renderMarkdown: (source: string, key: string) => ReactNode): ReactNode[] {
  const section = data.sections[sectionIndex]!;
  const source = data.markdown.replace(/\r\n?/g, '\n').split('\n');
  const start = section.title ? section.line : 0;
  const end = data.sections[sectionIndex + 1]?.line ? data.sections[sectionIndex + 1]!.line - 1 : source.length;
  const result: ReactNode[] = [];
  let pending: string[] = [];
  const flush = (line: number) => {
    if (pending.some((text) => text.trim() !== '')) result.push(renderMarkdown(pending.join('\n'), `text-${line}`));
    pending = [];
  };
  for (let index = start; index < end; index += 1) {
    const node = renderLine(index + 1);
    if (node !== null) { flush(index); result.push(<Fragment key={`line-${index}`}>{node}</Fragment>); }
    else pending.push(source[index] ?? '');
  }
  flush(end);
  return result;
}

/** Split only the known mount headings, leaving their bodies with the shared renderer. */
function referenceParts(markdown: string): Array<{ title: string | null; markdown: string }> {
  const parts: Array<{ title: string | null; markdown: string }> = [];
  let title: string | null = null;
  let lines: string[] = [];
  let fence: { marker: string; length: number } | null = null;
  const flush = () => { if (title !== null || lines.some((line) => line.trim())) parts.push({ title, markdown: lines.join('\n') }); };
  for (const line of markdown.split('\n')) {
    const marker = /^\s*(`{3,}|~{3,})/.exec(line)?.[1];
    if (marker) {
      if (!fence) fence = { marker: marker[0]!, length: marker.length };
      else if (marker[0] === fence.marker && marker.length >= fence.length) fence = null;
      lines.push(line);
      continue;
    }
    const heading = fence ? null : /^###\s+(.+?)\s*#*\s*$/.exec(line);
    if (heading) { flush(); title = heading[1]!.trim(); lines = []; }
    else lines.push(line);
  }
  flush();
  return parts;
}

function Files({ files, domainPath, onOpen }: { files: readonly FileEntry[]; domainPath: string; onOpen: OpenFile }) {
  if (files.length === 0) return <p className={common.none}>这里还没有文件。</p>;
  return <ul className={common.files}>{files.map((entry) => <li key={entry.path} className={common.fileRow}>
    <Icon name="file" />
    <button type="button" className={common.fileName} title={entry.path} onClick={() => onOpen(entry.path)}>{entry.path.startsWith(`${domainPath}/`) ? entry.path.slice(domainPath.length + 1) : entry.name}</button>
    <span className={common.fileMeta}>{entry.availability === 'icloud' ? '尚未从 iCloud 下载' : formatSize(entry.size)}</span>
    {entry.modifiedAt ? <span className={common.fileMeta}>{formatDate(entry.modifiedAt)}</span> : null}
  </li>)}</ul>;
}

export function PersonalOsRegistryTable({ rows, onOpen }: { rows: Domain['registry']; onOpen: OpenFile }) {
  const copyPath = useCopyPath();
  if (rows.length === 0) return <p className={common.none}>这个领域还没有资料登记</p>;
  return <div className={styles.tableWrap}><table aria-label="资料登记" data-testid="personalos-registry"><thead><tr>{['领域', '主题', '资料', '位置', '用途', '状态'].map((label) => <th key={label}>{label}</th>)}</tr></thead>
    <tbody>{rows.map((row, index) => {
      const location = row.location;
      const target = location.kind === 'link' ? resolveLink(location.url ?? location.display, row.source) : null;
      return <tr key={`${row.source}:${index}`} data-missing={location.kind === 'local' && location.exists === false}>
        {[row.domain, row.topic, row.title].map((value, cell) => <td key={cell} title={value}><div className={styles.tableText}><InlineMarkdown source={value} basePath={row.source} onOpen={onOpen} highlightTerms={PERSONAL_OS_GAP_TERMS} /></div></td>)}
        <td title={location.display}><div className={styles.tableLocation}>
          {location.kind === 'local' && location.exists === false ? <span className={styles.warning} title="这个路径现在不存在" aria-label="这个路径现在不存在">● </span> : null}
          {target?.kind === 'external' ? <a className={styles.tableText} href={target.href} target="_blank" rel="noreferrer noopener">{location.display}</a> : <span className={styles.tableText}>{location.display}</span>}
          {location.kind === 'local' ? <button type="button" className={common.iconButton} onClick={() => copyPath(location.display)} title={`复制路径：${location.display}`} aria-label={`复制路径：${location.display}`}><Icon name="copy" /></button> : null}
        </div></td>
        {[row.purpose, row.status].map((value, cell) => <td key={cell} title={value}><div className={styles.tableText}><InlineMarkdown source={value} basePath={row.source} onOpen={onOpen} highlightTerms={PERSONAL_OS_GAP_TERMS} /></div></td>)}
      </tr>;
    })}</tbody></table></div>;
}

export function PersonalOsDomainDetail({ id, todoId = null, heading = null, onOpen, onReadFile = onOpen }: PersonalOsDomainDetailProps) {
  const query = usePersonalOsDomain(id);
  const commits = useDomainCommits(id);
  const overview = usePersonalOsOverview();
  const copyPath = useCopyPath();
  const root = useRef<HTMLDivElement>(null);
  const [selection, setSelection] = useState<{ id: string; tab: Tab }>({ id, tab: 'status' });
  const tab = selection.id === id ? selection.tab : 'status';
  const data = query.data;
  useEffect(() => { setSelection({ id, tab: 'status' }); }, [id, todoId, heading]);
  useEffect(() => {
    if (!data || tab !== 'status' || !root.current) return;
    if (todoId) {
      const target = [...root.current.querySelectorAll<HTMLElement>('[data-todo-id]')].find((element) => element.dataset.todoId === todoId);
      if (target) {
        target.scrollIntoView({ block: 'center' });
        target.focus({ preventScroll: true });
        target.dataset.flash = 'true';
        const timer = window.setTimeout(() => delete target.dataset.flash, 1600);
        return () => { window.clearTimeout(timer); delete target.dataset.flash; };
      }
    } else if (heading) scrollToHeading(root.current, heading);
  }, [data?.id, tab, todoId, heading]);

  if (query.isPending) return <p className={common.none}>正在读取…</p>;
  const error = query.isError ? <Banner onRetry={() => void query.refetch()} retrying={query.isFetching}>读不到这个领域：{describeError(query.error)}{data ? `。以下是 ${new Date(query.dataUpdatedAt).toLocaleTimeString()} 读取的旧数据。` : ''}</Banner> : null;
  if (!data) return <div className={styles.alert}>{error}</div>;
  const tabs: Array<{ id: Tab; label: string }> = [{ id: 'status', label: '状态' }, { id: 'registry', label: '资料' }];
  if (data.matters.some((matter) => matter.files.length > 0 || matter.entry)) tabs.push({ id: 'matters', label: '事项' });
  if (data.knowledge.length > 0) tabs.push({ id: 'knowledge', label: '知识' });
  tabs.push({ id: 'files', label: '文件' });
  if (commits.data?.available) tabs.push({id:'commits',label:'提交'});
  const current = tabs.find((item) => item.id === tab) ?? tabs[0]!;
  const onAnchor = (anchor: string) => { scrollToHeading(root.current, anchor); };
  const markdown = (source: string, key?: string) => <Markdown key={key} source={source} basePath={data.file} onOpen={onOpen} onAnchor={onAnchor} highlightTerms={PERSONAL_OS_GAP_TERMS} />;
  const renderSection = (section: Section, index: number) => {
    if (section.empty) return <p className={common.none}>{section.markdown.trim()}</p>;
    if (section.kind === 'todos') return structuredSection(data, index, (line) => {
      const todo = data.todos.find((item) => item.line === line);
      return todo ? <TodoRow todo={todo} today={overview.data?.today ?? ''} onOpen={onOpen} onAnchor={onAnchor} /> : null;
    }, markdown);
    if (section.kind === 'changes') return structuredSection(data, index, (line) => {
      const change = data.changes.find((item) => item.line === line);
      return change ? <div className={styles.change}><time dateTime={change.date}>{change.date}</time><InlineMarkdown source={change.text} basePath={data.file} onOpen={onOpen} onAnchor={onAnchor} highlightTerms={PERSONAL_OS_GAP_TERMS} /></div> : null;
    }, markdown);
    if (section.kind === 'references') return referenceParts(section.markdown).map((part, partIndex) => part.title === null ? markdown(part.markdown, `links-${partIndex}`) : <section key={partIndex} className={styles.mount} data-testid="personalos-mount"><h4 data-heading={part.title}><InlineMarkdown source={part.title} basePath={data.file} onOpen={onOpen} onAnchor={onAnchor} highlightTerms={PERSONAL_OS_GAP_TERMS} /><span className={common.tag}>外部 · 只读</span></h4>{markdown(part.markdown)}</section>);
    return <Markdown source={section.markdown} basePath={data.file} onOpen={onOpen} onAnchor={onAnchor} highlightTerms={PERSONAL_OS_GAP_TERMS} />;
  };

  return <div ref={root} data-testid="personalos-domain-detail">
    {error ? <div className={styles.alert}>{error}</div> : null}
    <h2 className={common.detailTitle}>{data.name}{!data.registered ? <span className={common.tag}>未登记</span> : null}</h2>
    <div className={common.meta}>
      <span className={data.stale ? styles.warning : undefined}>{data.updatedAt ? `更新于 ${data.updatedAt}` : '没有更新日期'}</span><span className={common.tag}>只读</span>
      <span className={common.path}>{data.file}</span>
      <button type="button" className={common.iconButton} title={data.file} onClick={() => copyPath(`${overview.data?.root ?? '~/Documents/PersonalOS'}/${data.file}`)}><Icon name="copy" />复制路径</button>
    </div>
    {data.warnings.length > 0 ? <details className={styles.warnings}><summary>读取提示（{data.warnings.length}）</summary><ul>{data.warnings.map((warning, index) => <li key={index}>{warning.message}</li>)}</ul></details> : null}
    <div className={common.tabs} role="tablist" aria-label="领域内容">{tabs.map((item) => <button key={item.id} type="button" className={common.tab} role="tab" aria-selected={current.id === item.id} onClick={() => setSelection({ id, tab: item.id })}>{item.label}</button>)}</div>
    <div role="tabpanel" aria-label={current.label}>
      {current.id === 'status' ? <>
        {data.availability !== 'available' ? <p className={common.notice}>{!data.exists ? '这个领域的目录不存在。' : data.availability === 'icloud' ? '状态文件尚未从 iCloud 下载。请在访达中下载后重试。' : data.availability === 'missing' ? '这个领域还没有状态.md。' : '状态文件暂时无法读取，请检查文件后重试。'} <button type="button" className={common.linkButton} onClick={() => void query.refetch()}>重试</button></p> : null}
        {data.sections.map((section, index) => <section key={`${section.line}:${index}`} className={styles.section}>{section.title ? <h3 className={styles.sectionTitle} data-heading={section.title}><InlineMarkdown source={section.title} basePath={data.file} onOpen={onOpen} onAnchor={onAnchor} highlightTerms={PERSONAL_OS_GAP_TERMS} /></h3> : null}{renderSection(section, index)}</section>)}
      </> : null}
      {current.id === 'commits' && commits.data?.available ? <DomainCommits domain={id} commits={commits.data.commits} /> : null}
      {current.id === 'registry' ? <PersonalOsRegistryTable rows={data.registry} onOpen={onOpen} /> : null}
      {current.id === 'matters' ? data.matters.map((matter) => <section key={matter.path} className={styles.section}><h3 className={styles.sectionTitle}>{matter.name}</h3><Files files={matter.files} domainPath={data.path} onOpen={onReadFile} /></section>) : null}
      {current.id === 'knowledge' ? <Files files={data.knowledge} domainPath={data.path} onOpen={onReadFile} /> : null}
      {current.id === 'files' ? <Files files={data.files.filter((file) => file.kind === 'markdown')} domainPath={data.path} onOpen={onReadFile} /> : null}
    </div>
  </div>;
}
