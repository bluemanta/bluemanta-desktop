import { openCore, type Core, type IdeaCategory } from '@bluemanta/core';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import {
  AGENT_LIMITATION,
  CAPTURE_DESCRIPTION,
  GET_DESCRIPTION,
  IDEA_CAPTURE_TOOL,
  IDEA_CATEGORY_VALUES,
  IDEA_GET_TOOL,
  IDEA_SEARCH_TOOL,
  SEARCH_DESCRIPTION,
  captureIdea,
  getIdea,
  renderCapture,
  renderGet,
  renderSearch,
  searchIdeas,
  type CaptureIdeaResult,
  type GetIdeaResult,
  type SearchIdeaResult,
} from '@bluemanta/cli/idea-tools';

const categorySchema = z
  .enum(IDEA_CATEGORY_VALUES)
  .describe('可选分类：product 产品想法、learning 学习备忘、work 工作事务、life 生活随想、other 其他');

type ToolValue = CaptureIdeaResult | SearchIdeaResult | GetIdeaResult;

export function clientSourceName(name: string | undefined): string {
  const trimmed = name?.trim() ?? '';
  return trimmed === '' ? 'mcp' : trimmed;
}

/** 用 MCP 请求 id 生成稳定的 requestId，同一次调用重试时 core 不会再写一条。 */
export function mcpCaptureRequestId(requestId: string | number | undefined): string | null {
  if (requestId === undefined) return null;
  const text = String(requestId).trim();
  if (text === '') return null;
  return `mcp:${text}`;
}

export function captureWithClient(
  core: Core,
  args: { body?: string; title?: string; category?: IdeaCategory },
  context: { requestId: string | number | undefined; clientName: string | undefined },
): CaptureIdeaResult {
  const requestId = mcpCaptureRequestId(context.requestId);
  if (requestId === null) return { ok: false, error: '缺少请求 id' };
  return captureIdea(core, {
    requestId,
    source: { kind: 'agent', name: clientSourceName(context.clientName) },
    ...(args.body === undefined ? {} : { body: args.body }),
    ...(args.title === undefined ? {} : { title: args.title }),
    ...(args.category === undefined ? {} : { category: args.category }),
  });
}

export function createIdeaMcpServer(dataDir: string): { server: McpServer; close: () => void } {
  const core = openCore({ dataDir });
  let closed = false;
  const close = (): void => {
    if (closed) return;
    closed = true;
    core.close();
  };

  const server = new McpServer(
    { name: 'bluemanta-idea', version: '0.0.0' },
    { instructions: `记录、查找和读取 bluemanta 灵感。${AGENT_LIMITATION}` },
  );

  server.registerTool(
    IDEA_CAPTURE_TOOL,
    {
      description: CAPTURE_DESCRIPTION,
      inputSchema: {
        body: z.string().describe('灵感正文。与 title 至少一个非空').optional(),
        title: z.string().describe('可选标题。省略或空字符串时按正文生成兜底标题').optional(),
        category: categorySchema.optional(),
      },
    },
    async (args, extra) => {
      aborted(extra.signal);
      const result = captureWithClient(core, args, {
        requestId: requestIdOf(extra),
        clientName: server.server.getClientVersion()?.name,
      });
      return toolResult(result, renderCapture(result));
    },
  );

  server.registerTool(
    IDEA_SEARCH_TOOL,
    {
      description: SEARCH_DESCRIPTION,
      inputSchema: {
        query: z.string().describe('关键词。按空白分开，每个词都要命中'),
        limit: z.number().int().describe('返回条数，默认 10，最大 50').optional(),
        category: categorySchema.optional(),
        starredOnly: z.boolean().describe('为 true 时只返回已收藏的灵感').optional(),
      },
    },
    async (args, extra) => {
      aborted(extra.signal);
      const result = searchIdeas(core, {
        query: args.query,
        ...(args.limit === undefined ? {} : { limit: args.limit }),
        ...(args.category === undefined ? {} : { category: args.category }),
        ...(args.starredOnly === undefined ? {} : { starredOnly: args.starredOnly }),
      });
      return toolResult(result, renderSearch(result));
    },
  );

  server.registerTool(
    IDEA_GET_TOOL,
    {
      description: GET_DESCRIPTION,
      inputSchema: {
        id: z.string().describe('灵感 id'),
      },
    },
    async (args, extra) => {
      aborted(extra.signal);
      const result = getIdea(core, { id: args.id });
      return toolResult(result, renderGet(result));
    },
  );

  const previous = server.server.onclose;
  server.server.onclose = () => {
    close();
    previous?.();
  };

  return { server, close };
}

function toolResult(value: ToolValue, text: string) {
  const structured = value.ok ? value : { ok: false as const, error: value.error };
  return {
    content: [{ type: 'text' as const, text }],
    structuredContent: structured,
  };
}

function requestIdOf(extra: object): string | number | undefined {
  if (!('requestId' in extra)) return undefined;
  const value = extra.requestId;
  if (typeof value === 'string' || typeof value === 'number') return value;
  return undefined;
}

function aborted(signal: AbortSignal): void {
  if (signal.aborted) throw new DOMException('The operation was aborted', 'AbortError');
}
