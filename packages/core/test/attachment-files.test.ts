import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  checkImageBytes,
  cleanupStaleAttachments,
  discardPurgedAttachments,
  openCore,
  readImageUpload,
  readStoredFile,
  resolveStoredFile,
  shouldShowRaw,
  writeStoredFile,
  type Core,
} from '../src/index.js';

const dirs: string[] = [];
const cores: Core[] = [];

afterEach(() => {
  while (cores.length > 0) cores.pop()?.close();
  while (dirs.length > 0) {
    const dir = dirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

function tempCore(): Core {
  const dir = mkdtempSync(join(tmpdir(), 'bluemanta-core-files-'));
  dirs.push(dir);
  const core = openCore({ dataDir: dir });
  cores.push(core);
  return core;
}

function png(width: number, height: number): Buffer {
  const bytes = Buffer.alloc(24);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(bytes, 0);
  bytes.write('IHDR', 12, 'ascii');
  bytes.writeUInt32BE(width, 16);
  bytes.writeUInt32BE(height, 20);
  return bytes;
}

const HUMAN = { kind: 'human' as const, name: 'test' };

function storeImage(core: Core, requestId: string): { id: string; file: string } {
  const bytes = png(4, 4);
  const checked = checkImageBytes(bytes);
  if (!checked.ok) throw new Error(checked.message);
  const created = core.attachment.create({
    requestId,
    source: HUMAN,
    mime: checked.mime,
    byteSize: checked.byteSize,
    width: checked.width,
    height: checked.height,
    sha256: checked.sha256,
  });
  if (!created.ok) throw new Error(created.message);
  writeStoredFile(core.dataDir, created.record.path, bytes);
  return { id: created.record.id, file: join(core.dataDir, created.record.path) };
}

describe('图片上传校验', () => {
  it('按文件头识别，核对扩展名和声明类型，算 sha256', async () => {
    const checked = checkImageBytes(png(3, 2), { name: 'a.PNG', contentType: 'image/png; charset=binary' });
    expect(checked).toMatchObject({ ok: true, mime: 'image/png', width: 3, height: 2, byteSize: 24 });
    if (checked.ok) expect(checked.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(checkImageBytes(png(3, 2), { name: 'a.gif' })).toEqual({ ok: false, message: '文件内容与扩展名不符' });
    expect(checkImageBytes(png(3, 2), { contentType: 'image/webp' })).toEqual({
      ok: false,
      message: '文件内容与声明的类型不符',
    });
    expect(checkImageBytes(png(16385, 1))).toEqual({ ok: false, message: '图片宽高不能超过 16384 像素' });
    expect(checkImageBytes(Buffer.from('hello'))).toEqual({ ok: false, message: '只接受 jpeg、png、gif、webp 图片' });
    expect(await readImageUpload(null)).toEqual({ ok: false, message: '没有收到图片' });
    const tooLarge = new Blob([new Uint8Array(8 * 1024 * 1024 + 1)]).stream();
    expect(await readImageUpload(tooLarge)).toEqual({ ok: false, message: '单张图片不能超过 8 MB' });
  });
});

describe('附件文件', () => {
  it('路径只能落在 media/ 之内', () => {
    const core = tempCore();
    expect(resolveStoredFile(core.dataDir, 'media/a.png')).toBe(join(core.dataDir, 'media', 'a.png'));
    expect(resolveStoredFile(core.dataDir, 'store.sqlite')).toBeNull();
    expect(resolveStoredFile(core.dataDir, 'media/../store.sqlite')).toBeNull();
    expect(resolveStoredFile(core.dataDir, 'media')).toBeNull();
    expect(() => writeStoredFile(core.dataDir, '../escape.png', Buffer.from('x'))).toThrow();
    writeFileSync(join(core.dataDir, 'outside.txt'), 'x');
    expect(readStoredFile(core.dataDir, 'outside.txt')).toBeNull();
    expect(readStoredFile(core.dataDir, 'media/missing.png')).toBeNull();
  });

  it('彻底删除后只清掉不再被引用的附件', () => {
    const core = tempCore();
    const shared = storeImage(core, 'img-shared');
    const own = storeImage(core, 'img-own');
    const first = core.card.create({
      requestId: 'c1',
      source: HUMAN,
      cardType: 'idea',
      title: '虚构 1',
      attachmentIds: [shared.id, own.id],
    });
    const second = core.card.create({ requestId: 'c2', source: HUMAN, cardType: 'idea', title: '虚构 2', attachmentIds: [shared.id] });
    if (!first.ok || !second.ok) throw new Error('create failed');
    const trashed = core.card.delete({ requestId: 'd1', source: HUMAN, id: first.record.id, rev: first.record.rev });
    if (!trashed.ok) throw new Error(trashed.message);
    const purged = core.card.purge({ requestId: 'p1', source: HUMAN, id: first.record.id, rev: trashed.record.rev });
    if (!purged.ok) throw new Error(purged.message);

    const removed = discardPurgedAttachments(core, purged.record.attachmentIds);
    expect(removed.map((attachment) => attachment.id)).toEqual([own.id]);
    expect(existsSync(own.file)).toBe(false);
    expect(core.getAttachment(own.id)).toBeNull();
    expect(existsSync(shared.file)).toBe(true);
    expect(core.getAttachment(shared.id)).not.toBeNull();
  });

  it('启动清理只删超过 24 小时仍未被引用的附件', () => {
    const core = tempCore();
    const orphan = storeImage(core, 'img-orphan');
    expect(cleanupStaleAttachments(core)).toEqual([]);
    const later = new Date(Date.now() + 25 * 60 * 60 * 1000);
    expect(cleanupStaleAttachments(core, later).map((attachment) => attachment.id)).toEqual([orphan.id]);
    expect(existsSync(orphan.file)).toBe(false);
  });
});

describe('原文是否显示', () => {
  it('同 idea-ui.md 第 3 节', () => {
    const present = { status: 'present' as const, channel: 'web' as const, text: '用户原话' };
    expect(shouldShowRaw('整理后的正文', present)).toBe(true);
    expect(shouldShowRaw('前缀 用户原话 后缀', present)).toBe(false);
    expect(shouldShowRaw('用户   原话', { ...present, text: '用户 原话' })).toBe(false);
    expect(shouldShowRaw('整理后的正文', { status: 'legacy' })).toBe(false);
    expect(shouldShowRaw('整理后的正文', { ...present, text: '  ' })).toBe(false);
  });
});
