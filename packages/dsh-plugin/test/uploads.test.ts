import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openCore, type Attachment, type Core } from '@bluemanta/core';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanupStaleAttachments } from '../src/cleanup.js';
import { DESKTOP_SOURCE } from '../src/commands.js';
import { parseImage } from '../src/images.js';
import { handleAttachmentRead, handleAttachmentUpload } from '../src/uploads.js';

const dirs: string[] = [];

function tempCore(): Core {
  const dir = mkdtempSync(join(tmpdir(), 'bluemanta-upload-'));
  dirs.push(dir);
  return openCore({ dataDir: dir });
}

afterEach(() => {
  while (dirs.length > 0) {
    const dir = dirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

function png(width: number, height: number): Buffer {
  const bytes = Buffer.alloc(24);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(bytes, 0);
  bytes.write('IHDR', 12, 'ascii');
  bytes.writeUInt32BE(width, 16);
  bytes.writeUInt32BE(height, 20);
  return bytes;
}

function jpeg(width: number, height: number): Buffer {
  return Buffer.from([
    0xff, 0xd8,
    0xff, 0xc0, 0x00, 0x0b, 0x08,
    (height >> 8) & 0xff, height & 0xff,
    (width >> 8) & 0xff, width & 0xff,
    0x01, 0x01, 0x11, 0x00,
    0xff, 0xd9,
  ]);
}

function gif(width: number, height: number): Buffer {
  const bytes = Buffer.from('GIF89a', 'ascii');
  const size = Buffer.alloc(4);
  size.writeUInt16LE(width, 0);
  size.writeUInt16LE(height, 2);
  return Buffer.concat([bytes, size, Buffer.from([0, 0, 0])]);
}

function webp(width: number, height: number): Buffer {
  const chunk = Buffer.alloc(18);
  chunk.write('VP8X', 0, 'ascii');
  chunk.writeUInt32LE(10, 4);
  chunk.writeUIntLE(width - 1, 12, 3);
  chunk.writeUIntLE(height - 1, 15, 3);
  const header = Buffer.alloc(12);
  header.write('RIFF', 0, 'ascii');
  header.writeUInt32LE(4 + chunk.length, 4);
  header.write('WEBP', 8, 'ascii');
  return Buffer.concat([header, chunk]);
}

function upload(bytes: Buffer, query: string, contentType = 'application/octet-stream'): Request {
  return new Request(`http://127.0.0.1/api/bluemanta/attachments?${query}`, {
    method: 'POST',
    headers: { 'content-type': contentType },
    body: bytes,
  });
}

async function read(response: Response): Promise<Record<string, unknown>> {
  return response.json() as Promise<Record<string, unknown>>;
}

describe('图片文件头', () => {
  it('识别四种图片的宽高', () => {
    expect(parseImage(png(12, 34))).toEqual({ mime: 'image/png', width: 12, height: 34 });
    expect(parseImage(jpeg(320, 240))).toEqual({ mime: 'image/jpeg', width: 320, height: 240 });
    expect(parseImage(gif(7, 9))).toEqual({ mime: 'image/gif', width: 7, height: 9 });
    expect(parseImage(webp(640, 480))).toEqual({ mime: 'image/webp', width: 640, height: 480 });
    expect(parseImage(Buffer.from('not an image'))).toBeNull();
  });
});

describe('上传与读取', () => {
  it('接受四种图片，记下宽高和 sha256', async () => {
    const core = tempCore();
    try {
      const samples = [
        { bytes: png(3, 5), name: 'a.png', mime: 'image/png', ext: '.png', width: 3, height: 5 },
        { bytes: jpeg(8, 2), name: 'b.jpg', mime: 'image/jpeg', ext: '.jpg', width: 8, height: 2 },
        { bytes: gif(1, 1), name: 'c.gif', mime: 'image/gif', ext: '.gif', width: 1, height: 1 },
        { bytes: webp(11, 13), name: 'd.webp', mime: 'image/webp', ext: '.webp', width: 11, height: 13 },
      ];
      for (const sample of samples) {
        const response = await handleAttachmentUpload(
          core,
          upload(sample.bytes, `requestId=${sample.name}&name=${encodeURIComponent(sample.name)}`, sample.mime),
        );
        expect(response.status, sample.name).toBe(200);
        const body = await read(response);
        const record = body.record as Attachment;
        expect(record).toMatchObject({
          mime: sample.mime,
          byteSize: sample.bytes.byteLength,
          width: sample.width,
          height: sample.height,
          sha256: createHash('sha256').update(sample.bytes).digest('hex'),
          createdBy: DESKTOP_SOURCE,
        });
        expect(record.path).toBe(`media/${record.id}${sample.ext}`);
        expect(existsSync(join(core.dataDir, record.path))).toBe(true);

        const fetched = handleAttachmentRead(core, new Request(`http://127.0.0.1/api/bluemanta/attachment?id=${record.id}`));
        expect(fetched.status).toBe(200);
        expect(fetched.headers.get('content-type')).toBe(sample.mime);
        expect(fetched.headers.get('cache-control')).toContain('max-age=');
        expect(Buffer.from(await fetched.arrayBuffer())).toEqual(sample.bytes);
      }
    } finally {
      core.close();
    }
  });

  it('拒绝伪造扩展名、声明类型不符和超限文件', async () => {
    const core = tempCore();
    try {
      const forged = await handleAttachmentUpload(
        core,
        upload(jpeg(4, 4), 'requestId=forged&name=photo.png', 'image/png'),
      );
      expect(forged.status).toBe(400);
      await expect(read(forged)).resolves.toMatchObject({ message: '文件内容与扩展名不符' });

      const text = await handleAttachmentUpload(
        core,
        upload(Buffer.from('hello png'), 'requestId=text&name=note.png'),
      );
      expect(text.status).toBe(400);
      await expect(read(text)).resolves.toMatchObject({ message: '只接受 jpeg、png、gif、webp 图片' });

      const header = png(2, 2);
      const oversized = Buffer.concat([header, Buffer.alloc(8 * 1024 * 1024)]);
      const huge = await handleAttachmentUpload(core, upload(oversized, 'requestId=huge&name=big.png', 'image/png'));
      expect(huge.status).toBe(400);
      await expect(read(huge)).resolves.toMatchObject({ message: '单张图片不能超过 8 MB' });

      const wide = await handleAttachmentUpload(
        core,
        upload(png(16385, 1), 'requestId=wide&name=wide.png', 'image/png'),
      );
      expect(wide.status).toBe(400);
      await expect(read(wide)).resolves.toMatchObject({ message: '图片宽高不能超过 16384 像素' });
      expect(core.listAttachments()).toEqual([]);
    } finally {
      core.close();
    }
  });

  it('缺少附件返回 404', () => {
    const core = tempCore();
    try {
      const response = handleAttachmentRead(core, new Request('http://127.0.0.1/api/bluemanta/attachment?id=attachment_missing'));
      expect(response.status).toBe(404);
    } finally {
      core.close();
    }
  });
});

describe('未引用附件清理', () => {
  it('启动清理会删除超过 24 小时仍未引用的文件和记录，新的和已引用的留下', async () => {
    const core = tempCore();
    try {
      const oldBytes = png(1, 2);
      const oldUpload = await handleAttachmentUpload(core, upload(oldBytes, 'requestId=old&name=old.png', 'image/png'));
      const oldRecord = (await read(oldUpload)).record as Attachment;
      const fresh = await handleAttachmentUpload(core, upload(png(2, 2), 'requestId=fresh&name=fresh.png', 'image/png'));
      const freshRecord = (await read(fresh)).record as Attachment;
      const used = await handleAttachmentUpload(core, upload(gif(3, 3), 'requestId=used&name=used.gif', 'image/gif'));
      const usedRecord = (await read(used)).record as Attachment;
      const card = core.card.create({
        requestId: 'bind',
        source: DESKTOP_SOURCE,
        cardType: 'idea',
        title: '引用旧图',
        attachmentIds: [usedRecord.id],
      });
      if (!card.ok) throw new Error(card.message);

      expect(cleanupStaleAttachments(core, new Date())).toEqual([]);
      expect(core.getAttachment(freshRecord.id)?.id).toBe(freshRecord.id);

      const later = new Date(Date.now() + 24 * 60 * 60 * 1000 + 5_000);
      const removed = cleanupStaleAttachments(core, later);
      expect(removed.map((item) => item.id).sort()).toEqual([oldRecord.id, freshRecord.id].sort());
      expect(core.getAttachment(oldRecord.id)).toBeNull();
      expect(core.getAttachment(freshRecord.id)).toBeNull();
      expect(core.getAttachment(usedRecord.id)?.id).toBe(usedRecord.id);
      expect(existsSync(join(core.dataDir, oldRecord.path))).toBe(false);
      expect(existsSync(join(core.dataDir, freshRecord.path))).toBe(false);
      expect(existsSync(join(core.dataDir, usedRecord.path))).toBe(true);

      expect(core.getAttachment(usedRecord.id)?.id).toBe(usedRecord.id);
    } finally {
      core.close();
    }
  });
});
