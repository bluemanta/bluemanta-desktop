import type { IdeaRecord } from '@bluemanta/server/api-types';
import { describe, expect, it } from 'vitest';
import { backWouldDiscard } from './paths';
import { draftCopy, isSessionDirty, trashToastText } from './draft';
import type { ImageSlot } from '../images/slots';

function record(overrides: Partial<IdeaRecord> = {}): IdeaRecord {
  return {
    id: 'card_a',
    rev: 1,
    createdAt: '2026-10-11T01:00:00Z',
    updatedAt: '2026-10-11T01:00:00Z',
    createdBy: { kind: 'human', name: 'desktop' },
    updatedBy: { kind: 'human', name: 'desktop' },
    deletedAt: null,
    title: '标题',
    titleOrigin: 'user',
    body: '正文',
    rawInput: { status: 'legacy' },
    showRaw: false,
    starred: false,
    tags: [],
    category: 'other',
    categorySource: 'auto',
    captureGroupId: null,
    extensions: [],
    attachmentIds: [],
    attachments: [],
    edited: false,
    ...overrides,
  };
}

const fields = { title: '标题', body: '正文', category: 'other' as const };

describe('编辑草稿', () => {
  it('字段或未完成的图片都算未保存', () => {
    expect(isSessionDirty(record(), [], fields)).toBe(false);
    expect(isSessionDirty(record(), [], { ...fields, title: '改' })).toBe(true);
    const uploading: ImageSlot = {
      key: 'u',
      requestId: 'r',
      phase: 'uploading',
      progress: 0.2,
      message: null,
      file: null,
      attachmentId: null,
      previewUrl: null,
      remoteUrl: null,
    };
    expect(isSessionDirty(record(), [uploading], fields)).toBe(true);
  });

  it('草稿文本和回收站提示', () => {
    expect(draftCopy(fields, 2)).toContain('标题：标题');
    expect(draftCopy(fields, 2)).toContain('图片：2 张');
    expect(trashToastText('一二三四五六七八九十十一十二十三')).toBe('已移入回收站：一二三四五六七八九十十一十二');
    expect(trashToastText('  ')).toBe('已移入回收站：未命名灵感');
  });
});

describe('后退确认', () => {
  const dirty = new Set(['card_a']);

  it('离开清单、离开这条灵感时要确认；换一条标签不用', () => {
    expect(backWouldDiscard('/ideas/card_a', '/ideas/stats', dirty)).toBe(true);
    expect(backWouldDiscard('/ideas/card_a', '/ideas', dirty)).toBe(true);
    expect(backWouldDiscard('/ideas/card_a', '/ideas/card_b', dirty)).toBe(true);
    expect(backWouldDiscard('/ideas/card_b', '/ideas/card_a', dirty)).toBe(false);
    expect(backWouldDiscard('/ideas/card_a', '/ideas/card_b', new Set())).toBe(false);
  });
});
