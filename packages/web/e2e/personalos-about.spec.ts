/** 关于页（规格 personalos-ui 第 15 节）：数据全部来自虚构 fixture。 */
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { WEB_ROOT } from '../scripts/sandbox.ts';
import { app, noHorizontalScroll } from './helpers.ts';

const OUT = join(WEB_ROOT, 'screenshots');
const about = (page: Page) => page.getByTestId('personalos-about');
const readerPane = (page: Page) => page.getByRole('complementary', { name: '详情' });

async function openFull(page: Page, path = '/knowledge/about'): Promise<void> {
  await page.goto('about:blank');
  await page.goto(`${app.url}${path}#token=${app.token}`);
}
async function openSources(page: Page, path = '/knowledge/about'): Promise<void> {
  await page.goto('about:blank');
  await page.goto(`${process.env.BM_E2E_SOURCES_URL}${path}#token=${process.env.BM_E2E_SOURCES_TOKEN}`);
}
/** Edit the real response so empty states are tested against the same page code. */
async function patchAbout(page: Page, patch: (body: Record<string, unknown>) => Record<string, unknown>): Promise<void> {
  await page.route('**/api/v1/personalos/about', async (route) => {
    const response = await route.fetch(); const body = await response.json() as Record<string, unknown>;
    await route.fulfill({ response, json: patch(body) });
  });
}

test.describe('关于页', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test('分段第 7 项、页头版本与规模、三层架构、更新记录', async ({ page }) => {
    await openFull(page);
    const tabs = page.getByRole('group', { name: '知识台页面' }).getByRole('button');
    await expect(tabs).toHaveText(['今天', '领域', '资料', '接入', '动态', '搜索', '关于']);
    await expect(tabs.last()).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('about-version')).toHaveText(/关于 v1\.2\s*更新于 2026-11-26/);
    await expect(page.getByRole('list', { name: '规模' })).toContainText('10个领域');
    const entries = page.getByTestId('about-entry');
    await expect(entries).toHaveCount(3);
    await expect(entries.first()).toContainText('AGENTS.md');
    await expect(entries.first()).toContainText('路由表');
    await expect(entries.nth(1)).toContainText('转到 AGENTS.md');
    await expect(page.getByTestId('pos-read-time')).not.toContainText('—');
    await expect(page.getByTestId('about-domain')).toHaveCount(10);
    await expect(page.locator('[data-domain="园艺"]')).toContainText('未登记');
    await expect(page.locator('[data-domain="财务"]')).toContainText('目录不存在');
    await expect(page.locator('[data-domain="技术"]')).toContainText('知识.md');
    await expect(page.getByTestId('about-sources-missing')).toContainText('我/数据源.md');
    await expect(page.getByTestId('about-records')).toContainText('3 条未分拣');
    await expect(page.getByTestId('about-records')).toContainText('2 个月 · 最新 2026-11');
    const changes = page.getByTestId('about-changelog').getByRole('listitem');
    await expect(changes).toHaveCount(4);
    await expect(changes.first()).toContainText('v1.2');
    await expect(changes.first()).toHaveAttribute('data-current', 'true');
    await expect(changes.last()).toContainText('日期待核对');
    await expect(page.getByTestId('about-tree')).toContainText('领域/');
    await expect(page.getByTestId('about-tree')).not.toContainText('.claude');
    await noHorizontalScroll(page);
  });

  test('点入口文件和目录里的文件开阅读器，Esc 关闭；点领域到领域页；命令面板可达', async ({ page }) => {
    await openFull(page);
    await page.getByTestId('about-entry').filter({ hasText: '协议/阅读.md' }).click();
    await expect(readerPane(page)).toContainText('阅读约定');
    await expect(page).toHaveURL(/\/knowledge\/about$/);
    await page.keyboard.press('Escape');
    await expect(readerPane(page)).toHaveCount(0);
    await expect(page.getByTestId('about-entry').filter({ hasText: '协议/阅读.md' })).toBeFocused();
    await page.getByTestId('about-tree').getByRole('button', { name: '收件箱.md' }).click();
    await expect(readerPane(page)).toContainText('暂存还没决定归到哪个领域');
    await page.keyboard.press('Escape');
    await page.locator('[data-domain="技术"]').click();
    await expect(page).toHaveURL(/\/knowledge\/domains\/%E6%8A%80%E6%9C%AF$/);
    await page.keyboard.press('Control+k');
    await expect(page.getByRole('dialog', { name: '命令面板' }).getByRole('combobox', { name: '命令面板' })).toBeFocused();
    await page.keyboard.type('知识台：关于');
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/knowledge\/about$/);
  });

  test('接了数据源：来源、方式、任务按执行方计数，点击进接入页', async ({ page }) => {
    await openSources(page);
    const sources = page.getByTestId('about-source');
    await expect(sources).toHaveCount(5);
    await expect(sources.first()).toContainText('示例聊天');
    await expect(sources.first()).toContainText('副本');
    await expect(sources.first()).toContainText('1 个刷新任务');
    await expect(page.getByTestId('about-tasks')).toContainText('10 个');
    await expect(page.getByTestId('about-tasks')).toContainText('launchd 4 · Codex 5 · 其他 1');
    await expect(page.getByRole('list', { name: '规模' })).toContainText('5个数据源');
    await sources.first().click();
    await expect(page).toHaveURL(/\/knowledge\/sources$/);
    await openSources(page);
    await page.getByTestId('about-tasks').click();
    await expect(page).toHaveURL(/\/knowledge\/sources\/tasks$/);
  });

  test('空状态：没有更新记录、没有 PersonalOS', async ({ page }) => {
    await patchAbout(page, (body) => ({ ...body, about: { file: '我/关于.md', exists: false, current: null, changelog: [] } }));
    await openFull(page);
    await expect(page.getByTestId('about-version')).toContainText('还没有更新记录');
    await expect(page.getByTestId('about-changelog-empty')).toContainText('我/关于.md');
    await expect(page.getByTestId('about-domain')).toHaveCount(10);
    await page.unroute('**/api/v1/personalos/about');
    await patchAbout(page, (body) => ({ ...body, exists: false, entries: [], domains: [], tree: [] }));
    await openFull(page);
    await expect(about(page)).toContainText('没有找到 PersonalOS');
  });

  test('720 宽：单列，没有横向溢出', async ({ page }) => {
    await page.setViewportSize({ width: 720, height: 900 });
    await openSources(page);
    await expect(page.getByTestId('about-source')).toHaveCount(5);
    await noHorizontalScroll(page);
  });
});

for (const theme of ['light', 'dark'] as const) {
  for (const width of [1440, 720]) {
    test(`关于页截图 ${width} ${theme}`, async ({ browser }) => {
      const context = await browser.newContext({ viewport: { width, height: 1800 }, colorScheme: theme });
      try {
        const page = await context.newPage();
        await openSources(page);
        await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
        await expect(page.getByTestId('about-source')).toHaveCount(5);
        await page.mouse.move(0, 0);
        await noHorizontalScroll(page);
        await page.screenshot({ path: join(OUT, `personalos-about-${width}-${theme}.png`) });
      } finally { await context.close(); }
    });
  }
}
