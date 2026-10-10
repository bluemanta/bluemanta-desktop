import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openCore, type Core } from '@bluemanta/core';
import { validateJsonSchemaValue, type ToolDefinition as DshToolDefinition } from '@deepseek-ai/dsh-tools';
import { afterEach, describe, expect, it } from 'vitest';
import type { HostContext } from '../src/context.js';
import { IDEA_CAPTURE_TOOL, IDEA_GET_TOOL, IDEA_SEARCH_TOOL } from '../src/idea-tools.js';
import { registerIdeaTools } from '../src/register-idea-tools.js';

const human = { kind: 'human' as const, name: '测试者' };
const dirs: string[] = [];

function tempCore(): Core {
  const dir = mkdtempSync(join(tmpdir(), 'bluemanta-idea-schema-'));
  dirs.push(dir);
  return openCore({ dataDir: dir });
}

afterEach(() => {
  while (dirs.length > 0) {
    const dir = dirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

type RegisteredTool = DshToolDefinition;

function registeredTools(core: Core): RegisteredTool[] {
  const tools: RegisteredTool[] = [];
  const ctx = {
    tools: {
      register(definition: RegisteredTool) {
        tools.push(definition);
        return () => undefined;
      },
    },
  } as HostContext;
  registerIdeaTools(ctx, core);
  return tools;
}

function toolNamed(tools: readonly RegisteredTool[], name: string): RegisteredTool {
  const found = tools.find((tool) => tool.name === name);
  if (!found) throw new Error(`缺少工具 ${name}`);
  return found;
}

function exec(callId: string) {
  return { callId, signal: new AbortController().signal } as never;
}

function expectValid(tool: RegisteredTool, args: unknown, value: unknown): void {
  const violations = validateJsonSchemaValue(tool.output.schema, value, '');
  expect(violations, JSON.stringify(value)).toEqual([]);
  const rendered = tool.output.render(args, value as never);
  expect(rendered[0]).toMatchObject({ type: 'text' });
}

describe('工具输出符合声明的 schema', () => {
  it('记录、查找、读取的成功和失败结果都能通过校验', async () => {
    const core = tempCore();
    try {
      const tools = registeredTools(core);
      expect(tools.map((tool) => tool.name)).toEqual([IDEA_CAPTURE_TOOL, IDEA_SEARCH_TOOL, IDEA_GET_TOOL]);
      const capture = toolNamed(tools, IDEA_CAPTURE_TOOL);
      const search = toolNamed(tools, IDEA_SEARCH_TOOL);
      const get = toolNamed(tools, IDEA_GET_TOOL);

      const captured = await capture.execute({ body: 'schema 虚构灵感' }, exec('schema-capture'));
      expectValid(capture, { body: 'schema 虚构灵感' }, captured);

      const empty = await capture.execute({ title: '   ', body: ' ' }, exec('schema-empty'));
      expectValid(capture, { title: '   ', body: ' ' }, empty);
      expect(empty).toMatchObject({ ok: false });

      const hits = await search.execute({ query: 'schema' }, exec('schema-search'));
      expectValid(search, { query: 'schema' }, hits);

      const none = await search.execute({ query: '不存在的虚构词' }, exec('schema-none'));
      expectValid(search, { query: '不存在的虚构词' }, none);
      expect(none).toMatchObject({ ok: true, message: '没有找到' });

      const badLimit = await search.execute({ query: 'schema', limit: 0 }, exec('schema-limit'));
      expectValid(search, { query: 'schema', limit: 0 }, badLimit);

      const id = (captured as { id: string }).id;
      const loaded = await get.execute({ id }, exec('schema-get'));
      expectValid(get, { id }, loaded);

      const legacy = core.card.create({
        requestId: 'schema-legacy',
        source: human,
        cardType: 'idea',
        title: '旧的',
        body: '旧正文',
        rawInput: { status: 'legacy' },
      });
      if (!legacy.ok) throw new Error(legacy.message);
      core.card.delete({ requestId: 'schema-delete', source: human, id: legacy.record.id, rev: legacy.record.rev });
      const trashed = await get.execute({ id: legacy.record.id }, exec('schema-trash'));
      expectValid(get, { id: legacy.record.id }, trashed);
      expect(trashed).toMatchObject({
        ok: true,
        notice: '在回收站中',
        rawInput: { status: 'legacy', note: '无原文' },
      });

      const missing = await get.execute({ id: 'card_missing' }, exec('schema-missing'));
      expectValid(get, { id: 'card_missing' }, missing);

      await expect(search.execute({ query: 'schema', category: 'nope' }, exec('schema-bad'))).rejects.toThrow();
    } finally {
      core.close();
    }
  });
});
