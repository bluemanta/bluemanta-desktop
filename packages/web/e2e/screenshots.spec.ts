/**
 * 设计验收截图（设计规范第 10 节）。写到 packages/web/screenshots/，CI 作为产物上传；
 * 不入库，用户认可正式页面后再登记基线。
 */
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { gradientPng } from '../scripts/png.ts';
import { WEB_ROOT } from '../scripts/sandbox.ts';
import { app, detail, openApp, row, rows, SEEDED, VIEWPORTS, waitImages } from './helpers.ts';

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

const PNG = gradientPng(320, 200, [90, 140, 160], [210, 196, 170]);

test.describe('写操作', () => {
  test.describe.configure({ mode: 'serial' });

  for (const variant of [
    { theme: 'light' as const, width: 1440, suffix: '1440-light', conflict: '学一点基础的色彩理论' },
    { theme: 'dark' as const, width: 1440, suffix: '1440-dark', conflict: '学 SQL 窗口函数' },
    { theme: 'light' as const, width: 720, suffix: '720-light', conflict: '季度复盘的写法' },
  ]) {
    test(`快速记录、编辑、确认、冲突、回收站、撤销 ${variant.suffix}`, async ({ browser }) => {
      test.setTimeout(120_000);
      const context = await browser.newContext({
        viewport: { width: variant.width, height: 900 },
        colorScheme: variant.theme,
      });
      const page = await context.newPage();
      await openApp(page, { shot: true });
      await expect(page.locator('html')).toHaveAttribute('data-theme', variant.theme);

      await page.getByRole('button', { name: '＋ 记一条' }).click();
      const card = page.getByRole('form', { name: '快速记录' });
      await card.getByRole('textbox', { name: '标题' }).fill('截图用的一条灵感');
      await card.getByRole('textbox', { name: '正文' }).fill('带一张图片的快速记录。');
      await card.getByLabel('选择图片').setInputFiles({ name: 'shot.png', mimeType: 'image/png', buffer: PNG });
      await expect(card.getByRole('img', { name: '图片 1' })).toBeVisible();
      await expect(card.getByRole('progressbar')).toHaveCount(0);
      await shoot(page, `state-capture-${variant.suffix}`);
      await page.keyboard.press('Escape');

      if (variant.width < 1024) {
        await row(page, SEEDED.rich).click();
        await page.getByRole('button', { name: '编辑' }).click();
        await page.getByRole('textbox', { name: '正文' }).fill('改过但还没保存');
        await shoot(page, `state-edit-${variant.suffix}`);
        await page.getByRole('button', { name: '返回' }).click();
        await expect(page.getByRole('alertdialog')).toBeVisible();
        await shoot(page, `state-discard-${variant.suffix}`);
        await page.getByRole('button', { name: '继续编辑' }).click();
        await page.getByRole('button', { name: '取消', exact: true }).click();
        await page.getByRole('alertdialog').getByRole('button', { name: '放弃修改' }).click();
        await page.getByRole('button', { name: '返回' }).click();
      } else {
        await row(page, SEEDED.rich).click();
        await detail(page).getByRole('button', { name: '编辑' }).click();
        await detail(page).getByRole('textbox', { name: '正文' }).fill('改过但还没保存');
        await expect(detail(page).getByLabel('未保存')).toBeVisible();
        await shoot(page, `state-edit-${variant.suffix}`);
        await page.getByRole('button', { name: '统计', exact: true }).click();
        await expect(page.getByRole('alertdialog')).toBeVisible();
        await shoot(page, `state-discard-${variant.suffix}`);
        await page.getByRole('button', { name: '继续编辑' }).click();
        await detail(page).getByRole('button', { name: '取消' }).click();
        await page.getByRole('alertdialog').getByRole('button', { name: '放弃修改' }).click();
      }

      await row(page, variant.conflict).click();
      await page.getByRole('button', { name: '编辑' }).click();
      await page.getByRole('textbox', { name: '标题' }).fill('截图里的本地草稿');
      const id = page.url().match(/\/ideas\/(card_[^/?]+)/)?.[1];
      if (!id) throw new Error('地址里没有灵感 id');
      const token = await page.evaluate(() => window.localStorage.getItem('bluemanta.token'));
      const current = await page.request.get(`${app.shotUrl}/api/v1/ideas/${id}`, {
        headers: { authorization: `Bearer ${token}` },
      });
      const rev = ((await current.json()) as { record: { rev: number } }).record.rev;
      const patched = await page.request.patch(`${app.shotUrl}/api/v1/ideas/${id}`, {
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        data: { requestId: crypto.randomUUID(), rev, title: '别处更新的标题' },
      });
      expect(patched.ok()).toBeTruthy();
      await page.getByRole('button', { name: '保存' }).click();
      await expect(page.getByText('这条灵感已在别处更新')).toBeVisible();
      await shoot(page, `state-conflict-${variant.suffix}`);
      await page.getByRole('button', { name: '取消', exact: true }).click();
      await page.getByRole('alertdialog').getByRole('button', { name: '放弃修改' }).click();

      if (variant.width < 1024) await page.goto(`${app.shotUrl}/ideas`);
      await page.getByRole('button', { name: '回收站', exact: true }).click();
      await expect(page.getByText('已经移入回收站的一条')).toBeVisible();
      await shoot(page, `state-trash-${variant.suffix}`);
      await page.getByRole('button', { name: '彻底删除' }).click();
      await expect(page.getByRole('alertdialog')).toBeVisible();
      await shoot(page, `state-purge-${variant.suffix}`);
      await page.getByRole('alertdialog').getByRole('button', { name: '取消' }).click();

      await page.getByRole('button', { name: '清单', exact: true }).click();
      await row(page, '晨跑路线换成河边').click();
      if (variant.width < 1024) {
        await page.getByRole('button', { name: '移入回收站' }).click();
      } else {
        await detail(page).getByRole('button', { name: '移入回收站' }).click();
      }
      await expect(page.getByRole('status')).toContainText('撤销');
      await shoot(page, `state-toast-undo-${variant.suffix}`);
      await page.getByRole('status').getByRole('button', { name: '撤销' }).click();
      await expect(row(page, '晨跑路线换成河边')).toBeVisible();
      await context.close();
    });
  }

  test('空回收站 1440 浅色、1440 深色、720 浅色', async ({ browser }) => {
    test.setTimeout(90_000);
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: 'light' });
    const page = await context.newPage();
    await openApp(page, { shot: true });
    const token = await page.evaluate(() => window.localStorage.getItem('bluemanta.token'));
    const listed = await page.request.get(`${app.shotUrl}/api/v1/ideas?scope=trash`, {
      headers: { authorization: `Bearer ${token}` },
    });
    const trashed = ((await listed.json()) as { items: { id: string; rev: number }[] }).items;
    for (const item of trashed) {
      const purged = await page.request.post(`${app.shotUrl}/api/v1/ideas/${item.id}/purge`, {
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        data: { requestId: crypto.randomUUID(), rev: item.rev },
      });
      expect(purged.ok()).toBeTruthy();
    }
    await page.getByRole('button', { name: '回收站', exact: true }).click();
    await expect(page.getByRole('heading', { name: '回收站是空的' })).toBeVisible();
    await shoot(page, 'state-trash-empty-1440-light');
    await page.emulateMedia({ colorScheme: 'dark' });
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await shoot(page, 'state-trash-empty-1440-dark');
    await page.setViewportSize({ width: 720, height: 900 });
    await page.emulateMedia({ colorScheme: 'light' });
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    await shoot(page, 'state-trash-empty-720-light');
    await context.close();
  });
});
