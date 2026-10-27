/**
 * embed=main 收到 bm:chrome 后，页头模块名让出左上角；0 时回到原位。
 * 清单、统计、回收站都测。1440×900，深浅色各一张。
 */
import { createServer } from 'node:http';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type FrameLocator, type Page } from '@playwright/test';
import { WEB_ROOT } from '../scripts/sandbox.ts';
import { app, openApp, SEEDED } from './helpers.ts';

const SHOTS = join(WEB_ROOT, 'screenshots', 'leading-clearance');

const SECTIONS = [
  { id: 'list', name: '清单' },
  { id: 'stats', name: '统计' },
  { id: 'trash', name: '回收站' },
] as const;

async function serveParent(html: (origin: string) => string): Promise<{ origin: string; close: () => Promise<void> }> {
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

function frameSrc(origin: string, path: string): string {
  return `${app.url}${path}#token=${app.token}&parent=${encodeURIComponent(origin)}`;
}

function parentHtml(path: string): (origin: string) => string {
  return (origin) => `<!doctype html><html><head>
<style>html,body{margin:0;height:100%;overflow:hidden}</style></head>
<body>
<iframe id="app" src="${frameSrc(origin, path)}" style="width:1440px;height:900px;border:0;display:block"></iframe>
</body></html>`;
}

async function postToFrame(page: Page, message: object): Promise<void> {
  const targetOrigin = new URL(app.url).origin;
  await page.evaluate(
    ({ message, targetOrigin }) => {
      const frame = document.getElementById('app');
      if (!(frame instanceof HTMLIFrameElement) || !frame.contentWindow) throw new Error('没有主区框');
      frame.contentWindow.postMessage(message, targetOrigin);
    },
    { message, targetOrigin },
  );
}

async function headerEdges(frame: FrameLocator): Promise<{ title: number; seg: number }> {
  return frame.locator('header').evaluate((header) => {
    const title = header.querySelector('h1');
    const seg = header.querySelector('[role="group"]');
    return {
      title: title ? title.getBoundingClientRect().left : -1,
      seg: seg ? seg.getBoundingClientRect().left : -1,
    };
  });
}

async function showSection(frame: FrameLocator, name: (typeof SECTIONS)[number]['name']): Promise<void> {
  await frame.getByRole('button', { name, exact: true }).click();
  if (name === '清单') await expect(frame.getByTestId('idea-count')).toBeVisible();
  if (name === '统计') await expect(frame.getByRole('heading', { name: '近半年记录频率' })).toBeVisible();
  if (name === '回收站') await expect(frame.getByText('彻底删除前会一直保留')).toBeVisible();
}

async function setTheme(page: Page, frame: FrameLocator, dark: boolean): Promise<void> {
  await postToFrame(page, { type: 'bm:theme', dark });
  await expect(frame.locator('html')).toHaveAttribute('data-theme', dark ? 'dark' : 'light');
}

async function shot(page: Page, name: string): Promise<void> {
  await page.locator('#app').screenshot({ path: join(SHOTS, name), animations: 'disabled' });
}

test('embed=main 收到 160 后三页页头右移，收到 0 后回到原位', async ({ page }) => {
  test.setTimeout(90_000);
  mkdirSync(SHOTS, { recursive: true });
  const parent = await serveParent(parentHtml('/ideas?embed=main'));
  try {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`${parent.origin}/`);
    const frame = page.frameLocator('#app');
    await expect(frame.getByTestId('idea-count')).toHaveText(`${SEEDED.total} 条`);
    await expect(frame.getByRole('navigation', { name: '模块' })).toHaveCount(0);

    const base = await headerEdges(frame);
    expect(base.title).toBeGreaterThan(0);
    expect(base.title).toBeLessThan(160);
    expect(base.seg).toBeGreaterThan(base.title);

    await postToFrame(page, { type: 'bm:chrome', leadingClearance: 160 });
    await expect.poll(async () => (await headerEdges(frame)).title).toBeGreaterThanOrEqual(160);

    for (const section of SECTIONS) {
      await showSection(frame, section.name);
      const shifted = await headerEdges(frame);
      expect(shifted.title).toBeGreaterThanOrEqual(160);
      expect(shifted.title).toBeLessThanOrEqual(Math.max(160, base.title) + 1);
      expect(Math.abs(shifted.seg - base.seg - (shifted.title - base.title))).toBeLessThan(1);
      await setTheme(page, frame, false);
      await shot(page, `${section.id}-160-light.png`);
      await setTheme(page, frame, true);
      await shot(page, `${section.id}-160-dark.png`);
    }

    const headerFits = await frame.locator('header').evaluate((node) => node.scrollWidth <= node.clientWidth + 1);
    expect(headerFits).toBe(true);

    await postToFrame(page, { type: 'bm:chrome', leadingClearance: 0 });
    await expect.poll(async () => Math.abs((await headerEdges(frame)).title - base.title) < 0.5).toBe(true);

    for (const section of SECTIONS) {
      await showSection(frame, section.name);
      const restored = await headerEdges(frame);
      expect(Math.abs(restored.title - base.title)).toBeLessThan(0.5);
      expect(Math.abs(restored.seg - base.seg)).toBeLessThan(0.5);
      await setTheme(page, frame, true);
      await shot(page, `${section.id}-0-dark.png`);
      await setTheme(page, frame, false);
      await shot(page, `${section.id}-0-light.png`);
    }
  } finally {
    await parent.close();
  }
});

test('独立打开和 embed=sidebar 不因 bm:chrome 移动页头', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openApp(page);
  const standalone = await page.getByRole('heading', { level: 1, name: '灵感台' }).evaluate((node) => node.getBoundingClientRect().left);
  await page.evaluate(() => window.postMessage({ type: 'bm:chrome', leadingClearance: 160 }, '*'));
  await page.waitForTimeout(200);
  expect(await page.getByRole('heading', { level: 1, name: '灵感台' }).evaluate((node) => node.getBoundingClientRect().left)).toBe(standalone);

  await openApp(page, { path: '/ideas', search: '?embed=main' });
  const unparented = await page.getByRole('heading', { level: 1, name: '灵感台' }).evaluate((node) => node.getBoundingClientRect().left);
  await page.evaluate(() => window.postMessage({ type: 'bm:chrome', leadingClearance: 160 }, '*'));
  await page.waitForTimeout(200);
  expect(await page.getByRole('heading', { level: 1, name: '灵感台' }).evaluate((node) => node.getBoundingClientRect().left)).toBe(unparented);

  const parent = await serveParent(parentHtml('/ideas?embed=sidebar'));
  try {
    await page.goto(`${parent.origin}/`);
    const frame = page.frameLocator('#app');
    await expect(frame.getByTestId('idea-count')).toHaveText(`${SEEDED.total} 条`);
    const before = await headerEdges(frame);
    await postToFrame(page, { type: 'bm:chrome', leadingClearance: 160 });
    await page.waitForTimeout(200);
    const after = await headerEdges(frame);
    expect(after.title).toBe(before.title);
    expect(after.seg).toBe(before.seg);
    expect(after.title).toBeLessThan(160);
  } finally {
    await parent.close();
  }
});
