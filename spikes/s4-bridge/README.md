# S4 技术验证：在对话中引用、快捷键

- 日期：2026-10-11
- 执行：Claude Code
- dsh 版本：0.2.0-rc.2（web 版，隔离 `DSH_HOME`）
- 结论：**「在对话中引用」可行**；快捷键在 web 版和 Desktop 中行为不同，**Desktop 的 ⌘K 与网页命令面板冲突**，需在 T15 验收时于 Desktop 实测后定处理方式。

## 1. 在对话中引用

### 做法

网页发 `bm:quote { id, title }` → dsh 插件：

1. 从 `ctx.sidebarRight.mounted.getSnapshot()` 取屏幕上的会话 id；没有会话（主区是灵感台等全局页面）时回 `{ ok: false, reason: '当前不在对话里' }`。
2. `ctx.sessions.scope(sessionId)` 得到会话作用域 `actx`，`actx.get('conversation').input.for(actx)` 得到该会话的输入框（`SessionInput`）。写法与 dsh 自己的 `ui-conversation/src/client/queue/QueueDock.tsx` 相同。
3. 读 `input.state.getSnapshot().draft`，把引用文字追加在末尾（前面补一个空格）后 `input.setDraft(…)`，再 `input.focus()` 把键盘还给输入框。
4. 回 `bm:result { ok: true }`。

插件需要 `inject: ['sessions', 'sidebarRight', …]`，`dsh.client.inject` 加 `@deepseek-ai/dsh-client-ui-conversation`。不 import dsh 客户端包。

引用文字（S4 用的格式）：`【灵感】<标题>（bluemanta 灵感 id：<id>）`。agent 看到 id 后可以用 `bluemanta_idea_get` 读全文。

### 验收记录（web 版）

| # | 检查项 | 结果 |
|---|---|---|
| 1 | 输入框已有文字「请看这条灵感」时插入，原文保留，引用追加在后面 | verified |
| 2 | 插入后焦点回到输入框 | verified |
| 3 | 右侧栏 iframe 里点按钮 → `bm:quote` → 插入 → iframe 收到 `bm:result ok` | verified |
| 4 | 主区切到全局页面（插件页）时回「当前不在对话里」，不报错 | verified |
| 5 | 控制台无错误 | verified（先刷新后采集） |
| 6 | Desktop 中同样可用 | not-run（T15 验收时测） |

### 已知限制

- 用 `setDraft` 整段替换草稿，会把输入框里已有的行内引用 chip（`@文件`、`@会话`）展开成纯文本形式。光标位置插入的 `insertText(text, captureInsertion())` 只在输入框自己的 slot 组件里拿得到（`InputActions`），插件外部拿不到。阶段 1.5 接受这个限制；若用户在意，以后改为注册一个 `@灵感` 引用来源（`ui-input-trigger`），让用户在输入框里用 `@` 选灵感。
- 引用是纯文本，不是 dsh 的原子引用 chip。

## 2. 快捷键

### dsh 0.2.0-rc.2 默认键位（与灵感台相关的部分）

| 命令 | Desktop（macOS） | web 版（macOS） |
|---|---|---|
| 新建会话 | ⌘N | ⌥⌘N |
| **搜索会话** | **⌘K** | ⌥⌘K |
| 添加工作区 | ⌘O | ⌥⌘O |
| 左侧栏开合 | ⌘B | — |
| 右侧栏开合 | ⌥⌘B | ⇧⌘B |
| 关闭 / 刷新右栏页 | ⌘W / ⌘R | — |
| 文件、浏览器、快捷键速查、设置 | ⌘P、⌘T、⌘/、⌘, | — |

来源：`packages/client/ui-workspace/src/client/shortcuts.ts`、`ui-sidebar-right/src/client/shortcuts.ts`、`ui-layout`、`ui-sidebar-files`、`ui-sidebar-browser`、`ui-shortcuts`、`ui-settings-general`。

### 与灵感台的关系

- 灵感台的单字母键（N、/、J、K、S、E、⌫）和 ⌘↵、esc 与 dsh 不冲突。
- **⌘K 冲突**：设计规范把命令面板定在 ⌘K，dsh Desktop 用 ⌘K 搜索会话。
- **web 版**：焦点在跨源 iframe 里时，dsh 的 DOM 快捷键收不到按键，dsh 快捷键全部不生效；网页自己的 ⌘K 正常。
- **Desktop**：dsh 文档（`packages/client/shortcuts/README.zh.md`）写明 macOS / Windows 的可配置命令由原生输入在页面处理前拦截，并会匹配获焦的 iframe。预计焦点在网页里时 ⌘K 等仍由 dsh 执行，网页的 ⌘K 收不到。**未实测**。

### 给 T15 的建议

1. 不做快捷键转发（`bm:shortcut`）：用户主要用 Desktop，Desktop 由原生层分发，不需要转发；web 版 dsh 只用于开发验收。
2. T15 验收时在 Desktop 实测：焦点在网页里按 ⌘K、⌘N、⌘B、⌘W，记录由谁执行。
3. 若 Desktop 中 ⌘K 被 dsh 拿走：嵌入模式下命令面板改用页头按钮打开，并在命令面板入口显示嵌入时可用的键（候选 ⇧⌘K，届时确认不与 dsh 冲突）；独立打开时仍用 ⌘K。这是交互变化，届时作为选择题问用户。

## 复现

```bash
cd spikes/s4-bridge
export DSH_HOME="$PWD/.dsh-home" DSH_TELEMETRY_DISABLED=1
dsh --profile s4 --from-default-profile web --dump-config > /dev/null
dsh plugin --profile s4 add ./plugin
dsh --profile s4 --port 3095 --no-open
```

也可以用 `.claude/launch.json` 的 `spike-s4-bridge` 配置启动（用 `~/Developer/bm-t7/.dsh-dev/cli` 里装好的 dsh 0.2.0-rc.2）。右侧栏开始页选「S4 引用」，点框里的按钮；或在控制台调用 `window.__bmS4.quote({ id, title })`。
