# @bluemanta/server

bluemanta Desktop 的本地服务。只监听 `127.0.0.1`，提供 `/api/v1` 接口和网页静态文件（`packages/web/dist`）。网页和 dsh 插件都只经这里的 HTTP 接口读写灵感，见 [ADR 0005](../../docs/decisions/0005-web-app-dsh-entry.md) 与 [阶段 1.5 计划](../../docs/phase-1-5.md) 第 3 节。

## 启动

```bash
npm ci
npm run build
npm run server                       # 等于 node packages/server/dist/cli.js start
```

启动成功后标准输出只有一行：地址和数据目录。之后只在出错时写标准错误；不记录请求体、灵感内容和口令。

三条命令共用同一套参数：

| 命令 | 作用 |
|---|---|
| `node packages/server/dist/cli.js start` | 启动服务。端口已被 bluemanta 服务占用时提示「已在运行」并以 0 退出；被别的程序占用时报「端口 4310 被其他程序占用」并以非 0 退出，不换端口 |
| `node packages/server/dist/cli.js url` | 打印带口令的地址 `http://127.0.0.1:4310/#token=<口令>` |
| `node packages/server/dist/cli.js open` | 用 macOS 的 `open` 在默认浏览器打开上面的地址 |

| 参数 | 环境变量 | 默认 |
|---|---|---|
| `--data-dir <目录>` | `BLUEMANTA_DATA_DIR` | `~/Library/Application Support/BluemantaDesktop/` |
| `--port <端口>` | `BLUEMANTA_SERVER_PORT` | `4310` |

参数优先于环境变量。试用和测试请用临时目录：

```bash
node packages/server/dist/cli.js start --data-dir /tmp/bluemanta-try
```

收到 `SIGTERM` 或 `SIGINT`（Ctrl-C）时关闭监听和数据库后退出。启动时会清理一次上传后 24 小时仍未被引用的附件。

在 DeepSeek Harness Desktop 自带的 Electron 里运行（T15 由插件这样拉起）：

```bash
ELECTRON_RUN_AS_NODE=1 "<DeepSeek Harness.app 里的可执行文件>" packages/server/dist/cli.js start --data-dir /tmp/bluemanta-try
```

## 口令

- 存在数据目录下的 `local-server.json`：`{ "token": "<64 位十六进制>" }`。首次启动（或首次运行 `url`/`open`）时用 32 字节随机数生成，权限 `600`。
- 已有文件对同组或其他用户开放时，启动会改回 `600` 并在标准错误提示一次。
- 想换口令：停掉服务，删除 `local-server.json`，再启动。
- 内容不是合法口令时拒绝启动，不会覆盖文件。

## 在浏览器打开

运行 `open`（或把 `url` 打出的地址贴进浏览器）。口令放在 `#` 后面，不会发给服务器、不进日志；网页读到后存进本地存储并从地址栏抹掉（T12 实现）。之后收藏 `http://127.0.0.1:4310/` 即可。

网页还没构建（`packages/web/dist` 不存在）时，`/` 显示一页说明「网页尚未构建，先运行 npm run build」。

## 接口一览

除 `health` 外都要带 `Authorization: Bearer <口令>`。只暴露灵感（`cardType = idea`）。返回体里没有本机路径、数据目录和口令。字段类型见 [`src/api-types.ts`](src/api-types.ts)，网页直接引用。

| 方法与路径 | 请求体 | 作用 |
|---|---|---|
| `GET /api/v1/health` | — | 不要口令。`{ service: 'bluemanta', apiVersion: 1, version }` |
| `GET /api/v1/ideas?scope=active\|trash&q=` | — | 列表，默认 `active`。带 `q` 走 core 搜索，每条附 `match: { field, excerpt }`。返回 `{ ok, count, items }` |
| `GET /api/v1/ideas/:id` | — | 单条：延展、附件元数据（带 `url`）、`showRaw`（原文是否显示） |
| `POST /api/v1/ideas` | `{ requestId, title?, body?, category?, attachmentIds? }` | 新建 |
| `PATCH /api/v1/ideas/:id` | `{ requestId, rev, title?, body?, category?, attachmentIds? }` | 修改 |
| `PUT /api/v1/ideas/:id/star` | `{ requestId, rev, starred }` | 收藏 / 取消收藏 |
| `POST /api/v1/ideas/:id/trash` | `{ requestId, rev }` | 移入回收站 |
| `POST /api/v1/ideas/:id/restore` | `{ requestId, rev }` | 恢复 |
| `POST /api/v1/ideas/:id/purge` | `{ requestId, rev }` | 彻底删除（只对回收站里的），并清掉不再被引用的附件文件和记录。`record` 只剩 `{ id }` |
| `POST /api/v1/ideas/:id/extensions` | `{ requestId, rev, text }` | 追加延展 |
| `DELETE /api/v1/ideas/:id/extensions/:extensionId` | `{ requestId, rev }` | 删除延展 |
| `POST /api/v1/attachments?requestId=&name=` | 图片字节 | 上传：≤ 8 MB，按文件头识别 jpeg / png / gif / webp，边长 ≤ 16384，扩展名或 `Content-Type` 与文件头不符时拒绝 |
| `GET /api/v1/attachments/:id` | — | 读图片，`cache-control: private, max-age=31536000, immutable` |

写入协议：

- 一律经 core 命令，来源强制为 `{ kind: 'human', name: 'desktop' }`，忽略请求里的 `source`。
- 成功：`{ ok: true, record, duplicate? }`，`record` 与 `GET /ideas/:id` 同形状。同一 `requestId` 同内容重放时带 `duplicate: true`，不会重复写入；同号不同内容返回 409。
- 失败：`{ ok: false, code, message }`。`invalid_input` 400、`forbidden_source` 403、`not_found` 404、`version_conflict` / `duplicate_request_mismatch` 409；口令不对 401 `unauthorized`；Host 不对 403 `forbidden_host`；未知路径 404；方法不对 405 `method_not_allowed`；请求体不是 JSON 400；内部错误 500 `internal`（不带堆栈和路径）。

示例：

```bash
TOKEN=$(node -e "console.log(require('/tmp/bluemanta-try/local-server.json').token)")
curl -s http://127.0.0.1:4310/api/v1/ideas -H "Authorization: Bearer $TOKEN"
curl -s -X POST http://127.0.0.1:4310/api/v1/ideas -H "Authorization: Bearer $TOKEN" \
  -H 'content-type: application/json' -d '{"requestId":"try-1","title":"虚构灵感","body":"正文"}'
curl -s -X POST "http://127.0.0.1:4310/api/v1/attachments?requestId=img-1&name=a.png" \
  -H "Authorization: Bearer $TOKEN" --data-binary @a.png
```

## 安全约束

- 只监听 `127.0.0.1`。所有请求（含静态文件）只接受 `Host` 为 `127.0.0.1:<端口>` 或 `localhost:<端口>`，否则 403，防 DNS 重绑定。
- 不设任何 CORS 响应头，其他网站读不到接口。不设 `X-Frame-Options`，以便 dsh 嵌入（T15）。
- 所有响应带 `X-Content-Type-Options: nosniff`、`Referrer-Policy: no-referrer`。
- 口令校验集中在 `src/app.ts` 的一个中间件里，用定长比较；将来换账号登录只改这里。
- 网页静态文件：带哈希的资源长缓存，`index.html` 不缓存，非 `/api/` 的未知路径回落到 `index.html`。

## 测试

```bash
npm test -w @bluemanta/server
```

测试只用临时数据目录和虚构数据：鉴权与 Host、每个接口、409、幂等重放、上传校验、返回体不泄露路径和口令、静态文件、口令文件权限、端口占用两种情况，以及服务与 `idea.js add` 两个进程各写 50 条的并发写入。
