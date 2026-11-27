# ADR 0016：「工作台」直接嵌入 SalesOS Console（3001）

- 状态：已采纳（2026-11-28 Chris 选择「只嵌入 3001」）
- 日期：2026-11-28
- 补充：[ADR 0005](0005-web-app-dsh-entry.md)（核心界面做成独立网页，dsh 只放入口与嵌入框）
- 说明书：[tasks/workbench-embed.md](../tasks/workbench-embed.md)
- 背景方案：salesos-console 仓库 `docs/architecture/20261127-dsh-workbench/plan.md`（第 4.5 节为可行性核验）

## 背景

- Chris 想在 dsh Desktop 里用 SalesOS Console，作为左侧栏的「工作台」。
- 考虑过把 Console 的页面在本仓库重写（四段方案，约 3–4 周）。Chris 选择只嵌入：Console 继续在自己的仓库开发，部署在 `127.0.0.1:3001`，哪天不用 dsh 了，浏览器里照常能用。
- 核验结果（2026-11-27）：3001 的主页面没有禁止被嵌入；Console 的写入和 Agent 面板只校验同源，iframe 里的页面请求自己的接口仍是同源；S3 已在 Desktop 里嵌入过 `127.0.0.1` 上的跨源本地网页。

## 决定

1. **工作台是 Console 本身，不在本仓库重写。** 左侧栏加「工作台」入口，主区放一个铺满的 iframe，地址默认 `http://127.0.0.1:3001/dashboard`。
2. **插件不管 3001 的启停。** 3001 由 Console 的部署工具管理（`npm run instance -- prod …`）。插件只在打开时检查它是否在线；不在线时显示原因和「重试」，不尝试拉起。这是 ADR 0005「本地服务没在跑时临时拉起」的例外。
3. **地址只认本机。** 可用环境变量 `BLUEMANTA_CONSOLE_URL` 改地址，例如验收时指向合成数据的 3002。只接受 `http://127.0.0.1`、`localhost`、`[::1]` 且带端口的地址，其他一律拒绝并说明原因。
4. **不接消息桥。** Console 不认 `bm:*` 消息。插件不给这个框发主题和红绿灯避让，也不处理它发来的消息。框仍带 `data-html-preview` 和独立的 `name`，让 Desktop 快捷键归 dsh（S5）。
5. **业务规则全部留在 Console。** 写入仍走 Console 的「预览 → 一次人工确认 → apply → 核验」。本仓库不读 Console 的数据，不加 agent 工具，不加右侧栏 tab。
6. **由 Codex 实现，Claude Code 验收。** 这是 [ADR 0017](0017-codex-local-dispatch.md) 本地派发的第一单。

## 不做

- 不做深色主题（Console 只有浅色）。
- 不处理 Console 内 `/review`（`SAMEORIGIN`）和 `/embedded-agent`（`DENY`）这两个禁止嵌入的页面，它们要在浏览器里打开。
- 不把 dsh agent 接进 Console 的数据。日后需要时另开 ADR，并经过 Console 的公共契约。

## 待验收时确认

- macOS 左上角红绿灯在侧栏收起时是否挡住 Console 页头。挡住的话，在 Console 仓库改，不在插件里给框加偏移。
- 框里点 `target="_blank"` 的链接，Desktop 是否正常打开新窗口。

## 后果

- 好处：工作量 1–2 天；对 dsh 的依赖最小；Console 的迭代不用同步到本仓库。
- 代价：工作台和 dsh 的 agent 不互通；深色模式下是一块浅色页面；Console 自身「设计复杂、用得少」的问题仍要在 Console 仓库解决。
