import { randomUUID } from 'node:crypto';
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
import {
  KNOWLEDGE_LIMITATION,
  KNOWLEDGE_READ_DESCRIPTION,
  KNOWLEDGE_READ_TOOL,
  KNOWLEDGE_ROUTE_DESCRIPTION,
  KNOWLEDGE_ROUTE_TOOL,
  KNOWLEDGE_SEARCH_DESCRIPTION,
  KNOWLEDGE_SEARCH_TOOL,
  openKnowledgeIndex,
  readKnowledge,
  renderKnowledgeRead,
  renderKnowledgeRoute,
  renderKnowledgeSearch,
  routeKnowledge,
  searchKnowledge,
  type KnowledgeReadResult,
  type KnowledgeRouteResult,
  type KnowledgeSearchResult,
} from '@bluemanta/cli/knowledge-tools';
import { defaultKnowledgeEnv, type KnowledgeEnv, type KnowledgeIndex } from '@bluemanta/knowledge';

const categorySchema = z
  .enum(IDEA_CATEGORY_VALUES)
  .describe('可选分类：product 产品想法、learning 学习备忘、work 工作事务、life 生活随想、other 其他');

type ToolValue = CaptureIdeaResult | SearchIdeaResult | GetIdeaResult | KnowledgeRouteResult | KnowledgeSearchResult | KnowledgeReadResult;

export function clientSourceName(name: string | undefined): string {
  const trimmed = name?.trim() ?? '';
  return trimmed === '' ? 'mcp' : trimmed;
}

/**
 * 进程启动时生成一次。MCP 请求 id 在每个连接里都从头计数，
 * 不带这段随机串的话，新会话会撞上旧会话的号。
 */
export const mcpProcessToken = randomUUID();

/** 同一进程内，相同请求 id 得到相同 requestId，重试不会再写一条。 */
export function mcpCaptureRequestId(
  requestId: string | number | undefined,
  processToken: string = mcpProcessToken,
): string | null {
  if (requestId === undefined) return null;
  const text = String(requestId).trim();
  const token = processToken.trim();
  if (text === '' || token === '') return null;
  return `mcp:${token}:${text}`;
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

export function createIdeaMcpServer(dataDir: string, knowledgeEnv: KnowledgeEnv = defaultKnowledgeEnv()): { server: McpServer; close: () => void } {
  const core = openCore({ dataDir });
  // 知识索引第一次用到时才在数据目录建（ADR 0009 决定 4）。
  let knowledgeIndex: KnowledgeIndex | null = null;
  const index = (): KnowledgeIndex => (knowledgeIndex ??= openKnowledgeIndex({ dataDir, core, env: knowledgeEnv }));
  let closed = false;
  const close = (): void => {
    if (closed) return;
    closed = true;
    knowledgeIndex?.close();
    core.close();
  };

  const server = new McpServer(
    { name: 'bluemanta-idea', version: '0.0.0' },
    {
      instructions:
        `记录、查找和读取 bluemanta 灵感，并查找、读取个人知识库与 Arsenal。${AGENT_LIMITATION}` +
        `回答知识类问题时先用 ${KNOWLEDGE_ROUTE_TOOL} 定位主题，再用 ${KNOWLEDGE_READ_TOOL} 按读取顺序读；找回以前的想法用 ${KNOWLEDGE_SEARCH_TOOL}，换几种说法多搜几次。${KNOWLEDGE_LIMITATION}`,
    },
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

  server.registerTool(
    KNOWLEDGE_ROUTE_TOOL,
    {
      description: KNOWLEDGE_ROUTE_DESCRIPTION,
      inputSchema: {
        query: z.string().describe('用户的问题或关键词'),
        library: z.enum(['personal', 'arsenal']).describe('只查一个库：personal 个人库，arsenal 售前主题库').optional(),
        limit: z.number().int().describe('候选主题数，默认 5，最多 10').optional(),
      },
    },
    async (args, extra) => {
      aborted(extra.signal);
      const result = routeKnowledge(index(), knowledgeEnv, args);
      return toolResult(result, renderKnowledgeRoute(result));
    },
  );

  server.registerTool(
    KNOWLEDGE_SEARCH_TOOL,
    {
      description: KNOWLEDGE_SEARCH_DESCRIPTION,
      inputSchema: {
        query: z.string().describe('关键词，按空白分开'),
        library: z.enum(['personal', 'arsenal']).describe('只搜一个库；指定后不含灵感').optional(),
        includeIdeas: z.boolean().describe('是否包含灵感，默认 true').optional(),
        limit: z.number().int().describe('返回条数，默认 10，最多 30').optional(),
      },
    },
    async (args, extra) => {
      aborted(extra.signal);
      const result = searchKnowledge(index(), knowledgeEnv, args);
      return toolResult(result, renderKnowledgeSearch(result));
    },
  );

  server.registerTool(
    KNOWLEDGE_READ_TOOL,
    {
      description: KNOWLEDGE_READ_DESCRIPTION,
      inputSchema: {
        library: z.enum(['personal', 'arsenal']).describe('库 id'),
        path: z.string().describe('库内相对路径：主题目录或文件'),
        offset: z.number().int().describe('长文件接着读的起点（上次结果里给出）').optional(),
      },
    },
    async (args, extra) => {
      aborted(extra.signal);
      const result = readKnowledge(knowledgeEnv, args);
      return toolResult(result, renderKnowledgeRead(result));
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
