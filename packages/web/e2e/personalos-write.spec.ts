/** 迭代 3 写入走查：只在 .dev-data/pos-write-home 的可写副本上写，内容全部虚构。 */
import {execFileSync} from 'node:child_process';
import {appendFileSync,readFileSync} from 'node:fs';
import {join} from 'node:path';
import {test,expect,type Page} from '@playwright/test';
import {sandboxDir,WEB_ROOT} from '../scripts/sandbox.ts';
import {noHorizontalScroll} from './helpers.ts';

test.describe.configure({mode:'serial'});
const root=sandboxDir('pos-write-home/Documents/PersonalOS');
const read=(p:string)=>readFileSync(join(root,p),'utf8');
const git=(...args:string[])=>execFileSync('git',['--git-dir',join(root,'.gitdata.nosync'),'--work-tree',root,'-c','core.quotepath=false',...args],{encoding:'utf8'});
async function open(page:Page,path:string){
  await page.goto('about:blank');
  await page.goto(process.env.BM_E2E_POS_WRITE_URL+path+'#token='+process.env.BM_E2E_POS_WRITE_TOKEN);
}
const check=(page:Page,text:string)=>page.getByRole('checkbox',{name:'完成：'+text});
const dialog=(page:Page)=>page.getByTestId('personalos-complete-dialog');

test('确认框截图（只预览，不写）',async({page})=>{
  for(const width of [1440,720]) for(const theme of ['light','dark'] as const){
    await page.setViewportSize({width,height:900});await page.emulateMedia({colorScheme:theme});
    await open(page,'/knowledge/today');
    await check(page,'整理试点访谈问题卡').click();
    await expect(dialog(page)).toContainText('[工作] 完成：整理试点访谈问题卡');
    await dialog(page).getByText('查看改动').click();
    await expect(dialog(page)).toContainText('+- [x] 整理试点访谈问题卡 @due(2026-11-18) 2026-11-21');
    await noHorizontalScroll(page);
    await page.screenshot({path:join(WEB_ROOT,'screenshots',`personalos-complete-${width}-${theme}.png`)});
    await page.keyboard.press('Escape');await expect(dialog(page)).toBeHidden();
  }
  expect(read('领域/工作/状态.md')).toContain('- [ ] 整理试点访谈问题卡');
});

test('取消不写；确认后打勾、写日志、提交，行从已逾期消失',async({page})=>{
  const head=git('rev-parse','HEAD').trim();
  await open(page,'/knowledge/today');
  const overdue=page.getByRole('region',{name:'已逾期'});
  await check(page,'整理试点访谈问题卡').click();
  await dialog(page).getByRole('button',{name:'取消'}).click();
  await expect(dialog(page)).toBeHidden();
  expect(git('rev-parse','HEAD').trim()).toBe(head);
  await check(page,'整理试点访谈问题卡').click();
  await dialog(page).getByRole('button',{name:'完成'}).click();
  await expect(page.getByText('已完成并提交')).toBeVisible();
  await expect(overdue.getByText('整理试点访谈问题卡')).toHaveCount(0);
  expect(read('领域/工作/状态.md')).toContain('- [x] 整理试点访谈问题卡 @due(2026-11-18) 2026-11-21');
  expect(read('日志/2026-11.md')).toContain('- 2026-11-21 [工作] 完成：整理试点访谈问题卡');
  expect(git('log','-1','--format=%s').trim()).toBe('[工作] 完成：整理试点访谈问题卡');
});

test('周期事项在领域详情里完成：顺延到下周，换到未来 7 天',async({page})=>{
  await open(page,'/knowledge/domains/副业');
  await check(page,'回看本周书签样品记录').click();
  await expect(dialog(page)).toContainText('@due(2026-11-28)');
  await dialog(page).getByRole('button',{name:'完成'}).click();
  await expect(page.getByText('已完成并提交')).toBeVisible();
  expect(read('领域/副业/状态.md')).toContain('- [ ] 回看本周书签样品记录 @every(1w) @due(2026-11-28)');
  await open(page,'/knowledge/today');
  await expect(page.getByRole('region',{name:'未来 7 天'}).getByText('回看本周书签样品记录')).toBeVisible();
  await expect(page.getByRole('region',{name:'今天到期'}).getByText('回看本周书签样品记录')).toHaveCount(0);
});

test('预览后文件被别处改过：提示冲突，不写',async({page})=>{
  await open(page,'/knowledge/today');
  await check(page,'验证书名索引导出样例').click();
  await expect(dialog(page)).toBeVisible();
  appendFileSync(join(root,'领域/技术/状态.md'),'\n别的会话刚写的一行\n');
  await dialog(page).getByRole('button',{name:'完成'}).click();
  await expect(page.getByText('文件刚被改过，已刷新，请再试一次')).toBeVisible();
  expect(read('领域/技术/状态.md')).toContain('- [ ] 验证书名索引导出样例');
});

test('有未存档改动的文件：写入但不提交',async({page})=>{
  // 上一条用例留下了技术领域的未存档改动；刷新后再完成同一件事。
  const head=git('rev-parse','HEAD').trim();
  await open(page,'/knowledge/today');
  await check(page,'验证书名索引导出样例').click();
  await dialog(page).getByRole('button',{name:'完成'}).click();
  await expect(page.getByText(/已完成，未提交：文件里还有别的未存档改动/)).toBeVisible();
  expect(git('rev-parse','HEAD').trim()).toBe(head);
  expect(read('领域/技术/状态.md')).toContain('- [x] 验证书名索引导出样例');
});

test('x 键打开确认框，Esc 取消',async({page})=>{
  await open(page,'/knowledge/today');
  const row=page.getByTestId('personalos-todo').filter({hasText:'跟进书架场地确认'});
  await row.focus();await page.keyboard.press('x');
  await expect(dialog(page)).toContainText('跟进书架场地确认');
  await page.keyboard.press('Escape');await expect(dialog(page)).toBeHidden();
});

test('速记：预览那一行，回车追加到收件箱',async({page})=>{
  await open(page,'/knowledge/today?note=1');
  const input=page.getByRole('textbox',{name:'速记'});
  await expect(input).toBeFocused();
  await input.fill('买一卷细麻绳');
  await expect(page.getByTestId('personalos-quick-preview')).toContainText('- 2026-11-21 买一卷细麻绳');
  await input.press('Enter');
  await expect(page.getByText('已记到收件箱')).toBeVisible();
  await expect(input).toHaveValue('');
  await expect(page.getByRole('region',{name:'收件箱'}).getByText('买一卷细麻绳')).toBeVisible();
  expect(read('收件箱.md').endsWith('- 2026-11-21 买一卷细麻绳\n')).toBe(true);
});

/* 第 16 节：收件箱完成与不跟踪（可撤销）、待办不做了。接在前面的用例后面，用同一个可写副本。 */
const entry=(page:Page,text:string)=>page.getByTestId('personalos-inbox-entry').filter({hasText:text});
const dropDialog=(page:Page)=>page.getByTestId('personalos-drop-dialog');
const toast=(page:Page)=>page.getByRole('status').filter({hasText:/已完成：|已不跟踪：|已撤销|收件箱刚被改过/});
function archiveLog(){
  // 前面的用例让当月日志留下未存档改动；先存档，后面的写入才能提交。
  git('add','--','日志/2026-11.md');git('commit','-q','-m','走查：存档日志','--','日志/2026-11.md');
}

test('收件箱悬停和「不做了」确认框截图（只预览，不写）',async({page})=>{
  const inboxBefore=read('收件箱.md');const statusBefore=read('领域/工作/状态.md');
  for(const width of [1440,720]) for(const theme of ['light','dark'] as const){
    await page.setViewportSize({width,height:900});await page.emulateMedia({colorScheme:theme});
    await open(page,'/knowledge/today');
    const row=entry(page,'折纸书签');
    await expect(row.getByRole('button',{name:/^完成：/})).toHaveCSS('opacity','0');
    await row.hover();
    await expect(row.getByRole('button',{name:/^完成：/})).toHaveCSS('opacity','1');
    await expect(row.getByRole('button',{name:/^不跟踪：/})).toBeVisible();
    await noHorizontalScroll(page);
    await row.screenshot({path:join(WEB_ROOT,'screenshots',`personalos-inbox-hover-${width}-${theme}.png`)});
    const todo=page.getByTestId('personalos-todo').filter({hasText:'补充读者引导语候选'});
    await todo.hover();await todo.getByRole('button',{name:'不做了：补充读者引导语候选'}).click();
    await expect(dropDialog(page)).toContainText('不做这件事了？');
    await expect(dropDialog(page)).toContainText('[工作] 不做了：补充读者引导语候选');
    await dropDialog(page).getByText('查看改动').click();
    await expect(dropDialog(page)).toContainText('-- [ ] 补充读者引导语候选');
    await noHorizontalScroll(page);
    await page.screenshot({path:join(WEB_ROOT,'screenshots',`personalos-drop-${width}-${theme}.png`)});
    await page.keyboard.press('Escape');await expect(dropDialog(page)).toBeHidden();
  }
  expect(read('收件箱.md')).toBe(inboxBefore);
  expect(read('领域/工作/状态.md')).toBe(statusBefore);
});

test('收件箱完成：行消失、日志留原文、提交；撤销后原样回来',async({page})=>{
  archiveLog();
  const inboxBefore=read('收件箱.md');const logBefore=read('日志/2026-11.md');
  await open(page,'/knowledge/today');
  const row=entry(page,'折纸书签');
  await row.hover();await row.getByRole('button',{name:/^完成：/}).click();
  await expect(toast(page)).toContainText('已完成：把折纸书签的失败样品整理成一页制作心得。');
  await expect(entry(page,'折纸书签')).toHaveCount(0);
  expect(read('收件箱.md')).not.toContain('折纸书签');
  expect(read('日志/2026-11.md')).toContain('- 2026-11-21 完成：把折纸书签的失败样品整理成一页制作心得。（收件箱 11-20）');
  expect(git('log','-1','--format=%s').trim()).toBe('[收件箱] 完成：把折纸书签的失败样品整理成一页制作心得。');
  await page.screenshot({path:join(WEB_ROOT,'screenshots','personalos-inbox-undo-1440-light.png')});
  await toast(page).getByRole('button',{name:'撤销'}).click();
  await expect(toast(page)).toHaveText(/已撤销/);
  await expect(entry(page,'折纸书签')).toHaveCount(1);
  expect(read('收件箱.md')).toBe(inboxBefore);
  expect(read('日志/2026-11.md')).toBe(logBefore);
  expect(git('log','-1','--format=%s').trim()).toBe('[收件箱] 撤销：把折纸书签的失败样品整理成一页制作心得。');
});

test('键盘：x 完成，Delete 不跟踪；速记框里打 x 不触发',async({page})=>{
  await open(page,'/knowledge/today');
  const input=page.getByRole('textbox',{name:'速记'});
  await input.focus();await page.keyboard.type('x');
  await expect(input).toHaveValue('x');await input.fill('');
  await entry(page,'反馈卡').focus();await page.keyboard.press('x');
  await expect(toast(page)).toContainText('已完成：在交换书架旁放一张让读者画表情的反馈卡。');
  await expect(entry(page,'反馈卡')).toHaveCount(0);
  await entry(page,'安静的时间').focus();await page.keyboard.press('Delete');
  await expect(toast(page)).toContainText('已不跟踪：试试用不同颜色标出一天里真正安静的时间。');
  await expect(entry(page,'安静的时间')).toHaveCount(0);
  expect(read('日志/2026-11.md')).toContain('- 2026-11-21 不跟踪：试试用不同颜色标出一天里真正安静的时间。（收件箱 11-18）');
  expect(read('收件箱.md')).not.toMatch(/反馈卡|安静的时间/);
});

test('收件箱被别处改过：提示冲突，不写',async({page})=>{
  await open(page,'/knowledge/today');
  await expect(entry(page,'折纸书签')).toHaveCount(1);
  appendFileSync(join(root,'收件箱.md'),'- 2026-11-21 手机刚记的一条\n');
  const row=entry(page,'折纸书签');
  await row.hover();await row.getByRole('button',{name:/^不跟踪：/}).click();
  await expect(page.getByText('收件箱刚被改过，已刷新，请再试一次')).toBeVisible();
  await expect(entry(page,'折纸书签')).toHaveCount(1);
  expect(read('收件箱.md')).toContain('折纸书签');
});

test('待办不做了：取消不写；确认后删掉这一行、写日志；Delete 键和周期事项说明',async({page})=>{
  await open(page,'/knowledge/today');
  const todo=page.getByTestId('personalos-todo').filter({hasText:'补充读者引导语候选'});
  await todo.focus();await page.keyboard.press('Delete');
  await expect(dropDialog(page)).toContainText('补充读者引导语候选');
  await dropDialog(page).getByRole('button',{name:'取消'}).click();
  await expect(dropDialog(page)).toBeHidden();
  expect(read('领域/工作/状态.md')).toContain('- [ ] 补充读者引导语候选');
  await todo.hover();await todo.getByRole('button',{name:'不做了：补充读者引导语候选'}).click();
  await dropDialog(page).getByRole('button',{name:'不做了'}).click();
  await expect(page.getByText(/已不做：补充读者引导语候选/)).toBeVisible();
  await expect(page.getByTestId('personalos-todo').filter({hasText:'补充读者引导语候选'})).toHaveCount(0);
  expect(read('领域/工作/状态.md')).not.toContain('补充读者引导语候选');
  expect(read('日志/2026-11.md')).toContain('- 2026-11-21 [工作] 不做了：补充读者引导语候选');
  await open(page,'/knowledge/domains/副业');
  const weekly=page.getByTestId('personalos-domain-detail').locator('[data-todo-id]').filter({hasText:'回看本周书签样品记录'});
  await weekly.hover();await weekly.getByRole('button',{name:'不做了：回看本周书签样品记录'}).click();
  await expect(dropDialog(page)).toContainText('这是周期事项，删掉后以后不再出现');
  await page.keyboard.press('Escape');await expect(dropDialog(page)).toBeHidden();
  expect(read('领域/副业/状态.md')).toContain('回看本周书签样品记录');
});
