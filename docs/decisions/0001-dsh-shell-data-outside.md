# ADR 0001：dsh Desktop 作为唯一外壳，数据与业务规则放在 dsh 之外

- 状态：已采纳；扩展点已在 web 版验证（S1），Desktop App 内待验证
- 日期：2026-10-10

## 背景

Desktop 既需要和 agent 对话，也需要灵感清单、发布台这类看板。如果对话用 dsh Desktop、看板用另一个网页，就会变成两个窗口、两套入口。

dsh 0.2.0-rc.2 的 Web 客户端由插件组成。插件包在 `package.json` 中声明 `dsh.client`，可以挂到以下位置（依据 `packages/client/` 下各包的 README）：

| 挂载点 | 效果 |
|---|---|
| `sidebar.panellist` 加主区 `main` keyed slot | 左侧栏多一个入口，点开后占满主区域 |
| `ctx.sidebarRightTabs` | 右栏新增一种 tab |
| `tool.call.toolview` | agent 调用某个工具后，对话里显示自定义卡片 |
| 右栏内置浏览器 | 加载本机 loopback 网页，作为兜底方案 |

dsh 处于开发者预览，这些 API 都标注为预稳定。

## 决定

1. dsh Desktop 是唯一的交互外壳。看板做成 dsh 插件面板，不另开窗口。
2. 数据正本和业务规则放在 Desktop 自己的 core 中，不写进 dsh 插件。面板上的按钮和 agent 的工具调用走同一套 core 和写入规则。
3. 面板页面写成普通 React 组件，通过一层很薄的 dsh 适配挂进去，沿用灵感台 `core/`、`ui/`、`adapters/`、`standalone/` 的分层。dsh 出现破坏性变更时只改适配层；必要时页面可以脱离 dsh 独立运行。
4. 能力层通过 CLI 和 MCP 暴露，dsh 之外的 agent（Claude Code、Codex）也能调用。

## 后果

- 好处：一个窗口；agent 可以替换；dsh 升级的影响限制在适配层。
- 代价：多一层适配代码；需要锁定 dsh 版本并承担升级验证成本。
- 未验证：`sidebar.panellist` 在随附的产品组合里没有任何示例面板。若 S1 验证失败，退回方案是把 Desktop 自己的网页放进右栏内置浏览器，或者另开独立窗口。

## 验证结果（2026-10-10，S1）

详见 [spikes/s1-panel](../../spikes/s1-panel/README.md)。

- 左侧栏面板在 web 版中可行：纯 JS 插件即可注册入口和主区页面，显示 workbench 冻结数据中的 29 条灵感，主题跟随宿主，控制台无报错。
- 数据通道：第三方插件不能新增 `ctx.remote` 命名空间。S1 改由宿主插件在 `ctx.webServer` 注册路由，面板 fetch 该路由。这条路由不经过 dsh 的 `/api` 鉴权，正式实现前要查清并复用 dsh 的鉴权机制。
- 尚未验证：在 Desktop App 内显示；TypeScript 构建产物；插件停用后的清理。
