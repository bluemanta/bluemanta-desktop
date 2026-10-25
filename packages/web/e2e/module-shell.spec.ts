import { expect, test as base, type Page } from '@playwright/test';
import { createServer } from 'vite';
import { freePort, WEB_ROOT } from '../scripts/sandbox.ts';
import { app, openApp } from './helpers.ts';

const test = base.extend<{}, { moduleUrl: string }>({
  moduleUrl: [async ({}, use) => {
    const server = await createServer({
      root: WEB_ROOT,
      configFile: `${WEB_ROOT}/vite.config.ts`,
      server: {
        host: '127.0.0.1', port: await freePort(), strictPort: true, watch: null, hmr: false,
        proxy: { '/api': { target: app.url, changeOrigin: true } },
      },
      plugins: [{
        name: 'module-shell-fixture',
        configureServer(vite) {
          vite.middlewares.use((request, _response, next) => {
            const url = new URL(request.url ?? '/', 'http://localhost');
            if (['/ideas', '/fake', '/fake/matrix', '/ideas-copy'].includes(url.pathname)) {
              request.url = `/e2e/fixtures/module-shell.html${url.search}`;
            }
            next();
          });
        },
      }],
    });
    try {
      await server.listen();
      await use(server.resolvedUrls!.local[0]!.replace(/\/$/, ''));
    } finally {
      await server.close();
    }
  }, { scope: 'worker' }],
});

test.describe.configure({ mode: 'default' });

async function openModule(page: Page, url: string, path = '/fake', search = '') {
  await page.goto(`${url}${path}${search}#token=${app.token}`);
  await expect(page.getByRole('heading', { name: path === '/ideas' ? '灵感台' : '假模块', exact: true })).toBeVisible();
}

test('灵感台命令顺序不变，首项回车打开快速记录', async ({ page }) => {
  await openApp(page, { path: '/ideas' });
  await page.keyboard.press('p');
  const options = page.getByRole('dialog', { name: '命令面板' }).getByRole('option');
  await expect(options.first()).toHaveText('＋ 记一条灵感N');
  await expect(options).toHaveText([
    '＋ 记一条灵感N', '切换到清单', '切换到统计', '打开回收站', '只看收藏', '清除筛选', /切换深浅色/,
  ]);
  await expect(options.first()).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('form', { name: '快速记录' })).toBeVisible();
});

test('注入假模块后，侧栏和命令面板都显示它且选中项随导航变化', async ({ page, moduleUrl }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openModule(page, moduleUrl, '/ideas');
  const nav = page.getByRole('navigation', { name: '模块' });
  const ideas = nav.getByRole('button', { name: '灵感台', exact: true });
  const fake = nav.getByRole('button', { name: '假模块', exact: true });
  await expect(fake).toBeVisible();
  await expect(ideas).toHaveAttribute('aria-current', 'page');
  await expect(fake).not.toHaveAttribute('aria-current');
  await page.keyboard.press('p');
  const palette = page.getByRole('dialog', { name: '命令面板' });
  await expect(palette.getByRole('option').first()).toHaveText('＋ 记一条灵感N');
  await expect(palette.getByRole('option').last()).toHaveText('切换到 假模块');
  await palette.getByRole('option', { name: '切换到 假模块', exact: true }).click();
  await expect(page).toHaveURL(`${moduleUrl}/fake`);
  await expect(fake).toHaveAttribute('aria-current', 'page');
  await expect(ideas).not.toHaveAttribute('aria-current');
  await page.keyboard.press('p');
  await expect(palette.getByRole('option', { name: '打开假模块矩阵', exact: true })).toBeVisible();
  await expect(palette.getByRole('option', { name: /记一条灵感/ })).toHaveCount(0);
  await page.keyboard.press('Escape');
  await ideas.click();
  await expect(page).toHaveURL(`${moduleUrl}/ideas`);
  await expect(ideas).toHaveAttribute('aria-current', 'page');
  await expect(fake).not.toHaveAttribute('aria-current');
  await page.goBack();
  await expect(fake).toHaveAttribute('aria-current', 'page');
});

for (const path of ['/fake', '/ideas-copy']) {
  test(`${path} 按 N 不打开快速记录，回到灵感台后 N 仍可用`, async ({ page, moduleUrl }) => {
    await openModule(page, moduleUrl, path);
    await page.keyboard.press('n');
    await expect(page.getByRole('form', { name: '快速记录' })).toHaveCount(0);
    await expect(page).toHaveURL(`${moduleUrl}${path}`);
    await page.getByRole('navigation', { name: '模块' }).getByRole('button', { name: '灵感台', exact: true }).click();
    await expect(page.getByTestId('idea-count')).toHaveText(/\d+ 条/);
    await expect(page.getByRole('form', { name: '快速记录' })).toHaveCount(0);
    await page.getByRole('heading', { name: '灵感台', exact: true }).click();
    await page.keyboard.press('n');
    await expect(page.getByRole('form', { name: '快速记录' })).toBeVisible();
  });
}

test('Shell 未传 onSection 时按分段路径导航并保留嵌入参数', async ({ page, moduleUrl }) => {
  await openModule(page, moduleUrl, '/fake', '?embed=main');
  const sections = page.getByRole('group', { name: '假模块页面' });
  await sections.getByRole('button', { name: '矩阵', exact: true }).click();
  await expect(page).toHaveURL(`${moduleUrl}/fake/matrix?embed=main`);
  await expect(sections.getByRole('button', { name: '矩阵', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await sections.getByRole('button', { name: '首页', exact: true }).click();
  await expect(page).toHaveURL(`${moduleUrl}/fake?embed=main`);
});

for (const embed of ['main', 'sidebar', null] as const) {
  test(`假模块 ${embed ?? '窄屏'} 无侧栏时页头提供命令入口和 P 提示`, async ({ page, moduleUrl }) => {
    await page.setViewportSize({ width: embed ? 1440 : 720, height: 900 });
    await openModule(page, moduleUrl, '/fake', embed ? `?embed=${embed}` : '');
    await expect(page.getByRole('navigation', { name: '模块' })).toHaveCount(0);
    const button = page.locator('header').getByRole('button', { name: '搜索或执行', exact: true });
    await expect(button.locator('kbd')).toHaveText('P');
    await button.hover();
    await expect(page.getByRole('tooltip')).toHaveText('搜索或执行 P');
    await button.click();
    await expect(page.getByRole('dialog', { name: '命令面板' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog', { name: '命令面板' })).toHaveCount(0);
  });
}

test('假模块宽屏和中屏保留侧栏入口，页头不重复', async ({ page, moduleUrl }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openModule(page, moduleUrl);
  for (const width of [1440, 1024]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(page.getByRole('navigation', { name: '模块' })).toBeVisible();
    await expect(page.locator('header').getByRole('button', { name: '搜索或执行', exact: true })).toHaveCount(0);
    const button = page.getByRole('button', { name: '搜索或执行', exact: true });
    await expect(button).toHaveCount(1);
    await button.click();
    await expect(page.getByRole('dialog', { name: '命令面板' })).toBeVisible();
    await page.keyboard.press('Escape');
  }
});
