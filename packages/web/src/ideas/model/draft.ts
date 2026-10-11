import type { IdeaCategory, IdeaRecord } from '@bluemanta/server/api-types';
import { categoryLabel } from './categories';
import type { ImageSlot } from '../images/slots';

export function sameIds(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((id, index) => id === right[index]);
}

export function readyAttachmentIds(slots: readonly ImageSlot[]): string[] {
  return slots.flatMap((slot) => (slot.phase === 'ready' && slot.attachmentId ? [slot.attachmentId] : []));
}

/** 有未传完或失败的图片，或字段和当前记录不一致。 */
export function isSessionDirty(record: IdeaRecord, slots: readonly ImageSlot[], fields: { title: string; body: string; category: IdeaCategory }): boolean {
  if (slots.some((slot) => slot.phase !== 'ready')) return true;
  return (
    fields.title !== record.title ||
    fields.body !== record.body ||
    fields.category !== record.category ||
    !sameIds(readyAttachmentIds(slots), record.attachmentIds)
  );
}

/** 放进冲突提示里，方便复制。 */
export function draftCopy(fields: { title: string; body: string; category: IdeaCategory }, imageCount: number): string {
  return [`标题：${fields.title}`, `正文：${fields.body}`, `分类：${categoryLabel(fields.category)}`, `图片：${imageCount} 张`].join('\n');
}

export function trashToastText(title: string): string {
  const name = title.trim() === '' ? '未命名灵感' : title.trim();
  return `已移入回收站：${name.slice(0, 14)}`;
}
