/** P4 只读走查：真实请求仅访问 fixture；三组同屏结果使用明确的虚构响应。 */
import { expect, test, type Page } from '@playwright/test';
import { app, noHorizontalScroll, VIEWPORTS } from './helpers.ts';
import { mockThreeGroupSearch, SEARCH_QUERY } from './personalos-search-fixture.ts';

const resources = (page: Page) => page.getByTestId('personalos-resources');
const registry = (page: Page) => page.getByTestId('personalos-registry');
const registryRows = (page: Page) => registry(page).locator('tbody tr');
const activity = (page: Page) => page.getByTestId('personalos-activity');
const results = (page: Page) => page.getByRole('listbox', { name: '搜索结果' });
const searchPath = (query: string) => `/knowledge/search/${encodeURIComponent(query)}`;
async function open(page: Page, path: string): Promise<void> {
  await page.goto(`${app.url}${path}#token=${app.token}`);
}

// 不访问宿主剪贴板；验证页面复制的是可展示的 fixture 路径。
async function mockClipboard(page: Page): Promise<void> {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: async (value: string) => { sessionStorage.setItem('test:copied-path', value); } },
    });
  });
}

test.describe('PersonalOS 资料、动态与搜索', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test('资料登记合并九行，提示不存在路径，复制展示路径且外链新窗口打开', async ({ page }) => {
    await mockClipboard(page);
    await open(page, '/knowledge/resources');
    await expect(registryRows(page)).toHaveCount(9);
    await expect(registry(page).getByRole('columnheader')).toHaveText(['领域', '主题', '资料', '位置', '用途', '状态']);
    const missing = registryRows(page).filter({ hasText: '书架布局草稿' });
    await expect(missing).toHaveAttribute('data-missing', 'true');
    await expect(missing.getByTitle('这个路径现在不存在')).toBeVisible();
    await expect(missing).toContainText('~/Documents/PersonalOS/领域/工作/事项/书架布局草稿.md');
    await missing.getByRole('button', { name: /复制路径/ }).click();
    await expect.poll(() => page.evaluate(() => sessionStorage.getItem('test:copied-path'))).toBe('~/Documents/PersonalOS/领域/工作/事项/书架布局草稿.md');
    await expect(page.getByText('已复制路径', { exact: true })).toBeVisible();
    const link = registry(page).getByRole('link', { name: '复盘样式', exact: true });
    await expect(link).toHaveAttribute('href', 'https://example.org/linzhou/review');
    await expect(link).toHaveAttribute('target', '_blank');
    await expect(link).toHaveAttribute('rel', /noopener|noreferrer/);
  });

  test('资料领域多选、位置类型和缺失路径筛选可组合，并有空态', async ({ page }) => {
    await open(page, '/knowledge/resources');
    await resources(page).getByRole('button', { name: '工作', exact: true }).click();
    await expect(registryRows(page)).toHaveCount(3);
    await resources(page).getByRole('button', { name: '技术', exact: true }).click();
    await expect(registryRows(page)).toHaveCount(6);
    await expect(resources(page).getByRole('button', { name: '工作', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await expect(resources(page).getByRole('button', { name: '技术', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await resources(page).getByRole('group', { name: '位置类型', exact: true }).getByRole('button', { name: '本机', exact: true }).click();
    await expect(registryRows(page)).toHaveCount(3);
    await resources(page).getByRole('button', { name: '本机路径不存在', exact: true }).click();
    await expect(resources(page).getByRole('button', { name: '本机路径不存在', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await expect(registryRows(page)).toHaveCount(1);
    await expect(registryRows(page)).toContainText('书架布局草稿');
    await resources(page).getByRole('button', { name: '本机路径不存在', exact: true }).click();
    await resources(page).getByRole('button', { name: '技术', exact: true }).click();
    await resources(page).getByRole('group', { name: '位置类型', exact: true }).getByRole('button', { name: '链接', exact: true }).click();
    await expect(resources(page).getByRole('heading', { name: '没有符合条件的资料', exact: true })).toBeVisible();

    await open(page, '/knowledge/resources');
    await resources(page).getByRole('button', { name: '本机路径不存在', exact: true }).click();
    await expect(registryRows(page)).toHaveCount(2);
    await resources(page).getByRole('button', { name: '本机路径不存在', exact: true }).click();
    await resources(page).getByRole('group', { name: '位置类型', exact: true }).getByRole('button', { name: '其他', exact: true }).click();
    await expect(registryRows(page)).toHaveCount(2);
  });

  test('资料内的Arsenal分段固定该库，主题详情仍可读并能回资料登记', async ({ page }) => {
    await open(page, '/knowledge/resources');
    await page.getByRole('button', { name: 'Arsenal', exact: true }).click();
    await expect(page).toHaveURL(/\/knowledge\/resources\/arsenal$/);
    await expect(page.getByRole('listbox', { name: '主题清单' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Arsenal', exact: true })).toHaveCount(1);
    await expect(page.getByRole('button', { name: /个人库/ })).toHaveCount(0);
    await page.getByRole('listbox', { name: '主题清单' }).getByRole('option').filter({ hasText: '会员体系' }).click();
    await expect(page.getByTestId('knowledge-topic').getByRole('heading', { name: /会员体系/ })).toBeVisible();
    await page.getByRole('button', { name: '资料登记', exact: true }).click();
    await expect(page).toHaveURL(/\/knowledge\/resources$/);
    await expect(registryRows(page)).toHaveCount(9);
  });

  test('动态倒序按日期分组，小节默认折叠，展开后显示正文', async ({ page }) => {
    await open(page, '/knowledge/activity');
    const dates = activity(page).getByRole('region');
    await expect(dates.first()).toHaveAttribute('aria-label', '2026-11-21');
    await expect(activity(page).getByRole('region', { name: '2026-11-20', exact: true })).toContainText('11-20');
    const section = activity(page).locator('details').filter({ has: page.locator('summary').filter({ hasText: '索引实验交付说明' }) });
    await expect(section).not.toHaveAttribute('open', '');
    await expect(section.getByText('交付的是一份输入输出说明，没有对外服务，也没有接入真实读者数据。', { exact: true })).toBeHidden();
    await section.locator('summary').click();
    await expect(section).toHaveAttribute('open', '');
    await expect(section).toContainText('空书名应得到提示');
    await expect(section.getByText('交付的是一份输入输出说明，没有对外服务，也没有接入真实读者数据。', { exact: true })).toBeVisible();
    const review = activity(page).locator('details').filter({ has: page.locator('summary').filter({ hasText: '回看要点' }) });
    await review.locator('summary').click();
    await expect(review).toContainText('先展示两个失败样例');
  });

  test('动态支持领域多选并加载早于默认30天窗口的日志', async ({ page }) => {
    await open(page, '/knowledge/activity');
    await activity(page).getByRole('button', { name: '技术', exact: true }).click();
    await expect(activity(page).getByTestId('personalos-log-entry')).toHaveCount(2);
    await expect(activity(page)).toContainText('十个虚构书名');
    await activity(page).getByRole('button', { name: '副业', exact: true }).click();
    await expect(activity(page).getByTestId('personalos-log-entry')).toHaveCount(3);
    await expect(activity(page)).toContainText('纸张比较记录');
    await open(page, '/knowledge/activity');
    await expect(activity(page)).not.toContainText('把试点想法整理成一页纸');
    await activity(page).getByRole('button', { name: '加载更早', exact: true }).click();
    await expect(activity(page).getByRole('region', { name: '2026-10-15', exact: true })).toContainText('把试点想法整理成一页纸');
    await expect(activity(page).locator('summary').filter({ hasText: '纸面试点交付说明' })).toBeVisible();
  });

  test('追加条目独立显示，普通标签为灰色；未归领域包含条目与小节且可和领域多选', async ({ page }) => {
    await open(page, '/knowledge/activity');
    const entries = activity(page).getByTestId('personalos-log-entry');
    await expect(entries).toHaveCount(9);
    const section = activity(page).locator('details').filter({ has: page.locator('summary').filter({ hasText: '索引实验交付说明' }) });
    await section.locator('summary').click();
    await expect(section).not.toContainText('将访谈顺序改成先观察后提问');
    await expect(section).not.toContainText('失败假设');
    await expect(section).not.toContainText('重复书名样例');
    await expect(entries.filter({ hasText: '重复书名样例' })).toBeVisible();
    const tag = activity(page).getByTestId('personalos-log-tag');
    await expect(tag).toHaveText('蓝图');
    expect(await tag.evaluate((element) => getComputedStyle(element).color)).toBe(await tag.evaluate((element) => {
      const probe = document.createElement('span');
      probe.style.color = 'var(--bm-text-3)';
      element.append(probe);
      const color = getComputedStyle(probe).color;
      probe.remove();
      return color;
    }));
    await activity(page).getByRole('button', { name: '未归领域', exact: true }).click();
    await expect(entries).toHaveCount(4);
    await expect(activity(page).locator('details')).toHaveCount(2);
    await expect(tag).toHaveText('蓝图');
    await activity(page).getByRole('button', { name: '技术', exact: true }).click();
    await expect(entries).toHaveCount(6);
    await activity(page).getByRole('button', { name: '未归领域', exact: true }).click();
    await expect(entries).toHaveCount(2);
    await activity(page).getByRole('button', { name: '全部', exact: true }).click();
    await expect(entries).toHaveCount(9);
    await expect(activity(page).getByRole('button', { name: '未归领域', exact: true })).toHaveAttribute('aria-pressed', 'false');
  });

  test('资料和动态读取失败保持可见说明', async ({ page }) => {
    await page.route('**/api/v1/personalos/registry', (route) => route.fulfill({ status: 500, json: { ok: false, code: 'read_error', message: '虚构资料读取失败' } }));
    await open(page, '/knowledge/resources');
    await expect(resources(page).getByRole('alert')).toContainText('读取失败');
    await page.route('**/api/v1/personalos/log**', (route) => route.fulfill({ status: 500, json: { ok: false, code: 'read_error', message: '虚构日志读取失败' } }));
    await open(page, '/knowledge/activity');
    await expect(activity(page).getByRole('alert')).toContainText('读取失败');
  });

  test('fixture关键词只命中PersonalOS或Arsenal，领域别名把副业结果置前', async ({ page }) => {
    await open(page, searchPath('雾灯便签'));
    const personalOs = results(page).getByRole('region', { name: 'PersonalOS', exact: true });
    await expect(personalOs).toBeVisible();
    await expect(results(page).getByRole('region', { name: 'Arsenal', exact: true })).toHaveCount(0);
    await expect(personalOs.getByRole('option').first().getByTestId('search-domain')).toHaveText('工作');
    await expect(personalOs.locator('mark').filter({ hasText: '雾灯便签' }).first()).toBeVisible();
    await open(page, searchPath('消耗出口'));
    await expect(results(page).getByRole('region', { name: 'Arsenal', exact: true })).toBeVisible();
    await expect(results(page).getByRole('region', { name: 'PersonalOS', exact: true })).toHaveCount(0);
    await open(page, searchPath('纸舟实验'));
    const first = results(page).getByRole('region', { name: 'PersonalOS', exact: true }).getByRole('option').first();
    await expect(first.getByTestId('search-domain')).toHaveText('副业');
    await expect(first.getByTestId('search-title-chain')).toContainText('副业 ›');
    await first.click();
    await expect(page.getByTestId('personalos-reader')).toContainText('书签');
    await expect(page).toHaveURL(/\/knowledge\/search\//);
  });

  test('搜索请求限定新三组，展示领域标签与标题链，旧personal响应不显示', async ({ page }) => {
    await mockThreeGroupSearch(page);
    const requested = page.waitForRequest((request) => new URL(request.url()).pathname === '/api/v1/knowledge/search');
    await open(page, searchPath(SEARCH_QUERY));
    const params = new URL((await requested).url()).searchParams;
    expect(params.getAll('library')).toEqual(['personalos', 'arsenal']);
    expect(params.get('ideas')).toBe('1');
    await expect(results(page).getByRole('region')).toHaveCount(3);
    for (const name of ['PersonalOS', 'Arsenal', '灵感']) await expect(results(page).getByRole('region', { name, exact: true })).toBeVisible();
    await expect(page.getByTestId('hit-count')).toHaveText('3 条');
    await expect(page.getByText('旧个人库隔离标记', { exact: true })).toHaveCount(0);
    await expect(page.getByRole('toolbar', { name: '筛选来源' }).getByRole('button', { name: '个人库', exact: true })).toHaveCount(0);
    const hit = results(page).getByRole('region', { name: 'PersonalOS', exact: true }).getByRole('option');
    await expect(hit.getByTestId('search-domain')).toHaveText('工作');
    await expect(hit.getByTestId('search-title-chain')).toHaveText('工作 › 状态.md › 现状');
    await hit.click();
    await expect(page.getByTestId('personalos-reader').getByRole('heading', { name: '现状', exact: true })).toBeInViewport();
    await expect(page).toHaveURL(new RegExp(`/knowledge/search/${encodeURIComponent(SEARCH_QUERY)}$`));
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('personalos-reader')).toHaveCount(0);
    const filters = page.getByRole('toolbar', { name: '筛选来源' });
    await filters.getByRole('button', { name: 'Arsenal', exact: true }).click();
    await expect(results(page).getByRole('region')).toHaveCount(1);
    await expect(results(page).getByRole('region', { name: 'Arsenal', exact: true })).toBeVisible();
    await filters.getByRole('button', { name: '灵感', exact: true }).click();
    await expect(results(page).getByRole('region')).toHaveCount(2);
    await filters.getByRole('button', { name: '全部', exact: true }).click();
    await expect(results(page).getByRole('region')).toHaveCount(3);

    // 分组顺序跟随最相关命中的首现顺序，不固定 PersonalOS 优先。
    await page.unroute('**/api/v1/knowledge/search?**');
    await mockThreeGroupSearch(page, ['arsenal', 'idea', 'personalos', 'personal']);
    await page.reload();
    const groups = results(page).getByRole('region');
    await expect(groups).toHaveCount(3);
    for (const [index, name] of ['Arsenal', '灵感', 'PersonalOS'].entries()) {
      await expect(groups.nth(index)).toHaveAttribute('aria-label', name);
    }
  });
});

for (const viewport of VIEWPORTS) {
  test(`资料、动态、搜索在${viewport.width}宽无页面横向溢出，窄屏阅读器可返回`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await open(page, '/knowledge/resources');
    await expect(registryRows(page)).toHaveCount(9);
    await noHorizontalScroll(page);
    await open(page, '/knowledge/activity');
    await expect(activity(page).getByRole('region', { name: '2026-11-21', exact: true })).toBeVisible();
    await noHorizontalScroll(page);
    await mockThreeGroupSearch(page);
    await open(page, searchPath(SEARCH_QUERY));
    await expect(results(page).getByRole('region')).toHaveCount(3);
    await noHorizontalScroll(page);
    if (viewport.width < 1024) {
      await results(page).getByRole('region', { name: 'PersonalOS', exact: true }).getByRole('option').click();
      await expect(page.getByTestId('personalos-reader')).toBeVisible();
      await expect(results(page)).toHaveCount(0);
      await noHorizontalScroll(page);
      await page.getByRole('button', { name: /返回/ }).click();
      await expect(results(page).getByRole('region')).toHaveCount(3);
      await expect(page).toHaveURL(new RegExp(`/knowledge/search/${encodeURIComponent(SEARCH_QUERY)}$`));
    }
  });
}
