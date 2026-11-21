import { useRef, useState } from 'react';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { useLocation, useSearch } from 'wouter';
import type { GitCommitsResponse, GitCommitResponse } from '@bluemanta/server/api-types';
import { apiJson, describeError } from '../api/client';
import { useAppNavigate, useLaunch } from '../app/context';
import { Button } from '../ui/Button';
import { Banner } from '../ui/Banner';
import { EmptyState } from '../ui/EmptyState';
import { usePersonalOsOverview } from './api';
import { PageFrame, useNavigationKeys } from './PersonalOsPage';
import { ActivityTabs, DomainFilters, dateLabel } from './PersonalOsCollections';
import { personalOsFilePath } from './personalos-paths';
import { PersonalOsMissing } from './PersonalOsReadState';
import common from './Knowledge.module.css';
import styles from './PersonalOsCollections.module.css';
import list from '../ideas/IdeaList.module.css';
import git from './PersonalOsGit.module.css';

const base='/knowledge/activity/commits';
const api='/api/v1/personalos/git/commits';
type Commit=Extract<GitCommitsResponse,{available:true}>['commits'][number];
function fetchPage(domains:string[],unassigned:boolean,skip:number,limit:number,signal:AbortSignal) {
  const params=new URLSearchParams({domain:domains.join(','),unassigned:unassigned?'1':'0',skip:String(skip),limit:String(limit)});
  return apiJson<GitCommitsResponse>(api+'?'+params,{signal});
}
export function useDomainCommits(domain:string) {
  return useQuery({queryKey:['pos-git','domain',domain],refetchInterval:30000,staleTime:30000,queryFn:({signal})=>fetchPage([domain],false,0,10,signal)});
}
function Row({item,tags=true,selected=false}:{item:Commit;tags?:boolean;selected?:boolean}) {
  const navigate=useAppNavigate();
  return <button data-pos-focus className={styles.entry+' '+git.row} aria-pressed={selected} title={item.subject} onClick={()=>navigate(base+'/'+item.sha)}>
    <code>{item.shortSha}</code><span className={styles.entryText}>{item.subject}</span>
    {tags && item.domains.slice(0,2).map(d=><span key={d} className={common.tag}>{d}</span>)}{tags && item.domains.length>2 && <span>+{item.domains.length-2}</span>}
    {item.tag && <span className={common.tag}>{item.tag}</span>}<span>+{item.insertions} −{item.deletions}</span><time>{item.date.slice(11,16)}</time>
  </button>;
}
export function DomainCommits({domain,commits}:{domain:string;commits:Commit[]}) {
  const [,navigate]=useLocation(); const {embed}=useLaunch();
  const params=new URLSearchParams({domain}); if(embed) params.set('embed',embed);
  return <>{commits.map(item=><Row key={item.sha} item={item} tags={false}/>)}<Button onClick={()=>navigate(base+'?'+params)}>在动态页查看全部</Button></>;
}
function Unavailable({reason,retry}:{reason:string;retry:()=>void}) {
  if(reason==='git_error') return <Banner onRetry={retry}>读取 Git 记录失败</Banner>;
  return <EmptyState icon="book" title={reason==='no_repo'?'PersonalOS 还没有 Git 记录':'本机没有找到 git 命令'}/>;
}
function CommitDetail({sha}:{sha:string}) {
  const navigate=useAppNavigate();
  const q=useQuery({queryKey:['pos-git','commit',sha],queryFn:({signal})=>apiJson<GitCommitResponse>(api+'/'+sha,{signal}),refetchInterval:30000,staleTime:30000});
  if(!q.data) return q.isError?<Banner onRetry={()=>void q.refetch()}>{describeError(q.error)}</Banner>:<p>正在读取提交…</p>;
  if(!q.data.available) return <Unavailable reason={q.data.reason} retry={()=>void q.refetch()}/>;
  const c=q.data.commit;
  return <article className={git.detail} data-testid="git-detail"><h2 className={common.detailTitle}>{c.subject}</h2>
    {q.isError && <Banner onRetry={()=>void q.refetch()}>{describeError(q.error)}</Banner>}
    <time>{c.date}</time><button className={common.linkButton} title="复制提交号" onClick={()=>void navigator.clipboard.writeText(c.sha)}>{c.sha}</button>
    {c.domains.map(d=><span className={common.tag} key={d}>{d}</span>)}{c.body && <pre>{c.body}</pre>}
    {c.hiddenOnly && <p>只改了隐藏文件</p>}
    {c.files.map((f,i)=><details key={f.path} open={i<3}><summary>{f.status} {f.oldPath && f.oldPath+' → '}{f.path}　+{f.insertions} −{f.deletions}</summary>
      {f.exists && <button className={common.linkButton} onClick={()=>navigate(personalOsFilePath(f.path))}>打开当前版本</button>}
      {f.binary ? <p>二进制文件</p> : <pre>{f.lines.map((line,j)=><span key={j} data-kind={line.startsWith('+')?'add':line.startsWith('-')?'del':line.startsWith('@@')?'hunk':''}>{line}{'\n'}</span>)}</pre>}
      {f.truncated && <p>差异太长，只显示前 {f.lines.length} 行</p>}
    </details>)}</article>;
}
export function CommitView({sha}:{sha:string|null}) {
  const preset=new URLSearchParams(useSearch()).get('domain');
  return <CommitTimeline key={preset} preset={preset} sha={sha}/>;
}
function CommitTimeline({sha,preset}:{sha:string|null;preset:string|null}) {
  const overview=usePersonalOsOverview(), navigate=useAppNavigate(), root=useRef<HTMLDivElement>(null);
  const [domains,setDomains]=useState<string[]>(preset?[preset]:[]), [unassigned,setUnassigned]=useState(false);
  const q=useInfiniteQuery({queryKey:['pos-git','pages',domains,unassigned],initialPageParam:0,
    queryFn:({signal,pageParam})=>fetchPage(domains,unassigned,pageParam,30,signal),
    getNextPageParam:(last,_pages,offset)=>last.available && last.hasMore?offset+last.commits.length:undefined,
    refetchInterval:30000,staleTime:30000});
  useNavigationKeys(root,false,sha?()=>navigate(base):null);
  const first=q.data?.pages[0];
  const commits=q.data?.pages.flatMap(p=>p.available?p.commits:[]) ?? [];
  const groups=Map.groupBy(commits,c=>c.date.slice(0,10));
  return <PageFrame section="activity" detail={sha?<CommitDetail key={sha} sha={sha}/>:null} onClose={()=>navigate(base)}>
    <div className={styles.page}><ActivityTabs commits/>
    {overview.data?.exists===false?<PersonalOsMissing root={overview.data.root}/>:<>
    {q.isError && <Banner onRetry={()=>void q.refetch()}>{describeError(q.error)}</Banner>}
    {first && !first.available ? <Unavailable reason={first.reason} retry={()=>void q.refetch()}/> : first?.available && <>
      <div className={styles.filters}><DomainFilters options={overview.data?.domains??[]} selected={domains} onChange={setDomains} unassigned={{selected:unassigned,onChange:setUnassigned}}/></div>
      <div className={styles.content} ref={root}>{first.uncommitted.count>0 && <details><summary>{first.uncommitted.count} 个文件有未存档的改动，晨间存档时会提交。</summary>
        {first.uncommitted.files.map(f=><button key={f.path} className={common.linkButton} onClick={()=>navigate(personalOsFilePath(f.path))}>{f.status} {f.path}</button>)}</details>}
      {!commits.length && <EmptyState icon="book" title="没有匹配的提交"/>}
      {Array.from(groups,([day,items])=><section key={day}><h2 className={list.group}>{dateLabel(day)}</h2>{items.map(c=><Row key={c.sha} item={c} selected={c.sha===sha}/>)}</section>)}
      {q.hasNextPage && <Button disabled={q.isFetchingNextPage} onClick={()=>void q.fetchNextPage()}>加载更早</Button>}</div>
    </>}{q.isPending && <p>正在读取提交…</p>}</>}</div>
  </PageFrame>;
}
