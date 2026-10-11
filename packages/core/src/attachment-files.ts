import { unreferencedAttachmentCutoff } from './attachment-gc.js';
import { removeStoredFile } from './media.js';
import type { Attachment } from './types.js';

export type AttachmentCleanupGateway = {
  dataDir: string;
  listStaleUnreferencedAttachments: (cutoffIso: string) => Attachment[];
  deleteUnreferencedAttachmentRecords: (ids: readonly string[]) => Attachment[];
};

export type PurgedAttachmentGateway = Pick<AttachmentCleanupGateway, 'dataDir' | 'deleteUnreferencedAttachmentRecords'>;

/** 服务启动时调用：删掉上传后超过 24 小时仍未被引用的附件记录和文件。 */
export function cleanupStaleAttachments(core: AttachmentCleanupGateway, now = new Date()): Attachment[] {
  const stale = core.listStaleUnreferencedAttachments(unreferencedAttachmentCutoff(now));
  const removed = core.deleteUnreferencedAttachmentRecords(stale.map((attachment) => attachment.id));
  for (const attachment of removed) {
    removeStoredFile(core.dataDir, attachment.path);
  }
  return removed;
}

/** 彻底删除成功后，删掉不再被任何卡片引用的附件文件和记录。 */
export function discardPurgedAttachments(core: PurgedAttachmentGateway, ids: readonly string[]): Attachment[] {
  const removed = core.deleteUnreferencedAttachmentRecords(ids);
  for (const attachment of removed) {
    removeStoredFile(core.dataDir, attachment.path);
  }
  return removed;
}
