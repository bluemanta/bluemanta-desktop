import {execFileSync} from 'node:child_process';
import {readFileSync,writeFileSync,unlinkSync} from 'node:fs';
import {join} from 'node:path';
import {test,expect,type Page} from '@playwright/test';
import {sandboxDir} from '../scripts/sandbox.ts';
const root=sandboxDir('refresh-home/Documents/PersonalOS');
const file=(p:string)=>join(root,p);
async function open(page:Page,path:string){
  await Promise.all([
    page.waitForResponse(res=>res.url().endsWith('/personalos/version') && res.ok()),
    page.goto(process.env.BM_E2E_REFRESH_URL+path+'#token='+process.env.BM_E2E_REFRESH_TOKEN),
  ]);
}
test('待办换组时保留列表，页头读取时间更新',async({page})=>{
  await open(page,'/knowledge/today');
  const row=page.getByRole('region',{name:'已逾期'}).getByText('整理试点访谈问题卡');
  await expect(row).toBeVisible();
  const stamp=page.getByTestId('pos-read-time').locator('time'),before=await stamp.getAttribute('datetime');
  await page.evaluate(()=>{const watch=new MutationObserver(()=>{
    if(document.body.textContent?.includes('正在读取今天的事项'))document.body.dataset.flashed='yes';
  });watch.observe(document.body,{subtree:true,childList:true});});
  const f=file('领域/工作/状态.md');
  writeFileSync(f,readFileSync(f,'utf8').replace('@due(2026-11-18)','@due(2026-11-21)'));
  await expect(page.getByRole('region',{name:'今天到期'}).getByText('整理试点访谈问题卡')).toBeVisible({timeout:10000});
  await expect(stamp).not.toHaveAttribute('datetime',before!);
  expect(await page.locator('body').getAttribute('data-flashed')).toBeNull();
});
test('领域状态原地更新，保持页签和滚动位置',async({page})=>{
  await page.setViewportSize({width:1280,height:350});
  await open(page,'/knowledge/domains/技术');
  const panel=page.getByRole('tabpanel',{name:'状态'});await expect(panel).toBeVisible();
  const scroll=await panel.evaluate(el=>{let p=el.parentElement;while(p && p.scrollHeight<=p.clientHeight)p=p.parentElement;if(!p)return 0;p.dataset.checkScroll='yes';p.scrollTop=28;return p.scrollTop});
  const f=file('领域/技术/状态.md');writeFileSync(f,readFileSync(f,'utf8')+'\n虚构刷新观测完成\n');
  await expect(panel).toContainText('虚构刷新观测完成',{timeout:10000});
  expect(scroll).toBeGreaterThan(0);
  expect(await page.locator('[data-check-scroll]').evaluate(el=>el.scrollTop)).toBe(scroll);
});
test('新提交在十秒内出现',async({page})=>{
  await open(page,'/knowledge/activity/commits');
  await expect(page.getByTitle('封存草稿')).toBeVisible();
  const env={PATH:process.env.PATH,GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:'/dev/null',GIT_AUTHOR_DATE:'2026-12-01T02:00:00Z',GIT_COMMITTER_DATE:'2026-12-01T02:00:00Z'};
  execFileSync('git',['-c','user.name=纸星','-c','user.email=paper@example.invalid','commit','--allow-empty','-m','虚构刷新纸环'],{cwd:root,env});
  await expect(page.getByTitle('虚构刷新纸环')).toBeVisible({timeout:10000});
});
test('打开的文件删除后显示提示',async({page})=>{
  await open(page,'/knowledge/pos/file/我/纸船.md');await expect(page.getByTestId('personalos-reader')).toContainText('待折叠');
  unlinkSync(file('我/纸船.md'));
  await expect(page.getByText('这个文件已不存在')).toBeVisible({timeout:10000});
});
