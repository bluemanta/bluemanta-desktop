import {EventEmitter} from 'node:events';
import {mkdtempSync,mkdirSync,rmSync,writeFileSync,type FSWatcher} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {afterEach,expect,it,vi} from 'vitest';
import {PersonalOsVersion,type WatchRoot} from '../src/index.js';

const dirs:string[]=[];
function directory(){const dir=mkdtempSync(join(tmpdir(),'version-'));dirs.push(dir);return dir}
afterEach(()=>{vi.useRealTimers();for(const dir of dirs.splice(0))rmSync(dir,{recursive:true,force:true})});
it('内容事件去抖，隐藏路径与 index/objects/lock 无效，refs 独立计数，close 释放句柄',()=>{
  vi.useFakeTimers();
  const emitter=Object.assign(new EventEmitter(),{close:vi.fn()});
  let event!:(path:string|null)=>void;
  const listen:WatchRoot=vi.fn((_dir,cb)=>{event=cb;return emitter as unknown as FSWatcher});
  const v=new PersonalOsVersion(directory(),listen);
  expect(listen).not.toHaveBeenCalled();
  const a=v.current();
  for(const p of ['.git/index','.git/refs/heads/test.lock','.git/objects/aa/bb','领域/.隐藏'])event(p);
  vi.advanceTimersByTime(350);expect(v.current()).toEqual(a);
  for(const p of ['状态.md','纸星.md','状态.md'])event(p);
  vi.advanceTimersByTime(299);expect(v.current()).toEqual(a);
  vi.advanceTimersByTime(1);const b=v.current();expect(b.version).toMatch(/-1$/);expect(b.gitVersion).toBe(a.gitVersion);
  event('.git/refs/heads/paper');vi.advanceTimersByTime(300);expect(v.current().gitVersion).toMatch(/-1$/);
  event('待处理');v.close();expect(emitter.close).toHaveBeenCalledOnce();expect(vi.getTimerCount()).toBe(0);
});
it('off 恢复监听、watch 错误回退 poll，检测新建/修改/删除与 refs',()=>{
  vi.useFakeTimers();
  const root=join(directory(),'PersonalOS');
  const emitter=Object.assign(new EventEmitter(),{close:vi.fn()});
  const v=new PersonalOsVersion(root,()=>emitter as unknown as FSWatcher);
  expect(v.current().mode).toBe('off');mkdirSync(root);mkdirSync(join(root,'.git/refs/heads'),{recursive:true});
  vi.advanceTimersByTime(10000);expect(v.current().mode).toBe('watch');
  emitter.emit('error',new Error('测试回退'));let previous=v.current();expect(previous.mode).toBe('poll');
  const path=join(root,'纸环.md');
  for(const change of [()=>writeFileSync(path,'初稿'),()=>writeFileSync(path,'第二版纸环'),()=>rmSync(path)]){
    change();vi.advanceTimersByTime(10000);const next=v.current();expect(next.version).not.toBe(previous.version);expect(next.gitVersion).toBe(previous.gitVersion);previous=next;
  }
  writeFileSync(join(root,'.git/refs/heads/paper'),'纸环');vi.advanceTimersByTime(10000);
  expect(v.current().gitVersion).not.toBe(previous.gitVersion);expect(v.current().version).toBe(previous.version);
  v.close();expect(vi.getTimerCount()).toBe(0);
});
