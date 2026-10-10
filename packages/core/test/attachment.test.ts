import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { unreferencedAttachmentCutoff } from '../src/index.js';
import { human, idea, must, req, withCore } from './helpers.js';

const sha = createHash('sha256').update('fiction').digest('hex');

function attachmentInput(overrides: Record<string, unknown> = {}) {
  return {
    requestId: req(),
    source: human,
    mime: 'image/png' as const,
    byteSize: 128,
    width: 32,
    height: 16,
    sha256: sha,
    ...overrides,
  };
}

describe('attachment.create', () => {
  it('写入元数据，路径落在 media/，sha256 转成小写', () => {
    withCore((core) => {
      const created = must(core.attachment.create(attachmentInput({ sha256: sha.toUpperCase() })));
      expect(created).toMatchObject({
        mime: 'image/png',
        byteSize: 128,
        width: 32,
        height: 16,
        sha256: sha,
        path: `media/${created.id}.png`,
        createdBy: human,
        deletedAt: null,
        rev: 1,
      });
      expect(created.id).toMatch(/^attachment_/);
      expect(core.getAttachment(created.id)).toEqual(created);
      expect(core.listHistory({ objectId: created.id })).toHaveLength(1);
    });
  });

  it('拒绝超限、伪造类型和非法 sha256', () => {
    withCore((core) => {
      const cases = [
        attachmentInput({ mime: 'image/svg+xml' }),
        attachmentInput({ mime: 'text/plain' }),
        attachmentInput({ byteSize: 0 }),
        attachmentInput({ byteSize: 8 * 1024 * 1024 + 1 }),
        attachmentInput({ width: 0 }),
        attachmentInput({ height: 16385 }),
        attachmentInput({ width: 16385 }),
        attachmentInput({ sha256: 'abc' }),
        attachmentInput({ sha256: `${'g'.repeat(64)}` }),
      ];
      for (const input of cases) {
        const result = core.attachment.create(input);
        expect(result, JSON.stringify(input)).toMatchObject({ ok: false, code: 'invalid_input' });
      }
      expect(core.listAttachments({ deleted: 'all' })).toEqual([]);
    });
  });

  it('相同 requestId 不重复建记录', () => {
    withCore((core) => {
      const input = attachmentInput({ requestId: 'same-upload' });
      const first = must(core.attachment.create(input));
      const again = must(core.attachment.create(input));
      expect(again).toEqual(first);
      expect(core.listAttachments()).toHaveLength(1);
    });
  });
});

describe('未引用附件', () => {
  it('只清理超过截止时间且无人引用的记录，被引用的留下', () => {
    withCore((core) => {
      const loose = must(core.attachment.create(attachmentInput()));
      const kept = must(core.attachment.create(attachmentInput({ mime: 'image/gif', width: 2, height: 2 })));
      must(core.card.create(idea({ attachmentIds: [kept.id] })));

      const future = new Date(Date.now() + 60_000).toISOString();
      expect(core.listStaleUnreferencedAttachments(future).map((item) => item.id)).toEqual([loose.id]);
      expect(core.listStaleUnreferencedAttachments(new Date(0).toISOString())).toEqual([]);

      const removed = core.deleteUnreferencedAttachmentRecords([loose.id, kept.id, 'attachment_missing']);
      expect(removed.map((item) => item.id)).toEqual([loose.id]);
      expect(core.getAttachment(loose.id)).toBeNull();
      expect(core.getAttachment(kept.id)?.id).toBe(kept.id);
    });
  });

  it('回收站里的卡片仍算引用', () => {
    withCore((core) => {
      const attachment = must(core.attachment.create(attachmentInput()));
      const card = must(core.card.create(idea({ attachmentIds: [attachment.id] })));
      must(core.card.delete({ requestId: req(), source: human, id: card.id, rev: card.rev }));
      const future = new Date(Date.now() + 60_000).toISOString();
      expect(core.listStaleUnreferencedAttachments(future)).toEqual([]);
      expect(core.deleteUnreferencedAttachmentRecords([attachment.id])).toEqual([]);
      expect(core.getAttachment(attachment.id)?.id).toBe(attachment.id);
    });
  });

  it('截止时间是 24 小时前', () => {
    const now = new Date('2026-10-10T03:00:00.000Z');
    expect(unreferencedAttachmentCutoff(now)).toBe('2026-10-09T03:00:00.000Z');
  });
});
