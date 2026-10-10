import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { openCore, type Core } from '@bluemanta/core';
import { afterEach, describe, expect, it } from 'vitest';
import { DESKTOP_SOURCE, handleCommands, statusForCommandCode } from '../src/commands.js';

const dirs: string[] = [];

function tempCore(): Core {
  const dir = mkdtempSync(join(tmpdir(), 'bluemanta-commands-'));
  dirs.push(dir);
  return openCore({ dataDir: dir });
}

afterEach(() => {
  while (dirs.length > 0) {
    const dir = dirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

function post(body: unknown): Request {
  return new Request('http://127.0.0.1/api/bluemanta/commands', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function read(response: Response): Promise<Record<string, unknown>> {
  return response.json() as Promise<Record<string, unknown>>;
}

describe('命令接口', () => {
  it('白名单之外的命令返回 400', async () => {
    const core = tempCore();
    try {
      for (const command of ['project.create', 'task.purge', 'attachment.create', 'card.nope', '']) {
        const response = await handleCommands(core, post({ command, input: { requestId: 'x' } }));
        expect(response.status, command).toBe(400);
        await expect(read(response)).resolves.toMatchObject({ ok: false, code: 'invalid_input', message: '不支持的命令' });
      }
    } finally {
      core.close();
    }
  });

  it('忽略请求里的 source，强制记为桌面端的人', async () => {
    const core = tempCore();
    try {
      const response = await handleCommands(core, post({
        command: 'card.create',
        input: {
          requestId: 'create-1',
          source: { kind: 'agent', name: '伪装' },
          cardType: 'idea',
          title: '虚构灵感',
          body: '正文',
        },
      }));
      expect(response.status).toBe(200);
      const body = await read(response);
      expect(body.ok).toBe(true);
      const record = body.record as { createdBy: unknown; updatedBy: unknown; title: string };
      expect(record.createdBy).toEqual(DESKTOP_SOURCE);
      expect(record.updatedBy).toEqual(DESKTOP_SOURCE);
      expect(record.title).toBe('虚构灵感');

      const starred = await handleCommands(core, post({
        command: 'card.setStar',
        input: {
          requestId: 'star-1',
          source: { kind: 'agent', name: '伪装' },
          id: (body.record as { id: string }).id,
          rev: (body.record as { rev: number }).rev,
          starred: true,
        },
      }));
      expect(starred.status).toBe(200);
      const starBody = await read(starred);
      expect((starBody.record as { starred: boolean }).starred).toBe(true);
    } finally {
      core.close();
    }
  });

  it('把 core 的错误码映射成 HTTP 状态，并带上 message', async () => {
    expect(statusForCommandCode('invalid_input')).toBe(400);
    expect(statusForCommandCode('not_found')).toBe(404);
    expect(statusForCommandCode('version_conflict')).toBe(409);
    expect(statusForCommandCode('duplicate_request_mismatch')).toBe(409);
    expect(statusForCommandCode('forbidden_source')).toBe(403);

    const core = tempCore();
    try {
      const missing = await handleCommands(core, post({
        command: 'card.update',
        input: { requestId: 'missing', id: 'card_missing', rev: 1, title: '没有' },
      }));
      expect(missing.status).toBe(404);
      const missingBody = await read(missing);
      expect(missingBody).toMatchObject({ ok: false, code: 'not_found' });
      expect(missingBody.message).toEqual(expect.any(String));

      const created = await handleCommands(core, post({
        command: 'card.create',
        input: { requestId: 'map-create', cardType: 'idea', title: '用来冲突' },
      }));
      const record = (await read(created)).record as { id: string; rev: number };
      const conflict = await handleCommands(core, post({
        command: 'card.update',
        input: { requestId: 'conflict', id: record.id, rev: record.rev + 3, body: '改' },
      }));
      expect(conflict.status).toBe(409);
      await expect(read(conflict)).resolves.toMatchObject({ code: 'version_conflict' });

      const invalid = await handleCommands(core, post({
        command: 'card.create',
        input: { requestId: 'empty', cardType: 'idea', title: '', body: '' },
      }));
      expect(invalid.status).toBe(400);
      await expect(read(invalid)).resolves.toMatchObject({ code: 'invalid_input' });

      const first = await handleCommands(core, post({
        command: 'card.create',
        input: { requestId: 'dup', cardType: 'idea', title: '第一次' },
      }));
      expect(first.status).toBe(200);
      const mismatch = await handleCommands(core, post({
        command: 'card.create',
        input: { requestId: 'dup', cardType: 'idea', title: '第二次不一样' },
      }));
      expect(mismatch.status).toBe(409);
      await expect(read(mismatch)).resolves.toMatchObject({ code: 'duplicate_request_mismatch' });
    } finally {
      core.close();
    }
  });

  it('forbidden_source 映射为 403', async () => {
    const stub = {
      dataDir: '/tmp/unused',
      card: {
        create: () => ({ ok: false as const, code: 'forbidden_source' as const, message: '只能由人执行' }),
        update: () => { throw new Error('unused'); },
        delete: () => { throw new Error('unused'); },
        restore: () => { throw new Error('unused'); },
        purge: () => { throw new Error('unused'); },
        setStar: () => { throw new Error('unused'); },
        addExtension: () => { throw new Error('unused'); },
        deleteExtension: () => { throw new Error('unused'); },
      },
      deleteUnreferencedAttachmentRecords: () => [],
    };
    const response = await handleCommands(stub, post({
      command: 'card.create',
      input: { requestId: 'forbid', cardType: 'idea', title: '不会写入' },
    }));
    expect(response.status).toBe(403);
    await expect(read(response)).resolves.toEqual({ ok: false, code: 'forbidden_source', message: '只能由人执行' });
  });

  it('彻底删除后删掉不再被引用的附件文件', async () => {
    const core = tempCore();
    try {
      const uploaded = core.attachment.create({
        requestId: 'file-1',
        source: DESKTOP_SOURCE,
        mime: 'image/png',
        byteSize: 8,
        width: 1,
        height: 1,
        sha256: 'ab'.repeat(32),
      });
      if (!uploaded.ok) throw new Error(uploaded.message);
      const absolute = join(core.dataDir, uploaded.record.path);
      mkdirSync(dirname(absolute), { recursive: true });
      writeFileSync(absolute, Buffer.from('not-really'));
      const shared = core.attachment.create({
        requestId: 'file-2',
        source: DESKTOP_SOURCE,
        mime: 'image/gif',
        byteSize: 4,
        width: 2,
        height: 2,
        sha256: 'cd'.repeat(32),
      });
      if (!shared.ok) throw new Error(shared.message);
      writeFileSync(join(core.dataDir, shared.record.path), Buffer.from('keep'));

      const created = await handleCommands(core, post({
        command: 'card.create',
        input: {
          requestId: 'with-file',
          cardType: 'idea',
          title: '带图',
          attachmentIds: [uploaded.record.id, shared.record.id],
        },
      }));
      const card = (await read(created)).record as { id: string; rev: number };
      const other = await handleCommands(core, post({
        command: 'card.create',
        input: {
          requestId: 'keeps-shared',
          cardType: 'idea',
          title: '还用着这张图',
          attachmentIds: [shared.record.id],
        },
      }));
      expect(other.status).toBe(200);

      const deleted = await handleCommands(core, post({
        command: 'card.delete',
        input: { requestId: 'trash-it', id: card.id, rev: card.rev },
      }));
      const trashed = (await read(deleted)).record as { id: string; rev: number };
      const purged = await handleCommands(core, post({
        command: 'card.purge',
        input: { requestId: 'purge-it', id: trashed.id, rev: trashed.rev },
      }));
      expect(purged.status).toBe(200);
      expect(core.getAttachment(uploaded.record.id)).toBeNull();
      expect(core.getAttachment(shared.record.id)?.id).toBe(shared.record.id);
      expect(existsSync(absolute)).toBe(false);
      expect(existsSync(join(core.dataDir, shared.record.path))).toBe(true);
    } finally {
      core.close();
    }
  });
});
