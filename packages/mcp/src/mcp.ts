#!/usr/bin/env node
import { resolveDataDir } from '@bluemanta/cli/data-dir';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createIdeaMcpServer } from './server.js';

async function main(): Promise<void> {
  const dataDir = resolveDataDir(undefined, process.env);
  const { server } = createIdeaMcpServer(dataDir);
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((error: unknown) => {
  const message = error instanceof Error && error.message !== '' ? error.message : '未能启动 MCP 服务';
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
