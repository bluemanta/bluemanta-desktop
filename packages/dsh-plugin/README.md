# @bluemanta/dsh-plugin

dsh 0.2.0-rc.2 的组合包。宿主端打开 `@bluemanta/core`，在 dsh 的鉴权路由上提供灵感的读取、写入和图片通道；浏览器端在左侧栏挂「灵感台」（面板 id 仍是 `bluemanta.ideas`）。

业务规则在 core 里，这个包只做显示和适配。图片文件写在数据目录的 `media/` 下。

宿主端用 peer 依赖 `@deepseek-ai/dsh-tools@0.2.0-rc.2` 注册 agent 工具，实例由 dsh 宿主提供，同时写在 `devDependencies` 里供本地类型检查。浏览器端 `client.js` 不引用任何 `@deepseek-ai/*` 包。

## 构建

在仓库根目录：

```bash
npm ci
npm run build
```

宿主端由 TypeScript 编成 `packages/dsh-plugin/dist/`。浏览器端是已写好的 `client.js`，不需要再打包。安装或启动前要先构建，否则宿主入口找不到 `dist/index.js`。

## 本地隔离启动

```bash
npm run dev:dsh
```

脚本会：

1. 在仓库内的 `.dsh-dev/`（已 gitignore）准备隔离的 `DSH_HOME` 和临时数据目录。不会读写 `~/.dsh`，也不会碰 `~/Library/Application Support/BluemantaDesktop/`。
2. 把 `@deepseek-ai/dsh@0.2.0-rc.2` 装到 `.dsh-dev/cli`（需要网络，只要第一次）。
3. 用 `dsh --profile bluemanta-dev --from-default-profile web --dump-config` 从 web 模板建立 profile。这里加了 `--dump-config`，只建配置、不把服务跑起来；否则插件还没装上服务就启动了。
4. `dsh plugin --profile bluemanta-dev add ./packages/dsh-plugin`。这一步需要 PATH 上有 pnpm。
5. 把 `BLUEMANTA_DATA_DIR` 指到 `.dsh-dev/data`，启动 `dsh --profile bluemanta-dev --port 3092 --no-open`。

终端会打印带 `token` 的地址。用那个地址打开页面，左侧栏会出现「灵感台」。不带登录 cookie 访问 `/api/bluemanta/health` 会得到 401。

数据目录优先读环境变量 `BLUEMANTA_DATA_DIR`。未设置时用 core 的默认目录 `~/Library/Application Support/BluemantaDesktop/`。

## 装进 Desktop

1. 在仓库根目录执行 `npm run build`。
2. 打开 DeepSeek Harness Desktop 0.2.0-rc.2。
3. 进入「插件 → 添加插件」，目录填本仓库的 `packages/dsh-plugin`（绝对路径）。
4. 启用后，左侧栏会出现「灵感台」。空库的清单显示「还没有记下灵感。点右上角「新增」，可以只写文字、只贴图，或两者一起记下。」

Desktop 默认数据目录是 core 的默认目录。要用临时库试列表，先用 core 往一个临时目录写入卡片，再让 Desktop 进程带上 `BLUEMANTA_DATA_DIR=<该目录>` 启动。不要把真实灵感写进仓库。

## 代码更新后如何生效

1. 再执行一次 `npm run build`。`client.js` 若只改了浏览器端，保存即可，它不经过 tsc。
2. 宿主端模块由 Node 缓存。改了 `packages/dsh-plugin/src/` 或 core 之后，要完全退出 dsh / Desktop 再打开，新的 `dist/` 才会加载。
3. `npm run dev:dsh` 每次都会先构建再启动。已经在跑的进程不会热更新宿主代码，停掉后重新执行脚本。
4. 浏览器端若刷新后仍是旧页面，在插件页停用再启用一次。

## 路由

路由都用 `ctx.connection.fetch.register` 注册在 `/api` 下，经过 dsh 的 Host/Origin 校验和浏览器 cookie 认证。写命令和上传由宿主强制 `source: { kind: 'human', name: 'desktop' }`。

| 方法与路径 | 结果 |
|---|---|
| `GET /api/bluemanta/health` | `{ schemaVersion, dataDir, counts: { projects, tasks, cards } }`。counts 是未进回收站的数量 |
| `GET /api/bluemanta/cards?cardType=idea&trash=0\|1&q=关键词` | `{ count, cards }`。不带 `trash` 或 `trash=0` 不含回收站；`trash=1` 只返回回收站。`cardType` 可省略。带 `q` 时按关键词搜索，每条卡片附带 `field`（命中字段）和 `excerpt`（摘录）。`q` 为空或重复返回 400。其它非法参数也返回 400 |
| `POST /api/bluemanta/commands` | 请求体 `{ command, input }`。白名单：`card.create`、`card.update`、`card.delete`、`card.restore`、`card.purge`、`card.setStar`、`card.addExtension`、`card.deleteExtension`。其它命令 400。`invalid_input` → 400，`not_found` → 404，`version_conflict` / `duplicate_request_mismatch` → 409，`forbidden_source` → 403，均带 `message`。成功时返回 core 的 `{ ok: true, record }`。彻底删除后，不再被其它卡片引用的附件会删掉文件和记录 |
| `POST /api/bluemanta/attachments?requestId=&name=` | 流式上传。按文件头识别 jpeg / png / gif / webp，单张 ≤ 8 MB，宽高 ≤ 16384，计算 sha256，写入 `media/<id>.<扩展名>` 并调用 `attachment.create`。返回 `{ ok: true, record }` |
| `GET /api/bluemanta/attachment?id=` | 返回图片字节，`content-type` 来自记录，并带长期私有缓存头 |

插件启动时会清理创建超过 24 小时、且没有被任何卡片（含回收站）引用的附件。

## Agent 工具

宿主启动时用 `ctx.tools.register(defineTool(...))` 注册三个工具。执行函数在 `src/idea-tools.ts`，只调用 core，不另写标题、分类或回收站规则。

| 工具 | 作用 |
|---|---|
| `bluemanta_idea_capture` | 记下一条灵感。来源固定为 `{ kind: 'agent', name: 'dsh-agent' }`，不传 `rawInput`，`requestId` 由工具调用 id 生成 |
| `bluemanta_idea_search` | 按关键词查找灵感。默认不含回收站，`limit` 默认 10、最大 50 |
| `bluemanta_idea_get` | 按 id 读取一条灵感。在回收站中的也会返回 |

不提供修改、收藏、追记、删除。这些只在灵感台界面由人操作。

## 对话右侧栏

浏览器端在 `dsh.client.inject` 里声明 `@deepseek-ai/dsh-client-ui-sidebar-right` 和 `@deepseek-ai/dsh-client-ui-tool`，只用来排激活顺序，`client.js` 不 import 这两个包。

- 页类型 `bluemanta.idea`（`multiple: true`）注册到 `ctx.sidebarRightTabs`。开始页入口「灵感台」打开精简列表；点一条，或在工具卡片上点「打开」，会在当前对话的右侧栏新开这条灵感。正文复用灵感详情，写入仍走人的命令通道。
- `bluemanta_idea_capture`、`bluemanta_idea_search`、`bluemanta_idea_get` 各有一张 `tool.call.toolview` 卡片。主区域不是对话时右侧栏不存在，「打开」不显示，也不会调用 `openTab`。
