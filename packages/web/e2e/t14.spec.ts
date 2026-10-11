/**
 * T14：统计、日期胶囊、命令面板、键盘、深浅色、200% 放大。
 * 统计预期按 scripts/seed.ts 的日龄表计算；种子时刻用「咖啡店」那条的 createdAt 对齐，避免跨过上海零点时对不上。
 */
import type { IdeaListItem, IdeaListResponse } from '@bluemanta/server/api-types';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { app, detail, openApp, row, rows, SEEDED } from './helpers.ts';
import { formatDayNumber, shanghaiDayNumber } from '../src/ideas/model/time.ts';

const HEAT_CELLS = 26 * 7;

/** 未删除种子的日龄（相对种子当天）。桌面新建的「咖啡店」也在当天。 */
const SEED_ROWS: { age: number; category: 'product' | 'learning' | 'work' | 'life' | 'other'; starred: boolean }[] = [
  { age: 0, category: 'product', starred: true },
  { age: 0, category: 'life', starred: false },
  { age: 0, category: 'other', starred: false },
  { age: 0, category: 'product', starred: false },
  { age: 1, category: 'learning', starred: true },
  { age: 1, category: 'product', starred: false },
  { age: 1, category: 'life', starred: false },
  { age: 2, category: 'product', starred: false },
  { age: 3, category: 'work', starred: true },
  { age: 4, category: 'product', starred: false },
  { age: 4, category: 'learning', starred: false },
  { age: 5, category: 'life', starred: false },
  { age: 6, category: 'work', starred: false },
  { age: 8, category: 'learning', starred: false },
  { age: 12, category: 'other', starred: false },
  { age: 20, category: 'product', starred: true },
  { age: 40, category: 'other', starred: false },
  { age: 70, category: 'learning', starred: false },
  { age: 100, category: 'work', starred: false },
  { age: 150, category: 'life', starred: false },
  { age: 175, category: 'other', starred: false },
];

const CATEGORY_LABEL = {
  product: '产品想法',
  learning: '学习备忘',
  work: '工作事务',
  life: '生活随想',
  other: '其他',
} as const;

type ExpectedStats = {
  total: number;
  week: number;
  month: number;
  starred: number;
  categories: Record<keyof typeof CATEGORY_LABEL, number>;
  todayCount: number;
  todayLabel: string;
};

function expectedStats(items: IdeaListItem[], nowMs: number): ExpectedStats {
  const coffee = items.find((item) => item.title.startsWith('咖啡店'));
  if (!coffee) throw new Error('种子里没有咖啡店那条，无法对齐日龄');
  const shift = shanghaiDayNumber(nowMs) - shanghaiDayNumber(Date.parse(coffee.createdAt));
  const ageOf = (age: number) => age + shift;
  const inSpan = (max: number) => SEED_ROWS.filter((row) => {
    const age = ageOf(row.age);
    return age >= 0 && age < max;
  }).length;
  const categories = { product: 0, learning: 0, work: 0, life: 0, other: 0 };
  for (const row of SEED_ROWS) categories[row.category] += 1;
  return {
    total: SEED_ROWS.length,
    week: inSpan(7),
    month: inSpan(30),
    starred: SEED_ROWS.filter((row) => row.starred).length,
    categories,
    todayCount: SEED_ROWS.filter((row) => ageOf(row.age) === 0).length,
    todayLabel: formatDayNumber(shanghaiDayNumber(nowMs), nowMs),
  };
}

async function listItems(page: Page): Promise<IdeaListItem[]> {
  const response = await page.request.get(`${app.url}/api/v1/ideas`, {
    headers: { authorization: `Bearer ${app.token}` },
  });
  expect(response.ok()).toBeTruthy();
  return ((await response.json()) as IdeaListResponse).items;
}

function palette(page: Page) {
  return page.getByRole('dialog', { name: '命令面板' });
}

async function openPalette(page: Page): Promise<void> {
  await page.keyboard.press('Control+k');
  await expect(palette(page).getByRole('combobox', { name: '命令面板' })).toBeFocused();
}

test.describe('统计', () => {
  test('指标、热力图格子和分类按种子日龄计算', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openApp(page);
    const expected = expectedStats(await listItems(page), Date.now());
    expect(expected.total).toBe(SEEDED.total);
    expect(expected.starred).toBe(SEEDED.starred);

    await page.getByRole('button', { name: '统计', exact: true }).click();
    await expect(page.getByRole('toolbar', { name: '筛选' })).toHaveCount(0);
    await expect(page.getByRole('complementary', { name: '详情' })).toHaveCount(0);
    await expect(page.getByRole('heading', { name: '近半年记录频率' })).toBeVisible();
    await expect(page.getByRole('heading', { name: '分类分布' })).toBeVisible();
    await expect(page.getByText('按记下日期统计，上海时区。')).toBeVisible();

    const kpi = (id: string) => page.locator(`[data-kpi="${id}"]`);
    await expect(kpi('total').locator('strong')).toHaveText(String(expected.total));
    await expect(kpi('week').locator('strong')).toHaveText(String(expected.week));
    await expect(kpi('month').locator('strong')).toHaveText(String(expected.month));
    await expect(kpi('starred').locator('strong')).toHaveText(String(expected.starred));
    await expect(kpi('total')).toContainText('全部灵感');
    await expect(kpi('week')).toContainText('近 7 天');
    await expect(kpi('month')).toContainText('近 30 天');
    await expect(kpi('starred')).toContainText('收藏');
    await expect(kpi('total').locator('strong')).toHaveCSS('font-size', '22px');
    await expect(kpi('total').locator('strong')).toHaveCSS('font-weight', '600');
    await expect(kpi('total').locator('strong')).toHaveCSS('font-variant-numeric', /tabular-nums/);

    const cells = page.locator('[data-columns] button');
    await expect(cells).toHaveCount(HEAT_CELLS);
    const levels = await cells.evaluateAll((nodes) =>
      nodes.map((node) => ({
        count: Number(node.getAttribute('data-count')),
        level: Number(node.getAttribute('data-level')),
        label: node.getAttribute('aria-label'),
      })),
    );
    expect(levels.reduce((sum, cell) => sum + cell.count, 0)).toBe(expected.total);
    for (const cell of levels) {
      const band = cell.count <= 0 ? 0 : cell.count === 1 ? 1 : cell.count === 2 ? 2 : 3;
      expect(cell.level).toBe(band);
      expect(cell.label).toMatch(/· \d+ 条$/);
    }
    expect(levels.at(-1)).toMatchObject({ count: expected.todayCount, label: `${expected.todayLabel} · ${expected.todayCount} 条` });

    for (const [id, label] of Object.entries(CATEGORY_LABEL)) {
      const bar = page.locator(`[data-category="${id}"]`);
      await expect(bar).toContainText(label);
      await expect(bar.locator('span').last()).toHaveText(String(expected.categories[id as keyof typeof CATEGORY_LABEL]));
    }
  });

  test('过窄时热力图减少列数，今天仍在最后一格', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 700 });
    await openApp(page);
    const expected = expectedStats(await listItems(page), Date.now());
    await page.getByRole('button', { name: '统计', exact: true }).click();
    const heat = page.locator('[data-columns]');
    await expect.poll(async () => Number(await heat.getAttribute('data-columns'))).toBeLessThan(26);
    const columns = Number(await heat.getAttribute('data-columns'));
    await expect(heat.getByRole('button')).toHaveCount(columns * 7);
    await expect(heat.getByRole('button').last()).toHaveAttribute('aria-label', `${expected.todayLabel} · ${expected.todayCount} 条`);
  });

  test('空库：指标为 0，热力图空着', async ({ page }) => {
    await openApp(page, { empty: true });
    await page.getByRole('button', { name: '统计', exact: true }).click();
    for (const id of ['total', 'week', 'month', 'starred']) {
      await expect(page.locator(`[data-kpi="${id}"] strong`)).toHaveText('0');
    }
    await expect(page.getByText('还没有记下灵感，热力图先空着。')).toBeVisible();
    await expect(page.locator('[data-columns] button')).toHaveCount(0);
    await expect(page.getByText('按记下日期统计，上海时区。')).toBeVisible();
    for (const label of Object.values(CATEGORY_LABEL)) {
      await expect(page.getByText(label, { exact: true })).toBeVisible();
    }
  });

  test('上海时区边界：UTC 16:00 前后落在不同天', async ({ page }) => {
    const midnight = shanghaiMidnight(Date.now());
    const before = new Date(midnight - 60_000).toISOString();
    const after = new Date(midnight).toISOString();
    const beforeLabel = formatDayNumber(shanghaiDayNumber(Date.parse(before)), Date.now());
    const afterLabel = formatDayNumber(shanghaiDayNumber(Date.parse(after)), Date.now());
    expect(beforeLabel).not.toBe(afterLabel);
    expect(new Date(after).toISOString().endsWith('16:00:00.000Z') || new Date(midnight).getUTCHours() === 16).toBeTruthy();

    const items = [fakeIdea('card_before', '边界前一天', before), fakeIdea('card_after', '边界后一天', after)];
    await page.route('**/api/v1/ideas', async (route) => {
      const url = new URL(route.request().url());
      if (route.request().method() !== 'GET' || url.pathname !== '/api/v1/ideas' || url.searchParams.size > 0) {
        await route.continue();
        return;
      }
      await route.fulfill({ json: { ok: true, count: items.length, items } });
    });
    await openApp(page);
    await page.getByRole('button', { name: '统计', exact: true }).click();
    const beforeCell = page.getByRole('button', { name: `${beforeLabel} · 1 条` });
    const afterCell = page.getByRole('button', { name: `${afterLabel} · 1 条` });
    await expect(beforeCell).toHaveAttribute('data-level', '1');
    await expect(afterCell).toHaveAttribute('data-level', '1');
    await beforeCell.hover();
    await expect(beforeCell).toHaveAttribute('title', `${beforeLabel} · 1 条`);

    await beforeCell.click();
    await expect(page).toHaveURL(`${app.url}/ideas`);
    await expect(page.locator('[data-date-chip]')).toContainText(beforeLabel);
    await expect(page.getByTestId('idea-count')).toHaveText('1 条');
    await expect(row(page, '边界前一天')).toBeVisible();
    await expect(row(page, '边界后一天')).toHaveCount(0);
  });
});

test.describe('日期胶囊', () => {
  test('从热力图进入后与收藏、分类、搜索叠加，清除后计数恢复', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openApp(page);
    const items = await listItems(page);
    const meeting = items.find((item) => item.title === SEEDED.rich);
    if (!meeting) throw new Error('种子里没有会议纪要那条');
    const label = formatDayNumber(shanghaiDayNumber(Date.parse(meeting.createdAt)), Date.now());
    const onThatDay = items.filter((item) => shanghaiDayNumber(Date.parse(item.createdAt)) === shanghaiDayNumber(Date.parse(meeting.createdAt)));

    await page.getByRole('button', { name: '统计', exact: true }).click();
    await page.getByRole('button', { name: `${label} · ${onThatDay.length} 条` }).click();
    await expect(page).toHaveURL(`${app.url}/ideas`);
    const chip = page.locator('[data-date-chip]');
    await expect(chip).toContainText(label);
    await expect(chip).toContainText('清除日期');
    await expect(page.getByTestId('idea-count')).toHaveText(`${onThatDay.length} 条`);

    const bar = page.getByRole('toolbar', { name: '筛选' });
    await bar.getByRole('button', { name: '★ 收藏' }).click();
    const starred = onThatDay.filter((item) => item.starred);
    await expect(page.getByTestId('idea-count')).toHaveText(`${starred.length} 条`);
    await bar.getByRole('button', { name: '产品想法' }).click();
    const starredProduct = starred.filter((item) => item.category === 'product');
    await expect(page.getByTestId('idea-count')).toHaveText(`${starredProduct.length} 条`);
    await page.getByRole('searchbox', { name: '搜索灵感' }).fill('纪要');
    await expect(page.getByTestId('idea-count')).toHaveText('1 条');
    await expect(row(page, SEEDED.rich)).toBeVisible();

    await chip.click();
    await expect(chip).toHaveCount(0);
    await expect(page.getByTestId('idea-count')).toHaveText('1 条');
    await bar.getByRole('button', { name: '全部' }).click();
    await expect(page.getByTestId('idea-count')).toHaveText('2 条');
    await expect(bar.getByRole('button', { name: '★ 收藏' })).toHaveAttribute('aria-pressed', 'false');
  });
});

test.describe('命令面板', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openApp(page);
  });

  test('Ctrl+K 与侧栏入口开关，方向键选择，底部有提示', async ({ page }) => {
    await expect(page.getByRole('button', { name: '搜索或执行' }).locator('kbd')).toHaveText('Ctrl+K');
    await openPalette(page);
    const dialog = palette(page);
    await expect(page.locator('[data-palette]')).toHaveCSS('border-radius', '14px');
    await expect(dialog.getByText('命令', { exact: true })).toBeVisible();
    await expect(dialog.locator('kbd', { hasText: 'N' })).toBeVisible();
    await expect(dialog.getByText('选择')).toBeVisible();
    await expect(dialog.getByText('执行')).toBeVisible();
    await expect(dialog.getByText('关闭')).toBeVisible();

    const options = dialog.getByRole('option');
    await expect(options.first()).toHaveAttribute('data-selected', 'true');
    await page.keyboard.press('ArrowDown');
    await expect(options.nth(1)).toHaveAttribute('data-selected', 'true');
    await page.keyboard.press('ArrowUp');
    await expect(options.first()).toHaveAttribute('data-selected', 'true');
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);

    await page.getByRole('button', { name: '搜索或执行' }).click();
    await expect(dialog).toBeVisible();
    await page.keyboard.press('Escape');
  });

  test('命令：记一条、切换清单和统计、回收站、只看收藏、清除筛选', async ({ page }) => {
    await openPalette(page);
    await palette(page).getByRole('option', { name: '＋ 记一条灵感' }).click();
    await expect(page.getByRole('form', { name: '快速记录' })).toBeVisible();
    await expect(palette(page)).toHaveCount(0);
    await page.keyboard.press('Escape');

    await openPalette(page);
    await palette(page).getByRole('option', { name: '切换到统计' }).click();
    await expect(page).toHaveURL(`${app.url}/ideas/stats`);
    await expect(page.getByRole('heading', { name: '近半年记录频率' })).toBeVisible();

    await openPalette(page);
    await palette(page).getByRole('option', { name: '打开回收站' }).click();
    await expect(page).toHaveURL(`${app.url}/ideas/trash`);
    await expect(page.getByText('已经移入回收站的一条')).toBeVisible();

    await openPalette(page);
    await palette(page).getByRole('option', { name: '只看收藏' }).click();
    await expect(page).toHaveURL(new RegExp(`${app.url}/ideas`));
    await expect(page.getByRole('toolbar', { name: '筛选' }).getByRole('button', { name: '★ 收藏' })).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('idea-count')).toHaveText(`${SEEDED.starred} 条`);

    await page.getByRole('searchbox', { name: '搜索灵感' }).fill('纪要');
    await expect(page.getByTestId('idea-count')).toHaveText('1 条');
    await openPalette(page);
    await palette(page).getByRole('option', { name: '清除筛选' }).click();
    await expect(page.getByRole('searchbox', { name: '搜索灵感' })).toHaveValue('');
    await expect(page.getByTestId('idea-count')).toHaveText(`${SEEDED.total} 条`);
    await expect(page.getByRole('toolbar', { name: '筛选' }).getByRole('button', { name: '全部' })).toHaveAttribute('aria-pressed', 'true');

    await openPalette(page);
    await palette(page).getByRole('option', { name: '切换到清单' }).click();
    await expect(page).toHaveURL(new RegExp(`${app.url}/ideas`));
    await expect(page.getByRole('listbox', { name: '灵感清单' })).toBeVisible();
  });

  test('搜索最多 6 条，命中词高亮，选中后打开详情', async ({ page }) => {
    const found = await page.request.get(`${app.url}/api/v1/ideas?q=${encodeURIComponent('的')}`, {
      headers: { authorization: `Bearer ${app.token}` },
    });
    const matched = ((await found.json()) as IdeaListResponse).count;
    expect(matched).toBeGreaterThan(6);

    await openPalette(page);
    await palette(page).getByRole('combobox', { name: '命令面板' }).fill('的');
    const hits = palette(page).getByRole('option');
    await expect(hits).toHaveCount(6);
    await page.keyboard.press('Escape');

    await openPalette(page);
    const input = palette(page).getByRole('combobox', { name: '命令面板' });
    await input.fill('纪要');
    const hit = palette(page).getByRole('option', { name: SEEDED.rich });
    await expect(hit.locator('mark')).toHaveText('纪要');
    await hit.click();
    await expect(palette(page)).toHaveCount(0);
    await expect(page).toHaveURL(/\/ideas\/card_/);
    await expect(detail(page).getByRole('heading', { level: 2 })).toHaveText(SEEDED.rich);
  });

  test('嵌入模式不显示切换深浅色，本地偏好也不生效', async ({ page }) => {
    await page.goto(`${app.url}/ideas?embed=main#token=${app.token}`);
    await page.evaluate(() => window.localStorage.setItem('bluemanta.colorScheme', 'dark'));
    await page.reload();
    await expect(page.getByTestId('idea-count')).toHaveText(`${SEEDED.total} 条`);
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    await openPalette(page);
    await expect(palette(page).getByRole('option', { name: '切换深浅色' })).toHaveCount(0);
    await expect(palette(page).getByRole('option', { name: '切换到统计' })).toBeVisible();
  });
});

test.describe('深浅色', () => {
  test('跟随系统、浅色、深色循环，刷新后仍在', async ({ browser }) => {
    const context = await browser.newContext({ colorScheme: 'light' });
    const page = await context.newPage();
    await page.setViewportSize({ width: 1440, height: 900 });
    await openApp(page);
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');

    await openPalette(page);
    await expect(palette(page).getByRole('option', { name: /切换深浅色/ })).toContainText('跟随系统');
    await palette(page).getByRole('option', { name: /切换深浅色/ }).click();
    await expect.poll(() => page.evaluate(() => localStorage.getItem('bluemanta.colorScheme'))).toBe('light');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');

    await openPalette(page);
    await palette(page).getByRole('option', { name: /切换深浅色/ }).click();
    await expect.poll(() => page.evaluate(() => localStorage.getItem('bluemanta.colorScheme'))).toBe('dark');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');

    await page.reload();
    await expect(page.getByTestId('idea-count')).toHaveText(`${SEEDED.total} 条`);
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await page.emulateMedia({ colorScheme: 'light' });
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');

    await openPalette(page);
    await palette(page).getByRole('option', { name: /切换深浅色/ }).click();
    await expect.poll(() => page.evaluate(() => localStorage.getItem('bluemanta.colorScheme'))).toBe('system');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    await page.emulateMedia({ colorScheme: 'dark' });
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await context.close();
  });
});

test.describe('键盘', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openApp(page);
  });

  test('J/K 与方向键移动并打开详情，↵ 打开焦点行', async ({ page }) => {
    await page.keyboard.press('j');
    await expect(page).toHaveURL(/\/ideas\/card_/);
    const first = detail(page).getByRole('heading', { level: 2 });
    const firstTitle = await first.innerText();
    await page.keyboard.press('j');
    await expect(first).not.toHaveText(firstTitle);
    const secondTitle = await first.innerText();
    await page.keyboard.press('k');
    await expect(first).toHaveText(firstTitle);
    await page.keyboard.press('ArrowDown');
    await expect(first).toHaveText(secondTitle);
    await page.keyboard.press('ArrowUp');
    await expect(first).toHaveText(firstTitle);

    const target = rows(page).nth(3);
    await target.focus();
    await page.keyboard.press('Enter');
    await expect(target).toHaveAttribute('aria-selected', 'true');
  });

  test('N、E、⌘↵、S、⌫ 仍可用；按钮上有 kbd；拖动条 ← → 微调', async ({ page }) => {
    await expect(page.getByRole('button', { name: '＋ 记一条' }).locator('kbd')).toHaveText('N');
    await page.keyboard.press('n');
    const card = page.getByRole('form', { name: '快速记录' });
    await expect(card.getByRole('textbox', { name: '正文' })).toBeFocused();
    await page.keyboard.press('ControlOrMeta+Enter');
    await expect(page.getByRole('status')).toHaveText('标题和正文至少写一项');
    await page.keyboard.press('Escape');
    await expect(card).toHaveCount(0);

    await row(page, SEEDED.rich).click();
    const handle = page.getByRole('separator', { name: '调整详情宽度' });
    await handle.focus();
    await page.keyboard.press('ArrowLeft');
    await expect(handle).toHaveAttribute('aria-valuenow', '436');
    await page.keyboard.press('ArrowRight');
    await expect(handle).toHaveAttribute('aria-valuenow', '420');

    await expect(detail(page).getByRole('button', { name: '编辑' }).locator('kbd')).toHaveText('E');
    await page.keyboard.press('e');
    const body = detail(page).getByRole('textbox', { name: '正文' });
    await expect(body).toBeFocused();
    expect(await caretAtEnd(body)).toBe(true);
    await expect(detail(page).getByRole('button', { name: '保存' }).locator('kbd')).toHaveText('⌘↵');
    const record = (await listItems(page)).find((item) => item.title === SEEDED.rich);
    if (!record) throw new Error('没有找到要编辑的灵感');
    await body.fill('走查改过但不会写进库');
    await page.route('**/api/v1/ideas/**', async (route) => {
      const url = new URL(route.request().url());
      if (route.request().method() !== 'PATCH' || !url.pathname.endsWith(`/${record.id}`)) {
        await route.continue();
        return;
      }
      const patch = route.request().postDataJSON() as { body?: string; rev: number };
      await route.fulfill({ json: { ok: true, record: { ...record, body: patch.body ?? record.body, rev: record.rev + 1, edited: true } } });
    });
    await page.keyboard.press('ControlOrMeta+Enter');
    await expect(detail(page).getByText('走查改过但不会写进库')).toBeVisible();
    await expect(detail(page).getByText('已改写')).toBeVisible();

    await page.route('**/api/v1/ideas/**', async (route) => {
      const url = new URL(route.request().url());
      if (!url.pathname.endsWith('/star')) {
        await route.continue();
        return;
      }
      const body = route.request().postDataJSON() as { starred: boolean; rev: number };
      await route.fulfill({
        json: { ok: true, record: { ...record, starred: body.starred, rev: record.rev + 1 } },
      });
    });
    await rows(page).filter({ hasText: SEEDED.rich }).first().focus();
    await page.keyboard.press('s');
    await expect(detail(page).getByRole('button', { name: '☆ 收藏' })).toBeVisible();

    await page.unroute('**/api/v1/ideas/**');
    await page.route('**/api/v1/ideas/**', async (route) => {
      const url = new URL(route.request().url());
      if (!url.pathname.endsWith('/trash')) {
        await route.continue();
        return;
      }
      await route.fulfill({
        json: { ok: true, record: { ...record, deletedAt: new Date().toISOString(), rev: record.rev + 2 } },
      });
    });
    await page.keyboard.press('Delete');
    await expect(page.getByRole('status')).toContainText('已移入回收站');
  });

  test('esc 依次退出命令面板、确认框、快速记录、编辑、搜索框；窄屏再退出详情', async ({ page }) => {
    await page.keyboard.press('n');
    await expect(page.getByRole('form', { name: '快速记录' })).toBeVisible();
    await openPalette(page);
    await page.keyboard.press('Escape');
    await expect(palette(page)).toHaveCount(0);
    await expect(page.getByRole('form', { name: '快速记录' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('form', { name: '快速记录' })).toHaveCount(0);

    await page.getByRole('button', { name: '回收站', exact: true }).click();
    await page.getByRole('button', { name: '彻底删除' }).first().click();
    const dialog = page.getByRole('alertdialog');
    await expect(dialog).toBeVisible();
    await page.keyboard.press('Control+k');
    await expect(palette(page)).toHaveCount(0);
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(page.getByText('已经移入回收站的一条')).toBeVisible();

    await page.getByRole('button', { name: '清单', exact: true }).click();
    await row(page, '学一点基础的色彩理论').click();
    await page.keyboard.press('e');
    const body = detail(page).getByRole('textbox', { name: '正文' });
    await body.fill('还没保存的修改');
    await page.keyboard.press('Escape');
    await expect(page.getByRole('alertdialog')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('alertdialog')).toHaveCount(0);
    await expect(body).toHaveValue('还没保存的修改');
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: '放弃修改' }).click();
    await expect(detail(page).getByRole('textbox', { name: '标题' })).toHaveCount(0);

    const search = page.getByRole('searchbox', { name: '搜索灵感' });
    await search.fill('树荫');
    await expect(search).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(search).toHaveValue('');
    await expect(search).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(search).not.toBeFocused();

    await page.goto(`${app.url}/ideas`);
    await expect(page.getByTestId('idea-count')).toHaveText(`${SEEDED.total} 条`);
    await page.setViewportSize({ width: 720, height: 900 });
    await row(page, SEEDED.rich).click();
    await expect(page.getByRole('button', { name: '返回' })).toBeVisible();
    await expect(page.getByRole('searchbox', { name: '搜索灵感' })).toHaveCount(0);
    await page.keyboard.press('Escape');
    await expect(page).toHaveURL(`${app.url}/ideas`);
    await expect(rows(page).first()).toBeVisible();
  });

  test('焦点在输入框里时单字母快捷键不生效', async ({ page }) => {
    const search = page.getByRole('searchbox', { name: '搜索灵感' });
    await search.focus();
    await page.keyboard.type('njkes/');
    await expect(search).toHaveValue('njkes/');
    await expect(page.getByRole('form', { name: '快速记录' })).toHaveCount(0);
    await expect(page).toHaveURL(`${app.url}/ideas`);
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');

    await page.keyboard.press('n');
    const body = page.getByRole('form', { name: '快速记录' }).getByRole('textbox', { name: '正文' });
    await body.fill('');
    await page.keyboard.type('e');
    await expect(body).toHaveValue('e');
    await expect(page.getByRole('form', { name: '快速记录' })).toHaveCount(1);
    await page.keyboard.press('Escape');

    await openPalette(page);
    await page.keyboard.type('n');
    await expect(palette(page).getByRole('combobox', { name: '命令面板' })).toHaveValue('n');
    await expect(page.getByRole('form', { name: '快速记录' })).toHaveCount(0);
  });
});

test('200% 缩放下清单、详情、统计和命令面板仍可用', async ({ page }) => {
  await page.setViewportSize({ width: 720, height: 450 });
  await openApp(page);
  await row(page, SEEDED.rich).click();
  await expect(page.getByRole('heading', { level: 2 })).toHaveText(SEEDED.rich);
  await page.getByRole('button', { name: '返回' }).click();
  await expect(page).toHaveURL(`${app.url}/ideas`);
  await page.getByRole('searchbox', { name: '搜索灵感' }).fill('纪要');
  await expect(rows(page)).toHaveCount(2);
  await page.getByRole('button', { name: '统计', exact: true }).click();
  await expect(page.locator('[data-kpi="total"] strong')).toHaveText(String(SEEDED.total));
  await expect(page.getByText('按记下日期统计，上海时区。')).toBeVisible();
  await page.keyboard.press('Control+k');
  await expect(palette(page)).toBeVisible();
  await page.keyboard.press('Escape');

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.evaluate(() => {
    document.documentElement.style.zoom = '2';
  });
  await page.getByRole('button', { name: '清单', exact: true }).click();
  await page.getByRole('searchbox', { name: '搜索灵感' }).fill('');
  await expect(page.getByTestId('idea-count')).toHaveText(`${SEEDED.total} 条`);
  await row(page, SEEDED.fourImages).click();
  await expect(detail(page).getByRole('heading', { level: 2 })).toHaveText(SEEDED.fourImages);
  await page.keyboard.press('n');
  await expect(page.getByRole('form', { name: '快速记录' })).toBeVisible();
  await page.keyboard.press('Escape');
});

function shanghaiMidnight(nowMs: number): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
  }).formatToParts(new Date(nowMs));
  const value = (type: string) => Number(parts.find((part) => part.type === type)?.value);
  return Date.UTC(value('year'), value('month') - 1, value('day')) - 8 * 3_600_000;
}

function fakeIdea(id: string, title: string, createdAt: string): IdeaListItem {
  return {
    id,
    rev: 1,
    createdAt,
    updatedAt: createdAt,
    createdBy: { kind: 'human', name: 'desktop' },
    updatedBy: { kind: 'human', name: 'desktop' },
    deletedAt: null,
    title,
    titleOrigin: 'user',
    body: title,
    rawInput: { status: 'legacy' },
    showRaw: false,
    starred: false,
    tags: [],
    category: 'other',
    categorySource: 'auto',
    captureGroupId: null,
    extensions: [],
    attachmentIds: [],
    attachments: [],
    edited: false,
  };
}

async function caretAtEnd(body: Locator): Promise<boolean> {
  return body.evaluate((node) => {
    const field = node as HTMLTextAreaElement;
    return field.selectionStart === field.value.length && field.selectionEnd === field.value.length && field.value.length > 0;
  });
}
