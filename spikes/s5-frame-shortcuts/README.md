# S5 技术验证：焦点在嵌入网页里时 Desktop 快捷键由谁执行

- 日期：2026-10-12
- 执行：Claude Code（读源码、写插件）；用户在自己的 Desktop 里临时安装并按键
- dsh 版本：0.2.0-rc.2（Desktop App）
- 结论：**给 iframe 加 `data-html-preview` 和非空 `name` 后，dsh 快捷键在框内正常执行**；不加时按键被 Desktop 原生层吞掉，dsh 和网页都收不到。⇧⌘K 在用户电脑上被别的 App 全局占用，不能当命令面板的备用键。

## 起因

阶段 1.5 收尾第 8 步在 Desktop 实测：焦点在灵感台网页里时，⌘K、⌘N、⌘B、⌘W 都没有反应，dsh 没执行，网页的 ⌘K 命令面板也没打开。单字母键（N、J、K）正常。

## 源码结论（锁定版本 `c1b47e41fc`）

1. `apps/desktop/src/keyboard.ts`：Desktop 在 `before-input-event` 里先拦下 dsh 已绑定的组合键（`event.preventDefault()`），网页收不到 keydown。来自子 frame 的按键以 `kind: 'iframe'` 发给渲染进程，带上顶层子 frame 的 `name`。
2. `apps/desktop/src/preload-app.ts` 与 `packages/client/shortcuts/src/client/native.ts`：只有当获焦元素是 `iframe[data-sidebar-browser-frame]` 或 `iframe[data-html-preview]`，且 `iframe.name` 等于发来的 `frameName`（非空）时，才交给命令注册表执行；否则直接丢弃。
3. `data-html-preview` 在 dsh 里只用于这两处匹配（另有 HTML 预览自己的 iframe 带它），没有样式或其他行为挂在上面。
4. 不带修饰键的单字母键 dsh 不拦，照常到网页。

## 做法

`plugin/` 是只有浏览器端的最小插件：左侧栏「S5 快捷键」，主区并排两个 `sandbox="allow-scripts"` 的 iframe（不透明 origin，等同跨源），框内列出自己收到的 keydown。

- 框 A：不带标记，等同当前灵感台。
- 框 B：`name="bluemanta-s5-b"` 和 `data-html-preview`。

先尝试用隔离 `DSH_HOME` + `--user-data-dir` 单独启动打包版 Desktop（隔离生效，没碰 `~/.dsh`），但新实例停在登录页，凭据不能由 agent 填写，改为经用户同意临时装进用户的 Desktop（「添加插件」填绝对路径），测完删除。

## 验收记录

| # | 检查项 | 结果 |
|---|---|---|
| 1 | 框 A 内按 ⌘B / ⌘K / ⌘N：dsh 不执行，框内也收不到 | verified（用户按键确认，与灵感台现象一致） |
| 2 | 框 B 内按 ⌘B（左栏开合）、⌘K（会话搜索）、⌘N（新会话）：dsh 正常执行 | verified（用户按键确认） |
| 3 | ⇧⌘K 能否到达网页（命令面板备用键候选） | failed：被用户电脑上别的 App 的全局快捷键拿走 |

## 对产品的含义

- T17：插件给主区和右侧栏的灵感台 iframe 加 `data-html-preview` 和稳定、非空、互不相同的 `name`。
- ⌘K 归 dsh（用户 2026-10-12 决定）。嵌入时命令面板改用页头按钮和单键 `P` 打开（用户决定）；独立浏览器里 ⌘K 不变。
- 依赖 dsh 的内部选择器 `data-html-preview`：升级 dsh 时要回归这一项。
