import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { WEB_ROOT } from '../scripts/sandbox.ts';
import { app, noHorizontalScroll } from './helpers.ts';

/** 接入页（ADR 0013，规格 personalos-sources 第 5、7 节）：虚构库见 knowledge/fixtures/sources。 */
const open = async (page: Page, path: string) => {
  await page.goto('about:blank');
  await page.goto(`${process.env.BM_E2E_SOURCES_URL}${path}#token=${process.env.BM_E2E_SOURCES_TOKEN}`);
};
const card = (page: Page, name: string) => page.getByTestId('personalos-source').and(page.locator(`[data-source="${name}"]`));

test('今天页提醒行：计数和点击进入只看异常', async ({ page }) => {
  await open(page, '/knowledge/today');
  const alert = page.getByTestId('sources-alert');
  await expect(alert).toContainText('1 个任务失败 · 1 个来源过期');
  await alert.click();
  await expect(page).toHaveURL(/\/knowledge\/sources\?issues=1/);
  await expect(page.getByRole('button', { name: '只看异常' })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('sources-count')).toHaveText('3 个来源');
  await expect(card(page, '示例聊天')).toHaveCount(0);
  await expect(card(page, '示例书签')).toContainText('探针不存在');
});

test('没有登记表、没有异常时不显示提醒，接入页给出说明', async ({ page }) => {
  await page.goto(`${app.url}/knowledge/today#token=${app.token}`);
  await expect(page.getByTestId('personalos-summary')).toBeVisible();
  await expect(page.getByTestId('sources-alert')).toHaveCount(0);
  await page.goto(`${app.url}/knowledge/sources#token=${app.token}`);
  await expect(page.getByTestId('sources-registry-missing')).toContainText('我/数据源.md');
});

test('来源段：卡片、新鲜度、筛选和跳到刷新任务', async ({ page }) => {
  await open(page, '/knowledge/sources');
  await expect(page.getByRole('group', { name: '知识台页面' }).getByRole('button', { name: '接入' })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('sources-count')).toHaveText('5 个来源');
  const chat = card(page, '示例聊天');
  await expect(chat.getByTestId('source-freshness')).toContainText(/最后同步 今天 \d{2}:\d{2}/);
  await expect(chat.getByRole('img', { name: '正常', exact: true })).toBeVisible();
  await expect(card(page, '示例笔记').getByRole('img', { name: '偏旧' })).toBeVisible();
  await expect(card(page, '示例推送')).toContainText('手动');
  await page.getByRole('group', { name: '方式' }).getByRole('button', { name: '查询' }).click();
  await expect(page.getByTestId('sources-count')).toHaveText('1 个来源');
  await page.getByRole('group', { name: '方式' }).getByRole('button', { name: '全部' }).click();
  await chat.getByRole('button', { name: /示例副本刷新/ }).click();
  await expect(page).toHaveURL(/\/knowledge\/sources\/tasks\/launchd%3Alocal\.example\.mirror-refresh$/);
  const detail = page.getByTestId('personalos-task-detail');
  await expect(detail).toContainText('每小时第 5 分');
  await expect(detail.getByTestId('task-log')).toContainText('资源告警');
  await expect(detail).toContainText('--token=•••');
  await page.keyboard.press('Escape');
  await expect(page).toHaveURL(/\/knowledge\/sources\/tasks$/);
  await expect(page.getByTestId('personalos-task-detail')).toHaveCount(0);
});

test('定时任务段：排序、常驻服务、未登记折叠、日志不可显示、登记行', async ({ page }) => {
  await open(page, '/knowledge/sources/tasks');
  const rows = page.getByRole('listbox', { name: '定时任务' }).getByTestId('personalos-task');
  await expect(rows).toHaveCount(11);
  await expect(rows.first()).toHaveAttribute('data-state', 'signaled');
  await expect(rows.first()).toContainText('被信号 9 终止');
  await expect(page.getByRole('listbox', { name: '常驻服务' })).toContainText('运行中');
  const unregistered = page.getByTestId('unregistered-tasks');
  await expect(unregistered).not.toHaveAttribute('open', '');
  await unregistered.locator('summary').click();
  await expect(unregistered.getByTestId('personalos-task')).toHaveCount(4);
  await unregistered.locator('[data-task="launchd:com.apple.example-checkin"]').click();
  const detail = page.getByTestId('personalos-task-detail');
  await expect(detail).toContainText('失败（退出码 1）');
  await expect(detail.getByTestId('task-snippet')).toContainText('`launchd:com.apple.example-checkin`');
  await rows.first().click();
  await expect(detail).toContainText('日志可能含账号信息');
  await expect(detail.getByTestId('task-log')).toHaveCount(0);
  // 关闭详情后焦点回到刚才打开的行（下一帧），再用 j 移到下一行。
  await page.keyboard.press('Escape');
  await expect(rows.first()).toBeFocused();
  await page.keyboard.press('j');
  await expect(rows.nth(1)).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('personalos-task-detail')).toBeVisible();
});

for (const width of [1440, 720]) for (const theme of ['light', 'dark'] as const) {
  test(`接入页截图 ${width} ${theme}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 }); await page.emulateMedia({ colorScheme: theme });
    const shot = async (name: string) => { await noHorizontalScroll(page); await page.screenshot({ path: join(WEB_ROOT, 'screenshots', `personalos-sources-${name}-${width}-${theme}.png`) }); };
    await open(page, '/knowledge/sources');
    await expect(page.getByTestId('sources-count')).toHaveText('5 个来源'); await shot('cards');
    await open(page, '/knowledge/sources/tasks/launchd%3Alocal.example.mirror-refresh');
    await expect(page.getByTestId('task-log')).toBeVisible(); await shot('task');
    await open(page, '/knowledge/today');
    await expect(page.getByTestId('sources-alert')).toBeVisible(); await shot('today');
  });
}
