import {
  KNOWLEDGE_READ_DESCRIPTION,
  KNOWLEDGE_READ_TOOL,
  KNOWLEDGE_ROUTE_DESCRIPTION,
  KNOWLEDGE_ROUTE_TOOL,
  KNOWLEDGE_SEARCH_DESCRIPTION,
  KNOWLEDGE_SEARCH_LIMIT_DEFAULT,
  KNOWLEDGE_SEARCH_TOOL,
  readKnowledge,
  renderKnowledgeRead,
  renderKnowledgeRoute,
  renderKnowledgeSearch,
  routeKnowledge,
  searchKnowledge,
} from '@bluemanta/cli/knowledge-tools';
import type { KnowledgeEnv, KnowledgeIndex } from '@bluemanta/knowledge';
import { defineTool } from '@deepseek-ai/dsh-tools';
import type { HostContext } from './context.js';

function aborted(signal: AbortSignal): void {
  if (signal.aborted) throw new DOMException('The operation was aborted', 'AbortError');
}

const LIBRARY = {
  type: 'string' as const,
  enum: ['personal', 'arsenal'],
  description: 'personal 个人库，arsenal 售前主题库（只读）',
};

const FAILURE = {
  type: 'object',
  additionalProperties: false,
  properties: {
    ok: { type: 'boolean', const: false, required: true },
    error: { type: 'string', required: true },
  },
} as const;

const STRINGS = { type: 'array', items: { type: 'string' }, required: true } as const;

/**
 * 三个只读知识工具（ADR 0009，KB5）。执行逻辑和说明在 `@bluemanta/cli/knowledge-tools`，MCP 共用。
 * 索引由调用方按需打开，返回值用于卸载。
 */
export function registerKnowledgeTools(ctx: HostContext, env: KnowledgeEnv, index: () => KnowledgeIndex): Array<() => void> {
  const disposeRoute = ctx.tools.register(defineTool({
    name: KNOWLEDGE_ROUTE_TOOL,
    description: KNOWLEDGE_ROUTE_DESCRIPTION,
    parameters: {
      query: { type: 'string', required: true, description: '用户的问题或关键词' },
      library: LIBRARY,
      limit: { type: 'integer', description: '候选主题数，默认 5，最多 10', default: 5 },
    },
    output: {
      schema: {
        oneOf: [
          {
            type: 'object',
            additionalProperties: false,
            properties: {
              ok: { type: 'boolean', const: true, required: true },
              query: { type: 'string', required: true },
              candidates: {
                type: 'array',
                required: true,
                items: {
                  type: 'object',
                  additionalProperties: false,
                  properties: {
                    library: { type: 'string', required: true },
                    topicPath: { type: 'string', required: true },
                    name: { type: 'string', required: true },
                    category: { type: 'string', required: true },
                    matched: STRINGS,
                    readOrder: STRINGS,
                  },
                },
              },
            },
          },
          FAILURE,
        ],
      },
      render: (_args, value) => [{ type: 'text', text: renderKnowledgeRoute(value) }],
    },
    isConcurrencySafe: () => true,
    async execute(args, exec) {
      aborted(exec.signal);
      return routeKnowledge(index(), env, {
        query: args.query,
        ...(args.library === undefined ? {} : { library: args.library }),
        ...(args.limit === undefined ? {} : { limit: args.limit }),
      });
    },
  }));

  const disposeSearch = ctx.tools.register(defineTool({
    name: KNOWLEDGE_SEARCH_TOOL,
    description: KNOWLEDGE_SEARCH_DESCRIPTION,
    parameters: {
      query: { type: 'string', required: true, description: '关键词，按空白分开' },
      library: LIBRARY,
      includeIdeas: { type: 'boolean', description: '是否包含灵感，默认 true；指定 library 时不含灵感' },
      limit: { type: 'integer', description: '返回条数，默认 10，最多 30', default: KNOWLEDGE_SEARCH_LIMIT_DEFAULT },
    },
    output: {
      schema: {
        oneOf: [
          {
            type: 'object',
            additionalProperties: false,
            properties: {
              ok: { type: 'boolean', const: true, required: true },
              query: { type: 'string', required: true },
              keywords: STRINGS,
              count: { type: 'integer', required: true },
              items: {
                type: 'array',
                required: true,
                items: {
                  type: 'object',
                  additionalProperties: false,
                  properties: {
                    source: { type: 'string', enum: ['library', 'idea'], required: true },
                    library: { type: 'string', required: true },
                    path: { type: 'string', required: true },
                    ideaId: { type: 'string', required: true },
                    title: { type: 'string', required: true },
                    headings: STRINGS,
                    topic: { type: 'string', required: true },
                    archived: { type: 'boolean', required: true },
                    excerpt: { type: 'string', required: true },
                  },
                },
              },
            },
          },
          FAILURE,
        ],
      },
      render: (_args, value) => [{ type: 'text', text: renderKnowledgeSearch(value) }],
    },
    isConcurrencySafe: () => true,
    async execute(args, exec) {
      aborted(exec.signal);
      return searchKnowledge(index(), env, {
        query: args.query,
        ...(args.library === undefined ? {} : { library: args.library }),
        ...(args.includeIdeas === undefined ? {} : { includeIdeas: args.includeIdeas }),
        ...(args.limit === undefined ? {} : { limit: args.limit }),
      });
    },
  }));

  const disposeRead = ctx.tools.register(defineTool({
    name: KNOWLEDGE_READ_TOOL,
    description: KNOWLEDGE_READ_DESCRIPTION,
    parameters: {
      library: { ...LIBRARY, required: true },
      path: { type: 'string', required: true, description: '库内相对路径：主题目录或文件' },
      offset: { type: 'integer', description: '长文件接着读的起点（上次结果里给出）' },
    },
    output: {
      schema: {
        oneOf: [
          {
            type: 'object',
            additionalProperties: false,
            properties: {
              ok: { type: 'boolean', const: true, required: true },
              library: { type: 'string', required: true },
              path: { type: 'string', required: true },
              kind: { type: 'string', enum: ['markdown', 'file', 'topic'], required: true },
              displayPath: { type: 'string', required: true },
              content: { type: 'string', required: true },
              offset: { type: 'integer', required: true },
              nextOffset: { oneOf: [{ type: 'integer' }, { type: 'null' }], required: true },
              files: STRINGS,
            },
          },
          FAILURE,
        ],
      },
      render: (_args, value) => [{ type: 'text', text: renderKnowledgeRead(value) }],
    },
    isConcurrencySafe: () => true,
    async execute(args, exec) {
      aborted(exec.signal);
      return readKnowledge(env, {
        library: args.library,
        path: args.path,
        ...(args.offset === undefined ? {} : { offset: args.offset }),
      });
    },
  }));

  return [disposeRoute, disposeSearch, disposeRead];
}
