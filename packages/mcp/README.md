# @bluemanta/mcp

stdio MCP 服务，供 Claude Code、Codex 记录和查找灵感。工具参数和返回与 T6 相同，执行函数在 `@bluemanta/cli` 的 `src/idea-tools.ts`。

用法、输入输出、错误码和 Grok Bot 的命令示例见 [packages/cli/README.md](../cli/README.md)。

启动：

```bash
node <仓库>/packages/mcp/dist/mcp.js
```

数据目录是环境变量 `BLUEMANTA_DATA_DIR`，未设置时用 core 的默认目录。

Claude Code（`.mcp.json`）：

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

Codex（`~/.codex/config.toml`）：

```toml
[mcp_servers.bluemanta-idea]
command = "node"
args = ["<仓库>/packages/mcp/dist/mcp.js"]

[mcp_servers.bluemanta-idea.env]
BLUEMANTA_DATA_DIR = "<数据目录>"
```
