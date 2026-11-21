/** Arsenal 和灵感搜索继续沿用知识台 v1；PersonalOS 页面另见 personalos.spec.ts。 */
import { expect, test, type Page } from '@playwright/test';
import { app, SEEDED } from './helpers.ts';

const enc = (path: string) => path.split('/').map(encodeURIComponent).join('/');
async function openKnowledge(page: Page, path: string, search = ''): Promise<void> {
  await page.goto(`${app.url}${path}${search}#token=${app.token}`);
}
const detail = (page: Page) => page.getByRole('complementary', { name: '详情' });

test.describe('知识台 Arsenal 与既有搜索', () => {
  test('Arsenal 深链主题保留路由信息、五个页签、缺文件提示和相关主题跳转', async ({ page }) => {
    await openKnowledge(page, `/knowledge/lib/arsenal/topic/${enc('01_业务主题/会员体系')}`);
    const card = detail(page);
    await expect(card.getByTestId('knowledge-topic')).toBeVisible();
    await expect(card.getByRole('heading', { name: /会员体系/ })).toBeVisible();
    await expect(card.getByText(/Loyalty/)).toBeVisible();
    await expect(card.getByRole('tab')).toHaveText(['概览', '资产', '知识', '日志', '文件']);
    await card.getByRole('tab', { name: '资产', exact: true }).click();
    await expect(card.getByRole('tabpanel')).toHaveText('这个主题还没有 Asset_Index.md。');
    await card.getByRole('tab', { name: '知识', exact: true }).click();
    await expect(card.getByRole('tabpanel')).toContainText('积分要有消耗出口');
    await card.getByRole('tab', { name: '概览', exact: true }).click();
    await card.getByRole('button', { name: '标签', exact: true }).click();
    await expect(card.getByRole('heading', { name: /标签/ })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(detail(page)).toHaveCount(0);
  });

  test('Arsenal 搜索保留分组、高亮和阅读器，灵感结果仍跳到灵感台', async ({ page }) => {
    await openKnowledge(page, '/knowledge/today');
    await page.keyboard.press('/');
    await page.keyboard.type('消耗出口');
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/knowledge\/search\//);
    const results = page.getByRole('listbox', { name: '搜索结果' });
    await expect(results.getByRole('region', { name: 'Arsenal' })).toBeVisible();
    await expect(results.locator('mark').first()).toHaveText('消耗出口');
    await results.getByRole('option').first().click();
    await expect(page.getByTestId('knowledge-reader')).toContainText('积分要有消耗出口');

    const keyword = SEEDED.rich.slice(1, 5);
    await openKnowledge(page, `/knowledge/search/${encodeURIComponent(keyword)}`);
    const ideas = page.getByRole('listbox', { name: '搜索结果' }).getByRole('region', { name: '灵感' });
    await expect(ideas).toBeVisible();
    await ideas.getByRole('option').first().click();
    await expect(page).toHaveURL(/\/ideas\//);
  });

  test('Arsenal 阅读器在 sidebar 嵌入下隐藏主列和返回按钮', async ({ page }) => {
    await openKnowledge(page, `/knowledge/lib/arsenal/file/${enc('01_业务主题/会员体系/Topic_Knowledge.md')}`, '?embed=sidebar');
    await expect(page.getByTestId('knowledge-reader')).toContainText('积分要有消耗出口');
    await expect(page.getByRole('navigation', { name: '模块' })).toHaveCount(0);
    await expect(page.getByRole('listbox', { name: '主题清单' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /返回/ })).toHaveCount(0);
  });
});
