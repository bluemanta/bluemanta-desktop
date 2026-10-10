# S1 技术验证：dsh 左侧栏挂自定义面板

- 日期：2026-10-10
- 执行：Claude Code
- dsh 版本：0.2.0-rc.2（CLI；隔离 `DSH_HOME`，web profile）
- 结论：**web 版中可行（verified）**；Desktop App 内尚未验证（not-run）

## 要回答的问题

dsh Desktop 能否承载我们自己的看板（如灵感清单），让对话和看板在同一个窗口里？见 [ADR 0001](../../docs/decisions/0001-dsh-shell-data-outside.md)。

## 做法

一个纯 JS 组合包 `plugin/`，不需要构建：

| 文件 | 作用 |
|---|---|
| `package.json` | 声明 `dsh.bundle` 和 `dsh.client`（`platform: web`，`immediately: true`） |
| `cordis.patch.yml` | 插入宿主端插件行 |
| `index.js` | 宿主端：在 `ctx.webServer` 注册只读路由 `GET /bluemanta/s1/ideas`，读取 workbench 冻结数据，只返回标题、分类、星标、日期 |
| `client.js` | 浏览器端：在 `sidebar.panellist` 注册「灵感清单」入口，在 `main` 注册同 id 的页面，页面 fetch 上面的路由 |

写法参照 dsh 自带的 `cordis-plugin-development` skill（`packages/preset/agent-preset/skills/cordis-plugin-development/`）和 `ui-plugin-manager` 的面板注册方式。

## 复现

```bash
cd spikes/s1-panel
export DSH_HOME="$PWD/.dsh-home" DSH_TELEMETRY_DISABLED=1
dsh --profile s1 --from-default-profile web --dump-config > /dev/null
dsh plugin --profile s1 add ./plugin
dsh --profile s1 --port 3091 --no-open
```

用终端打印的带 `token` 的 URL 打开。也可以用仓库 `.claude/launch.json` 中的 `spike-s1-dsh-web` 配置启动。

## 验收记录

| # | 检查项 | 结果 | 证据 |
|---|---|---|---|
| 1 | 插件装进隔离 profile，配置层出现 | verified | `dsh --profile s1 --dump-config` 出现 `# == @bluemanta/spike-s1-panel` 层 |
| 2 | 左侧栏出现「灵感清单」入口 | verified | 截图：位于自带「插件」入口下方，带图标 |
| 3 | 点击后主区域显示面板，读到真实数据 | verified | 显示「29 条 · 来源：bluemanta-workbench（已冻结，只读）」，列表含星标、分类、日期 |
| 4 | 面板与对话来回切换 | verified | 点「新会话」回到对话，再点「灵感清单」回到面板 |
| 5 | 浅色 / 深色主题 | verified | 只用 `--dsw-alias-*` 主题变量，深色下自动跟随 |
| 6 | 控制台无报错（无 `slot entry crashed`） | verified | `read_console_messages` 无错误 |
| 7 | 路由只读 | verified | `POST` 返回 405；`store.json` 修改时间仍为 2026-10-09 09:45 |
| 8 | 路由拒绝非回环 Host 头 | verified | `Host: evil.example` 返回 403 |
| 9 | 在 Desktop App 内显示 | not-run | 需要用户授权把插件装进 Desktop 的 profile |
| 10 | 停用 / 卸载插件后面板消失 | not-run | |
| 11 | TypeScript 源码构建出的 client bundle 能加载 | not-run | 本次用纯 JS，未走构建链 |

## 发现

1. **第三方插件不能新增 remote 命名空间。** `ctx.remote` 的能力在 dsh 构建时固定（见 `packages/api/remotes/README.zh.md` 已知限制）。面板读取宿主数据，本次改用宿主插件在 `ctx.webServer` 上注册 HTTP 路由，可行。
2. **自定义路由不经过 dsh 的鉴权。** 不带令牌访问 `/api/` 返回 401，访问我们的路由返回 200。本次靠"只监听回环 + 校验 Host 头 + 只读 + 只返回摘要"兜底。正式实现前，必须查清 dsh 的 `/api` 鉴权机制并复用，写入操作尤其不能裸露。
3. **dsh 默认上传会话日志。** 使用 DeepSeek 官方 API 时，基础组合包的 `session-log-deepseek` 默认把规范会话日志随请求上传（`dsh_session_log` 字段），内容包括 agent 读到的文件和工具结果。可以在「设置 → 通用 → 在使用官方模型 API 时上传 Session Log」关闭。OTel 只在用户主动反馈时上传，`DSH_TELEMETRY_DISABLED` 可整体关闭。
4. **Desktop 的页面跑在 `dsh-app://app/`。** 文档说明 Electron 会把应用 HTTP 请求转发给已认证的 Host，所以相对路径的 fetch 应该可用，但要在 Desktop 里实测（检查项 9）。
5. **dsh 自带的插件开发 skill 质量很高**，规则包括：不要 import dsh 的客户端 UI 包、只用主题变量、同一个操作做成宿主方法后由界面和 agent 工具共用。可以直接作为给 Cursor / Codex 的必读材料。
