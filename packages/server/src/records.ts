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

/** 只有 `card.update` 算改写。调用方从操作历史得出，不改表结构。 */
export function isEditedHistory(entries: readonly { command: string; objectId: string | null }[]): Set<string> {
  const ids = new Set<string>();
  for (const entry of entries) {
    if (entry.command === 'card.update' && entry.objectId) ids.add(entry.objectId);
  }
  return ids;
}

type OrderedIdea = { id: string; createdAt: string; deletedAt: string | null };

/** 清单和搜索按创建时间倒序；回收站（含搜索）按移入时间倒序。同一时刻再用 id 倒序。 */
export function sortIdeas<T extends OrderedIdea>(items: readonly T[], scope: 'active' | 'trash'): T[] {
  const key = (item: T) => (scope === 'trash' ? (item.deletedAt ?? '') : item.createdAt);
  return [...items].sort((a, b) => {
    const left = key(a);
    const right = key(b);
    if (left !== right) return left < right ? 1 : -1;
    if (a.id === b.id) return 0;
    return a.id < b.id ? 1 : -1;
  });
}

export function toIdeaRecord(card: IdeaCard, lookup: AttachmentLookup, edited: boolean): IdeaRecord {
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
    edited,
  };
}
