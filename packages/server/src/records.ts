import { shouldShowRaw, type Attachment, type IdeaCard } from '@bluemanta/core';
import type { AttachmentMeta, IdeaRecord } from './api-types.js';

export type AttachmentLookup = (id: string) => Attachment | null;

export function attachmentUrl(id: string): string {
  return `/api/v1/attachments/${encodeURIComponent(id)}`;
}

/** 附件元数据去掉本机相对路径 `path`。 */
export function toAttachmentMeta(attachment: Attachment): AttachmentMeta {
  return {
    id: attachment.id,
    mime: attachment.mime,
    byteSize: attachment.byteSize,
    width: attachment.width,
    height: attachment.height,
    sha256: attachment.sha256,
    createdAt: attachment.createdAt,
    url: attachmentUrl(attachment.id),
  };
}

export function toIdeaRecord(card: IdeaCard, lookup: AttachmentLookup): IdeaRecord {
  const attachments: AttachmentMeta[] = [];
  for (const id of card.attachmentIds) {
    const attachment = lookup(id);
    if (attachment) attachments.push(toAttachmentMeta(attachment));
  }
  return {
    id: card.id,
    rev: card.rev,
    createdAt: card.createdAt,
    updatedAt: card.updatedAt,
    createdBy: { kind: card.createdBy.kind, name: card.createdBy.name },
    updatedBy: { kind: card.updatedBy.kind, name: card.updatedBy.name },
    deletedAt: card.deletedAt,
    title: card.title,
    titleOrigin: card.titleOrigin,
    body: card.body,
    rawInput: card.rawInput,
    showRaw: shouldShowRaw(card.body, card.rawInput),
    starred: card.starred,
    tags: [...card.tags],
    category: card.fields.category,
    categorySource: card.fields.categorySource,
    captureGroupId: card.fields.captureGroupId,
    extensions: card.extensions.map((extension) => ({
      id: extension.id,
      text: extension.body,
      createdAt: extension.createdAt,
    })),
    attachmentIds: [...card.attachmentIds],
    attachments,
  };
}
