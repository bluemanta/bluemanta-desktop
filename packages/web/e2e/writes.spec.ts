/**
 * 写操作走查。用单独的虚构库，串行执行，不改只读走查那份数据。
 */
import { expect, test, type Page } from '@playwright/test';
import { app, detail, openApp, row, rows } from './helpers.ts';

test.describe.configure({ mode: 'serial' });

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

function capture(page: Page) {
  return page.getByRole('form', { name: '快速记录' });
}

async function openCapture(page: Page): Promise<void> {
  await page.getByRole('button', { name: '＋ 记一条' }).click();
  await expect(capture(page).getByRole('textbox', { name: '正文' })).toBeFocused();
}

async function tokenOf(page: Page): Promise<string> {
  const token = await page.evaluate(() => window.localStorage.getItem('bluemanta.token'));
  if (!token) throw new Error('页面里没有口令');
  return token;
}

async function api(page: Page, method: string, path: string, body?: unknown) {
  const response = await page.request.fetch(`${app.writeUrl}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${await tokenOf(page)}`,
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    data: body,
  });
  return response;
}

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openApp(page, { write: true });
});

test('快速记录：全空提示、esc 取消、⌘↵ 记下纯文字', async ({ page }) => {
  await openCapture(page);
  await page.keyboard.press('ControlOrMeta+Enter');
  await expect(page.getByRole('status')).toHaveText('标题和正文至少写一项');
  await expect(capture(page)).toBeVisible();

  await capture(page).getByRole('textbox', { name: '标题' }).fill('这条不该被记下');
  await page.keyboard.press('Escape');
  await expect(capture(page)).toHaveCount(0);
  await expect(page.getByText('这条不该被记下')).toHaveCount(0);

  await page.keyboard.press('n');
  await expect(capture(page).getByRole('textbox', { name: '正文' })).toBeFocused();
  await capture(page).getByRole('textbox', { name: '标题' }).fill('走查记下的一条');
  await capture(page).getByRole('textbox', { name: '正文' }).fill('只用文字，没有图片。');
  await page.keyboard.press('ControlOrMeta+Enter');
  await expect(page.getByRole('status')).toHaveText('已记下');
  await expect(capture(page)).toHaveCount(0);
  await expect(rows(page).first()).toContainText('走查记下的一条');
  await expect(detail(page).getByRole('heading', { level: 2 })).toHaveText('走查记下的一条');
  await expect(detail(page).getByText('来源 灵感台')).toBeVisible();
  await expect(page.getByText('这条不该被记下')).toHaveCount(0);
});

test('搜索框里按 N 不会打开快速记录；从回收站按 N 会先回到清单', async ({ page }) => {
  await page.getByRole('searchbox', { name: '搜索灵感' }).focus();
  await page.keyboard.press('n');
  await expect(capture(page)).toHaveCount(0);
  await expect(page.getByRole('searchbox', { name: '搜索灵感' })).toHaveValue('n');

  await page.getByRole('button', { name: '回收站', exact: true }).click();
  await expect(page).toHaveURL(/\/ideas\/trash$/);
  await page.keyboard.press('n');
  await expect(page).toHaveURL(`${app.writeUrl}/ideas`);
  await expect(capture(page)).toBeVisible();
});

test('粘贴图片出现在卡片里，只有图片也可以保存', async ({ page }) => {
  await openCapture(page);
  await capture(page).getByRole('textbox', { name: '正文' }).evaluate((node, b64: string) => {
    const binary = atob(b64);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    const file = new File([bytes], 'paste.png', { type: 'image/png' });
    const data = new DataTransfer();
    data.items.add(file);
    const event = new Event('paste', { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'clipboardData', { value: data });
    node.dispatchEvent(event);
  }, PNG.toString('base64'));
  await expect(capture(page).getByRole('img', { name: '图片 1' })).toBeVisible();
  await expect(capture(page).getByRole('progressbar')).toHaveCount(0);
  await page.keyboard.press('Escape');

  await openCapture(page);
  await capture(page).getByLabel('选择图片').setInputFiles({ name: 'only.png', mimeType: 'image/png', buffer: PNG });
  await expect(capture(page).getByRole('img', { name: '图片 1' })).toBeVisible();
  await expect(capture(page).getByRole('progressbar')).toHaveCount(0);
  await capture(page).getByRole('button', { name: '记下' }).click();
  await expect(page.getByRole('status')).toHaveText('已记下');
  await expect(detail(page).getByRole('heading', { level: 2 })).toHaveText('未命名灵感');
  await expect(detail(page).getByRole('button', { name: '查看图片 1' })).toBeVisible();
});

test('收藏与取消：行内星标不打开详情，S 对当前行生效', async ({ page }) => {
  const target = row(page, '楼下新开的面包店周三休息');
  await target.getByRole('button', { name: '收藏', exact: true }).click();
  await expect(page).toHaveURL(`${app.writeUrl}/ideas`);
  await expect(target.getByRole('button', { name: '取消收藏' })).toBeVisible();

  await target.click();
  await expect(detail(page).getByRole('button', { name: '★ 已收藏' })).toBeVisible();
  await target.focus();
  await page.keyboard.press('s');
  await expect(detail(page).getByRole('button', { name: '☆ 收藏' })).toBeVisible();
  await expect(target.getByRole('button', { name: '收藏', exact: true })).toBeVisible();
});

test('编辑保存后显示已改写，⌘↵ 也能保存', async ({ page }) => {
  await row(page, '学一点基础的色彩理论').click();
  await expect(detail(page).getByText('已改写')).toHaveCount(0);
  await detail(page).getByRole('button', { name: '编辑' }).click();
  const body = detail(page).getByRole('textbox', { name: '正文' });
  await expect(body).toBeFocused();
  await body.fill('从色相环开始，这是走查改过的正文。');
  await expect(detail(page).getByLabel('未保存')).toBeVisible();
  await page.keyboard.press('ControlOrMeta+Enter');
  await expect(detail(page).getByText('从色相环开始，这是走查改过的正文。')).toBeVisible();
  await expect(detail(page).getByText('已改写')).toBeVisible();
  await expect(detail(page).getByLabel('未保存')).toHaveCount(0);
  await expect(detail(page).getByRole('textbox', { name: '标题' })).toHaveCount(0);
});

test('未保存绿点，关闭标签、切换页面、浏览器后退、窄屏返回都要确认', async ({ page }) => {
  test.setTimeout(90_000);
  await row(page, '灵感台加一个「随机回看」').click();
  const editor = detail(page).getByRole('textbox', { name: '正文' });
  const dirty = async () => {
    await detail(page).getByRole('button', { name: '编辑' }).click();
    await editor.fill('还没保存的修改');
    await expect(detail(page).getByLabel('未保存')).toBeVisible();
  };

  await dirty();
  const closeTab = detail(page).getByRole('button', { name: /关闭「灵感台加一个/ });
  await closeTab.click();
  const dialog = page.getByRole('alertdialog');
  await expect(dialog.getByRole('heading', { name: '放弃未保存的修改？' })).toBeVisible();
  await expect(dialog.getByRole('button', { name: '继续编辑' })).toBeFocused();
  await dialog.getByRole('button', { name: '继续编辑' }).click();
  await expect(editor).toHaveValue('还没保存的修改');
  await closeTab.click();
  await dialog.getByRole('button', { name: '放弃修改' }).click();
  await expect(page.getByRole('heading', { level: 2, name: '灵感台加一个「随机回看」' })).toHaveCount(0);

  await row(page, '灵感台加一个「随机回看」').click();
  await dirty();
  await page.getByRole('button', { name: '统计', exact: true }).click();
  await expect(dialog.getByRole('button', { name: '继续编辑' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page).toHaveURL(/\/ideas\/card_/);
  await expect(editor).toHaveValue('还没保存的修改');
  await page.getByRole('button', { name: '统计', exact: true }).click();
  await dialog.getByRole('button', { name: '放弃修改' }).click();
  await expect(page).toHaveURL(`${app.writeUrl}/ideas/stats`);

  await page.getByRole('button', { name: '清单', exact: true }).click();
  await row(page, '学 SQL 窗口函数').click();
  await row(page, '灵感台加一个「随机回看」').click();
  await dirty();
  await page.goBack();
  await expect(dialog.getByRole('heading', { name: '放弃未保存的修改？' })).toBeVisible();
  await dialog.getByRole('button', { name: '继续编辑' }).click();
  await expect(editor).toHaveValue('还没保存的修改');
  await page.goBack();
  await dialog.getByRole('button', { name: '放弃修改' }).click();
  await expect(detail(page).getByRole('heading', { level: 2 })).toHaveText('学 SQL 窗口函数');

  await page.goto(`${app.writeUrl}/ideas`);
  await expect(page.getByTestId('idea-count')).toBeVisible();
  await page.setViewportSize({ width: 720, height: 900 });
  await row(page, '灵感台加一个「随机回看」').click();
  await page.getByRole('button', { name: '编辑' }).click();
  await page.getByRole('textbox', { name: '正文' }).fill('窄屏上也还没保存');
  await page.getByRole('button', { name: '返回' }).click();
  await expect(page.getByRole('alertdialog').getByRole('button', { name: '继续编辑' })).toBeFocused();
  await page.getByRole('button', { name: '继续编辑' }).click();
  await expect(page.getByRole('textbox', { name: '正文' })).toHaveValue('窄屏上也还没保存');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('alertdialog')).toBeVisible();
  await page.getByRole('button', { name: '继续编辑' }).click();
  await page.getByRole('button', { name: '返回' }).click();
  await page.getByRole('button', { name: '放弃修改' }).click();
  await expect(page).toHaveURL(`${app.writeUrl}/ideas`);
  await expect(rows(page).first()).toBeVisible();
});

test('有未保存修改时注册 beforeunload', async ({ page }) => {
  const armed = () =>
    page.evaluate(() => {
      const event = new Event('beforeunload', { cancelable: true });
      window.dispatchEvent(event);
      return event.defaultPrevented;
    });
  await row(page, '季度复盘的写法').click();
  expect(await armed()).toBe(false);
  await detail(page).getByRole('button', { name: '编辑' }).click();
  await detail(page).getByRole('textbox', { name: '正文' }).fill('关掉页面前要问一声');
  await expect(detail(page).getByLabel('未保存')).toBeVisible();
  await expect.poll(armed).toBe(true);
});

test('别处先改再保存：409，草稿还在，重新载入后草稿可复制', async ({ page }) => {
  await row(page, '学 SQL 窗口函数').click();
  await detail(page).getByRole('button', { name: '编辑' }).click();
  await detail(page).getByRole('textbox', { name: '标题' }).fill('本地还没保存的标题');
  const id = page.url().match(/\/ideas\/(card_[^/?]+)/)?.[1];
  if (!id) throw new Error('地址里没有灵感 id');
  const current = (await (await api(page, 'GET', `/api/v1/ideas/${id}`)).json()) as { record: { rev: number } };
  const patched = await api(page, 'PATCH', `/api/v1/ideas/${id}`, {
    requestId: crypto.randomUUID(),
    rev: current.record.rev,
    title: '别处改过的标题',
  });
  expect(patched.ok()).toBeTruthy();
  await detail(page).getByRole('button', { name: '保存' }).click();
  await expect(detail(page).getByText('这条灵感已在别处更新')).toBeVisible();
  await expect(detail(page).getByRole('textbox', { name: '标题' })).toHaveValue('本地还没保存的标题');
  await detail(page).getByRole('button', { name: '重新载入' }).click();
  await expect(detail(page).getByRole('textbox', { name: '标题' })).toHaveValue('别处改过的标题');
  await expect(detail(page).getByRole('textbox', { name: '未保存的草稿' })).toHaveValue(/本地还没保存的标题/);
});

test('编辑中列表刷新到更高版本时不覆盖草稿', async ({ page }) => {
  test.setTimeout(60_000);
  await row(page, '收集好用的快捷键').click();
  await page.waitForTimeout(5_500);
  await detail(page).getByRole('button', { name: '编辑' }).click();
  await detail(page).getByRole('textbox', { name: '正文' }).fill('焦点刷新也不该盖掉');
  const id = page.url().match(/\/ideas\/(card_[^/?]+)/)?.[1];
  if (!id) throw new Error('地址里没有灵感 id');
  const current = (await (await api(page, 'GET', `/api/v1/ideas/${id}`)).json()) as { record: { rev: number } };
  const patched = await api(page, 'PATCH', `/api/v1/ideas/${id}`, {
    requestId: crypto.randomUUID(),
    rev: current.record.rev,
    body: '这是别处写下的正文',
  });
  expect(patched.ok()).toBeTruthy();
  const refetch = page.waitForResponse((response) => response.url().includes(`/api/v1/ideas/${id}`) && response.request().method() === 'GET');
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await refetch;
  await expect(detail(page).getByText('这条灵感已在别处更新')).toBeVisible();
  await expect(detail(page).getByRole('textbox', { name: '正文' })).toHaveValue('焦点刷新也不该盖掉');
});

test('追加延展，删除时确认，取消则保留', async ({ page }) => {
  await row(page, '方案评审前先写').click();
  const box = detail(page).getByRole('textbox', { name: '追加延展' });
  await expect(detail(page).getByRole('button', { name: '追加延展' })).toBeDisabled();
  await box.fill('走查追加的延展');
  await detail(page).getByRole('button', { name: '追加延展' }).click();
  const item = detail(page).locator('li').filter({ hasText: '走查追加的延展' });
  await expect(item).toBeVisible();
  await item.getByRole('button', { name: '删除' }).click();
  const dialog = page.getByRole('alertdialog');
  await expect(dialog.getByRole('heading', { name: '删除这条延展？' })).toBeVisible();
  await expect(dialog.getByText('删除后无法恢复。')).toBeVisible();
  await expect(dialog.getByRole('button', { name: '取消' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(item).toBeVisible();
  await item.getByRole('button', { name: '删除' }).click();
  await dialog.getByRole('button', { name: '删除' }).click();
  await expect(item).toHaveCount(0);
});

test('移入回收站带撤销，⌫ 也能移入，恢复后回到清单', async ({ page }) => {
  await row(page, '晨跑路线换成河边').click();
  await detail(page).getByRole('button', { name: '移入回收站' }).click();
  await expect(page.getByRole('status')).toContainText('已移入回收站：晨跑路线换成河边');
  await expect(row(page, '晨跑路线换成河边')).toHaveCount(0);
  await page.getByRole('status').getByRole('button', { name: '撤销' }).click();
  await expect(row(page, '晨跑路线换成河边')).toBeVisible();

  const podcast = row(page, '英语播客每天听 15 分钟');
  await podcast.click();
  await podcast.focus();
  await page.keyboard.press('Backspace');
  await expect(page.getByRole('status')).toContainText('已移入回收站：英语播客每天听 15');
  await expect(podcast).toHaveCount(0);

  await page.getByRole('button', { name: '回收站', exact: true }).click();
  const trashed = page.getByRole('listitem').filter({ hasText: '英语播客每天听 15 分钟' });
  await trashed.getByRole('button', { name: '恢复' }).click();
  await expect(page.getByRole('status')).toHaveText('已恢复');
  await page.getByRole('button', { name: '清单', exact: true }).click();
  await expect(row(page, '英语播客每天听 15 分钟')).toBeVisible();
});

test('彻底删除先确认，取消保留，确认后消失；清空后是空回收站', async ({ page }) => {
  await page.getByRole('button', { name: '回收站', exact: true }).click();
  const seeded = page.getByRole('listitem').filter({ hasText: '已经移入回收站的一条' });
  await seeded.getByRole('button', { name: '彻底删除' }).click();
  const dialog = page.getByRole('alertdialog');
  await expect(dialog.getByRole('heading', { name: '彻底删除这条灵感？' })).toBeVisible();
  await expect(dialog.getByText('将被永久删除')).toBeVisible();
  await expect(dialog.getByRole('button', { name: '取消' })).toBeFocused();
  await dialog.getByRole('button', { name: '取消' }).click();
  await expect(seeded).toBeVisible();
  await seeded.getByRole('button', { name: '彻底删除' }).click();
  await dialog.getByRole('button', { name: '彻底删除' }).click();
  await expect(seeded).toHaveCount(0);

  while ((await page.getByRole('listitem').count()) > 0) {
    await page.getByRole('listitem').first().getByRole('button', { name: '彻底删除' }).click();
    await page.getByRole('alertdialog').getByRole('button', { name: '彻底删除' }).click();
  }
  await expect(page.getByRole('heading', { name: '回收站是空的' })).toBeVisible();
  await expect(page.getByText('移入回收站的灵感会保留在这里，直到你彻底删除。')).toBeVisible();
});

test('写入失败保留输入', async ({ page }) => {
  await row(page, '给父母拍一组旧照片').click();
  await detail(page).getByRole('button', { name: '编辑' }).click();
  await detail(page).getByRole('textbox', { name: '正文' }).fill('这次保存会失败');
  await page.route('**/api/v1/ideas/**', async (route) => {
    if (route.request().method() !== 'PATCH') return route.continue();
    await route.fulfill({ status: 500, json: { ok: false, code: 'internal', message: '服务内部错误' } });
  });
  await detail(page).getByRole('button', { name: '保存' }).click();
  await expect(detail(page).getByRole('alert').filter({ hasText: '服务内部错误' })).toBeVisible();
  await expect(detail(page).getByRole('textbox', { name: '正文' })).toHaveValue('这次保存会失败');
  await expect(detail(page).getByLabel('未保存')).toBeVisible();
});

test('同一个 requestId 重试不会产生第二条', async ({ page }) => {
  const bodies: string[] = [];
  await page.route('**/api/v1/ideas', async (route) => {
    if (route.request().method() !== 'POST') return route.continue();
    const raw = route.request().postData() ?? '';
    bodies.push(raw);
    if (bodies.length === 1) {
      await route.fulfill({ status: 500, json: { ok: false, code: 'internal', message: '服务内部错误' } });
      return;
    }
    await route.continue();
  });
  await openCapture(page);
  await capture(page).getByRole('textbox', { name: '标题' }).fill('重试不应重复');
  await capture(page).getByRole('button', { name: '记下' }).click();
  await expect(capture(page).getByRole('alert')).toHaveText('服务内部错误');
  await expect(capture(page).getByRole('textbox', { name: '标题' })).toHaveValue('重试不应重复');
  await capture(page).getByRole('button', { name: '记下' }).click();
  await expect(page.getByRole('status')).toHaveText('已记下');
  expect(bodies).toHaveLength(2);
  const first = JSON.parse(bodies[0] ?? '{}') as { requestId?: string };
  const second = JSON.parse(bodies[1] ?? '{}') as { requestId?: string };
  expect(first.requestId).toBeTruthy();
  expect(second.requestId).toBe(first.requestId);
  await expect(rows(page).filter({ hasText: '重试不应重复' })).toHaveCount(1);
});

async function caretAtEnd(body: ReturnType<Page['getByRole']>): Promise<boolean> {
  return body.evaluate((node) => {
    const field = node as HTMLTextAreaElement;
    return field.selectionStart === field.value.length && field.selectionEnd === field.value.length && field.value.length > 0;
  });
}

async function saveHidden(page: Page, title: string): Promise<void> {
  await page.getByRole('button', { name: '＋ 记一条' }).click();
  await expect(capture(page).getByRole('textbox', { name: '正文' })).toBeFocused();
  await capture(page).getByRole('textbox', { name: '标题' }).fill(title);
  await page.keyboard.press('ControlOrMeta+Enter');
  await expect(page.getByRole('status')).toContainText('已记下（当前筛选下不显示）');
  await expect(page.getByRole('status').getByRole('button', { name: '清除筛选' })).toBeVisible();
  await expect(detail(page).getByRole('heading', { level: 2 })).toHaveText(title);
  await expect(row(page, title)).toHaveCount(0);
}

test('编辑时光标在正文末尾；收藏、分类、日期筛选下新灵感提示清除筛选', async ({ page }) => {
  await row(page, '学一点基础的色彩理论').click();
  await page.keyboard.press('e');
  const body = detail(page).getByRole('textbox', { name: '正文' });
  await expect(body).toBeFocused();
  expect(await caretAtEnd(body)).toBe(true);
  await page.keyboard.press('Escape');
  await expect(detail(page).getByRole('textbox', { name: '正文' })).toHaveCount(0);
  await detail(page).getByRole('button', { name: '编辑' }).click();
  await expect(body).toBeFocused();
  expect(await caretAtEnd(body)).toBe(true);
  await page.keyboard.press('Escape');

  await page.getByRole('toolbar', { name: '筛选' }).getByRole('button', { name: '★ 收藏' }).click();
  await saveHidden(page, '收藏筛选下的新灵感');
  await page.getByRole('status').getByRole('button', { name: '清除筛选' }).click();
  await expect(row(page, '收藏筛选下的新灵感')).toBeVisible();

  await page.getByRole('toolbar', { name: '筛选' }).getByRole('button', { name: '生活随想' }).click();
  await saveHidden(page, '分类筛选下的新灵感');
  await page.getByRole('status').getByRole('button', { name: '清除筛选' }).click();
  await expect(row(page, '分类筛选下的新灵感')).toBeVisible();

  await page.getByRole('button', { name: '统计', exact: true }).click();
  await page.locator('[data-columns] button[data-count="0"]').first().click();
  await expect(page.locator('[data-date-chip]')).toBeVisible();
  await saveHidden(page, '日期筛选下的新灵感');
  await page.getByRole('status').getByRole('button', { name: '清除筛选' }).click();
  await expect(page.locator('[data-date-chip]')).toHaveCount(0);
  await expect(row(page, '日期筛选下的新灵感')).toBeVisible();
});
