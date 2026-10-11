/**
 * 详情里的引用入口：独立打开不显示；嵌入时是「引用到对话」「侧栏打开」，最窄时收进「更多」。
 */
import { createServer } from 'node:http';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { app, openApp, row, SEEDED } from './helpers.ts';

const SHOTS = '/opt/cursor/artifacts/screenshots';

async function ideaId(title: string): Promise<string> {
  const response = await fetch(`${app.url}/api/v1/ideas`, {
    headers: { authorization: `Bearer ${app.token}` },
  });
  const body = (await response.json()) as { items: { id: string; title: string }[] };
  const found = body.items.find((item) => item.title === title);
  if (!found) throw new Error(`没有找到「${title}」`);
  return found.id;
}

function frameSrc(origin: string, path: string): string {
  const parent = encodeURIComponent(origin);
  return `${app.url}${path}#token=${app.token}&parent=${parent}`;
}

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

function parentPage(src: string, options: { fail?: boolean; dark?: boolean } = {}): (origin: string) => string {
  return () => `<!doctype html><html data-fail="${options.fail ? '1' : '0'}" data-dark="${options.dark ? '1' : '0'}"><body style="margin:0">
<script>
window.received = [];
addEventListener('message', (event) => {
  window.received.push(event.data);
  const msg = event.data || {};
  if (!event.source || typeof event.source.postMessage !== 'function') return;
  if (msg.type === 'bm:ready') {
    event.source.postMessage({ type: 'bm:theme', dark: document.documentElement.dataset.dark === '1' }, event.origin);
  }
  if (msg.type === 'bm:quote' || msg.type === 'bm:openSidebar') {
    const failed = document.documentElement.dataset.fail === '1';
    event.source.postMessage({
      type: 'bm:result',
      action: msg.type,
      ok: !failed,
      reason: failed ? '当前不在对话里' : undefined,
      requestId: msg.requestId,
    }, event.origin);
  }
});
</script>
<iframe id="app" src="${src}" style="width:1100px;height:760px;border:0"></iframe>
</body></html>`;
}

async function receivedTypes(page: Page): Promise<string[]> {
  return page.evaluate(() => (window as unknown as { received: { type?: string }[] }).received.map((item) => item.type ?? ''));
}

test('独立打开时不显示引用和侧栏按钮', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await openApp(page);
  await row(page, SEEDED.rich).click();
  const bar = page.getByRole('toolbar', { name: '操作' });
  await expect(bar.getByRole('button', { name: '引用到对话' })).toHaveCount(0);
  await expect(bar.getByRole('button', { name: '侧栏打开' })).toHaveCount(0);
  await expect(bar.getByRole('button', { name: '移入回收站' })).toBeVisible();
});

test('右侧栏嵌入显示整页详情，两个按钮把结果交给父窗口', async ({ page }) => {
  mkdirSync(SHOTS, { recursive: true });
  const id = await ideaId(SEEDED.rich);
  const parent = await serveParent((origin) => parentPage(frameSrc(origin, `/ideas/${id}?embed=sidebar`))(origin));
  try {
    await page.setViewportSize({ width: 1200, height: 860 });
    await page.goto(`${parent.origin}/`);
    const frame = page.frameLocator('#app');
    await expect(frame.getByRole('heading', { level: 2 })).toHaveText(SEEDED.rich);
    await expect(frame.getByRole('button', { name: '返回' })).toHaveCount(0);
    await expect(frame.getByRole('listbox')).toHaveCount(0);
    await page.screenshot({ path: join(SHOTS, 'embed-sidebar.png') });

    const bar = frame.getByRole('toolbar', { name: '操作' });
    await bar.getByRole('button', { name: '引用到对话' }).hover();
    await expect(frame.getByRole('tooltip')).toHaveText('在对话中引用');
    await bar.getByRole('button', { name: '引用到对话' }).click();
    await expect(frame.getByRole('status')).toContainText('已写入输入框');
    await bar.getByRole('button', { name: '侧栏打开' }).click();
    await expect(frame.getByRole('status')).toContainText('已在右侧栏打开');

    const messages = () => page.evaluate(() => (window as unknown as { received: { type: string; id?: string }[] }).received);
    await expect.poll(async () => (await messages()).some((item) => item.type === 'bm:quote' && item.id === id)).toBe(true);
    await expect.poll(async () => (await messages()).some((item) => item.type === 'bm:openSidebar' && item.id === id)).toBe(true);
  } finally {
    await parent.close();
  }
});

test('主区嵌入时父窗口拒绝，轻提示显示原因', async ({ page }) => {
  mkdirSync(SHOTS, { recursive: true });
  const parent = await serveParent((origin) => parentPage(frameSrc(origin, '/ideas?embed=main'), { fail: true })(origin));
  try {
    await page.setViewportSize({ width: 1200, height: 860 });
    await page.goto(`${parent.origin}/`);
    const frame = page.frameLocator('#app');
    await expect(frame.getByTestId('idea-count')).toHaveText(`${SEEDED.total} 条`);
    await expect(frame.getByRole('navigation', { name: '模块' })).toHaveCount(0);
    await expect(frame.locator('html')).toHaveAttribute('data-theme', 'light');
    await page.screenshot({ path: join(SHOTS, 'embed-main-light.png') });
    await page.evaluate((targetOrigin) => {
      const frame = document.querySelector('#app');
      if (!(frame instanceof HTMLIFrameElement) || !frame.contentWindow) return;
      frame.contentWindow.postMessage({ type: 'bm:theme', dark: true }, targetOrigin);
    }, new URL(app.url).origin);
    await expect(frame.locator('html')).toHaveAttribute('data-theme', 'dark');
    await page.screenshot({ path: join(SHOTS, 'embed-main-dark.png') });

    await frame.getByRole('option').filter({ hasText: SEEDED.rich }).click();
    const bar = frame.getByRole('toolbar', { name: '操作' });
    expect(await bar.evaluate((node) => node.scrollHeight <= node.clientHeight + 1 && node.scrollWidth <= node.clientWidth + 1)).toBe(true);
    const trash = await bar.getByRole('button', { name: '移入回收站' }).boundingBox();
    const box = await bar.boundingBox();
    expect(trash && box && Math.abs(box.x + box.width - (trash.x + trash.width)) <= 2).toBe(true);
    await bar.getByRole('button', { name: '侧栏打开' }).click();
    await expect(frame.getByRole('status')).toContainText('当前不在对话里');
    await bar.getByRole('button', { name: '引用到对话' }).click();
    await expect(frame.getByRole('status')).toContainText('当前不在对话里');
    await expect.poll(() => receivedTypes(page)).toContain('bm:openSidebar');
  } finally {
    await parent.close();
  }
});

test('详情宽 320px 时两个按钮收进更多，工具条仍是一行', async ({ page }) => {
  const parent = await serveParent((origin) => parentPage(frameSrc(origin, '/ideas?embed=main'))(origin));
  try {
    await page.addInitScript(() => {
      localStorage.setItem('bluemanta.detailWidth', '320');
    });
    await page.setViewportSize({ width: 1200, height: 860 });
    await page.goto(`${parent.origin}/`);
    const frame = page.frameLocator('#app');
    await frame.getByRole('option').filter({ hasText: SEEDED.rich }).click();
    const bar = frame.getByRole('toolbar', { name: '操作' });
    await expect(bar.getByRole('button', { name: '更多' })).toBeVisible();
    await expect(bar.getByRole('button', { name: '引用到对话' })).toHaveCount(0);
    expect(await bar.evaluate((node) => node.scrollHeight <= node.clientHeight + 1 && node.scrollWidth <= node.clientWidth + 1)).toBe(true);
    await bar.getByRole('button', { name: '更多' }).click();
    await frame.getByRole('menuitem', { name: '在对话中引用' }).click();
    await expect(frame.getByRole('status')).toContainText('已写入输入框');
  } finally {
    await parent.close();
  }
});

test('嵌入时编辑未保存会发 bm:dirty', async ({ page }) => {
  const id = await ideaId(SEEDED.rich);
  const parent = await serveParent((origin) => parentPage(frameSrc(origin, `/ideas/${id}?embed=sidebar`))(origin));
  try {
    await page.setViewportSize({ width: 1200, height: 860 });
    await page.goto(`${parent.origin}/`);
    const frame = page.frameLocator('#app');
    await frame.getByRole('button', { name: '编辑' }).click();
    await frame.getByRole('textbox', { name: '标题' }).fill('未保存的标题');
    await expect.poll(async () => {
      const items = await page.evaluate(() => (window as unknown as { received: { type?: string; dirty?: boolean }[] }).received);
      return items.some((item) => item.type === 'bm:dirty' && item.dirty === true);
    }).toBe(true);
  } finally {
    await parent.close();
  }
});

test('服务没启动时的提示', async ({ page }) => {
  mkdirSync(SHOTS, { recursive: true });
  await page.setViewportSize({ width: 900, height: 640 });
  await page.setContent(`<!doctype html><html><body style="margin:0;height:100vh;display:flex;align-items:center;justify-content:center;background:#f7f6f2;color:#1c1b19;font:14px/1.5 system-ui">
    <div style="display:flex;flex-direction:column;align-items:center;gap:12px;max-width:420px;text-align:center">
      <p style="margin:0">本地服务没有启动：端口 4310 被其他程序占用</p>
      <button type="button" style="border:1px solid #d9d3c7;background:transparent;border-radius:6px;padding:4px 12px">重试</button>
    </div>
  </body></html>`);
  await expect(page.getByRole('button', { name: '重试' })).toBeVisible();
  await page.screenshot({ path: join(SHOTS, 'server-not-started.png') });
});
