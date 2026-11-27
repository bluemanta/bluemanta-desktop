/** P3 只读走查：所有数据来自虚构 fixture，日期由 global-setup 固定为 2026-11-21。 */
import { expect, test, type Page } from '@playwright/test';
import { app, noHorizontalScroll, VIEWPORTS } from './helpers.ts';

const enc = (path: string) => path.split('/').map(encodeURIComponent).join('/');
const detail = (page: Page) => page.getByRole('complementary', { name: '详情' });
const domainDetail = (page: Page) => page.getByTestId('personalos-domain-detail');
const today = (page: Page) => page.getByTestId('personalos-today');
const grid = (page: Page) => page.getByRole('listbox', { name: '领域列表' });
const domainCard = (page: Page, name: string) => grid(page).getByRole('option', { name: `领域：${name}`, exact: true });

async function openPersonalOs(page: Page, path = '/knowledge/today', search = ''): Promise<void> {
  // Token fragments are removed at startup; revisiting must create a new document.
  await page.goto('about:blank');
  await page.goto(`${app.url}${path}${search}#token=${app.token}`);
}

test.describe('PersonalOS 今天与领域', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test('入口、六个分段、侧栏到期计数与今天六组', async ({ page }) => {
    await openPersonalOs(page, '/ideas');
    const entry = page.getByRole('navigation', { name: '模块' }).getByRole('button', { name: '知识台', exact: true });
    await entry.click();
    await expect(page).toHaveURL(/\/knowledge\/today$/);
    await expect(entry).toContainText('3');
    const sections = page.getByRole('group', { name: '知识台页面' });
    await expect(sections.getByRole('button')).toHaveText(['今天', '领域', '资料', '接入', '动态', '搜索', '关于']);
    await expect(page.getByTestId('personalos-focus')).toContainText('社区图书交换');
    await expect(today(page)).toContainText('2026-11-21');
    const expected: Array<[string, number]> = [['已逾期', 2], ['今天到期', 1], ['未来 7 天', 2], ['等待中', 1], ['无日期', 3]];
    for (const [name, count] of expected) {
      await expect(today(page).getByRole('region', { name, exact: true }).getByRole('option')).toHaveCount(count);
    }
    await expect(today(page).getByText(/还有\s*2\s*条/)).toBeVisible();
    await expect(today(page).getByRole('region', { name: '已逾期', exact: true })).toContainText('秦遥');
    await expect(today(page).getByRole('region', { name: '等待中', exact: true }).getByText('等待：夏禾', { exact: true })).toHaveAttribute('title', '等了多久：未记录');
    await expect(today(page).getByRole('region', { name: '今天到期', exact: true })).toContainText('1w');
    const later = today(page).getByRole('region', { name: '更晚', exact: true });
    await expect(later.locator('summary')).toContainText('1');
    await later.locator('summary').click();
    await expect(later.getByRole('option')).toHaveCount(1);
    await expect(later).toContainText('1m');
    // 迭代 3 起每件未完成事项有一个「完成」复选框；点了只打开预览，不直接写入。
    await expect(today(page).getByRole('checkbox', { name: /^完成：/ })).toHaveCount(10);
    await expect(today(page)).toContainText('每天 07:30 自动分拣');
    await expect(today(page)).toContainText('书签的失败样品');
    await expect(today(page)).not.toContainText('完成安静时间观察记录');
  });

  test('点击事项保留今天页，右侧打开领域并定位来源行；J/K 与 Enter 可操作', async ({ page }) => {
    await openPersonalOs(page);
    const overdue = today(page).getByRole('region', { name: '已逾期', exact: true }).getByRole('option');
    await overdue.first().focus();
    await page.keyboard.press('j');
    await expect(overdue.nth(1)).toBeFocused();
    await page.keyboard.press('k');
    await expect(overdue.first()).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/knowledge\/today$/);
    await expect(domainDetail(page).getByRole('heading', { name: '工作', exact: true })).toBeVisible();
    const target = domainDetail(page).locator('[data-todo-id="领域/工作/状态.md:19"]');
    await expect(target).toBeInViewport();
    await expect(target).toHaveAttribute('data-flash', 'true');
    await page.keyboard.press('Escape');
    await expect(detail(page)).toHaveCount(0);
    await overdue.nth(1).click();
    await expect(domainDetail(page).locator('[data-todo-id="领域/工作/状态.md:20"]')).toBeInViewport();
  });

  test('领域网格按路由顺序展示，标注缺目录与未登记；H/L/J/K移动而Enter打开', async ({ page }) => {
    await openPersonalOs(page, '/knowledge/domains');
    const cards = grid(page).getByRole('option');
    await expect(cards).toHaveCount(10);
    await expect(cards.first()).toHaveAttribute('data-domain-id', '我');
    await expect(cards.last()).toHaveAttribute('data-domain-id', '园艺');
    await expect(domainCard(page, '财务')).toContainText('目录不存在');
    await expect(domainCard(page, '园艺')).toContainText('未登记');
    await expect(domainCard(page, '工作')).toContainText('2026-11-01');
    await domainCard(page, '我').focus();
    await page.keyboard.press('l');
    await expect(domainCard(page, '工作')).toBeFocused();
    await page.keyboard.press('h');
    await expect(domainCard(page, '我')).toBeFocused();
    await page.keyboard.press('j');
    await expect(domainCard(page, '我')).not.toBeFocused();
    await expect(grid(page).locator('[role="option"]:focus')).toHaveCount(1);
    await page.keyboard.press('k');
    await expect(domainCard(page, '我')).toBeFocused();
    await expect(detail(page)).toHaveCount(0);
    await page.keyboard.press('Enter');
    await expect(domainDetail(page).getByRole('heading', { name: '我', exact: true })).toBeVisible();
  });

  test('领域状态保留偏离模板的Markdown、挂接卡片和缺口高亮', async ({ page }) => {
    await openPersonalOs(page, `/knowledge/domains/${enc('工作')}`);
    const card = domainDetail(page);
    await expect(card.getByRole('tab')).toHaveText(['状态', '资料', '事项', '文件']);
    await expect(card.getByRole('heading', { name: '社区图书交换试点', exact: true })).toBeVisible();
    await expect(card.locator('strong').filter({ hasText: '雾灯便签' })).toHaveCount(1);
    await expect(card.locator('mark').filter({ hasText: '（推断）' }).first()).toBeVisible();
    await expect(card.locator('mark').filter({ hasText: '未核验' }).first()).toBeVisible();
    const mounts = card.getByTestId('personalos-mount');
    await expect(mounts).toHaveCount(2);
    await mounts.first().scrollIntoViewIfNeeded();
    await expect(mounts.first()).toContainText('社区试点记录簿');
    await expect(mounts.first()).toContainText('外部 · 只读');
    await expect(mounts.nth(1)).toContainText('书架反馈汇总');
    await expect(card.getByRole('heading', { name: '留给下一轮的问题', exact: true })).toHaveCount(1);
    await openPersonalOs(page, `/knowledge/domains/${enc('我')}`);
    await expect(domainDetail(page).locator('mark').filter({ hasText: '待补充' }).first()).toBeVisible();
  });

  test('资料、事项、知识、文件页签按领域存在情况显示并可打开阅读器', async ({ page }) => {
    await openPersonalOs(page, `/knowledge/domains/${enc('工作')}`);
    await domainDetail(page).getByRole('tab', { name: '资料', exact: true }).click();
    await expect(domainDetail(page)).toContainText('书架布局草稿');
    await expect(domainDetail(page)).toContainText('待核对');
    await domainDetail(page).getByRole('tab', { name: '事项', exact: true }).click();
    await expect(domainDetail(page)).toContainText('交换书架');
    await domainDetail(page).getByRole('button', { name: /访谈方案/ }).click();
    await expect(page.getByTestId('personalos-reader')).toContainText('请参与者讲述上一次寻找一本书');
    await expect(page).toHaveURL(/\/knowledge\/pos\/file\//);
    await expect(page.getByTestId('personalos-reader').getByRole('navigation', { name: '位置' })).toContainText('PersonalOS');

    await openPersonalOs(page, `/knowledge/domains/${enc('技术')}`);
    await expect(domainDetail(page).getByRole('tab')).toHaveText(['状态', '资料', '知识', '文件']);
    await domainDetail(page).getByRole('tab', { name: '知识', exact: true }).click();
    await domainDetail(page).getByRole('button', { name: /知识\.md/ }).click();
    await expect(page.getByTestId('personalos-reader')).toContainText('先写一个最小输入样例');

    await openPersonalOs(page, `/knowledge/domains/${enc('家庭')}`);
    await expect(domainDetail(page).getByRole('tab')).toHaveText(['状态', '资料', '文件']);
    await domainDetail(page).getByRole('tab', { name: '资料', exact: true }).click();
    await expect(domainDetail(page)).toContainText('这个领域还没有资料登记');
    await domainDetail(page).getByRole('tab', { name: '文件', exact: true }).click();
    await domainDetail(page).getByRole('button', { name: /状态\.md/ }).click();
    await expect(page.getByTestId('personalos-reader')).toContainText('计划安排一次不赶时间的周末散步');
  });

  test('相对状态链接打开对应领域，普通Markdown链接打开阅读器，锚点留在当前领域', async ({ page }) => {
    await openPersonalOs(page, `/knowledge/domains/${enc('工作')}`);
    await domainDetail(page).getByRole('link', { name: '写作状态', exact: true }).click();
    await expect(domainDetail(page).getByRole('heading', { name: '写作', exact: true })).toBeVisible();
    await domainDetail(page).getByRole('link', { name: '工作记录', exact: true }).click();
    await expect(domainDetail(page).getByRole('heading', { name: '工作', exact: true })).toBeVisible();
    const path = new URL(page.url()).pathname;
    await domainDetail(page).getByRole('link', { name: '返回试点现状', exact: true }).click();
    await expect(domainDetail(page).getByRole('heading', { name: '现状', exact: true })).toBeInViewport();
    expect(new URL(page.url()).pathname).toBe(path);
    await domainDetail(page).getByRole('link', { name: '访谈方案', exact: true }).click();
    await expect(page.getByTestId('personalos-reader')).toContainText('访谈方案');
    await expect(page).toHaveURL(/\/knowledge\/pos\/file\//);
  });

  test('暂无与待补充保持空节说明，文件中的iCloud占位明确提示尚未下载', async ({ page }) => {
    await openPersonalOs(page, `/knowledge/domains/${enc('健康')}`);
    await expect(domainDetail(page).getByText('暂无', { exact: true })).toBeVisible();
    await openPersonalOs(page, `/knowledge/domains/${enc('生活事务')}`);
    await expect(domainDetail(page).getByText('待补充', { exact: true })).toBeVisible();
    await openPersonalOs(page, `/knowledge/pos/file/${enc('领域/工作/待下载资料.md')}`);
    await expect(page.getByTestId('personalos-reader')).toContainText('尚未从 iCloud 下载');
  });

  test('关于PersonalOS的入口、协议与蓝图可以在阅读器打开', async ({ page }) => {
    await openPersonalOs(page, '/knowledge/domains');
    await page.getByRole('button', { name: '入口说明', exact: true }).click();
    await expect(page.getByTestId('personalos-reader')).toContainText('林舟的个人记录');
    await openPersonalOs(page, `/knowledge/pos/file/${enc('协议/阅读.md')}`);
    await expect(page.getByTestId('personalos-reader')).toContainText('先读入口的领域路由');
    await openPersonalOs(page, `/knowledge/pos/file/${enc('蓝图/目录说明.md')}`);
    await expect(page.getByTestId('personalos-reader')).toContainText('新目录出现后');
  });

  test('缺库以说明呈现，接口错误持续可见', async ({ page }) => {
    await page.route('**/api/v1/personalos', (route) => route.fulfill({ json: { ok: true, root: '~/Documents/PersonalOS', exists: false, today: '2026-11-21', about: '', focus: [], domains: [], inbox: 0, warnings: [], documents: [] } }));
    await page.route('**/api/v1/personalos/today', (route) => route.fulfill({ status: 404, json: { ok: false, code: 'library_missing', message: '没有找到 PersonalOS' } }));
    await openPersonalOs(page);
    await expect(page.getByRole('heading', { name: '没有找到 PersonalOS', exact: true })).toBeVisible();
    await expect(page.getByText('~/Documents/PersonalOS', { exact: false })).toBeVisible();
    await expect(page.getByText(/BLUEMANTA_KNOWLEDGE_HOME/)).toBeVisible();
    await page.unroute('**/api/v1/personalos');
    await page.unroute('**/api/v1/personalos/today');
    await page.route('**/api/v1/personalos', (route) => route.fulfill({ status: 500, json: { ok: false, code: 'read_error', message: 'PersonalOS 读取失败，请重试' } }));
    await page.reload();
    await expect(page.getByRole('alert').first()).toBeVisible();
    await expect(page.getByRole('alert').first()).toContainText('读取失败');
  });

  for (const path of ['/knowledge', '/knowledge/lib/personal', `/knowledge/lib/personal/topic/${enc('旧主题')}`, '/knowledge/inbox', `/knowledge/inbox/file/${enc('旧文件.md')}`]) {
    test(`旧路径重定向：${path}`, async ({ page }) => {
      await openPersonalOs(page, path);
      await expect(page).toHaveURL(/\/knowledge\/today$/);
      await expect(today(page).getByRole('region', { name: '已逾期', exact: true })).toBeVisible();
    });
  }

  test('main隐藏模块侧栏；sidebar只显示领域详情或阅读器，导航保留嵌入参数', async ({ page }) => {
    await openPersonalOs(page, '/knowledge/today', '?embed=main');
    await expect(today(page)).toBeVisible();
    await expect(page.getByRole('navigation', { name: '模块' })).toHaveCount(0);
    await page.getByRole('group', { name: '知识台页面' }).getByRole('button', { name: '领域', exact: true }).click();
    await expect(page).toHaveURL(/\/knowledge\/domains\?embed=main$/);
    await openPersonalOs(page, `/knowledge/domains/${enc('工作')}`, '?embed=sidebar');
    await expect(domainDetail(page)).toBeVisible();
    await expect(grid(page)).toHaveCount(0);
    await expect(today(page)).toHaveCount(0);
    await expect(page.getByRole('button', { name: /返回/ })).toHaveCount(0);
    await openPersonalOs(page, `/knowledge/pos/file/${enc('领域/技术/知识.md')}`, '?embed=sidebar');
    await expect(page.getByTestId('personalos-reader')).toContainText('纸面到脚本');
    await expect(grid(page)).toHaveCount(0);
    await expect(page.getByRole('navigation', { name: '模块' })).toHaveCount(0);
  });

  test('命令面板可以定位今天和领域，离开灵感台后N不会开启灵感记录', async ({ page }) => {
    await openPersonalOs(page);
    await page.keyboard.press('p');
    const palette = page.getByRole('dialog', { name: '命令面板' });
    await expect(palette.getByRole('option', { name: '知识台：今天', exact: true })).toBeVisible();
    await palette.getByRole('option', { name: '知识台：领域', exact: true }).click();
    await expect(grid(page)).toBeVisible();
    await page.keyboard.press('n');
    await expect(page.getByRole('form', { name: '快速记录' })).toHaveCount(0);
  });
});

for (const viewport of VIEWPORTS) {
  test(`PersonalOS四档宽度无横向溢出 ${viewport.width}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await openPersonalOs(page);
    await expect(today(page)).toBeVisible();
    await noHorizontalScroll(page);
    await openPersonalOs(page, '/knowledge/domains');
    await expect(grid(page)).toBeVisible();
    await noHorizontalScroll(page);
    await domainCard(page, '工作').click();
    await expect(domainDetail(page)).toBeVisible();
    await noHorizontalScroll(page);
    if (viewport.width < 1024) {
      await page.getByRole('button', { name: /返回/ }).click();
      await expect(domainDetail(page)).toHaveCount(0);
      await expect(grid(page)).toBeVisible();
    }
  });
}
