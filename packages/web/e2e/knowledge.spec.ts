/**
 * 知识台走查（knowledge-ui 第 8 节）。库是 packages/knowledge/fixtures 里的虚构内容，
 * 灵感用 scripts/seed.ts 的虚构数据。只读，不改任何数据。
 */
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { WEB_ROOT } from '../scripts/sandbox.ts';
import { app, SEEDED } from './helpers.ts';

const OUT = join(WEB_ROOT, 'screenshots');
const enc = (path: string) => path.split('/').map(encodeURIComponent).join('/');

async function openKnowledge(page: Page, path = '/knowledge', search = ''): Promise<void> {
  await page.goto(`${app.url}${path}${search}#token=${app.token}`);
}

const topics = (page: Page) => page.getByRole('listbox', { name: '主题清单' });
const topicRow = (page: Page, name: string) => topics(page).getByRole('option').filter({ has: page.getByText(name, { exact: true }) });
const detail = (page: Page) => page.getByRole('complementary', { name: '详情' });

test.describe('知识台', () => {
  test('侧栏入口、库切换、主题分组和标记', async ({ page }) => {
    await openKnowledge(page, '/ideas');
    await page.getByRole('navigation').getByRole('button', { name: '知识台' }).click();
    await expect(page).toHaveURL(/\/knowledge$/);
    await expect(page.getByTestId('topic-count')).toHaveText('6 个主题');
    await expect(topics(page).getByRole('region')).toHaveText([/^思考与判断/, /^职业与业务/, /^AI与技术/, /^家庭与生活/]);
    await expect(topicRow(page, '临时整理')).toContainText('未登记');
    await expect(topicRow(page, '自动化小工具')).toContainText('目录未建');
    await page.getByRole('toolbar', { name: '筛选' }).getByRole('button', { name: /Arsenal/ }).click();
    await expect(page).toHaveURL(/\/knowledge\/lib\/arsenal$/);
    await expect(page.getByTestId('topic-count')).toHaveText('2 个主题');
    await page.getByRole('button', { name: '活跃', exact: true }).click();
    await expect(page.getByTestId('topic-count')).toHaveText('1 个主题');
  });

  test('主题四个页签，缺文件时照样占位', async ({ page }) => {
    await openKnowledge(page);
    await topicRow(page, 'AI关注').click();
    const card = detail(page);
    await expect(card.getByRole('heading', { name: /AI关注/ })).toBeVisible();
    await expect(card.getByRole('tab')).toHaveText(['概览', '资产', '知识', '日志', '文件']);
    await card.getByRole('tab', { name: '资产' }).click();
    await expect(card.getByRole('tabpanel')).toHaveText('这个主题还没有 Asset_Index.md。');
    await card.getByRole('tab', { name: '知识' }).click();
    await expect(card.getByRole('tabpanel')).toContainText('智能体工作台要先解决上下文');
    await page.keyboard.press('Escape');
    await expect(detail(page)).toHaveCount(0);
  });

  test('概览里的路由信息、相关主题跳转、文件页签与归档、阅读器和相对链接', async ({ page }) => {
    await openKnowledge(page, `/knowledge/lib/personal/topic/${enc('02_职业与业务/售前方法')}`);
    const card = detail(page);
    await expect(card.getByText('Presales')).toBeVisible();
    await card.getByRole('tab', { name: /文件/ }).click();
    await expect(card.getByRole('tabpanel').getByRole('listitem')).toHaveCount(2);
    await card.getByRole('button', { name: '归档 1 个' }).click();
    await expect(card.getByText('客户研究清单_v1.md')).toBeVisible();
    await card.getByRole('tab', { name: '概览' }).click();
    await card.getByRole('link', { name: '客户研究清单' }).click();
    await expect(page.getByTestId('knowledge-reader')).toContainText('一页客户画像');
    await expect(page).toHaveURL(/\/file\//);
    await page.goBack();
    await detail(page).getByRole('link', { name: 'AI关注' }).click();
    await expect(page.getByTestId('knowledge-reader')).toContainText('关注的模型和工具');
  });

  test('搜索：分组、高亮、打开命中段，灵感结果跳到灵感台', async ({ page }) => {
    await openKnowledge(page);
    await page.keyboard.press('/');
    await page.keyboard.type('评分项');
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/knowledge\/search\//);
    const results = page.getByRole('listbox', { name: '搜索结果' });
    await expect(results.getByRole('region', { name: '个人库' })).toBeVisible();
    await expect(results.locator('mark').first()).toHaveText('评分项');
    await results.getByRole('option').first().click();
    await expect(page.getByTestId('knowledge-reader')).toContainText('拿到 RFP 先拆评分项');

    const keyword = SEEDED.rich.slice(1, 5); // 会议纪要
    await openKnowledge(page, `/knowledge/search/${encodeURIComponent(keyword)}`);
    const ideas = page.getByRole('listbox', { name: '搜索结果' }).getByRole('region', { name: '灵感' });
    await expect(ideas).toBeVisible();
    await ideas.getByRole('option').first().click();
    await expect(page).toHaveURL(/\/ideas\//);
  });

  test('收件箱', async ({ page }) => {
    await openKnowledge(page, '/knowledge/inbox');
    const inbox = page.getByRole('listbox', { name: '收件箱' });
    await expect(inbox.getByRole('option')).toHaveText([/2026-10-20-读书笔记草稿\.md/]);
    await inbox.getByRole('option').first().click();
    await expect(page.getByTestId('knowledge-reader')).toContainText('复利思维');
  });

  test('嵌入：main 隐藏侧栏；sidebar 只显示阅读器', async ({ page }) => {
    await openKnowledge(page, '/knowledge', '?embed=main');
    await expect(page.getByTestId('topic-count')).toHaveText('6 个主题');
    await expect(page.getByRole('navigation')).toHaveCount(0);
    await openKnowledge(page, `/knowledge/lib/arsenal/file/${enc('01_业务主题/会员体系/Topic_Knowledge.md')}`, '?embed=sidebar');
    await expect(page.getByTestId('knowledge-reader')).toContainText('积分要有消耗出口');
    await expect(page.getByRole('listbox', { name: '主题清单' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /返回/ })).toHaveCount(0);
  });
});

test.describe('知识台截图', () => {
  for (const theme of ['light', 'dark'] as const) {
    test(`主题与详情 1440 ${theme}`, async ({ browser }) => {
      const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: theme });
      const page = await context.newPage();
      await openKnowledge(page, `/knowledge/lib/personal/topic/${enc('02_职业与业务/售前方法')}`);
      await expect(detail(page).getByRole('tab', { name: '概览' })).toBeVisible();
      await page.mouse.move(0, 0);
      await page.screenshot({ path: join(OUT, `knowledge-topics-1440x900-${theme}.png`) });
      await context.close();
    });
  }

  test('搜索 1440 浅色、主题 720 浅色', async ({ browser }) => {
    const wide = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await wide.newPage();
    await openKnowledge(page, `/knowledge/search/${encodeURIComponent('会员 积分')}`);
    await expect(page.getByTestId('hit-count')).toHaveText(/\d+ 条/);
    await page.screenshot({ path: join(OUT, 'knowledge-search-1440x900-light.png') });
    await wide.close();
    const narrow = await browser.newContext({ viewport: { width: 720, height: 900 } });
    const small = await narrow.newPage();
    await openKnowledge(small);
    await expect(small.getByTestId('topic-count')).toHaveText('6 个主题');
    await small.screenshot({ path: join(OUT, 'knowledge-topics-720x900-light.png') });
    await narrow.close();
  });
});
