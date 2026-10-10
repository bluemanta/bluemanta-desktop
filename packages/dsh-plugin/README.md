# @bluemanta/dsh-plugin

dsh 0.2.0-rc.2 的组合包。宿主端打开 `@bluemanta/core`，在 dsh 的鉴权路由上提供只读接口；浏览器端在左侧栏挂「灵感清单」。

运行时不依赖任何 `@deepseek-ai/*` 包。业务规则在 core 里，这个包只做显示和适配。

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

终端会打印带 `token` 的地址。用那个地址打开页面，左侧栏会出现「灵感清单」。不带登录 cookie 访问 `/api/bluemanta/health` 会得到 401。

数据目录优先读环境变量 `BLUEMANTA_DATA_DIR`。未设置时用 core 的默认目录 `~/Library/Application Support/BluemantaDesktop/`。

## 装进 Desktop

1. 在仓库根目录执行 `npm run build`。
2. 打开 DeepSeek Harness Desktop 0.2.0-rc.2。
3. 进入「插件 → 添加插件」，目录填本仓库的 `packages/dsh-plugin`（绝对路径）。
4. 启用后，左侧栏会出现「灵感清单」。空库显示「还没有灵感」和当前数据目录。

Desktop 默认数据目录是 core 的默认目录。要用临时库试列表，先用 core 往一个临时目录写入卡片，再让 Desktop 进程带上 `BLUEMANTA_DATA_DIR=<该目录>` 启动。不要把真实灵感写进仓库。

## 代码更新后如何生效

1. 再执行一次 `npm run build`。`client.js` 若只改了浏览器端，保存即可，它不经过 tsc。
2. 宿主端模块由 Node 缓存。改了 `packages/dsh-plugin/src/` 或 core 之后，要完全退出 dsh / Desktop 再打开，新的 `dist/` 才会加载。
3. `npm run dev:dsh` 每次都会先构建再启动。已经在跑的进程不会热更新宿主代码，停掉后重新执行脚本。
4. 浏览器端若刷新后仍是旧页面，在插件页停用再启用一次。

## 只读路由

两条路由都用 `ctx.connection.fetch.register` 注册在 `/api` 下，经过 dsh 的 Host/Origin 校验和浏览器 cookie 认证。

| 方法与路径 | 结果 |
|---|---|
| `GET /api/bluemanta/health` | `{ schemaVersion, dataDir, counts: { projects, tasks, cards } }`。counts 是未进回收站的数量 |
| `GET /api/bluemanta/cards?cardType=idea&trash=0\|1&q=关键词` | `{ count, cards }`。不带 `trash` 或 `trash=0` 不含回收站；`trash=1` 只返回回收站。`cardType` 可省略。带 `q` 时按关键词搜索，每条卡片附带 `field`（命中字段）和 `excerpt`（摘录）。`q` 为空或重复返回 400。其它非法参数也返回 400 |
