# 任务：左侧栏「工作台」嵌入 SalesOS Console

- 负责实现：Codex（本机派发，[ADR 0017](../decisions/0017-codex-local-dispatch.md)）
- 负责验收：Claude Code
- 关联：[ADR 0016](../decisions/0016-workbench-embeds-salesos-console.md)
- 分支 / worktree：`claude/workbench-embed` / `~/Developer/bm-workbench`

## 背景

Chris 要在 dsh Desktop 左侧栏点「工作台」，主区直接显示本机运行的 SalesOS Console（默认 `http://127.0.0.1:3001/dashboard`）。Console 是另一个仓库的独立应用，自己管启停和业务规则；本任务只做入口和嵌入框。

## 范围

要做：

1. 左侧栏新增入口「工作台」，排在知识台之后。
2. 点开后主区显示一个铺满的 iframe，加载 Console 地址。
3. 打开前由插件服务端检查 Console 是否在线：在线就加载；不在线、地址不合法时显示原因和「重试」按钮。
4. 地址可用环境变量 `BLUEMANTA_CONSOLE_URL` 覆盖，只接受本机地址。
5. `dsh:smoke` 增加工作台一项：用一个临时的虚构 Console 页面验证入口和框能加载，不碰真实 3001。

不做：

- 不启动、停止或重启 Console，也不调用它的部署命令。
- 不给这个框发 `bm:theme`、`bm:chrome`，不把它加入消息桥的 `frames`，不处理它发来的消息。
- 不加右侧栏 tab，不加 agent 工具或工具卡片。
- 不改 `packages/web`、`packages/server`、`packages/core`、`packages/knowledge`、`packages/cli`、`packages/mcp`、`packages/importer`、`packages/skills`。
- 不改 salesos-console 仓库。

## 必读

- [AGENTS.md](../../AGENTS.md)（硬规则 5–7）
- [ADR 0005](../decisions/0005-web-app-dsh-entry.md)、[ADR 0016](../decisions/0016-workbench-embeds-salesos-console.md)
- `packages/dsh-plugin/README.md`
- 照着写的现有代码：`packages/dsh-plugin/src/knowledge-sidebar.js` 与 `.d.ts`（纯函数单独成文件，`client.js` 内嵌同一份文本，测试核对）；`client.js` 里的 `WebFrame`、`useWebConfig`、`KnowledgeMainPage` 和 `apply` 中的 `sidebar.panellist` 注册；`src/index.ts` 里 `WEB_CONFIG_PATH` 路由的注册方式；`src/local-server.ts` 的 `probeHealth`（超时写法）
- 测试写法：`test/knowledge-sidebar.test.ts`、`test/client-smoke.test.ts`、`test/html-preview-frame.test.ts`、`test/dsh-smoke-plan.test.ts`
- dsh 槽位文档（只读）：`~/Developer/bluemanta-harness` 的 `ref/dsh-0.2.2-rc.1` 分支 `packages/client/ui-sidebar/README.zh.md`，可用 `git -C ~/Developer/bluemanta-harness show ref/dsh-0.2.2-rc.1:packages/client/ui-sidebar/README.zh.md` 读取

## 接口（已定死，不要改名）

客户端纯函数，新文件 `packages/dsh-plugin/src/workbench-frame.js` 与 `workbench-frame.d.ts`，`client.js` 内嵌同一份文本：

```js
export const WORKBENCH_PANEL_ID = 'bluemanta.workbench';
export const WORKBENCH_FRAME_NAME = 'bluemanta-workbench-main';
export const WORKBENCH_CONFIG_ROUTE = 'api/bluemanta/workbench-config';
/** 框的属性：data-html-preview 为空字符串，name 固定。 */
export function workbenchFrameAttrs() // → { 'data-html-preview': '', name: WORKBENCH_FRAME_NAME }
```

服务端，新文件 `packages/dsh-plugin/src/workbench-config.ts`：

```ts
export const DEFAULT_CONSOLE_URL = 'http://127.0.0.1:3001/dashboard';
export const WORKBENCH_CONFIG_PATH = 'api/bluemanta/workbench-config'; // 与客户端常量相同，测试核对
export const CONSOLE_PROBE_TIMEOUT_MS = 1500;
export type ConsoleUrlResult = { ok: true; url: string } | { ok: false; reason: string };
export type WorkbenchConfig = { ok: true; url: string } | { ok: false; url: string; reason: string };
/** raw 为空或只有空白时用默认地址。 */
export function resolveConsoleUrl(raw: string | undefined): ConsoleUrlResult;
/** 用 GET 请求 url，redirect: 'manual'，超时即视为不在线。状态码 < 500 视为在线。 */
export function probeConsole(url: string, fetchImpl?: typeof fetch, timeoutMs?: number): Promise<{ ok: true } | { ok: false; reason: string }>;
/** 先 resolve 再 probe；任何异常都转成 ok:false，不抛出。 */
export function loadWorkbenchConfig(env: NodeJS.ProcessEnv, fetchImpl?: typeof fetch): Promise<WorkbenchConfig>;
```

规则：

- `resolveConsoleUrl` 只接受 `http:` 协议；主机只能是 `127.0.0.1`、`localhost`、`[::1]`；必须写明端口；不能带用户名或密码。保留路径和查询串，去掉 `#` 之后的部分。不合格时 `reason` 写明原因，例如「工作台地址只能是本机地址：…」。
- 不在线时的 `reason`：`工作台没有在运行（<origin>）。请先启动 SalesOS Console，插件不会替你启动。`；超时、拒绝连接都用这句。状态码 ≥ 500 时写 `工作台返回 <状态码>（<origin>）`。
- `index.ts` 在现有 `bluemanta: core` effect 里注册 `WORKBENCH_CONFIG_PATH`（GET、`requestBody: 'buffered'`、`cache-control: no-store`），返回 `loadWorkbenchConfig(process.env)` 的 JSON，并随 effect 释放。`index.ts` 导出上述常量和函数。`ApplyOptions` 可加一个测试注入项 `consoleFetch?: typeof fetch`。

`client.js`：

- 注册 `main`（`key: WORKBENCH_PANEL_ID`）和 `sidebar.panellist`（`id: WORKBENCH_PANEL_ID`、`order: 12`、`label: '工作台'`），图标是 16px 线条 SVG，风格同 `IdeasIcon`。
- 新组件 `WorkbenchMainPage`：`fetch(WORKBENCH_CONFIG_ROUTE, { cache: 'no-store' })`。加载中显示「正在打开工作台…」；`ok:false` 时显示 `reason` 和「重试」按钮，样式照 `WebFrame` 的错误态；`ok:true` 时渲染 iframe：`src` 为返回的 `url`、`title: '工作台'`、`...workbenchFrameAttrs()`，样式同 `WebFrame` 的框。iframe 加载完成前保留「正在打开工作台…」。
- 不修改 `WebFrame`、`useWebConfig`、消息桥和灵感台、知识台的现有行为。

`dsh:smoke`：

- `smokeEnv` 删除继承的 `BLUEMANTA_CONSOLE_URL`，改为指向脚本起的虚构 Console：在空闲端口用 `node:http` 返回一页 HTML，页面里有 `<h1>虚构工作台</h1>`。这个端口也要在结束时关闭。
- `SMOKE_PANELS` 加一项：`label: '工作台'`、`frameName: WORKBENCH_FRAME_NAME`、`readyRole: 'heading'`、`readyName: '虚构工作台'`。
- `openPanel` 当前假设框指向本地服务端口（`assessFrame` 的参数），按需要给面板加一个期望的 origin 字段，不要放宽灵感台和知识台原有的判断。

## 一起改的同类

- `packages/dsh-plugin/README.md`：说明工作台入口、`BLUEMANTA_CONSOLE_URL`、插件不管 Console 启停。
- `packages/dsh-plugin/package.json` 的 `description` 加上工作台。

## 约束

- 允许修改的路径：`packages/dsh-plugin/**`（`dist/` 由构建生成，不手改）。
- 不允许碰：其他 packages、`AGENTS.md`、`docs/`（本说明书和 ADR 由 Claude Code 维护）、`~/.dsh`、`~/Developer/bluemanta-harness`、salesos-console 仓库、任何真实数据目录。
- 测试里不能访问真实的 `127.0.0.1:3001`：探测一律注入假的 `fetch`，或在测试里自己起临时 HTTP 服务。
- 不新增依赖。TypeScript strict，不用 `any`、`@ts-ignore`。
- 不提交、不推送、不运行 `npm install` / `npm ci`（依赖已装好）。

## 验收

Codex 自检（在报告中逐条写 `verified` / `failed` / `not-run`，附实际命令和结果摘要）：

1. `npm run build` 通过。
2. `npm run check` 通过。
3. `npm run test` 通过，新增测试至少覆盖：`resolveConsoleUrl` 的默认值、合法本机地址、非 http 协议、非本机主机、缺端口、带账号密码、去掉 hash；`probeConsole` 的在线、5xx、拒绝连接、超时；`loadWorkbenchConfig` 不抛异常；`client.js` 内嵌同一份 `workbench-frame.js`；`client-smoke` 中左侧栏有 `bluemanta.workbench / 工作台 / 12`；服务端与客户端路由常量一致；`smokeEnv` 不继承外部 `BLUEMANTA_CONSOLE_URL`。
4. `npm run dsh:smoke` 通过，输出包含工作台一项。沙箱里起不了浏览器或端口时写 `not-run` 并附错误，由 Claude Code 补跑。
5. `git status` 只显示允许路径内的改动。

Claude Code 另行验收：

6. 隔离 `DSH_HOME` 下运行 dsh，`BLUEMANTA_CONSOLE_URL` 指向合成数据的 3002：点「工作台」显示 Console 首页并截图；停掉 3002 后显示原因和「重试」，再启动后点「重试」恢复。
7. 焦点在工作台框里时 dsh 快捷键仍然有效；框里打开新窗口的链接时 Desktop 的表现；侧栏收起时红绿灯是否挡住 Console 页头。结果记入本说明书末尾。
8. 经 Chris 同意后，装进他的 Desktop，对 3001 做一次只读查看。

## 交付物

- Codex：工作区里的改动，以及最后一条消息形式的报告：改了哪些文件、偏离说明书之处及原因、验收 1–5 的结果、已知问题、需要 Claude Code 决定的问题。
- Claude Code：验收后提交到 `claude/workbench-embed`，推送并在 PR 中写验收结论（verified / failed / not-run）。

## 验收记录

2026-11-28，Claude Code。运行记录：`~/Developer/.codex-runs/202611271649-workbench-embed/`。

派发经过：
- 第一次运行 400：PATH 里的 npm 全局 codex 0.139.0 不认模型名。脚本改为优先用 ChatGPT 应用自带的 CLI（`49a3b0f`）。
- 第二次运行 Codex 在动手前停工：前置规则禁止读其他仓库，与本说明书「必读」冲突，属于说明书方的错误。规则已改为必读路径可以只读（`e4b929b`），续接同一会话后用 6.5 分钟完成。没有退回质量返工。

| 项 | 结果 | 依据 |
|---|---|---|
| 范围 | verified | 15 个文件，全部在 `packages/dsh-plugin/`；`git diff --check` 无问题 |
| 1. 构建 | verified | 沙箱外 `npm run build` 退出 0 |
| 2. 类型检查 | verified | `npm run check` 退出 0 |
| 3. 测试 | verified | `npm run test` 退出 0，插件包 99 项（原 73 项），全仓零失败。Codex 在沙箱里报 failed 的原因是不能监听端口、不能运行 `ps`，与代码无关 |
| 4. dsh:smoke | failed（环境） | 检查 1「插件没有被拒载」PASS。浏览器一步失败：Playwright 1.64 需要的 chromium_headless_shell-1248 本机没装，缓存里只有 1217，main 上同样会失败。下载浏览器属于改动用户环境，未做。浏览器部分改由第 6 项手动覆盖 |
| 6. 隔离 dsh + 3002 | verified | 用 smoke 留下的隔离 `DSH_HOME`，在 dsh web 模式（3093）里打开，`BLUEMANTA_CONSOLE_URL` 指向 3002 合成数据。主区显示 Console，框为 `name=bluemanta-workbench-main`、带 `data-html-preview`，`src=http://127.0.0.1:3002/dashboard`；框内切到「今天」，数据正常读取。停掉 3002 后重新打开，显示「工作台没有在运行（http://127.0.0.1:3002）…」和「重试」；启动 3002 后点「重试」恢复。灵感台、知识台照常加载 |
| 7. Desktop 专有行为 | 部分 verified | 2026-11-28 经 Chris 同意，在他的 Desktop 里临时把插件指向本 worktree 后实测（见第 8 项）。**红绿灯遮挡：确认会挡。** 左栏收起后，红绿灯和 dsh 浮在左上角的「打开侧边栏」「新建会话」两个按钮压在 Console 导航顶部的「SalesOS」标志上；标志只是首页链接，导航本身能用。按 ADR 0016，在 Console 仓库改。**新窗口链接：** not-run。Console 里只有文件预览中 Markdown 的外部链接带 `target="_blank"`，要找一份含外链的真实文件，没有做。**快捷键：** not-run，后台操作工具测不了焦点在框内时的 ⌘ 快捷键 |
| 8. 真实 3001 只读查看 | verified | Desktop「插件 → 添加插件」不允许同名插件直接换路径，先卸载 main 版、再装 worktree 版并启用。打开「工作台」，主区显示真实 3001（`/dashboard` 跳转到项目页，个人项目和关注队列正常读取）；在框内切到「任务」，23 项任务正常显示。只点了导航，没有点任何写入或确认按钮。框里的 Console 显示「连接团队账号」登录表单：Desktop 和浏览器的登录状态不共用，要看团队项目需在框里另外登录一次，没有代登录。看完后卸载 worktree 版、从 main 路径重装并启用，灵感台、知识台恢复，工作台入口消失。备份的 profile 文件在 `~/Developer/.codex-runs/desktop-install-backup-202611280748/`；恢复后 `package.json` 与备份只差 bundles 列表里本插件的位置（左栏里灵感台挪到了自动化任务下面） |

其他观察：
- 在 dsh web 模式里，刷新后第一次点左侧栏任一入口（知识台也一样）不会切换，要点第二次。这是宿主的行为，不是本任务引入的。
- 代码评审没有发现需要返工的问题。Codex 主动把 3001 加进 smoke 的保留端口，探测时只取响应头。

结论：可以合并。Desktop 实测后唯一的已知问题是左栏收起时红绿灯挡住 Console 的标志，在 Console 仓库处理，不阻塞本 PR。合并要 Chris 同意；合并后按 `docs/local-update.md` 退出并重开 Desktop 才会出现工作台。
