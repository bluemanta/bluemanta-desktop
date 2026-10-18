# @bluemanta/dsh-plugin

dsh 0.2.1-rc.2 的组合包。按 [ADR 0005](../../docs/decisions/0005-web-app-dsh-entry.md)，这个插件不再做灵感台的业务界面，只保留：

- 左侧栏入口和装网页的框（主区、右侧栏标签）
- 三个 agent 工具（宿主端直接调用 core）
- 对话里的工具卡片
- 和网页之间的消息桥
- 本地服务的检查与拉起

灵感的读写、规则和界面都在网页（`packages/web`）和本地服务（`packages/server`）里。网页只经 HTTP 接口访问数据。浏览器端 `client.js` 不引用任何 `@deepseek-ai/*` 包；`dsh.client.inject` 里的客户端包只用来排激活顺序。

宿主端用 peer 依赖 `@deepseek-ai/dsh-tools@0.2.1-rc.2` 注册 agent 工具，实例由 dsh 宿主提供，同时写在 `devDependencies` 里供本地类型检查。

## 本地服务

插件激活时请求 `http://127.0.0.1:<端口>/api/v1/health`。端口默认 4310，读 `BLUEMANTA_SERVER_PORT`。响应里 `service` 是 `bluemanta` 就直接用（例如开机自启的那个），不另起进程。

没人在听：用 `process.execPath` 加上 `ELECTRON_RUN_AS_NODE=1`，运行 `@bluemanta/server` 的 `dist/cli.js start`。脚本路径用 `import.meta.resolve('@bluemanta/server')` 找到入口 `dist/index.js`，再取同目录的 `cli.js`，不写死仓库目录。已经有 bluemanta 服务时直接复用，这次解析失败也不影响复用。子进程的 `BLUEMANTA_DATA_DIR`、`BLUEMANTA_SERVER_PORT` 和插件一致。健康检查大约等 10 秒。

只停自己拉起的那个：插件停用或 dsh 退出时给这个子进程发 SIGTERM；复用来的不碰。子进程自己退出时记一行日志，下次打开框时重新检查。

端口被别的程序占用，或拉起失败：框里显示原因（例如「本地服务没有启动：端口 4310 被其他程序占用」）和「重试」，不抛到 dsh。

## web-config

插件里只保留这一条 dsh 鉴权路由：

| 方法与路径 | 结果 |
|---|---|
| `GET /api/bluemanta/web-config` | 成功：`{ ok: true, baseUrl, token }`。失败：`{ ok: false, reason }`。口令读数据目录的 `local-server.json`（本地服务生成） |

浏览器端用相对路径 `api/bluemanta/web-config`（开头不带 `/`），web 版和 Desktop 的 `dsh-app://` 都能解析。

## 装网页的框

- 左侧栏「灵感台」（面板 id `bluemanta.ideas`，图标不变）：主区一个铺满的 iframe，地址 `<baseUrl>/ideas?embed=main#token=<口令>&parent=<父页面 origin>`。
- 右侧栏页类型仍是 `bluemanta.idea`（`multiple: true`，已保存的布局可以恢复）。有 `id` 时打开 `/ideas/<id>?embed=sidebar…`，没有时（开始页入口「灵感台」）打开 `/ideas?embed=sidebar…`。同一个灵感已经打开时聚焦那个标签。
- iframe 无边框、透明底、铺满。加载中显示「正在打开灵感台…」。

`#` 后面的口令不会发给服务器。网页读到后存进本地存储并从地址栏抹掉。

## 主题与消息桥

iframe 发 `bm:ready` 后，插件回 `bm:theme { dark }`（`document.body` 是否有 `data-ds-dark-theme`）。深浅色切换时给所有框重发。只发 `dark`，不发 `--dsw-alias-*`。

只接受自己放进去的 iframe（比对 `event.source`），且 `event.origin` 等于 `baseUrl` 的 origin。回复用 `postMessage(…, 这个 origin)`，不用 `'*'`。

| 方向 | 消息 | 作用 |
|---|---|---|
| 网页 → dsh | `bm:ready` | 插件回发主题 |
| dsh → 网页 | `bm:theme { dark }` | 网页设置 `data-theme` |
| 网页 → dsh | `bm:openSidebar { id, title }` | 在当前会话右侧栏打开这条灵感。不在对话里时 `{ ok: false, reason: '当前不在对话里' }` |
| 网页 → dsh | `bm:quote { id, title }` | 把 `【灵感】<标题>（bluemanta 灵感 id：<id>）` 追加到该会话输入框草稿末尾并聚焦 |
| 网页 → dsh | `bm:dirty { dirty }` | 记下这个右侧栏标签有未保存修改。关闭时沿用 `registerCloseHandler`：有修改就留下标签并确认 |
| dsh → 网页 | `bm:result { action, ok, reason?, requestId? }` | 每个请求的结果。网页用轻提示显示 |

「在对话中引用」需要 `inject` 里有 `sessions`，`dsh.client.inject` 里有 `@deepseek-ai/dsh-client-ui-conversation`。插件不 import 这个包。用 `setDraft` 整段替换草稿，输入框里已有的行内引用 chip 会展开成纯文本（S4 的已知限制）。

工具卡片上的「打开」走同一个右侧栏标签。主区域不是对话时没有右侧栏，「打开」不显示。

## 构建

在仓库根目录：

```bash
npm ci
npm run build
```

宿主端由 TypeScript 编成 `packages/dsh-plugin/dist/`。浏览器端是已写好的 `client.js`，不需要再打包。安装或启动前要先构建，否则宿主入口找不到 `dist/index.js`，本地服务也没有 `dist/cli.js`。

## 本地隔离启动

```bash
npm run dev:dsh
```

脚本会：

1. 在仓库内的 `.dsh-dev/`（已 gitignore）准备隔离的 `DSH_HOME` 和数据目录 `.dsh-dev/data`。不会读写 `~/.dsh`，也不会碰 `~/Library/Application Support/BluemantaDesktop/`。
2. 构建仓库。数据目录还没有 `store.sqlite` 时，用 `packages/web` 的种子脚本写入虚构数据。
3. 把 `@deepseek-ai/dsh@0.2.1-rc.2` 装到 `.dsh-dev/cli`（需要网络，只要第一次）。
4. 用 `dsh --profile bluemanta-dev --from-default-profile web --dump-config` 从 web 模板建立 profile。`--dump-config` 只建配置、不把服务跑起来。profile 目录已经存在时跳过。
5. `dsh plugin --profile bluemanta-dev add ./packages/dsh-plugin`。这一步需要 PATH 上有 pnpm。依赖里已经有 `@bluemanta/dsh-plugin` 时跳过。
6. 设置 `BLUEMANTA_DATA_DIR=.dsh-dev/data` 和 `BLUEMANTA_SERVER_PORT=4311`，启动 `dsh --profile bluemanta-dev --port 3092 --no-open`。4311 用来避开本机可能已经开着的 4310。

终端会打印带 `token` 的地址。用那个地址打开页面，左侧栏「灵感台」里是网页版。插件会按需拉起 `127.0.0.1:4311` 上的本地服务。

## 装进 Desktop

1. 在仓库根目录执行 `npm run build`。
2. 打开 DeepSeek Harness Desktop 0.2.1-rc.2。
3. 进入「插件 → 添加插件」，目录填本仓库的 `packages/dsh-plugin`（绝对路径）。
4. 启用后，左侧栏「灵感台」嵌入 `127.0.0.1:4310` 上的网页（除非设置了 `BLUEMANTA_SERVER_PORT`）。服务没在跑时由插件拉起，只在插件停用时停掉自己拉起的那个。

不要把真实灵感写进仓库。验证用隔离的 `DSH_HOME`，不要改用户的 `~/.dsh`。

## 代码更新后如何生效

1. 再执行一次 `npm run build`。只改了 `client.js` 时不用过 tsc。
2. 宿主端模块由 Node 缓存。改了 `packages/dsh-plugin/src/`、core 或本地服务之后，要完全退出 dsh / Desktop 再打开。本地服务是独立进程，更新后也要重启才会用上新代码。
3. `npm run dev:dsh` 每次都会先构建再启动。已经在跑的进程不会热更新宿主代码，停掉后重新执行脚本。
4. 浏览器端若刷新后仍是旧页面，在插件页停用再启用一次。

## Agent 工具

宿主启动时用 `ctx.tools.register(defineTool(...))` 注册三个工具。执行函数在 `packages/cli/src/idea-tools.ts`（本包的 `src/idea-tools.ts` 只转发），只调用 core，不另写标题、分类或回收站规则。

| 工具 | 作用 |
|---|---|
| `bluemanta_idea_capture` | 记下一条灵感。来源固定为 `{ kind: 'agent', name: 'dsh-agent' }`，不传 `rawInput`，`requestId` 由工具调用 id 生成 |
| `bluemanta_idea_search` | 按关键词查找灵感。默认不含回收站，`limit` 默认 10、最大 50。结果里的 `createdAt` 是上海时区的 `YYYY-MM-DD` |
| `bluemanta_idea_get` | 按 id 读取一条灵感。在回收站中的也会返回。`createdAt` 仍是 ISO UTC，另有上海时区的 `createdAtLocal`（追记同样有），形如 `2026-10-11 07:09` |

不提供修改、收藏、追记、删除。这些在网页里由人操作。

## 品牌

插件会停用官方品牌插件 `ui-brand-official`。`cordis.patch.yml` 用 `- id: ui-brand-official` 和 `disabled: true` 覆盖这一行：官方标志占着品牌 single slot，第二个注册会抛错 `single slot "..." already has a registration`。卸载本插件后，这条停用随之消失，侧栏的「deepseek HARNESS」和新会话首屏的鱼会自动恢复。

浏览器端填三个 slot。侧栏的两个用嵌套 `ctx.slots.inject` 作为一组注册，和 dsh 的 `ui-brand-official` 一样：

| slot | 内容 |
|---|---|
| `sidebar.brand.mark` | `BrandMark`。侧栏展开时和收起后的轨道都用它 |
| `sidebar.brand.name` | 文字 `bluemanta`，颜色 `--dsw-alias-label-primary` |
| `conversation.hero.brand.mark` | 同一个 `BrandMark` |

正式 logo 还没有。占位图形在 `client.js` 的 `BrandMark({ size, className })`：圆角方块，底色 `#2A715A`，小写 `b` 为 `#FFFFFF`。这两个色是固定的，不用 `--dsw-alias-brand-primary`（深色主题下它是白色，白字会消失）。拿到正式图标后只替换 `BrandMark`，slot 注册不用改。

浏览器标签页标题、Desktop 窗口标题和 Dock 图标由构建期决定，这个插件改不了。
