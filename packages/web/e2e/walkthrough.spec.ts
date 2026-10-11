import { createServer } from 'node:http';
import { expect, test, type Page } from '@playwright/test';
import { app, detail, noHorizontalScroll, openApp, row, rows, SEEDED, VIEWPORTS, waitImages } from './helpers.ts';

type ParentPage = (html: (origin: string) => string) => Promise<{ origin: string }>;

/** 模拟 dsh：在另一个本地端口提供装着网页 iframe 的父页面，用例结束时关掉。 */
const withParentPage = test.extend<{ parentPage: ParentPage }>({
  parentPage: async ({}, use) => {
    const servers: { close: () => Promise<void> }[] = [];
    await use(async (html) => {
      const served = await serveParentPage(html);
      servers.push(served);
      return served;
    });
    await Promise.all(servers.map((server) => server.close()));
  },
});

test.describe('口令', () => {
  test('#token 写入本地存储并从地址栏抹掉，刷新后仍可用', async ({ page }) => {
    await openApp(page);
    await expect(page).toHaveURL(`${app.url}/ideas`);
    expect(await page.evaluate(() => window.location.hash)).toBe('');
    expect(await page.evaluate(() => window.localStorage.getItem('bluemanta.token'))).toBe(app.token);

    const authorization = page.waitForRequest((request) => request.url().endsWith('/api/v1/ideas'));
    await page.reload();
    expect((await authorization).headers().authorization).toBe(`Bearer ${app.token}`);
    await expect(rows(page)).toHaveCount(SEEDED.total);
  });

  test('没有口令时整页说明需要重新打开', async ({ page }) => {
    await page.goto(`${app.url}/ideas`);
    await expect(page.getByRole('heading', { name: '需要重新打开' })).toBeVisible();
    await expect(page.getByText('这个页面还没有本地服务的口令。')).toBeVisible();
    await expect(page.getByText('node packages/server/dist/cli.js open')).toBeVisible();
  });

  test('口令不对（401）时整页说明口令已变化', async ({ page }) => {
    await page.goto(`${app.url}/ideas#token=${'0'.repeat(64)}`);
    await expect(page.getByRole('heading', { name: '需要重新打开' })).toBeVisible();
    await expect(page.getByText('本地服务的口令已变化')).toBeVisible();
    await expect(page.getByRole('listbox')).toHaveCount(0);
  });
});

test.describe('清单', () => {
  test('按上海时区分组、组内倒序、计数与尺寸', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openApp(page);
    await expect(page.getByTestId('idea-count')).toHaveText(`${SEEDED.total} 条`);
    await expect(rows(page)).toHaveCount(SEEDED.total);
    await expect(page.getByText('已经移入回收站的一条')).toHaveCount(0);

    const groups = page.getByRole('listbox', { name: '灵感清单' }).getByRole('group');
    const labels = await groups.evaluateAll((nodes) =>
      nodes.map((node) => ({
        label: node.getAttribute('aria-labelledby') ? document.getElementById(node.getAttribute('aria-labelledby')!)?.textContent : '',
        count: Number(node.querySelector('[role="presentation"] span:last-child')?.textContent),
        rows: node.querySelectorAll('[role="option"]').length,
        times: [...node.querySelectorAll('[role="option"] time')].map((time) => time.getAttribute('datetime') ?? ''),
      })),
    );
    expect(labels.map((group) => group.label)).toEqual(['今天', '昨天', '本周', '更早']);
    for (const group of labels) {
      expect(group.count).toBe(group.rows);
      expect([...group.times].sort().reverse()).toEqual(group.times);
    }
    expect(labels.reduce((sum, group) => sum + group.rows, 0)).toBe(SEEDED.total);

    const box = async (selector: string) => (await page.locator(selector).first().boundingBox())?.height;
    expect(await box('header')).toBe(46);
    expect(await box('[role="toolbar"][aria-label="筛选"]')).toBe(32);
    expect(await box('[role="option"]')).toBe(34);

    const long = row(page, SEEDED.longTitlePrefix).locator('span[title]').first();
    const fullTitle = await long.getAttribute('title');
    expect(fullTitle?.length).toBe(80);
    expect(await long.evaluate((node) => node.scrollWidth > node.clientWidth)).toBe(true);

    await expect(row(page, SEEDED.fourImages).getByLabel('4 张图片')).toBeVisible();
    await expect(row(page, '方案评审前先写').getByLabel('2 条延展')).toBeVisible();
    await expect(row(page, SEEDED.rich).getByRole('button', { name: '取消收藏' })).toBeVisible();
    await expect(row(page, '用便利贴墙规划季度').getByText('导入')).toBeVisible();
    await expect(row(page, '读书笔记').getByText('对话 agent')).toBeVisible();
    await expect(row(page, '未命名灵感').getByText('MCP')).toBeVisible();
    await expect(row(page, SEEDED.rich).getByText('Grok Bot')).toBeVisible();
    await expect(row(page, '咖啡店').getByText('灵感台')).toBeVisible();
  });

  test('读取中显示骨架', async ({ page }) => {
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => (release = resolve));
    await page.route('**/api/v1/ideas', async (route) => {
      await gate;
      await route.continue();
    });
    await page.goto(`${app.url}/#token=${app.token}`);
    await expect(page.getByLabel('正在读取灵感')).toBeVisible();
    release();
    await expect(rows(page)).toHaveCount(SEEDED.total);
  });

  test('筛选组合：收藏与分类叠加，分类之间是或', async ({ page }) => {
    await openApp(page);
    const count = page.getByTestId('idea-count');
    const chip = (name: string) => page.getByRole('toolbar', { name: '筛选' }).getByRole('button', { name });

    await chip('★ 收藏').click();
    await expect(count).toHaveText(`${SEEDED.starred} 条`);
    await expect(chip('全部')).toHaveAttribute('aria-pressed', 'false');
    await chip('产品想法').click();
    await expect(count).toHaveText('2 条');
    await chip('学习备忘').click();
    await expect(count).toHaveText('3 条');
    await expect(rows(page)).toHaveCount(3);
    await chip('★ 收藏').click();
    const both = await rows(page).count();
    expect(both).toBeGreaterThan(3);
    await expect(count).toHaveText(`${both} 条`);
    await chip('全部').click();
    await expect(count).toHaveText(`${SEEDED.total} 条`);
    await expect(chip('全部')).toHaveAttribute('aria-pressed', 'true');
  });

  test('筛选无结果时可以清除筛选', async ({ page }) => {
    await openApp(page);
    await page.getByRole('button', { name: '★ 收藏' }).click();
    await page.getByRole('button', { name: '其他' }).click();
    await expect(page.getByRole('heading', { name: '没有匹配的灵感' })).toBeVisible();
    await expect(page.getByTestId('idea-count')).toHaveText('0 条');
    await page.getByRole('button', { name: '清除筛选' }).click();
    await expect(page.getByTestId('idea-count')).toHaveText(`${SEEDED.total} 条`);
  });

  test('搜索：/ 聚焦、高亮、命中字段、搜索结果分组、esc 清空', async ({ page }) => {
    await openApp(page);
    await page.keyboard.press('/');
    const search = page.getByRole('searchbox', { name: '搜索灵感' });
    await expect(search).toBeFocused();

    await search.fill('唱反调');
    await expect(page.getByTestId('idea-count')).toHaveText('1 条');
    await expect(page.getByText('搜索结果', { exact: true })).toBeVisible();
    const hit = rows(page).first();
    await expect(hit).toContainText('方案评审前先写');
    await expect(hit.getByText('匹配原文')).toBeVisible();
    await expect(hit.locator('mark')).toHaveText('唱反调');

    await search.fill('树荫');
    await expect(rows(page)).toHaveCount(1);
    await expect(rows(page).first().getByText('匹配正文')).toBeVisible();
    await expect(rows(page).first().locator('mark')).toHaveText('树荫');

    await search.fill('纪要');
    await expect(rows(page)).toHaveCount(2);
    await expect(rows(page).getByText(/^匹配/)).toHaveCount(0);
    await expect(rows(page).first().locator('mark').first()).toHaveText('纪要');

    await search.fill('学习备忘');
    await expect(rows(page).first().getByText('匹配分类')).toBeVisible();

    await search.press('Escape');
    await expect(search).toHaveValue('');
    await expect(page.getByTestId('idea-count')).toHaveText(`${SEEDED.total} 条`);
    await expect(page.getByText('今天', { exact: true })).toBeVisible();
  });

  test('筛选与搜索叠加', async ({ page }) => {
    await openApp(page);
    await page.getByRole('searchbox', { name: '搜索灵感' }).fill('纪要');
    await expect(rows(page)).toHaveCount(2);
    await page.getByRole('button', { name: '工作事务' }).click();
    await expect(rows(page)).toHaveCount(1);
    await expect(page.getByTestId('idea-count')).toHaveText('1 条');
  });
});

test.describe('详情', () => {
  test('↵ 打开焦点行，内容顺序正确，引用入口仍不在', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openApp(page);
    const target = row(page, SEEDED.rich);
    await target.focus();
    await page.keyboard.press('Enter');
    await expect(target).toHaveAttribute('aria-selected', 'true');
    await expect(page).toHaveURL(/\/ideas\/card_/);
    const panel = detail(page);
    await expect(panel.getByRole('heading', { level: 2 })).toHaveText(SEEDED.rich);
    await expect(panel.getByText('来源 Grok Bot')).toBeVisible();
    await expect(panel.getByText(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/).first()).toBeVisible();
    await expect(panel.getByRole('heading', { name: '原文' })).toBeVisible();
    await expect(panel.getByRole('heading', { name: /延展\s*1/ })).toBeVisible();
    await waitImages(page, 2);

    // 工具条 → 标题 → 元信息 → 正文 → 图片 → 原文 → 延展
    const order = await panel.locator('article').evaluate((article) => [...article.children].map((child) => child.tagName));
    expect(order).toEqual(['DIV', 'H2', 'DIV', 'P', 'UL', 'SECTION', 'SECTION']);
    await expect(panel.locator('article > section').first()).toContainText('原文');
    await expect(panel.locator('article > section').last()).toContainText('延展');

    await expect(panel.getByRole('button', { name: '★ 已收藏' })).toBeVisible();
    await expect(panel.getByRole('button', { name: '编辑' })).toBeVisible();
    await expect(panel.getByRole('button', { name: '移入回收站' })).toBeVisible();
    await expect(panel.getByRole('button', { name: '追加延展' })).toBeDisabled();
    for (const name of ['在对话中引用', '在右侧栏打开']) {
      await expect(panel.getByRole('button', { name, exact: true })).toHaveCount(0);
    }
    await expect(panel.getByRole('textbox', { name: '追加延展' })).toBeVisible();
    await expect(panel.getByRole('textbox', { name: '标题' })).toHaveCount(0);
  });

  test('原文显示规则按接口：相同、被包含、legacy、为空时不显示', async ({ page }) => {
    await openApp(page);
    for (const title of ['咖啡店', '给孩子的周末观察本', '用便利贴墙规划季度', '学一点基础的色彩理论']) {
      await row(page, title).click();
      await expect(detail(page).getByRole('heading', { level: 2 })).toContainText(title.slice(0, 4));
      await expect(detail(page).getByRole('heading', { name: '原文' })).toHaveCount(0);
    }
    await row(page, '读书笔记').click();
    await expect(detail(page).getByRole('heading', { name: '原文' })).toBeVisible();
  });

  test('多标签：最多 6 个，超出关闭最早打开的，悬停出现 ×', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openApp(page);
    const titles = await rows(page).locator('span[title]').evaluateAll((nodes) =>
      nodes.slice(0, 7).map((node) => node.getAttribute('title') ?? ''),
    );
    for (const title of titles) await row(page, title).click();
    const tabs = detail(page).getByRole('tab');
    await expect(tabs).toHaveCount(6);
    await expect(tabs.filter({ hasText: titles[0]! })).toHaveCount(0);
    await expect(tabs.last()).toHaveAttribute('aria-selected', 'true');
    await expect(tabs.last()).toHaveText(titles[6]!);

    const close = detail(page).getByRole('button', { name: `关闭「${titles[3]}」` });
    await expect(close).toHaveCSS('opacity', '0');
    await detail(page).getByRole('tab', { name: titles[3]! }).hover();
    await expect(close).toHaveCSS('opacity', '1');
    await close.click();
    await expect(tabs).toHaveCount(5);

    await tabs.first().click();
    await expect(page.getByRole('heading', { level: 2 })).toHaveText(titles[1]!);
    await page.goBack();
    await expect(page.getByRole('heading', { level: 2 })).toHaveText(titles[6]!);
  });

  test('拖动详情宽度，刷新后保持，双击恢复，← → 微调', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openApp(page);
    await row(page, SEEDED.rich).click();
    const panel = detail(page);
    const width = async () => Math.round((await panel.boundingBox())!.width);
    expect(await width()).toBe(420);

    const handle = page.getByRole('separator', { name: '调整详情宽度' });
    const box = (await handle.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 - 100, box.y + box.height / 2, { steps: 5 });
    await page.mouse.up();
    expect(await width()).toBe(520);

    await page.mouse.move(box.x - 600, box.y + 10, { steps: 1 });
    await page.reload();
    await expect(rows(page)).toHaveCount(SEEDED.total);
    expect(await width()).toBe(520);
    expect(await page.evaluate(() => window.localStorage.getItem('bluemanta.detailWidth'))).toBe('520');

    await handle.dblclick();
    expect(await width()).toBe(420);
    await handle.focus();
    await page.keyboard.press('ArrowLeft');
    expect(await width()).toBe(436);
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowRight');
    expect(await width()).toBe(404);

    const again = (await handle.boundingBox())!;
    await page.mouse.move(again.x + again.width / 2, again.y + 10);
    await page.mouse.down();
    await page.mouse.move(again.x - 2000, again.y + 10, { steps: 3 });
    await page.mouse.up();
    expect(await handle.getAttribute('aria-valuenow')).toBe('720');
  });

  test('图片带口令读取，大图浏览 ← → 切换、esc 关闭', async ({ page }) => {
    await openApp(page);
    await row(page, SEEDED.fourImages).click();
    await waitImages(page, 4);
    await detail(page).getByRole('button', { name: '查看图片 2' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(page.getByTestId('lightbox-counter')).toHaveText('2 / 4');
    await expect(dialog.locator('img[src^="blob:"]')).toBeVisible();
    await page.keyboard.press('ArrowRight');
    await expect(page.getByTestId('lightbox-counter')).toHaveText('3 / 4');
    await page.keyboard.press('ArrowLeft');
    await page.keyboard.press('ArrowLeft');
    await page.keyboard.press('ArrowLeft');
    await expect(page.getByTestId('lightbox-counter')).toHaveText('4 / 4');
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(detail(page).getByRole('heading', { level: 2 })).toHaveText(SEEDED.fourImages);
  });

  test('图片请求带 Bearer 口令，不直接把接口地址写进 img', async ({ page }) => {
    const auth: (string | undefined)[] = [];
    page.on('request', (request) => {
      if (request.url().includes('/api/v1/attachments/')) auth.push(request.headers().authorization);
    });
    await openApp(page);
    await row(page, SEEDED.fourImages).click();
    await waitImages(page, 4);
    expect(auth.length).toBeGreaterThanOrEqual(4);
    expect(auth.every((value) => value === `Bearer ${app.token}`)).toBe(true);
    await expect(page.locator('img[src*="/api/"]')).toHaveCount(0);
  });
});

test.describe('窄屏', () => {
  test('整页详情与「← 返回」，返回后恢复滚动位置', async ({ page }) => {
    await page.setViewportSize({ width: 720, height: 900 });
    await openApp(page);
    await expect(page.getByRole('navigation', { name: '模块' })).toHaveCount(0);
    // 只留星标、标题、分类、时间：摘要、图片与延展计数、来源徽标都不显示
    const rich = row(page, SEEDED.rich);
    await expect(rich.getByRole('button', { name: '取消收藏' })).toBeVisible();
    await expect(rich.getByText('产品想法')).toBeVisible();
    await expect(rich.locator('time')).toBeVisible();
    await expect(rich.getByText('会后十分钟内', { exact: false })).toBeHidden();
    await expect(rich.getByText('Grok Bot')).toBeHidden();
    await expect(rich.getByLabel('2 张图片')).toBeHidden();

    const list = page.getByRole('listbox', { name: '灵感清单' });
    await list.evaluate((node) => (node.scrollTop = node.scrollHeight));
    const target = rows(page).last();
    const title = await target.locator('span[title]').getAttribute('title');
    const before = await list.evaluate((node) => node.scrollTop);
    expect(before).toBeGreaterThan(0);
    await target.click();
    await expect(page).toHaveURL(/\/ideas\/card_/);
    await expect(page.getByRole('listbox')).toHaveCount(0);
    await expect(page.locator('header')).toHaveCount(0);
    await expect(page.getByRole('heading', { level: 2 })).toHaveText(title!);
    await noHorizontalScroll(page);

    await page.getByRole('button', { name: '返回' }).click();
    await expect(page).toHaveURL(`${app.url}/ideas`);
    await expect(rows(page)).toHaveCount(SEEDED.total);
    expect(await page.getByRole('listbox', { name: '灵感清单' }).evaluate((node) => node.scrollTop)).toBe(before);
  });

  test('直接打开 /ideas/:id 时返回清单；dsh 右侧栏里没有返回', async ({ page }) => {
    await page.setViewportSize({ width: 720, height: 900 });
    await openApp(page);
    await row(page, SEEDED.rich).click();
    const url = page.url();
    await page.goto(`${url}#token=${app.token}`);
    await page.getByRole('button', { name: '返回' }).click();
    await expect(page).toHaveURL(`${app.url}/ideas`);

    await page.goto(`${url}?embed=sidebar#token=${app.token}`);
    await expect(page.getByRole('heading', { level: 2 })).toHaveText(SEEDED.rich);
    await expect(page.getByRole('button', { name: '返回' })).toHaveCount(0);
  });
});

test.describe('读取失败', () => {
  test('有缓存时保留列表并显示持续提示条，重试恢复', async ({ page }) => {
    await page.clock.install();
    await openApp(page);
    await expect(rows(page)).toHaveCount(SEEDED.total);

    await page.route('**/api/v1/ideas', (route) =>
      route.fulfill({ status: 500, json: { ok: false, code: 'internal', message: '服务内部错误' } }),
    );
    await page.clock.runFor(31_000);
    await page.clock.runFor(2_000);
    const banner = page.getByRole('alert');
    await expect(banner).toContainText(/读取失败，显示的是 \d{2}:\d{2} 的内容。服务内部错误/);
    await expect(rows(page)).toHaveCount(SEEDED.total);

    await page.unroute('**/api/v1/ideas');
    await banner.getByRole('button', { name: '重试' }).click();
    await expect(page.getByRole('alert')).toHaveCount(0);
  });

  test('没有缓存时整区显示错误和重试', async ({ page }) => {
    await page.route('**/api/v1/ideas', (route) =>
      route.fulfill({ status: 500, json: { ok: false, code: 'internal', message: '服务内部错误' } }),
    );
    await page.goto(`${app.url}/#token=${app.token}`);
    await expect(page.getByRole('heading', { name: '读取失败' })).toBeVisible();
    await expect(page.getByText('服务内部错误，还没有可以显示的内容。')).toBeVisible();
    await page.unroute('**/api/v1/ideas');
    await page.getByRole('button', { name: '重试' }).click();
    await expect(rows(page)).toHaveCount(SEEDED.total);
  });

  test('窗口重新获得焦点时刷新', async ({ page }) => {
    await page.clock.install();
    await openApp(page);
    await page.clock.runFor(6_000);
    const refetch = page.waitForRequest((request) => request.url().endsWith('/api/v1/ideas'));
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await refetch;
  });
});

test.describe('空库', () => {
  test('还没有灵感时「记第一条」可以打开快速记录', async ({ page }) => {
    await openApp(page, { empty: true });
    await expect(page.getByTestId('idea-count')).toHaveText('0 条');
    await expect(page.getByRole('heading', { name: '还没有灵感' })).toBeVisible();
    const first = page.getByRole('button', { name: '记第一条' });
    await expect(first).toBeEnabled();
    await first.click();
    await expect(page.getByRole('form', { name: '快速记录' })).toBeVisible();
    await expect(page.getByRole('textbox', { name: '正文' })).toBeFocused();
  });
});

test.describe('外壳', () => {
  test('侧栏三档宽度；⌘K 入口只提示；记一条可用', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openApp(page);
    const side = page.getByRole('navigation', { name: '模块' });
    expect((await side.boundingBox())!.width).toBe(208);
    await page.getByRole('button', { name: '命令面板（即将上线）' }).click();
    await expect(page.getByRole('status')).toHaveText('命令面板即将上线');

    const add = page.getByRole('button', { name: '＋ 记一条' });
    await expect(add).toBeEnabled();
    await add.click();
    await expect(page.getByRole('form', { name: '快速记录' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('form', { name: '快速记录' })).toHaveCount(0);

    await page.setViewportSize({ width: 1100, height: 800 });
    await expect.poll(async () => (await side.boundingBox())?.width).toBe(52);
    await page.setViewportSize({ width: 1000, height: 800 });
    await expect(side).toHaveCount(0);
  });

  test('中屏：52px 图标栏悬停显示名称，列表隐藏来源徽标', async ({ page }) => {
    await page.setViewportSize({ width: 1100, height: 800 });
    await openApp(page);
    expect((await page.getByRole('navigation', { name: '模块' }).boundingBox())!.width).toBe(52);
    await page.getByRole('button', { name: '灵感台' }).hover();
    await expect(page.getByRole('tooltip')).toHaveText('灵感台');
    await expect(row(page, SEEDED.rich).getByText('Grok Bot')).toBeHidden();
  });

  test('嵌入模式隐藏侧栏，站内跳转保留 embed', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openApp(page, { path: '/ideas', search: '?embed=main' });
    await expect(page.getByRole('navigation', { name: '模块' })).toHaveCount(0);
    await row(page, SEEDED.rich).click();
    await expect(page).toHaveURL(/\/ideas\/card_[^?]+\?embed=main$/);
  });

  test('路由：/ 跳到 /ideas，统计仍是占位，回收站列出已删除的，前进后退可用', async ({ page }) => {
    await openApp(page);
    await expect(page).toHaveURL(`${app.url}/ideas`);
    await page.getByRole('button', { name: '统计', exact: true }).click();
    await expect(page).toHaveURL(`${app.url}/ideas/stats`);
    await expect(page.getByRole('heading', { name: '统计即将上线' })).toBeVisible();
    await page.getByRole('button', { name: '回收站', exact: true }).click();
    await expect(page.getByText('已经移入回收站的一条')).toBeVisible();
    await expect(page.getByText('彻底删除前会一直保留')).toBeVisible();
    await page.goBack();
    await expect(page).toHaveURL(`${app.url}/ideas/stats`);
    await page.goBack();
    await expect(page).toHaveURL(`${app.url}/ideas`);
    await page.goForward();
    await expect(page.getByRole('button', { name: '统计', exact: true })).toHaveAttribute('aria-pressed', 'true');
  });

  test('独立打开时跟随系统深浅色', async ({ browser }) => {
    const context = await browser.newContext({ colorScheme: 'dark' });
    const page = await context.newPage();
    await openApp(page);
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await page.emulateMedia({ colorScheme: 'light' });
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    await context.close();
  });

  withParentPage('嵌在父窗口里：发 bm:ready，只接受 #parent 指定 origin 的 bm:theme', async ({ page, parentPage }) => {
    // 父页面由另一个本地端口真实提供（不同 origin）；用 route 伪造的页面会被浏览器的本地网络访问检查拦住。
    const parent = await parentPage(
      (origin) => `<!doctype html><html><body style="margin:0">
<script>window.received = []; addEventListener('message', (e) => window.received.push(e.data));</script>
<iframe id="app" src="${app.url}/ideas?embed=main#token=${app.token}&parent=${encodeURIComponent(origin)}"
  style="width:1200px;height:800px;border:0"></iframe></body></html>`,
    );
    await page.goto(`${parent.origin}/`);
    const frame = page.frameLocator('#app');
    await expect(frame.getByTestId('idea-count')).toHaveText(`${SEEDED.total} 条`);
    await expect(frame.getByRole('navigation', { name: '模块' })).toHaveCount(0);
    const received = () => page.evaluate(() => (window as unknown as { received: { type: string }[] }).received.map((m) => m.type));
    await expect.poll(received).toContain('bm:ready');

    const html = frame.locator('html');
    await expect(html).toHaveAttribute('data-theme', 'light');
    const fromParent = (dark: boolean) =>
      page.evaluate((value) => {
        (document.getElementById('app') as HTMLIFrameElement).contentWindow!.postMessage({ type: 'bm:theme', dark: value }, '*');
      }, dark);
    await fromParent(true);
    await expect(html).toHaveAttribute('data-theme', 'dark');
    await fromParent(false);
    await expect(html).toHaveAttribute('data-theme', 'light');

    // 不是父窗口发来的（这里是网页自己）不接受
    const appFrame = page.frames().find((candidate) => candidate.url().startsWith(app.url))!;
    await appFrame.evaluate(() => window.postMessage({ type: 'bm:theme', dark: true }, '*'));
    await page.waitForTimeout(200);
    await expect(html).toHaveAttribute('data-theme', 'light');
  });

  test('没有 #parent 时不接收 bm:theme', async ({ page }) => {
    await openApp(page, { search: '?embed=main' });
    await page.evaluate(() => window.postMessage({ type: 'bm:theme', dark: true }, '*'));
    await page.waitForTimeout(200);
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  });
});

test.describe('整页无横向滚动', () => {
  for (const viewport of VIEWPORTS) {
    test(`${viewport.width}×${viewport.height} 清单与详情`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await openApp(page);
      await noHorizontalScroll(page);
      await row(page, SEEDED.longTitlePrefix).click();
      await expect(page.getByRole('heading', { level: 2 })).toContainText(SEEDED.longTitlePrefix);
      await noHorizontalScroll(page);
      await focusVisible(page);
    });
  }
});

async function focusVisible(page: Page): Promise<void> {
  await page.keyboard.press('Tab');
  const outline = await page.evaluate(() => {
    const active = document.activeElement as HTMLElement | null;
    return active ? getComputedStyle(active).outlineStyle : 'none';
  });
  expect(outline).not.toBe('none');
}

async function serveParentPage(html: (origin: string) => string): Promise<{ origin: string; close: () => Promise<void> }> {
  const server = createServer((request, response) => {
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    response.end(html(`http://${request.headers.host}`));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  return {
    origin: `http://127.0.0.1:${port}`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}
