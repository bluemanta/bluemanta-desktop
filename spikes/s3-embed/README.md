# S3 技术验证：独立网页嵌进 dsh 主区和右侧栏

- 日期：2026-10-11
- 执行：Claude Code
- dsh 版本：0.2.0-rc.2（web 版用隔离 `DSH_HOME`；Desktop App 经用户授权临时安装）
- 结论：**可行**。web 版和 Desktop 中，网页都能嵌进主区和右侧栏，并且能读写、同步主题、经消息桥让 dsh 执行操作

## 要回答的问题

能不能把灵感台、内容线这些核心功能做成独立网页，dsh 里只放一个装网页的框，而不在 dsh 插件里开发业务界面？

## 做法

| 路径 | 作用 |
|---|---|
| `web/index.html` | 最小网页版灵感台：列表、搜索、新增、详情、「在右侧栏打开」。独立打开和嵌入时都能用 |
| `shared/ideas-api.mjs` | 读写接口，直接复用仓库里已构建的 core 和 T6/T7 工具函数 |
| `server/server.mjs` | **来源 A**：独立本地服务，只监听 127.0.0.1，校验 Host 头，接口要口令头 |
| `plugin/index.js` | 宿主端：**来源 B**，在 dsh 鉴权路由上托管同一个网页和接口；同时在插件激活时拉起来源 A 的服务、停用时关掉；`/api/bluemanta/s3/config` 把 A 的地址和口令交给浏览器端 |
| `plugin/client.js` | 浏览器端：左侧栏「S3 嵌入」→ 主区 iframe（可切换 A/B）；右侧栏页类型 `bluemanta.s3`（开始页入口「S3 网页」）；主题同步；消息桥 |

消息协议（`postMessage`，dsh 只接受自己放进去的 iframe 发来的消息）：

| 方向 | 消息 | 作用 |
|---|---|---|
| 网页 → dsh | `bm:ready` | dsh 回发主题 |
| dsh → 网页 | `bm:theme { dark, vars }` | 把 dsh 的 `--dsw-alias-*` 计算值映射成网页自己的变量；dsh 切换深浅色（`body[data-ds-dark-theme]`）时重发 |
| 网页 → dsh | `bm:openSidebar { id, title }` | dsh 调 `ctx.sidebarRight.openTab` 在右侧栏打开这条灵感 |
| dsh → 网页 | `bm:result { ok, reason }` | 执行结果；不在对话里时回「没有右侧栏」 |

数据目录：`S3_DATA_DIR`，未设置时用 `spikes/s3-embed/.data`（已 gitignore），只有虚构数据。

## 复现（web 版）

```bash
cd spikes/s3-embed
export DSH_HOME="$PWD/.dsh-home" DSH_TELEMETRY_DISABLED=1
dsh --profile s3 --from-default-profile web --dump-config > /dev/null
dsh plugin --profile s3 add ./plugin
S3_DATA_DIR="$PWD/.data" dsh --profile s3 --port 3094 --no-open
```

也可以用 `.claude/launch.json` 的 `spike-s3-embed` 配置启动。Desktop 中安装时，「添加插件」要填**绝对路径**（`~` 不会展开，会被当成包名报错）。

## 验收记录

| # | 检查项 | web 版 | Desktop |
|---|---|---|---|
| 1 | 主区嵌入，来源 B（dsh 鉴权路由，同源） | verified | verified（origin `dsh-app://app`） |
| 2 | 主区嵌入，来源 A（独立本地服务，跨源 `http://127.0.0.1:4390`） | verified | verified（用户操作确认） |
| 3 | 在框内读、写、搜索、输入中文 | verified | verified（用户确认 A 方案写入） |
| 4 | 主题同步，含深浅色实时切换 | verified | verified（用户确认） |
| 5 | 右侧栏嵌入同一网页（开始页入口「S3 网页」） | verified | verified（用户确认） |
| 6 | 消息桥：框内「在右侧栏打开」→ dsh 新开 tab 显示详情 | verified | verified（用户确认） |
| 7 | 消息桥：不在对话里时回「没有右侧栏」，不报错 | verified | 未单独测 |
| 8 | 插件激活时拉起本地服务、dsh 停止时随之退出 | verified（停止后无残留进程） | 拉起 verified（进程为 Desktop 自身的 Electron 程序，`ELECTRON_RUN_AS_NODE`）；退出 not-run |
| 9 | 不开 dsh、浏览器直接打开来源 A，数据与嵌入时同一份 | verified | — |
| 10 | 来源 A 无口令 401、伪造 Host 403 | verified | — |
| 11 | 控制台无错误 | 读取为空（未先刷新页面启动采集，不能算严格验证） | not-run |
| 12 | 焦点在框内时 dsh 快捷键是否生效 | not-run（按浏览器对跨源 iframe 的行为，预计不生效，需经消息桥转发） | not-run |

## 发现

1. **dsh 的主页面和 Desktop 主窗口都不限制 iframe。** Desktop 的 `will-navigate` 只拦主窗口整页跳转；dsh 自带的浏览器 tab 在 web 版本身就用 iframe（Desktop 用 `<webview>`）。
2. **`dsh-app://app/` 下的非静态请求会带登录 cookie 转发给宿主**（`apps/desktop/src/main.ts` 的 `protocol.handle`），所以来源 B 的相对路径在 Desktop 中同样可用。
3. **dsh 鉴权路由只认完整路径**（`packages/client/connection/src/rpc-host.ts` 中 `fetchRoutes.get(pathname)`），不支持前缀。来源 B 托管多文件网页，要么打包成单文件，要么逐个注册资源路径；来源 A 没有这个限制。
4. **Desktop 的宿主插件可以拉起子进程。** `process.execPath` 是 Electron 程序本身，加 `ELECTRON_RUN_AS_NODE=1` 后按 Node 运行，无需用户另装 Node。
5. **主题映射可行但要维护一张对照表。** 网页使用自己的变量名，由 dsh 发来 `--dsw-alias-*` 的计算值；dsh 升级改了变量名时，只需改这张表。

## 对架构的含义

"核心功能做成独立网页，dsh 里只保留入口、工具卡片和消息桥"这一路线在技术上成立。两种来源各有用途：

- **来源 A（独立本地服务）**：脱离 dsh 也能用，开发不受 dsh 路由限制，适合做主力；
- **来源 B（dsh 鉴权路由）**：免口令、天然经 dsh 鉴权，但只适合单文件或少量资源。

是否采用、正本放本机还是云端，由用户决定后写入 ADR。
