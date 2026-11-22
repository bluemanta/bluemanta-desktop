import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, afterAll, expect, it } from 'vitest';
import { gitCommit, gitCommits, PersonalOsReader } from '../src/index.js';

const home = mkdtempSync(join(tmpdir(),'pos-history-'));
const root = join(home,'Documents','PersonalOS');
const all = {skip:0,limit:100,domains:[],unassigned:false};
const reader = new PersonalOsReader({home});
beforeAll(()=>execFileSync(process.execPath,[fileURLToPath(new URL('../scripts/git-fixture.mjs',import.meta.url)),root]));
afterAll(()=>rmSync(home,{recursive:true,force:true}));
async function commits() {
  const result=await gitCommits(root,reader.overview().domains,all);
  if (!result.available) throw new Error(result.reason);
  return result;
}

it('跨月、单领域、领域加日志、三个领域、正文与普通标签',async()=>{
  const {commits:list}=await commits();
  expect(list.length).toBe(34);
  expect(new Set(list.map(c=>c.date.slice(0,7))).size).toBe(2);
  expect(list.find(c=>c.subject.endsWith('纸样 1'))?.domains).toEqual(['写作']);
  expect(list.find(c=>c.subject.includes('整理实验'))).toMatchObject({domain:'工作',fileCount:2,body:expect.stringContaining('更换纸张')});
  expect(list.find(c=>c.subject.includes('联查'))?.domains).toEqual(['工作','写作','技术']);
  expect(list.find(c=>c.subject.includes('保存纸纹'))).toMatchObject({tag:'蓝图',domains:[]});
});
it('中文改名、删除、隐藏及跨边界的完整差异',async()=>{
  const {commits:list,uncommitted}=await commits();
  expect(uncommitted.files.map(f=>f.status)).toEqual(['M','??']);
  for(const [subject,status] of [['调整中文文件名','R'],['移除旧纸桥','D'],['公开纸星','A'],['收起纸星','D']] as const) {
    const c=list.find(c=>c.subject===subject)!;
    expect(c.files[0]?.status).toBe(status);
    const detail=await gitCommit(root,[],c.shortSha);
    if(!detail.available) throw new Error(detail.reason);
    expect(JSON.stringify(detail)).not.toContain('.claude');
    if(subject.includes('纸星')) {
      expect(c.files[0]).toMatchObject({path:'领域/技术/纸星.md',insertions:status==='A'?1:0,deletions:status==='D'?1:0});
      expect(detail.commit.files[0]?.lines).toContain((status==='A'?'+':'-')+'虚构草稿');
    }
  }
  expect(list.find(c=>c.subject==='封存草稿')).toMatchObject({hiddenOnly:true,files:[]});
});
it('二进制无正文、单文件500行及每笔3000行',async()=>{
  const {commits:list}=await commits();
  for(const subject of ['[蓝图] 保存纸纹','[技术] 导入七组观测']) {
    const detail=await gitCommit(root,[],list.find(c=>c.subject===subject)!.sha);
    if(!detail.available) throw new Error(detail.reason);
    if(subject.includes('蓝图')) expect(detail.commit.files[0]).toMatchObject({binary:true,lines:[]});
    else {
      expect(detail.commit.files.every(f=>f.truncated && f.lines.length<=500)).toBe(true);
      expect(detail.commit.files.flatMap(f=>f.lines)).toHaveLength(3000);
    }
  }
});
it('忽略父仓库、找不到git及非零退出',async()=>{
  const nested=join(root,'空目录'); mkdirSync(nested);
  expect(await gitCommits(nested,[],all)).toEqual({available:false,reason:'no_repo'});
  expect(await gitCommits(root,[],all,join(home,'缺少命令'))).toEqual({available:false,reason:'git_missing'});
  expect(await gitCommits(root,[],all,'/usr/bin/false')).toEqual({available:false,reason:'git_error'});
});
