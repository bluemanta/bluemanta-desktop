import {useCallback,useEffect,useRef,useSyncExternalStore} from 'react';
import {useQuery,useQueryClient,type QueryClient} from '@tanstack/react-query';
import type {PersonalOsVersionResponse} from '@bluemanta/server/api-types';
import {apiJson} from '../api/client';
import {parsePersonalOsPath} from './personalos-paths';
import common from './Knowledge.module.css';

const versionKey=['pos-version'];
function invalidate(client:QueryClient,files:boolean,git:boolean) {
  return client.invalidateQueries({predicate:q=>{
    const [scope,type,id]=q.queryKey;
    if(scope==='pos-git') return git;
    return files && (scope==='personalos' || (scope==='knowledge' && (type==='search'||(type==='file' && id==='personalos'))));
  }});
}

export function usePersonalOsRefresh() {
  const client=useQueryClient();
  const q=useQuery({queryKey:versionKey,queryFn:({signal})=>apiJson<PersonalOsVersionResponse>('/api/v1/personalos/version',{signal}),refetchInterval:5000,refetchIntervalInBackground:false,staleTime:0});
  const previous=useRef<PersonalOsVersionResponse|undefined>(q.data);
  useEffect(()=>{
    if(!q.data) return;
    const old=previous.current;
    previous.current=q.data;
    if(old && (old.version!==q.data.version || old.gitVersion!==q.data.gitVersion))
      void invalidate(client,old.version!==q.data.version,old.gitVersion!==q.data.gitVersion);
  },[client,q.data]);
}

export function ReadTime() {
  const client=useQueryClient(), cache=client.getQueryCache();
  const route=parsePersonalOsPath(window.location.pathname);
  const subscribe=useCallback((fn:()=>void)=>cache.subscribe(fn),[cache]);
  const time=useSyncExternalStore(subscribe,()=>{
    const keys:readonly unknown[]=route.view==='file'?['knowledge','file','personalos',route.file]:
      route.view==='search' && route.query?['knowledge','search',route.query]:
      route.view==='arsenal'?['knowledge',route.file?'file':route.topic?'topic':'index','arsenal']:
      route.view==='domains' && route.domain?['personalos','domain',route.domain]:
      route.view==='commits'?(route.sha?['pos-git','commit',route.sha]:['pos-git','pages']):
      ['personalos',route.view==='resources'?'registry':route.view==='activity'?'log':route.view==='today'?'today':'overview'];
    return Math.max(0,...cache.findAll({queryKey:keys,type:'active'}).map(q=>q.state.dataUpdatedAt));
  });
  const mode=useSyncExternalStore(subscribe,()=>client.getQueryData<PersonalOsVersionResponse>(versionKey)?.mode);
  const hint=mode==='watch'?'文件变化后几秒内自动刷新':mode==='poll'?'每 10 秒检查一次变化':'自动刷新不可用，切回窗口时刷新';
  return <button className={common.linkButton} title={hint} data-testid="pos-read-time" onClick={()=>{void invalidate(client,true,true);void client.invalidateQueries({queryKey:versionKey});if(route.view==='arsenal')void client.invalidateQueries({queryKey:['knowledge']});}}>
    数据读取于 <time dateTime={time?new Date(time).toISOString():undefined}>{time?new Date(time).toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit'}):'—'}</time>
  </button>;
}
