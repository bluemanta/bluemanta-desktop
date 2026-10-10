import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openCore, type Core } from '@bluemanta/core';
import { afterEach, describe, expect, it } from 'vitest';
import {
  IDEA_CAPTURE_TOOL,
  IDEA_GET_TOOL,
  IDEA_SEARCH_TOOL,
} from '@bluemanta/cli/idea-tools';
import { captureWithClient, clientSourceName, mcpCaptureRequestId, mcpProcessToken } from '../src/server.js';

const mcpJs = fileURLToPath(new URL('../dist/mcp.js', import.meta.url));
const dirs: string[] = [];

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'bluemanta-mcp-'));
  dirs.push(dir);
  return dir;
}

function tempCore(): Core {
  return openCore({ dataDir: tempDir() });
}

afterEach(() => {
  while (dirs.length > 0) {
    const dir = dirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

describe('请求号和来源名', () => {
  it('客户端名缺省为 mcp，请求号带进程随机串', () => {
    expect(clientSourceName(undefined)).toBe('mcp');
    expect(clientSourceName('   ')).toBe('mcp');
    expect(clientSourceName(' Claude Code ')).toBe('Claude Code');
    expect(mcpCaptureRequestId(undefined, 'boot')).toBeNull();
    expect(mcpCaptureRequestId('  ', 'boot')).toBeNull();
    expect(mcpCaptureRequestId(7, '')).toBeNull();
    expect(mcpCaptureRequestId(7, 'boot')).toBe('mcp:boot:7');
    expect(mcpCaptureRequestId(7, 'other')).toBe('mcp:other:7');
    expect(mcpCaptureRequestId(7)).toBe(`mcp:${mcpProcessToken}:7`);
  });

  it('同一个 MCP 请求号重试不重复写入，来源使用客户端名', () => {
    const core = tempCore();
    try {
      const first = captureWithClient(
        core,
        { body: '虚构的 MCP 正文', title: '虚构 MCP 标题' },
        { requestId: 'call-1', clientName: 'Codex' },
      );
      const second = captureWithClient(
        core,
        { body: '虚构的 MCP 正文', title: '虚构 MCP 标题' },
        { requestId: 'call-1', clientName: 'Codex' },
      );
      expect(first.ok).toBe(true);
      expect(second).toMatchObject({ ok: true, id: first.ok ? first.id : '' });
      expect(core.listCards({ cardType: 'idea' })).toHaveLength(1);
      expect(core.listHistory().map((entry) => entry.requestId)).toEqual([`mcp:${mcpProcessToken}:call-1`]);
      const card = core.getCard(first.ok ? first.id : '');
      expect(card?.createdBy).toEqual({ kind: 'agent', name: 'Codex' });
      expect(card?.rawInput).toEqual({
        status: 'present',
        channel: 'agent',
        text: '虚构的 MCP 正文',
      });
    } finally {
      core.close();
    }
  });
});

function serverEnv(dataDir: string): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (typeof value === 'string') env[key] = value;
  }
  env.BLUEMANTA_DATA_DIR = dataDir;
  return env;
}

/** 独立进程：先 listTools，再 capture。调用顺序与验收复现一致。 */
async function captureInNewProcess(dataDir: string, body: string): Promise<{ ok?: boolean; id?: string; error?: string }> {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [mcpJs],
    env: serverEnv(dataDir),
    stderr: 'pipe',
  });
  const client = new Client({ name: 'fixture-mcp', version: '0.0.0' });
  try {
    await client.connect(transport);
    await client.listTools();
    const captured = await client.callTool({
      name: IDEA_CAPTURE_TOOL,
      arguments: { title: '跨进程虚构标题', body },
    });
    return (captured.structuredContent ?? {}) as { ok?: boolean; id?: string; error?: string };
  } finally {
    await client.close();
  }
}

describe('stdio MCP 服务', () => {
  it('两个进程按相同顺序写入不同内容，都会成功', async () => {
    const dataDir = tempDir();
    const first = await captureInNewProcess(dataDir, '第一段虚构正文');
    const second = await captureInNewProcess(dataDir, '第二段虚构正文');
    expect(first).toMatchObject({ ok: true });
    expect(second).toMatchObject({ ok: true });
    expect(first.id).not.toBe(second.id);

    const core = openCore({ dataDir });
    try {
      expect(core.listCards({ cardType: 'idea' })).toHaveLength(2);
      const requestIds = core.listHistory().map((entry) => entry.requestId);
      expect(new Set(requestIds).size).toBe(2);
      for (const requestId of requestIds) expect(requestId).toMatch(/^mcp:[^:]+:/);
    } finally {
      core.close();
    }
  });

  it('列出三个工具，并能记录、查找、读取', async () => {
    const dataDir = tempDir();
    const stderr: string[] = [];
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [mcpJs],
      env: serverEnv(dataDir),
      stderr: 'pipe',
    });
    transport.stderr?.on('data', (chunk: Buffer | string) => {
      stderr.push(String(chunk));
    });
    const client = new Client({ name: 'fixture-mcp', version: '0.0.0' });
    try {
      await client.connect(transport);
      const listed = await client.listTools();
      expect(listed.tools.map((tool) => tool.name)).toEqual([
        IDEA_CAPTURE_TOOL,
        IDEA_SEARCH_TOOL,
        IDEA_GET_TOOL,
      ]);

      const captured = await client.callTool({
        name: IDEA_CAPTURE_TOOL,
        arguments: { title: '虚构 MCP 标题', body: '虚构的 MCP 正文里有独有检索词', category: 'learning' },
      });
      const capturedBody = captured.structuredContent as { ok: boolean; id?: string; title?: string; category?: string };
      expect(captured.isError).not.toBe(true);
      expect(capturedBody).toMatchObject({
        ok: true,
        title: '虚构 MCP 标题',
        category: '学习备忘',
      });
      expect(captured.content).toEqual([
        expect.objectContaining({ type: 'text', text: expect.stringContaining('虚构 MCP 标题') }),
      ]);

      const searched = await client.callTool({
        name: IDEA_SEARCH_TOOL,
        arguments: { query: '独有检索词', limit: 10 },
      });
      expect(searched.structuredContent).toMatchObject({
        ok: true,
        count: 1,
        message: '',
        items: [expect.objectContaining({ id: capturedBody.id, field: 'body' })],
      });

      const got = await client.callTool({
        name: IDEA_GET_TOOL,
        arguments: { id: capturedBody.id },
      });
      expect(got.structuredContent).toMatchObject({
        ok: true,
        id: capturedBody.id,
        body: '虚构的 MCP 正文里有独有检索词',
        rawInput: { status: 'present', channel: 'agent', text: '虚构的 MCP 正文里有独有检索词' },
      });

      const empty = await client.callTool({
        name: IDEA_CAPTURE_TOOL,
        arguments: { title: '   ', body: ' ' },
      });
      expect(empty.structuredContent).toMatchObject({ ok: false });
      expect(empty.structuredContent).not.toHaveProperty('code');

      const log = stderr.join('');
      expect(log).not.toContain('独有检索词');
      expect(log).not.toContain('虚构 MCP 标题');
    } finally {
      await client.close();
    }

    const core = openCore({ dataDir });
    try {
      const cards = core.listCards({ cardType: 'idea' });
      expect(cards).toHaveLength(1);
      expect(cards[0]?.createdBy).toEqual({ kind: 'agent', name: 'fixture-mcp' });
    } finally {
      core.close();
    }
  });
});
