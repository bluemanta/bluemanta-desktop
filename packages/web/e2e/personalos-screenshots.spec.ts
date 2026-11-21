/** P3 设计验收截图；实际浏览器运行后才会产生文件，收集用例不代表截图已完成。 */
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { WEB_ROOT } from '../scripts/sandbox.ts';
import { app, noHorizontalScroll, VIEWPORTS } from './helpers.ts';

const OUT = join(WEB_ROOT, 'screenshots');
const detail = (page: Page) => page.getByTestId('personalos-domain-detail');

async function open(page: Page, path: string): Promise<void> {
  await page.goto(`${app.shotUrl}${path}#token=${app.shotToken}`);
}
async function shoot(page: Page, name: string): Promise<void> {
  await page.mouse.move(0, 0);
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await noHorizontalScroll(page);
  await page.screenshot({ path: join(OUT, `${name}.png`) });
}

for (const theme of ['light', 'dark'] as const) {
  for (const viewport of VIEWPORTS) {
    const size = `${viewport.width}x${viewport.height}`;
    test(`PersonalOS今天、网格、含挂接卡片详情 ${size} ${theme}`, async ({ browser }) => {
      const context = await browser.newContext({ viewport, colorScheme: theme });
      try {
        const page = await context.newPage();
        await open(page, '/knowledge/today');
        await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
        await expect(page.getByTestId('personalos-today').getByRole('region', { name: '已逾期', exact: true })).toBeVisible();
        await shoot(page, `personalos-today-${size}-${theme}`);
        await open(page, '/knowledge/domains');
        const grid = page.getByRole('listbox', { name: '领域列表' });
        await expect(grid.getByRole('option')).toHaveCount(10);
        await shoot(page, `personalos-domains-${size}-${theme}`);
        await grid.getByRole('option', { name: '领域：工作', exact: true }).click();
        await expect(detail(page)).toBeVisible();
        await detail(page).getByTestId('personalos-mount').first().scrollIntoViewIfNeeded();
        await expect(detail(page).getByTestId('personalos-mount')).toHaveCount(2);
        await shoot(page, `personalos-domain-detail-${size}-${theme}`);
      } finally {
        await context.close();
      }
    });
  }
}
