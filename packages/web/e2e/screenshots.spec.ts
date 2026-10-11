/**
 * 设计验收截图（设计规范第 10 节）。写到 packages/web/screenshots/，CI 作为产物上传；
 * 不入库，用户认可正式页面后再登记基线。
 */
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { WEB_ROOT } from '../scripts/sandbox.ts';
import { detail, openApp, row, rows, SEEDED, VIEWPORTS, waitImages } from './helpers.ts';

const OUT = join(WEB_ROOT, 'screenshots');

async function shoot(page: Page, name: string): Promise<void> {
  await page.mouse.move(0, 0);
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.screenshot({ path: join(OUT, `${name}.png`) });
}

for (const theme of ['light', 'dark'] as const) {
  for (const viewport of VIEWPORTS) {
    const size = `${viewport.width}x${viewport.height}`;
    test(`清单与详情 ${size} ${theme}`, async ({ browser }) => {
      const context = await browser.newContext({ viewport, colorScheme: theme });
      const page = await context.newPage();
      await openApp(page);
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
      if (viewport.width < 1024) {
        await shoot(page, `list-${size}-${theme}`);
        await row(page, SEEDED.rich).click();
        await waitImages(page, 2);
        await shoot(page, `detail-${size}-${theme}`);
      } else {
        await row(page, SEEDED.fourImages).click();
        await row(page, SEEDED.rich).click();
        await waitImages(page, 2);
        await expect(detail(page).getByRole('tab')).toHaveCount(2);
        await shoot(page, `list-detail-${size}-${theme}`);
      }
      await context.close();
    });
  }
}

test.describe('状态 1440 浅色', () => {
  test.use({ viewport: { width: 1440, height: 900 }, colorScheme: 'light' });

  test('空库', async ({ page }) => {
    await openApp(page, { empty: true });
    await expect(page.getByRole('heading', { name: '还没有灵感' })).toBeVisible();
    await shoot(page, 'state-empty-1440-light');
  });

  test('筛选无结果', async ({ page }) => {
    await openApp(page);
    await page.getByRole('button', { name: '★ 收藏' }).click();
    await page.getByRole('button', { name: '其他' }).click();
    await expect(page.getByRole('heading', { name: '没有匹配的灵感' })).toBeVisible();
    await shoot(page, 'state-no-match-1440-light');
  });

  test('读取失败（显示缓存）', async ({ page }) => {
    await page.clock.install();
    await openApp(page);
    await row(page, SEEDED.rich).click();
    await waitImages(page, 2);
    await page.route('**/api/v1/ideas', (route) =>
      route.fulfill({ status: 500, json: { ok: false, code: 'internal', message: '服务内部错误' } }),
    );
    await page.clock.runFor(31_000);
    await page.clock.runFor(2_000);
    await expect(page.getByRole('alert').first()).toBeVisible();
    await expect(rows(page)).toHaveCount(SEEDED.total);
    await shoot(page, 'state-read-failure-1440-light');
  });

  test('长标题', async ({ page }) => {
    await openApp(page);
    await row(page, SEEDED.longTitlePrefix).click();
    await expect(detail(page).getByRole('heading', { level: 2 })).toContainText(SEEDED.longTitlePrefix);
    await shoot(page, 'state-long-title-1440-light');
  });

  test('搜索高亮', async ({ page }) => {
    await openApp(page);
    await page.getByRole('searchbox', { name: '搜索灵感' }).fill('纪要');
    await expect(rows(page)).toHaveCount(2);
    await shoot(page, 'state-search-1440-light');
  });
});
