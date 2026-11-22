import { execFile } from 'node:child_process';
import { existsSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { promisify } from 'node:util';
import { KnowledgeError } from '../types.js';
import type { Route } from './types.js';

const exec = promisify(execFile);
const hidden = (path: string) => path.split('/').some(segment => segment.startsWith('.'));
const hash = /^[0-9a-f]{7,40}$/;
export interface GitFile {
  path: string; oldPath?: string; status: 'A'|'M'|'R'|'D'; insertions: number; deletions: number; binary: boolean;
}
export interface GitCommit {
  sha: string; shortSha: string; date: string; subject: string; body: string; domain?: string; tag?: string;
  domains: string[]; files: GitFile[]; insertions: number; deletions: number; fileCount: number; hiddenOnly: boolean;
}
export interface GitListOptions { skip: number; limit: number; domains: string[]; unassigned: boolean }
type Unavailable = { available: false; reason: 'no_repo'|'git_missing'|'git_error' };
type Command = 'rev-parse'|'log'|'show'|'status';
type Run = (command: Command, ...args: string[]) => Promise<string>;
const diffOptions = ['--diff-merges=first-parent', '--root'];
const emptyStats = { insertions: 0, deletions: 0, binary: false };

function visibleChange(status: GitFile['status'], path: string, oldPath?: string) {
  if (hidden(path)) return oldPath && !hidden(oldPath) ? { status: 'D' as const, path: oldPath } : null;
  if (oldPath && hidden(oldPath)) return { status: 'A' as const, path };
  return oldPath ? { status, path, oldPath } : { status, path };
}

/** The PersonalOS repository's work tree and git directory, both inside root; null when there is none. */
export function locateRepository(root: string): {cwd:string;dir:string}|null {
  const cwd = realpathSync(root);
  const separate = join(cwd,'.gitdata.nosync');
  let dir = statSync(separate,{throwIfNoEntry:false})?.isDirectory() ? separate : join(cwd,'.git');
  if (!existsSync(dir)) return null;
  if (!realpathSync(dir).startsWith(cwd+sep)) return null;
  if (statSync(dir).isFile()) {
    const pointer = /^gitdir: (.+)$/.exec(readFileSync(dir,'utf8').trimEnd());
    if (!pointer) return null;
    dir = resolve(cwd,pointer[1]!);
  }
  if (!existsSync(dir) || !realpathSync(dir).startsWith(cwd+sep)) return null;
  return {cwd,dir};
}

async function withRepository<T>(root: string, executable: string, read: (run: Run) => Promise<T>): Promise<({ available: true } & T) | Unavailable> {
  if (!existsSync(root)) throw new KnowledgeError('library_missing','PersonalOS');
  try {
    const repository = locateRepository(root);
    if (!repository) return {available:false,reason:'no_repo'};
    const {cwd,dir} = repository;
    const run: Run = async (command,...args) => (await exec(executable,[
      '-c','core.quotepath=false','-c','core.fsmonitor=false','-c','color.ui=false','--no-pager',command,
      ...(['log','show'].includes(command) ? ['--no-ext-diff','--no-textconv'] : []), ...args
    ],{cwd,env:{PATH:process.env.PATH, GIT_DIR:dir,GIT_WORK_TREE:cwd,GIT_CEILING_DIRECTORIES:dirname(cwd),
      GIT_OPTIONAL_LOCKS:'0',GIT_TERMINAL_PROMPT:'0',GIT_LITERAL_PATHSPECS:'1',GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:'/dev/null'},
      timeout:5000,maxBuffer:8*1024*1024})).stdout;
    if (realpathSync((await run('rev-parse','--show-toplevel')).trimEnd()) !== cwd) return {available:false,reason:'no_repo'};
    return {available:true,...await read(run)};
  } catch(error) {
    if (error instanceof KnowledgeError) throw error;
    return {available:false,reason:(error as NodeJS.ErrnoException).code === 'ENOENT' ? 'git_missing' : 'git_error'};
  }
}

function numstat(value: string) {
  const match = /^(-|\d+)\t(-|\d+)\t([\s\S]*)$/.exec(value);
  if (!match) throw new Error('numstat');
  return {insertions:Number(match[1]) || 0,deletions:Number(match[2]) || 0,binary:match[1] === '-',path:match[3]!};
}

// NUL-terminated raw records and numstat are emitted in two consecutive blocks.
// Consume pathname tokens by arity; a pathname may itself contain a newline or a tab.
async function history(run: Run, routes: Route[], sha?: string) {
  const output = await run(sha ? 'show' : 'log','--format=%x00%H%x00%aI%x00%s%x00%b','--raw','--numstat','-z','-M',...diffOptions,...(sha?[sha]:[]),'--');
  const fields = output.split('\0');
  const commits: GitCommit[] = [];
  let i=0;
  while (i < fields.length-1) {
    if (fields[i++] !== '') throw new Error('commit delimiter');
    const id=fields[i++]!, date=fields[i++]!, subject=fields[i++]!, body=fields[i++]!;
    if (!/^[a-f0-9]{40}$/.test(id)) throw new Error('invalid commit');
    const files: GitFile[]=[];
    const byPath=new Map<string,GitFile>();
    const crossed=new Set<GitFile>();
    let rawCount=0;
    while (fields[i]?.trimStart().startsWith(':')) {
      const raw=fields[i++]!.trimStart();
      const status=raw.split(' ').at(-1)![0]!;
      const source=fields[i++]!;
      const path=status==='R'?fields[i++]!:source;
      const visible=visibleChange(status==='T'?'M':status as GitFile['status'],path,status==='R'?source:undefined);
      rawCount++;
      if (!visible) continue;
      const file={...visible,...emptyStats};
      files.push(file); byPath.set(path,file);
      if (status==='R' && file.status!=='R') crossed.add(file);
    }
    while (fields[i]) {
      const stats=numstat(fields[i++]!);
      let path=stats.path;
      if (!path) { i++; path=fields[i++]!; }
      const file=byPath.get(path);
      if (file) Object.assign(file,{insertions:stats.insertions,deletions:stats.deletions,binary:stats.binary});
    }
    for (const file of crossed) {
      const stats=numstat((await run('show','--format=','--numstat','-z','--no-renames',...diffOptions,id,'--',file.path)).split('\0')[0]!);
      Object.assign(file,{insertions:stats.insertions,deletions:stats.deletions,binary:stats.binary});
    }
    const paths=files.flatMap(f=>f.oldPath?[f.path,f.oldPath]:[f.path]);
    const domains=routes.filter(r=>paths.some(p=>p.startsWith(r.path+'/'))).map(r=>r.name);
    for (const p of paths) {
      const name=/^领域\/([^/]+)\//.exec(p)?.[1];
      if (name && !routes.some(r=>p.startsWith(r.path+'/')) && !domains.includes(name)) domains.push(name);
    }
    const label=/^\[([^\]]+)\]/.exec(subject)?.[1];
    commits.push({sha:id,shortSha:id.slice(0,7),date,subject,body,domains,files,
      ...(label ? (label==='我'||routes.some(r=>r.registered && r.name===label)?{domain:label}:{tag:label}):{}),
      fileCount:files.length,hiddenOnly:rawCount>0 && !files.length,
      insertions:files.reduce((n,f)=>n+f.insertions,0),deletions:files.reduce((n,f)=>n+f.deletions,0)});
  }
  return commits.sort((a,b)=>Date.parse(b.date)-Date.parse(a.date));
}

async function uncommitted(run: Run) {
  const fields=(await run('status','--porcelain=v1','-z','--untracked-files=all')).split('\0');
  const files:{status:string;path:string}[]=[];
  for(let i=0;fields[i];i++) {
    const row=fields[i]!, status=row.slice(0,2).trim(),path=row.slice(3);
    if(status.includes('R')) {
      const change=visibleChange('R',path,fields[++i]);
      if(change) files.push({status:change.status,path:change.path});
    } else if (!hidden(path)) files.push({status,path});
  }
  return {count:files.length,files};
}

export function gitCommits(root:string,routes:Route[],options:GitListOptions,executable='git') {
  return withRepository(root,executable,async run=>{
    const commits=(await history(run,routes)).filter(c=>
      (!options.domains.length && !options.unassigned) || c.domains.some(d=>options.domains.includes(d)) || (!c.domains.length && options.unassigned));
    const end=options.skip+options.limit;
    return {commits:commits.slice(options.skip,end),hasMore:commits.length>end,uncommitted:await uncommitted(run)};
  });
}

export function gitCommit(root:string,routes:Route[],sha:string,executable='git') {
  if (!hash.test(sha)) throw new KnowledgeError('invalid_path','提交号无效');
  return withRepository(root,executable,async run=>{
    const matches=(await run('rev-parse','--disambiguate='+sha)).trim().split('\n');
    if(matches.length!==1 || !matches[0]) throw new KnowledgeError('not_found','提交不存在');
    const resolved=(await run('rev-parse','--revs-only',matches[0]+'^{commit}')).trim();
    if (!/^[0-9a-f]{40}$/.test(resolved)) throw new KnowledgeError('not_found','提交不存在');
    const [commit]=await history(run,routes,resolved);
    if(!commit) throw new KnowledgeError('not_found','提交不存在');
    let remaining=3000;
    const files=[];
    for(const file of commit.files) {
      const paths=file.oldPath?[file.oldPath,file.path]:[file.path];
      const patch=file.binary?'':await run('show','--format=','-U3',file.oldPath?'-M':'--no-renames',...diffOptions,resolved,'--',...paths);
      const all=patch ? patch.replace(/\n$/,'').split('\n') : [];
      const lines=all.slice(0,Math.min(500,remaining));
      remaining-=lines.length;
      const current=join(root,file.path);
      const exists=file.status!=='D' && existsSync(current) && realpathSync(current).startsWith(realpathSync(root)+sep);
      files.push({...file,exists,lines,truncated:lines.length<all.length});
    }
    return {commit:{...commit,files}};
  });
}
