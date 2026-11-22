import {randomUUID} from 'node:crypto';
import {watch, type FSWatcher, readdirSync, lstatSync, readFileSync} from 'node:fs';
import {join} from 'node:path';

export type VersionMode='watch'|'poll'|'off';
export type WatchRoot=(root:string,change:(path:string|null)=>void)=>FSWatcher;
const watchRoot:WatchRoot=(root,change)=>watch(root,{recursive:true,persistent:false},(_,path)=>change(path));
function isDir(path:string) {
  try { return lstatSync(path,{throwIfNoEntry:false})?.isDirectory() ?? false; }
  catch { return false; } // The reader reports permission errors; monitoring must not replace its response.
}
const isHidden=(path:string)=>path.split('/').some(s=>s.startsWith('.'));
const trackedRef=(p:string)=>!p.endsWith('.lock') && (['HEAD','packed-refs','logs/HEAD'].includes(p) || p.startsWith('refs/'));

function signature(root:string,git:boolean) {
  const rows:string[]=[];
  function visit(dir:string,prefix:string) {
    for(const entry of readdirSync(dir,{withFileTypes:true})) {
      const path=prefix+entry.name;
      if(entry.isSymbolicLink() || isHidden(path)) continue;
      if(git && !trackedRef(path) && path!=='refs' && path!=='logs') continue;
      const file=join(dir,entry.name);
      if(entry.isDirectory()) visit(file,path+'/');
      else if(entry.isFile()){
        const stat=lstatSync(file,{throwIfNoEntry:false});
        if(stat) rows.push(JSON.stringify([path,git && path!=='logs/HEAD'?readFileSync(file,'utf8'):stat.size,stat.mtimeMs]));
      }
    }
  }
  if(isDir(root)) visit(root,'');
  return rows.sort().join('\n');
}

/** One lazy monitor per server. Only the fallback scans the directory tree. */
export class PersonalOsVersion {
  private readonly boot=randomUUID();
  private version=0;
  private gitVersion=0;
  private changedAt:string;
  private mode:VersionMode='off';
  private handle:FSWatcher|null=null;
  private tick:NodeJS.Timeout|null=null;
  private timer:NodeJS.Timeout|null=null;
  private dirty=false;
  private gitDirty=false;
  private signatures=['',''];
  private gitDirectory='.git';
  constructor(private readonly root:string,private readonly listen:WatchRoot=watchRoot,private readonly now:()=>number=Date.now){
    this.changedAt=new Date(now()).toISOString();
  }
  current(){
    if(!this.tick){
      this.connect();
      this.tick=setInterval(()=>this.check(),10000);
      this.tick.unref();
    }
    return {version:this.boot+'-'+this.version,gitVersion:this.boot+'-'+this.gitVersion,changedAt:this.changedAt,mode:this.mode};
  }
  private flush(){
    if(this.dirty) this.version++;
    if(this.gitDirty) this.gitVersion++;
    if(this.dirty || this.gitDirty) this.changedAt=new Date(this.now()).toISOString();
    this.dirty=this.gitDirty=false;
  }
  private event(path:string|null){
    if(path===null || path==='') {this.fallback();return;}
    if(path.startsWith(this.gitDirectory+'/')){
      if(!trackedRef(path.slice(this.gitDirectory.length+1))) return;
      this.gitDirty=true;
    } else {
      if(isHidden(path)) return;
      this.dirty=true;
    }
    if(this.timer) clearTimeout(this.timer);
    this.timer=setTimeout(()=>{this.timer=null;this.flush()},300);
    this.timer.unref();
  }
  private connect(){
    if(!isDir(this.root)){this.mode='off';return;}
    this.gitDirectory=isDir(join(this.root,'.gitdata.nosync'))?'.gitdata.nosync':'.git';
    try{
      this.handle=this.listen(this.root,path=>this.event(path));
      this.handle.on('error',()=>this.fallback());
      this.mode='watch';
    } catch{this.fallback();}
  }
  private sample(){return [signature(this.root,false),signature(join(this.root,this.gitDirectory),true)];}
  private fallback(){
    this.handle?.close();this.handle=null;
    this.mode=isDir(this.root)?'poll':'off';
    try{this.signatures=this.sample();}catch{this.signatures=['',''];}
    this.dirty=this.gitDirty=true;this.flush();
  }
  private check(){
    if(!isDir(this.root)){if(this.mode!=='off') this.fallback();return;}
    if(this.mode==='off'){this.dirty=this.gitDirty=true;this.flush();this.connect();return;}
    if(this.mode==='poll'){
      try{
        const next=this.sample();
        this.dirty=next[0]!==this.signatures[0];this.gitDirty=next[1]!==this.signatures[1];
        this.signatures=next;this.flush();
      }catch{ /* The next poll retries an in-progress rename or a temporarily unreadable directory. */ }
    }
  }
  close(){
    this.handle?.close();this.handle=null;
    if(this.timer)clearTimeout(this.timer);
    if(this.tick)clearInterval(this.tick);
    this.tick=this.timer=null;
  }
}
