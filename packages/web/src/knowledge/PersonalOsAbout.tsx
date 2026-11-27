import type { PersonalOsAboutResponse } from '@bluemanta/server/api-types';
import { useCallback, useRef, useState, type ReactNode } from 'react';
import { describeError } from '../api/client';
import { useAppNavigate } from '../app/context';
import { Icon } from '../ui/Icon';
import { usePersonalOsAbout } from './api';
import { FileReader } from './FileReader';
import { PageFrame, useNavigationKeys } from './PersonalOsPage';
import { PersonalOsMissing, PersonalOsReadWarning } from './PersonalOsReadState';
import { SOURCES_PATH, TASKS_PATH, domainPath, personalOsTarget } from './personalos-paths';
import styles from './PersonalOsAbout.module.css';

type About = PersonalOsAboutResponse;
type Entry = About['entries'][number];
type TreeNode = About['tree'][number];
type Open = (path: string) => void;

const ROLE: Record<Entry['role'], string> = { router: '路由表', rules: '协作规则', redirect: '转向', protocol: '协议', document: '说明' };
const roleLabel = (entry: Entry): string => ROLE[entry.role];

/** 规格第 15 节：一页看清 PersonalOS 的逻辑架构和「关于」的版本。 */
export function PersonalOsAboutView() {
  const about = usePersonalOsAbout(); const navigate = useAppNavigate();
  const [file, setFile] = useState<string | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const close = useCallback(() => {
    const path = file; setFile(null);
    if (path) requestAnimationFrame(() => root.current?.querySelector<HTMLElement>(`[data-path="${CSS.escape(path)}"]`)?.focus());
  }, [file]);
  const data = about.data;
  const openLink = (path: string, anchor?: string) => navigate(personalOsTarget(path), { state: anchor ? { knowledgeHeading: anchor } : undefined });
  const detail = file && data?.exists ? <FileReader library="personalos" path={file} onOpen={openLink} /> : null;
  useNavigationKeys(root, false, detail ? close : null);
  return <PageFrame section="about" detail={detail} onClose={close} sidebarFallback={data?.exists === false ? <PersonalOsMissing root={data.root} /> : undefined}>
    <div ref={root} className={styles.page} data-testid="personalos-about">
      {about.isError ? <PersonalOsReadWarning message={`关于页读取失败：${describeError(about.error)}`} updatedAt={about.dataUpdatedAt} onRetry={() => void about.refetch()} retrying={about.isFetching} /> : null}
      {about.isPending ? <p className={styles.muted}>正在读取 PersonalOS 的结构…</p> : null}
      {data ? data.exists ? <AboutBody data={data} selected={file} onOpen={setFile} /> : <PersonalOsMissing root={data.root} /> : null}
    </div>
  </PageFrame>;
}

function AboutBody({ data, selected, onOpen }: { data: About; selected: string | null; onOpen: Open }) {
  const navigate = useAppNavigate();
  const current = data.about.current;
  const node = (path: string) => ({ 'data-path': path, 'aria-current': selected === path ? 'true' as const : undefined, onClick: () => onOpen(path) });
  const tasks = data.sources.tasks;
  const runners = ([['launchd', tasks.launchd], ['Codex', tasks.codex], ['Claude', tasks.claude], ['其他', tasks.other]] as const).filter(([, count]) => count > 0).map(([name, count]) => `${name} ${count}`).join(' · ');
  return <>
    <header className={styles.hero} data-testid="about-hero">
      <h1 className={styles.title}>PersonalOS 架构</h1>
      <p className={styles.version} data-testid="about-version">
        {current ? <><span className={styles.versionTag}>关于 {current.version}</span><span>更新于 {current.date}</span></>
          : <span className={styles.muted}>关于：还没有更新记录（<code>{data.about.file}</code>）</span>}
      </p>
      <p className={styles.muted}>{data.root} · 路由表在 <code>{data.routerFile}</code></p>
      <ul className={styles.stats} aria-label="规模">
        <li><b>{data.domains.length}</b>个领域</li>
        <li><b>{data.entries.length}</b>个入口文件</li>
        <li><b>{data.sources.items.length}</b>个数据源</li>
        <li><b>{tasks.total}</b>个后台任务</li>
      </ul>
      {data.warnings.length ? <p className={styles.notice} role="status" title={data.warnings.map((warning) => warning.message).join('；')}>有 {data.warnings.length} 处读取提示：{[...new Set(data.warnings.map((warning) => warning.message))].slice(0, 3).join('；')}</p> : null}
    </header>

    <section aria-labelledby="about-arch">
      <h2 id="about-arch" className={styles.heading}>逻辑架构</h2>
      <div className={styles.diagram}>
        <div className={styles.layers}>
          <Layer name="入口" hint="Agent 从这里开始读" testId="about-layer-entries">
            {data.entries.map((entry) => <button key={entry.path} type="button" className={styles.node} data-role={entry.role} data-testid="about-entry" {...node(entry.path)}>
              <span className={styles.nodeTitle}><Icon name="file" className={styles.icon} /><span className={styles.ellipsis} title={entry.path}>{entry.path}</span><span className={styles.tag}>{roleLabel(entry)}</span></span>
              {entry.redirect ? <span className={styles.nodeText}>转到 {entry.redirect}</span> : <>
                {entry.title ? <span className={styles.nodeText}>{entry.title}</span> : null}
                {entry.summary ? <span className={styles.nodeHint} title={entry.summary}>{entry.summary}</span> : null}
              </>}
            </button>)}
          </Layer>
          <Flow text={`按 ${data.routerFile} 的路由表定位领域，先读领域的 状态.md`} />
          <Layer name="领域" hint="每个领域一个目录" testId="about-layer-domains">
            {data.domains.map((domain) => <button key={domain.id} type="button" className={styles.node} data-testid="about-domain" data-domain={domain.name} onClick={() => navigate(domainPath(domain.id))}>
              <span className={styles.nodeTitle}><Icon name="folder" className={styles.icon} /><span className={styles.ellipsis}>{domain.name}</span>
                {domain.registered ? null : <span className={styles.warnTag}>未登记</span>}
                {domain.exists ? null : <span className={styles.warnTag}>目录不存在</span>}
              </span>
              <span className={styles.nodePath}>{domain.path}/</span>
              {domain.children.length ? <span className={styles.chips}>{domain.children.map((child) => <span key={child.name} className={styles.chip}>{child.name}{child.kind === 'directory' ? '/' : ''}</span>)}</span> : null}
              {domain.aliasCount ? <span className={styles.nodeHint}>{domain.aliasCount} 个别名与关键词</span> : null}
            </button>)}
          </Layer>
          <Flow text="领域的「去哪查」指向外部来源，副本由后台任务刷新" />
          <Layer name="接入" hint={data.sources.exists ? `登记在 ${data.sources.file}` : '还没有登记表'} testId="about-layer-sources">
            {data.sources.exists ? <>
              {data.sources.items.map((source) => <button key={source.name} type="button" className={styles.node} data-testid="about-source" onClick={() => navigate(SOURCES_PATH)}>
                <span className={styles.nodeTitle}><Icon name="extension" className={styles.icon} /><span className={styles.ellipsis}>{source.name}</span><span className={styles.tag}>{source.method}</span></span>
                <span className={styles.nodeHint}>{source.taskCount ? `${source.taskCount} 个刷新任务` : '没有刷新任务'}</span>
              </button>)}
              <button type="button" className={styles.node} data-testid="about-tasks" onClick={() => navigate(TASKS_PATH)}>
                <span className={styles.nodeTitle}><span className={styles.ellipsis}>后台任务</span><span className={styles.tag}>{tasks.total} 个</span></span>
                <span className={styles.nodeHint}>{runners || '没有登记任务'}</span>
              </button>
            </> : <p className={styles.muted} data-testid="about-sources-missing">还没有 <code>{data.sources.file}</code>，接入页会列出本机发现的任务。</p>}
          </Layer>
        </div>
        <aside className={styles.side} aria-label="记录" data-testid="about-records">
          <div className={styles.layerLabel}><span className={styles.layerName}>记录</span><span className={styles.layerHint}>变化先进收件箱，再写回领域并记日志</span></div>
          {data.records.inbox.exists ? <button type="button" className={styles.node} {...node('收件箱.md')}>
            <span className={styles.nodeTitle}><Icon name="file" className={styles.icon} />收件箱.md</span>
            <span className={styles.nodeHint}>{data.records.inbox.count} 条未分拣</span>
          </button> : null}
          <button type="button" className={styles.node} onClick={() => navigate('/knowledge/activity')}>
            <span className={styles.nodeTitle}><Icon name="folder" className={styles.icon} />日志/</span>
            <span className={styles.nodeHint}>{data.records.logs.count ? `${data.records.logs.count} 个月 · 最新 ${data.records.logs.latest}` : '还没有日志'}</span>
          </button>
          {data.records.blueprints.length ? <div className={styles.group}>
            <span className={styles.groupName}>蓝图/</span>
            {data.records.blueprints.map((blueprint) => <button key={blueprint.path} type="button" className={styles.link} data-testid="about-blueprint" {...node(blueprint.path)}>
              <span className={styles.ellipsis} title={blueprint.title}>{blueprint.title}</span>{blueprint.date ? <span className={styles.date}>{blueprint.date}</span> : null}
            </button>)}
          </div> : null}
          {data.about.exists ? <button type="button" className={styles.link} {...node(data.about.file)}>{data.about.file}</button> : null}
        </aside>
      </div>
    </section>

    <div className={styles.lower}>
      <section aria-labelledby="about-tree">
        <h2 id="about-tree" className={styles.heading}>目录结构</h2>
        <div className={styles.treeBox} data-testid="about-tree">
          <span className={styles.treeDir}>PersonalOS/</span>
          <Tree nodes={data.tree} more={data.treeMore} selected={selected} onOpen={onOpen} />
        </div>
      </section>
      <section aria-labelledby="about-changelog">
        <h2 id="about-changelog" className={styles.heading}>更新记录</h2>
        {data.about.changelog.length ? <ol className={styles.changelog} data-testid="about-changelog">
          {data.about.changelog.map((change) => <li key={change.line} data-current={current !== null && change.line === current.line}>
            <span className={styles.versionTag}>{change.version}</span>
            <time className={styles.date}>{change.date ?? '日期待核对'}</time>
            <span className={styles.changeText}>{change.text}</span>
          </li>)}
        </ol> : <p className={styles.muted} data-testid="about-changelog-empty">还没有更新记录。每次升级关于页时，在 <code>{data.about.file}</code> 的表格最上面加一行：版本、日期、更新内容。</p>}
      </section>
    </div>
  </>;
}

function Layer({ name, hint, testId, children }: { name: string; hint: string; testId: string; children: ReactNode }) {
  return <section className={styles.layer} aria-label={name} data-testid={testId}>
    <div className={styles.layerLabel}><span className={styles.layerName}>{name}</span><span className={styles.layerHint}>{hint}</span></div>
    <div className={styles.nodes}>{children}</div>
  </section>;
}

function Flow({ text }: { text: string }) {
  return <div className={styles.flow}><span className={styles.arrow} aria-hidden="true">↓</span>{text}</div>;
}

function Tree({ nodes, more, selected, onOpen }: { nodes: TreeNode[]; more?: number | undefined; selected: string | null; onOpen: Open }) {
  return <ul className={styles.tree}>
    {nodes.map((node) => <li key={node.path}>
      {node.kind === 'markdown'
        ? <button type="button" className={styles.treeFile} data-path={node.path} aria-current={selected === node.path ? 'true' : undefined} onClick={() => onOpen(node.path)}>{node.name}</button>
        : <span className={node.kind === 'directory' ? styles.treeDir : styles.treeOther}>{node.name}{node.kind === 'directory' ? '/' : ''}{node.kind === 'directory' && !node.children?.length && node.more ? <span className={styles.treeMore}> {node.more} 项</span> : null}</span>}
      {node.children?.length ? <Tree nodes={node.children} more={node.more} selected={selected} onOpen={onOpen} /> : null}
    </li>)}
    {more ? <li className={styles.treeMore}>还有 {more} 项</li> : null}
  </ul>;
}
