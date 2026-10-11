import { expect, type Page } from '@playwright/test';

function env(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`缺少 ${name}，走查需要经 global-setup 启动`);
  return value;
}

export const app = {
  get url() {
    return env('BM_E2E_URL');
  },
  get token() {
    return env('BM_E2E_TOKEN');
  },
  get emptyUrl() {
    return env('BM_E2E_EMPTY_URL');
  },
  get emptyToken() {
    return env('BM_E2E_EMPTY_TOKEN');
  },
};

export const VIEWPORTS = [
  { width: 1440, height: 900 },
  { width: 1280, height: 800 },
  { width: 1024, height: 768 },
  { width: 720, height: 900 },
] as const;

/** 虚构数据里几条固定的灵感（见 scripts/seed.ts）。 */
export const SEEDED = {
  total: 21,
  starred: 4,
  rich: '把会议纪要自动变成待办',
  fourImages: '周末整理书架',
  longTitlePrefix: '用热力图看一年的记录节奏',
};

type OpenOptions = { path?: string; empty?: boolean; search?: string };

/** 带口令打开网页并等清单读完。 */
export async function openApp(page: Page, options: OpenOptions = {}): Promise<void> {
  const base = options.empty ? app.emptyUrl : app.url;
  const token = options.empty ? app.emptyToken : app.token;
  await page.goto(`${base}${options.path ?? '/'}${options.search ?? ''}#token=${token}`);
  await expect(page.getByTestId('idea-count')).toHaveText(/\d+ 条/);
}

export function rows(page: Page) {
  return page.getByRole('listbox', { name: '灵感清单' }).getByRole('option');
}

export function row(page: Page, title: string) {
  return rows(page).filter({ hasText: title }).first();
}

export function detail(page: Page) {
  return page.getByRole('complementary', { name: '详情' });
}

export async function waitImages(page: Page, count: number): Promise<void> {
  await expect(page.locator('img[src^="blob:"]')).toHaveCount(count);
  await page.waitForFunction(() => [...document.images].every((image) => image.complete));
}

export async function noHorizontalScroll(page: Page): Promise<void> {
  const overflow = await page.evaluate(() => ({
    doc: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    body: document.body.scrollWidth - window.innerWidth,
  }));
  expect(overflow.doc).toBeLessThanOrEqual(0);
  expect(overflow.body).toBeLessThanOrEqual(0);
}
