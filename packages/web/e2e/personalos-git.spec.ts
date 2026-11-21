import {join} from 'node:path';
import {test,expect,type Page} from '@playwright/test';
import {WEB_ROOT} from '../scripts/sandbox.ts';
import {app,noHorizontalScroll} from './helpers.ts';
const base='/knowledge/activity/commits';
const open=async(page:Page,path:string)=>{
  await page.goto('about:blank');
  await page.goto(process.env.BM_E2E_GIT_URL+path+'#token='+process.env.BM_E2E_GIT_TOKEN);
};
test('日志分段、无Git说明',async({page})=>{
  await page.goto(app.url+'/knowledge/activity#token='+app.token);
  const tabs=page.getByRole('navigation',{name:'动态视图'});
  await tabs.getByText('提交').click(); await expect(page.getByText('PersonalOS 还没有 Git 记录')).toBeVisible();
  await tabs.getByText('日志').click();await expect(page.getByTestId('personalos-activity')).toBeVisible();
});
test('日期、分页、键盘、未存档与领域筛选',async({page})=>{
  await open(page,base);
  await expect(page.locator('[data-pos-focus]')).toHaveCount(30);
  await page.getByText('加载更早').click(); await expect(page.locator('[data-pos-focus]')).toHaveCount(34);
  await expect(page.getByRole('heading',{name:/10-20/})).toBeVisible();
  await page.getByText(/2 个文件有未存档/).click(); await expect(page.getByText('?? 我/纸船.md')).toBeVisible();
  await page.getByRole('button',{name:'未归领域',exact:true}).click(); await expect(page.getByTitle('封存草稿')).toBeVisible();
  await page.getByTitle('封存草稿').click(); await expect(page.getByText('只改了隐藏文件')).toBeVisible();
  await open(page,base+'?domain=技术');
  await expect(page.getByRole('button',{name:'技术',exact:true})).toHaveAttribute('aria-pressed','true');
  await page.keyboard.press('j');await page.keyboard.press('Enter');await expect(page.getByTestId('git-detail')).toBeVisible();
});
test('中文改名、删除和文件差异',async({page})=>{
  await open(page,base);await page.getByTitle('调整中文文件名').click();
  await expect(page.getByTestId('git-detail').locator('summary')).toContainText('领域/写作/纸桥.md → 领域/写作/纸岸.md');
  await open(page,base);await page.getByTitle('移除旧纸桥').click();
  await expect(page.getByTestId('git-detail').locator('summary')).toContainText('D 领域/工作/纸桥.md');
  await expect(page.getByText('打开当前版本')).toHaveCount(0);
});
for(const width of [1440,720]) for(const theme of ['light','dark'] as const){
  test('提交三视图 '+width+' '+theme,async({page})=>{
    await page.setViewportSize({width,height:900});await page.emulateMedia({colorScheme:theme});
    const shot=async(name:string)=>{await noHorizontalScroll(page);await page.screenshot({path:join(WEB_ROOT,'screenshots','personalos-git-'+name+'-'+width+'-'+theme+'.png')})};
    await open(page,base);const large=page.getByTitle('[技术] 导入七组观测');await expect(large).toBeVisible();await shot('list');
    await large.click();const detail=page.getByTestId('git-detail');
    await expect(detail.locator('details[open]')).toHaveCount(3);await expect(detail.getByText(/只显示前 500 行/).first()).toBeVisible();
    await shot('detail');await detail.locator('summary').first().click();await expect(detail.locator('details[open]')).toHaveCount(2);
    await open(page,'/knowledge/domains/写作');await page.getByRole('tab',{name:'提交'}).click();
    const panel=page.getByRole('tabpanel',{name:'提交'});await expect(panel.locator('[data-pos-focus]')).toHaveCount(10);await shot('domain');
    await panel.getByText('在动态页查看全部').click();await expect(page.getByRole('button',{name:'写作',exact:true})).toHaveAttribute('aria-pressed','true');
  });
}
test('提交视图中屏、嵌入与文字放大仍可筛选和打开详情',async({page})=>{
  for(const width of [1280,1024]){
    await page.setViewportSize({width,height:800});
    await open(page,base+'?embed=main');
    const row=page.getByTitle('封存草稿');await expect(row).toBeVisible();
    await page.addStyleTag({content:'html {font-size:200%} body {zoom:2}'});
    await noHorizontalScroll(page);
    await row.click();await expect(page.getByText('只改了隐藏文件')).toBeVisible();
    const url=new URL(page.url());await open(page,url.pathname+'?embed=sidebar');
    await expect(page.getByText('只改了隐藏文件')).toBeVisible();
  }
});
test('Git 错误重试、本机无命令与空筛选状态',async({page})=>{
  let reason='git_error';
  await page.route('**/personalos/git/commits?*',route=>route.fulfill({json:{ok:true,available:false,reason}}));
  await open(page,base);await expect(page.getByText('读取 Git 记录失败')).toBeVisible();
  reason='git_missing';await page.getByRole('button',{name:'重试'}).click();
  await expect(page.getByText('本机没有找到 git 命令')).toBeVisible();
  await page.unroute('**/personalos/git/commits?*');await open(page,base+'?domain=财务');
  await expect(page.getByText('没有匹配的提交')).toBeVisible();
});
