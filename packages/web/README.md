# @bluemanta/web

bluemanta 工作台网页（阶段 1.5 先做灵感台）。构建产物是 `packages/web/dist` 下的静态文件，由本地服务（[`@bluemanta/server`](../server/README.md)）托管；网页只经同源的 `/api/v1` 接口读写数据，不读本机路径（[ADR 0005](../../docs/decisions/0005-web-app-dsh-entry.md)）。

视觉与交互以 [设计规范](../../docs/design/DESIGN.md) 为准，界面规格见 [idea-ui.md](../../docs/specs/idea-ui.md)。T13 做了灵感的写操作（快速记录、收藏、编辑、延展、回收站）。统计、命令面板和完整快捷键在 T14，dsh 嵌入在 T15。

## 技术选型

React + TypeScript + Vite；CSS Modules；TanStack Query；wouter；Radix Primitives（Tooltip、Dialog、AlertDialog，只用行为不用样式）。不用带默认样式的组件库，不用 Tailwind。

样式只用 `--bm-*` 变量：`src/styles/global.css` 直接 `@import '@design/tokens.css'`（Vite 别名指向仓库里的 `docs/design/`，不复制文件）。tokens 里还没有的尺寸暂放在 `src/styles/local.css`（`--bmw-*`），并入设计规范后改用 `--bm-*` 并删掉对应的行。不写十六进制颜色。

## 开发

```bash
npm ci
npm run dev:web            # 在仓库根目录运行
npm run dev:web -- --empty # 空库
```

`dev:web` 先构建 core、cli、server，然后：

1. 在 `packages/web/.dev-data/dev/`（已 gitignore，每次启动清空重建）生成虚构数据；
2. 在一个空闲端口（不是 4310）启动本地服务；
3. 启动 Vite 开发服务器，把 `/api` 代理到本地服务；
4. 打印带口令的地址 `http://127.0.0.1:<Vite 端口>/#token=…`，在浏览器打开即可。

不会读写真实数据目录。只想生成数据：`npm run seed -w @bluemanta/web`（写到 `.dev-data/seed/`，加 `-- --empty` 为空库，`-- --data-dir <空目录>` 写到指定的空目录）。

虚构数据（`scripts/seed.ts`）经 core 写入，覆盖设计规范第 10.2 条：正常、长标题（正文超过 80 字被截成兜底标题）、长正文、无原文、原文与正文相同、原文被正文包含、legacy 原文、五个分类、收藏、延展、1–4 张图片（脚本生成的小 png）、Grok Bot / 对话 agent / MCP / 灵感台 / 导入五种来源、今天到半年前的日期分布，以及一条在回收站里的。历史时间、legacy 原文和导入来源只能经 core 的导入命令写入，所以大部分记录走 `core.importer`；另有一条走 `core.card.create`。

## 构建

```bash
npm run build              # 根目录：构建全部包，网页输出到 packages/web/dist
npm run server             # 本地服务托管 dist
```

试用虚构数据时用临时目录：

```bash
npm run seed -w @bluemanta/web -- --data-dir /tmp/bluemanta-web-try
node packages/server/dist/cli.js start --data-dir /tmp/bluemanta-web-try --port 4399
node packages/server/dist/cli.js url --data-dir /tmp/bluemanta-web-try --port 4399
```

## 检查与测试

```bash
npm run check -w @bluemanta/web   # tsc：网页代码（tsconfig.json）与脚本、走查（tsconfig.tools.json）
npm test -w @bluemanta/web        # vitest：时间与分组、筛选、高亮、来源、标签、启动参数
```

## 走查与截图（Playwright）

```bash
npx playwright install chromium   # 首次
npm run build
npm run walkthrough               # 根目录；等于 npm run walkthrough -w @bluemanta/web
```

走查用构建产物：`e2e/global-setup.ts` 在 `.dev-data/` 下生成四份虚构库（只读完整、空库、写操作、截图），各起一个本地服务（空闲端口）托管 `dist`。写操作不碰只读库。

- `e2e/walkthrough.spec.ts`：口令写入并抹除、无口令与 401 说明页、分组与计数、骨架、筛选组合、搜索高亮与命中字段、多标签与超出 6 个、拖动详情宽度并刷新保持、带口令的图片与大图浏览、窄屏整页详情与返回、读取失败提示条（`page.route` 模拟 500）、窗口焦点刷新、空库与快速记录入口、侧栏三档、嵌入模式、`bm:ready` / `bm:theme`（模拟父窗口）、路由与回收站、四档宽度无横向滚动。
- `e2e/writes.spec.ts`：快速记录（纯文字、只有图片、全空提示、⌘↵、esc、粘贴图片）、收藏与 `S`、编辑保存、未保存确认（关标签、换页面、浏览器后退、窄屏返回、`beforeunload`）、409 与外部刷新不覆盖草稿、延展追加和删除、移入回收站与撤销、`Delete`/`⌫`、恢复、彻底删除确认与空回收站、500 保留输入、同一 `requestId` 重试不重复。
- `e2e/screenshots.spec.ts`：T12 的清单与详情，加上快速记录（含图片）、编辑态、未保存确认、版本冲突、回收站（有内容与空）、彻底删除确认、带撤销的轻提示。1440 浅色和深色、720 浅色。输出到 `packages/web/screenshots/`（已 gitignore），CI 作为 `web-screenshots` 产物上传。基线等用户认可正式页面后再登记。

## 目录

```
packages/web/
├── index.html
├── vite.config.ts            # @design 别名、开发代理（BLUEMANTA_API_TARGET）
├── src/
│   ├── main.tsx              # 读启动参数（口令、父窗口 origin、embed），挂载 App
│   ├── app/                  # App 与路由、启动参数、视口三档、站内跳转、深浅色与消息桥
│   ├── api/                  # 带口令的请求、错误、TanStack Query 钩子、写入与缓存更新
│   ├── shell/                # 侧栏、页头、外壳布局、需要重新打开、占位页
│   ├── ideas/                # 灵感台：清单、筛选、快速记录、编辑、回收站、快捷键
│   │   ├── model/            # 纯逻辑（分组、草稿、标签），有单元测试
│   │   ├── capture/          # 快速记录
│   │   ├── images/           # 图片槽与上传
│   │   └── detail/           # 详情面板、编辑、大图浏览、拖动条
│   ├── ui/                   # 通用组件：按钮、图标、提示、带口令的图片、提示条、空状态、轻提示
│   └── styles/               # global.css（引入 tokens.css）、local.css（待并入规范的局部常量）
├── scripts/                  # 虚构数据种子、dev:web、沙盒目录与空闲端口
└── e2e/                      # Playwright 配置、全局启动、走查与截图
```

## 约定

- 口令：`#token=…` 读到后存 `localStorage`（`bluemanta.token`）并用 `history.replaceState` 抹掉；请求带 `Authorization: Bearer`。没有口令或收到 401 时整页显示「需要重新打开」。
- 图片：接口要口令，`<img src>` 带不上请求头，统一用 `ui/AuthImage`（fetch → blob URL，卸载时释放）。
- 嵌入：`?embed=main|sidebar` 隐藏侧栏，站内跳转保留这个参数；`#parent=<origin>` 指定父窗口，只和它收发消息（`bm:ready`、`bm:theme { dark }`），没指定时不收不发。
- 宽度档：≥1280 宽屏、1024–1279 中屏（52px 图标栏、隐藏来源）、<1024 窄屏（无侧栏、整页详情）。CSS 媒体查询不能用变量，断点数值写在对应的 `.module.css` 里。
- 详情宽度偏好存 `localStorage`（`bluemanta.detailWidth`），标签只在内存里。
