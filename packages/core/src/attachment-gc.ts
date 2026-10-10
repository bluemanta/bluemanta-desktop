import type { DatabaseSync } from 'node:sqlite';
import {
  deleteAttachment,
  getAttachment,
  listAttachments,
  referencedAttachmentIds,
} from './rows.js';
import type { Attachment } from './types.js';

export const UNREFERENCED_ATTACHMENT_TTL_MS = 24 * 60 * 60 * 1000;

export function unreferencedAttachmentCutoff(now: Date): string {
  return new Date(now.getTime() - UNREFERENCED_ATTACHMENT_TTL_MS).toISOString();
}

function isAtOrBefore(createdAt: string, cutoffIso: string): boolean {
  const created = Date.parse(createdAt);
  const cutoff = Date.parse(cutoffIso);
  return Number.isFinite(created) && Number.isFinite(cutoff) && created <= cutoff;
}

/** 创建时间不晚于 cutoff、且没有任何卡片引用的附件。只查询，不删除。 */
export function listStaleUnreferencedAttachments(db: DatabaseSync, cutoffIso: string): Attachment[] {
  const referenced = referencedAttachmentIds(db);
  return listAttachments(db, { deleted: 'all' }).filter((attachment) => {
    return !referenced.has(attachment.id) && isAtOrBefore(attachment.createdAt, cutoffIso);
  });
}

/**
 * 删除已经没有任何卡片引用的附件记录。
 * 仍被引用的 id 会跳过。返回实际删掉的记录，供调用方删文件。
 */
export function deleteUnreferencedAttachmentRecords(db: DatabaseSync, ids: readonly string[]): Attachment[] {
  const unique = [...new Set(ids)];
  db.exec('BEGIN IMMEDIATE');
  try {
    const referenced = referencedAttachmentIds(db);
    const removed: Attachment[] = [];
    for (const id of unique) {
      if (referenced.has(id)) continue;
      const attachment = getAttachment(db, id);
      if (!attachment) continue;
      deleteAttachment(db, id);
      removed.push(attachment);
    }
    db.exec('COMMIT');
    return removed;
  } catch (error) {
    try {
      db.exec('ROLLBACK');
    } catch {
      // 事务可能已经结束。
    }
    throw error;
  }
}
