import { unreferencedAttachmentCutoff, type Attachment } from '@bluemanta/core';
import { removeStoredFile } from './media.js';

export type AttachmentCleanupGateway = {
  dataDir: string;
  listStaleUnreferencedAttachments: (cutoffIso: string) => Attachment[];
  deleteUnreferencedAttachmentRecords: (ids: readonly string[]) => Attachment[];
};

/** 插件启动时调用：删掉上传后超过 24 小时仍未被引用的附件记录和文件。 */
export function cleanupStaleAttachments(core: AttachmentCleanupGateway, now = new Date()): Attachment[] {
  const stale = core.listStaleUnreferencedAttachments(unreferencedAttachmentCutoff(now));
  const removed = core.deleteUnreferencedAttachmentRecords(stale.map((attachment) => attachment.id));
  for (const attachment of removed) {
    removeStoredFile(core.dataDir, attachment.path);
  }
  return removed;
}
