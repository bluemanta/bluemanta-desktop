import type { Core } from '@bluemanta/core';
import { defineTool } from '@deepseek-ai/dsh-tools';
import type { HostContext } from './context.js';
import {
  CAPTURE_DESCRIPTION,
  GET_DESCRIPTION,
  IDEA_CAPTURE_TOOL,
  IDEA_CATEGORY_VALUES,
  IDEA_GET_TOOL,
  IDEA_SEARCH_TOOL,
  SEARCH_DESCRIPTION,
  SEARCH_LIMIT_DEFAULT,
  captureIdea,
  getIdea,
  ideaRequestId,
  renderCapture,
  renderGet,
  renderSearch,
  searchIdeas,
} from './idea-tools.js';

function categoryParameter() {
  return {
    type: 'string' as const,
    enum: IDEA_CATEGORY_VALUES,
    description: '可选分类：product 产品想法、learning 学习备忘、work 工作事务、life 生活随想、other 其他',
  };
}

function aborted(signal: AbortSignal): void {
  if (signal.aborted) throw new DOMException('The operation was aborted', 'AbortError');
}

/** 把三个灵感工具注册进宿主的工具表。返回值用于卸载。 */
export function registerIdeaTools(ctx: HostContext, core: Core): Array<() => void> {
  const disposeCapture = ctx.tools.register(defineTool({
    name: IDEA_CAPTURE_TOOL,
    description: CAPTURE_DESCRIPTION,
    parameters: {
      body: { type: 'string', description: '灵感正文。与 title 至少一个非空' },
      title: { type: 'string', description: '可选标题。省略或空字符串时按正文生成兜底标题' },
      category: categoryParameter(),
    },
    output: {
      schema: {
        oneOf: [
          {
            type: 'object',
            additionalProperties: false,
            properties: {
              ok: { type: 'boolean', const: true, required: true },
              id: { type: 'string', required: true },
              title: { type: 'string', required: true },
              category: { type: 'string', required: true },
              fallbackTitle: { type: 'boolean', required: true },
            },
          },
          {
            type: 'object',
            additionalProperties: false,
            properties: {
              ok: { type: 'boolean', const: false, required: true },
              error: { type: 'string', required: true },
            },
          },
        ],
      },
      render: (_args, value) => [{ type: 'text', text: renderCapture(value) }],
    },
    async execute(args, exec) {
      aborted(exec.signal);
      return captureIdea(core, {
        requestId: ideaRequestId(exec.callId),
        ...(args.body === undefined ? {} : { body: args.body }),
        ...(args.title === undefined ? {} : { title: args.title }),
        ...(args.category === undefined ? {} : { category: args.category }),
      });
    },
  }));

  const disposeSearch = ctx.tools.register(defineTool({
    name: IDEA_SEARCH_TOOL,
    description: SEARCH_DESCRIPTION,
    parameters: {
      query: { type: 'string', required: true, description: '关键词。按空白分开，每个词都要命中' },
      limit: {
        type: 'integer',
        description: '返回条数，默认 10，最大 50',
        default: SEARCH_LIMIT_DEFAULT,
      },
      category: categoryParameter(),
      starredOnly: { type: 'boolean', description: '为 true 时只返回已收藏的灵感' },
    },
    output: {
      schema: {
        oneOf: [
          {
            type: 'object',
            additionalProperties: false,
            properties: {
              ok: { type: 'boolean', const: true, required: true },
              count: { type: 'integer', required: true },
              limit: { type: 'integer', required: true },
              message: { type: 'string', required: true },
              items: {
                type: 'array',
                required: true,
                items: {
                  type: 'object',
                  additionalProperties: false,
                  properties: {
                    id: { type: 'string', required: true },
                    title: { type: 'string', required: true },
                    category: { type: 'string', required: true },
                    createdAt: { type: 'string', required: true },
                    field: {
                      type: 'string',
                      enum: ['title', 'body', 'rawInput', 'category'],
                      required: true,
                    },
                    excerpt: { type: 'string', required: true },
                  },
                },
              },
            },
          },
          {
            type: 'object',
            additionalProperties: false,
            properties: {
              ok: { type: 'boolean', const: false, required: true },
              error: { type: 'string', required: true },
            },
          },
        ],
      },
      render: (_args, value) => [{ type: 'text', text: renderSearch(value) }],
    },
    isConcurrencySafe: () => true,
    async execute(args, exec) {
      aborted(exec.signal);
      return searchIdeas(core, {
        query: args.query,
        ...(args.limit === undefined ? {} : { limit: args.limit }),
        ...(args.category === undefined ? {} : { category: args.category }),
        ...(args.starredOnly === undefined ? {} : { starredOnly: args.starredOnly }),
      });
    },
  }));

  const disposeGet = ctx.tools.register(defineTool({
    name: IDEA_GET_TOOL,
    description: GET_DESCRIPTION,
    parameters: {
      id: { type: 'string', required: true, description: '灵感 id' },
    },
    output: {
      schema: {
        oneOf: [
          {
            type: 'object',
            additionalProperties: false,
            properties: {
              ok: { type: 'boolean', const: true, required: true },
              id: { type: 'string', required: true },
              title: { type: 'string', required: true },
              body: { type: 'string', required: true },
              category: { type: 'string', required: true },
              starred: { type: 'boolean', required: true },
              createdAt: { type: 'string', required: true },
              createdAtLocal: { type: 'string', required: true },
              inTrash: { type: 'boolean', required: true },
              notice: { type: 'string', required: true },
              extensions: {
                type: 'array',
                required: true,
                items: {
                  type: 'object',
                  additionalProperties: false,
                  properties: {
                    id: { type: 'string', required: true },
                    body: { type: 'string', required: true },
                    createdAt: { type: 'string', required: true },
                    createdAtLocal: { type: 'string', required: true },
                  },
                },
              },
              rawInput: {
                required: true,
                oneOf: [
                  {
                    type: 'object',
                    additionalProperties: false,
                    properties: {
                      status: { type: 'string', const: 'present', required: true },
                      channel: { type: 'string', enum: ['web', 'bot', 'agent'], required: true },
                      text: { type: 'string', required: true },
                    },
                  },
                  {
                    type: 'object',
                    additionalProperties: false,
                    properties: {
                      status: { type: 'string', const: 'legacy', required: true },
                      note: { type: 'string', const: '无原文', required: true },
                    },
                  },
                ],
              },
            },
          },
          {
            type: 'object',
            additionalProperties: false,
            properties: {
              ok: { type: 'boolean', const: false, required: true },
              error: { type: 'string', required: true },
            },
          },
        ],
      },
      render: (_args, value) => [{ type: 'text', text: renderGet(value) }],
    },
    isConcurrencySafe: () => true,
    async execute(args, exec) {
      aborted(exec.signal);
      return getIdea(core, { id: args.id });
    },
  }));

  return [disposeCapture, disposeSearch, disposeGet];
}
