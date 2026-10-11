# 本机灵感命令与 MCP

Grok Bot、Claude Code、Codex 写入和查找灵感的入口。两边都调用从 T6 抽出的工具函数（`packages/cli/src/idea-tools.ts`），写入走 core 的 `card.create`。标题兜底、分类、同号去重都不在这里重写。

dsh 插件里的三个工具仍从这套函数转发，来源保持 `{ kind: 'agent', name: 'dsh-agent' }`。

先在仓库根目录构建：

```bash
npm ci
npm run build
```

需要 Node.js ≥ 24。测试和试用都用临时数据目录，不要指向真实的 `~/Library/Application Support/BluemantaDesktop/`。

## 本机命令

```bash
node <仓库>/packages/cli/dist/idea.js <add|search|get>
npm run --silent idea -- <add|search|get>
```

Grok Bot 用 `node` 这一条。`npm run idea` 会在标准输出前面加上 npm 自己的脚本横幅，解析那一行 JSON 时要加 `--silent`。JSON 从标准输入传入，不要写临时文件。

数据目录按这个顺序：

1. `--data-dir <路径>`（也可以写成 `--data-dir=<路径>`）
2. 环境变量 `BLUEMANTA_DATA_DIR`
3. core 的默认目录 `~/Library/Application Support/BluemantaDesktop/`

Desktop 开着时也可以写。库是 SQLite WAL。灵感台重新打开清单就能看到新条目，不用重启 Desktop。

标准输出只有一行 JSON。失败时退出码非 0。警告和日志只写标准错误，不打印正文。

### add

标准输入：

```json
{"requestId":"grok-demo-001","title":"虚构的产品标题","body":"一句话摘要","raw":"用户原话","category":"product","source":"Grokbot"}
```

| 字段 | 说明 |
|---|---|
| `requestId` | 必填。同号同内容再提交，返回第一次的结果，并带 `duplicate: true`。同号不同内容返回 `duplicate_request_mismatch`，不覆盖 |
| `title`、`body` | 至少一个非空。都空或只有空白时拒绝，不写入 |
| `raw` | 用户原话，写入 `rawInput`，`channel` 为 `bot`。省略时由 core 按正文生成，agent 来源的 `channel` 为 `agent` |
| `category` | 可选。`product`、`learning`、`work`、`life`、`other`。省略时由 core 按关键词分类 |
| `source` | 可选。来源记为 `{ kind: 'agent', name: <source> }`。缺省或空白时名字是 `bot` |

成功：

```json
{"ok":true,"id":"card_…","title":"虚构的产品标题","category":"产品想法","duplicate":false,"createdAt":"2026-10-10T00:00:00.000Z"}
```

`category` 是中文名，和 T6 工具的返回一致。`createdAt` 是记录上的 ISO 时间。写入后会回读，确认记录还在且标题一致。

失败：

```json
{"ok":false,"code":"invalid_input","message":"标题、正文、附件至少要有一项非空"}
```

### search

标准输入 `{"query":"关键词","limit":10}`。`query` 必填。`limit` 省略时为 10，最大 50。

成功时的对象与 T6 的 `bluemanta_idea_search` 相同：`ok`、`count`、`limit`、`message`、`items`。没有匹配时 `ok` 仍为 true，`message` 为「没有找到」，退出码 0。每条 `items` 含 `id`、`title`、`category`（中文名）、`createdAt`（`YYYY-MM-DD`，按 Asia/Shanghai 计算，不是 UTC 日期）、`field`、`excerpt`。

### get

标准输入 `{"id":"card_…"}`。成功时的对象与 T6 的 `bluemanta_idea_get` 相同，含标题、正文、分类中文名、收藏、创建时间、追记和原文。回收站里的也会返回。找不到时 `not_found`，退出码非 0。

`createdAt` 和追记的 `createdAt` 仍是记录上的 ISO UTC 时间。另有 `createdAtLocal`（追记同样有这个字段），是上海时区的本地时间文本，形如 `2026-10-11 07:09`。给模型看的说明文字用本地时间，不用 ISO。UTC `2026-10-10T23:09:00.000Z` 对应 `2026-10-11 07:09`。

### 错误码

| code | 含义 |
|---|---|
| `invalid_input` | JSON 不合法、缺字段、类型不对、空内容、未知子命令、`limit` 或 `category` 不合法 |
| `duplicate_request_mismatch` | 同一个 `requestId` 已经成功过，但这次内容不同 |
| `not_found` | `get` 找不到，或写入后回读不到记录 |
| `readback_mismatch` | 回读到的标题和写入结果不一致 |
| `forbidden_source` | core 拒绝了这次来源 |
| `version_conflict` | core 报告版本冲突 |
| `unsupported_schema_version` | 数据库版本高于当前代码 |
| `internal` | 其它未预期错误。消息里不含正文 |

### 给 Grok Bot 的调用示例

虚构内容。用管道把 JSON 交给命令，不写临时文件：

```bash
echo '{"requestId":"grok-demo-001","title":"虚构的产品标题","body":"一句话摘要","raw":"用户原话","category":"product","source":"Grokbot"}' | node <仓库>/packages/cli/dist/idea.js add
```

换数据目录时把 `--data-dir <路径>` 放在 `add` 后面。成功时读标准输出那一行 JSON 里的 `id` 回给用户。

## MCP 服务

stdio 传输。只在这个包依赖 `@modelcontextprotocol/sdk`。

```bash
node <仓库>/packages/mcp/dist/mcp.js
```

数据目录用 `BLUEMANTA_DATA_DIR`，未设置时用 core 的默认目录。

三个工具的名字、参数和返回与 T6 相同：

| 工具 | 作用 |
|---|---|
| `bluemanta_idea_capture` | `body`、`title`、`category`。来源 `{ kind: 'agent', name: <客户端名> }`，客户端名缺省 `mcp`。不传 `raw`，原文 `channel` 为 `agent` |
| `bluemanta_idea_search` | `query`、`limit`、`category`、`starredOnly` |
| `bluemanta_idea_get` | `id` |

`requestId` 是 `mcp:<启动随机串>:<请求 id>`。随机串在进程启动时生成一次，不同进程不会撞号；同一进程里同一次调用重试不会再写一条。工具结果的文本和 T6 的说明文字相同，结构化内容和 T6 的返回对象相同。不能收藏、追记、删除。

### Claude Code

项目里的 `.mcp.json`，或用户配置里的 `mcpServers`：

```json
{
  "mcpServers": {
    "bluemanta-idea": {
      "command": "node",
      "args": ["<仓库>/packages/mcp/dist/mcp.js"],
      "env": {
        "BLUEMANTA_DATA_DIR": "<数据目录>"
      }
    }
  }
}
```

不写 `env` 时用默认数据目录。接入前先 `npm run build`。

### Codex

`~/.codex/config.toml`：

```toml
[mcp_servers.bluemanta-idea]
command = "node"
args = ["<仓库>/packages/mcp/dist/mcp.js"]

[mcp_servers.bluemanta-idea.env]
BLUEMANTA_DATA_DIR = "<数据目录>"
```
