import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openCore, type CommandResult, type Core } from '@bluemanta/core';
import { afterEach, describe, expect, it } from 'vitest';
import {
  AGENT_LIMITATION,
  AGENT_SOURCE,
  CAPTURE_DESCRIPTION,
  GET_DESCRIPTION,
  SEARCH_DESCRIPTION,
  captureIdea,
  getIdea,
  ideaRequestId,
  renderGet,
  renderSearch,
  searchIdeas,
  type CaptureIdeaResult,
  type GetIdeaResult,
  type IdeaToolCore,
  type SearchIdeaResult,
} from '../src/idea-tools.js';

const human = { kind: 'human' as const, name: '测试者' };
const dirs: string[] = [];

function tempCore(): Core {
  const dir = mkdtempSync(join(tmpdir(), 'bluemanta-idea-tools-'));
  dirs.push(dir);
  return openCore({ dataDir: dir });
}

afterEach(() => {
  while (dirs.length > 0) {
    const dir = dirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

function unwrap<T>(result: CommandResult<T>): T {
  if (!result.ok) throw new Error(`${result.code}: ${result.message}`);
  return result.record;
}

function saved(result: CaptureIdeaResult): Extract<CaptureIdeaResult, { ok: true }> {
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.error);
  return result;
}

function found(result: SearchIdeaResult): Extract<SearchIdeaResult, { ok: true }> {
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.error);
  return result;
}

function read(result: GetIdeaResult): Extract<GetIdeaResult, { ok: true }> {
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.error);
  return result;
}

describe('记录灵感', () => {
  it('写入来源为 agent，原文 channel 为 agent，标题可兜底', () => {
    const core = tempCore();
    try {
      const result = saved(captureIdea(core, {
        requestId: ideaRequestId('call-capture'),
        body: '虚构的产品想法正文',
      }));
      expect(result).toMatchObject({
        title: '虚构的产品想法正文',
        category: '产品想法',
        fallbackTitle: true,
      });
      const card = core.getCard(result.id);
      expect(card?.createdBy).toEqual(AGENT_SOURCE);
      expect(card?.updatedBy).toEqual(AGENT_SOURCE);
      expect(card?.rawInput).toEqual({
        status: 'present',
        channel: 'agent',
        text: '虚构的产品想法正文',
      });
      expect(core.listHistory({ objectId: result.id })).toHaveLength(1);
    } finally {
      core.close();
    }
  });

  it('用户给了标题时不记成兜底，指定分类用中文名返回', () => {
    const core = tempCore();
    try {
      const result = saved(captureIdea(core, {
        requestId: 'dsh-agent:titled',
        title: '散步时想到的',
        body: '只是一句虚构正文',
        category: 'life',
      }));
      expect(result).toMatchObject({
        title: '散步时想到的',
        category: '生活随想',
        fallbackTitle: false,
      });
    } finally {
      core.close();
    }
  });

  it('同一调用 id 重试不重复写入', () => {
    const core = tempCore();
    try {
      const requestId = ideaRequestId('call-retry');
      const first = saved(captureIdea(core, { requestId, body: '同一条虚构灵感' }));
      const second = saved(captureIdea(core, { requestId, body: '同一条虚构灵感' }));
      expect(second.id).toBe(first.id);
      expect(core.listCards({ cardType: 'idea' })).toHaveLength(1);
      expect(core.listHistory({ objectId: first.id })).toHaveLength(1);
    } finally {
      core.close();
    }
  });

  it('空内容被拒，不留下卡片', () => {
    const core = tempCore();
    try {
      const blank = captureIdea(core, { requestId: 'dsh-agent:blank', title: '   ', body: '\n\t' });
      const missing = captureIdea(core, { requestId: 'dsh-agent:missing' });
      expect(blank.ok).toBe(false);
      expect(missing.ok).toBe(false);
      expect(core.listCards()).toEqual([]);
      expect(core.listHistory()).toEqual([]);
    } finally {
      core.close();
    }
  });
});

describe('查找灵感', () => {
  it('limit 默认 10，超过 50 时只返回 50 条', () => {
    const core = tempCore();
    try {
      for (let index = 0; index < 55; index += 1) {
        saved(captureIdea(core, {
          requestId: `dsh-agent:limit-${index}`,
          title: `虚构检索 ${index}`,
          body: '虚构检索词',
        }));
      }
      const capped = found(searchIdeas(core, { query: '虚构检索词', limit: 80 }));
      expect(capped.limit).toBe(50);
      expect(capped.items).toHaveLength(50);
      expect(capped.message).toBe('');

      const defaults = found(searchIdeas(core, { query: '虚构检索词' }));
      expect(defaults.limit).toBe(10);
      expect(defaults.items).toHaveLength(10);

      const few = found(searchIdeas(core, { query: '虚构检索词', limit: 3 }));
      expect(few.items).toHaveLength(3);
      expect(few.items[0]?.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);

      expect(searchIdeas(core, { query: '虚构检索词', limit: 0 }).ok).toBe(false);
    } finally {
      core.close();
    }
  });

  it('按分类和收藏过滤，默认不含回收站，没有结果时说明没有找到', () => {
    const core = tempCore();
    try {
      const product = saved(captureIdea(core, {
        requestId: 'dsh-agent:product',
        title: '虚构筛选 产品',
        body: '虚构筛选词',
        category: 'product',
      }));
      const life = saved(captureIdea(core, {
        requestId: 'dsh-agent:life',
        title: '虚构筛选 生活',
        body: '虚构筛选词',
        category: 'life',
      }));
      const trashed = saved(captureIdea(core, {
        requestId: 'dsh-agent:trash',
        title: '虚构筛选 丢弃',
        body: '虚构筛选词 独有丢弃词',
        category: 'work',
      }));
      unwrap(core.card.setStar({
        requestId: 'star-product',
        source: human,
        id: product.id,
        rev: 1,
        starred: true,
      }));
      unwrap(core.card.delete({
        requestId: 'delete-trash',
        source: human,
        id: trashed.id,
        rev: 1,
      }));

      const byCategory = found(searchIdeas(core, { query: '虚构筛选词', category: 'life' }));
      expect(byCategory.items.map((item) => item.id)).toEqual([life.id]);
      expect(byCategory.items[0]).toMatchObject({
        title: '虚构筛选 生活',
        category: '生活随想',
        field: 'body',
      });

      const starred = found(searchIdeas(core, { query: '虚构筛选词', starredOnly: true }));
      expect(starred.items.map((item) => item.id)).toEqual([product.id]);

      const active = found(searchIdeas(core, { query: '虚构筛选词' }));
      expect(active.items.map((item) => item.id).sort()).toEqual([life.id, product.id].sort());
      expect(active.items.some((item) => item.id === trashed.id)).toBe(false);

      const none = found(searchIdeas(core, { query: '独有丢弃词' }));
      expect(none.items).toEqual([]);
      expect(none.message).toBe('没有找到');
      expect(renderSearch(none)).toBe('没有找到');

      const missing = found(searchIdeas(core, { query: '完全不存在的虚构词' }));
      expect(missing.message).toBe('没有找到');
    } finally {
      core.close();
    }
  });
});

describe('读取灵感', () => {
  it('回收站中的照常返回，并标明在回收站中', () => {
    const core = tempCore();
    try {
      const created = saved(captureIdea(core, {
        requestId: 'dsh-agent:get-trash',
        title: '待丢弃',
        body: '虚构回收正文',
      }));
      unwrap(core.card.delete({
        requestId: 'delete-get',
        source: human,
        id: created.id,
        rev: 1,
      }));
      const result = read(getIdea(core, { id: created.id }));
      expect(result).toMatchObject({
        title: '待丢弃',
        body: '虚构回收正文',
        inTrash: true,
        notice: '在回收站中',
        starred: false,
      });
      expect(renderGet(result)).toContain('在回收站中');
      expect(result.rawInput).toEqual({
        status: 'present',
        channel: 'agent',
        text: '虚构回收正文',
      });
    } finally {
      core.close();
    }
  });

  it('legacy 原文说明无原文，并带回追记', () => {
    const core = tempCore();
    try {
      const card = unwrap(core.card.create({
        requestId: 'legacy-idea',
        source: human,
        cardType: 'idea',
        title: '旧灵感',
        body: '导入前的虚构正文',
        rawInput: { status: 'legacy' },
        fields: { category: 'learning' },
      }));
      unwrap(core.card.addExtension({
        requestId: 'legacy-note',
        source: human,
        id: card.id,
        rev: card.rev,
        body: '人补的一句虚构追记',
      }));
      const result = read(getIdea(core, { id: card.id }));
      expect(result.category).toBe('学习备忘');
      expect(result.rawInput).toEqual({ status: 'legacy', note: '无原文' });
      expect(result.notice).toBe('');
      expect(result.inTrash).toBe(false);
      expect(result.extensions).toEqual([
        expect.objectContaining({ body: '人补的一句虚构追记' }),
      ]);
      expect(renderGet(result)).toContain('原文：无原文');
      expect(renderGet(result)).toContain('人补的一句虚构追记');
    } finally {
      core.close();
    }
  });

  it('找不到或不是灵感时返回错误', () => {
    const core = tempCore();
    try {
      const note = unwrap(core.card.create({
        requestId: 'a-note',
        source: human,
        cardType: 'note',
        title: '不是灵感',
        body: '笔记',
        rawInput: { status: 'present', channel: 'web', text: '笔记' },
      }));
      expect(getIdea(core, { id: 'card_missing' }).ok).toBe(false);
      expect(getIdea(core, { id: note.id }).ok).toBe(false);
    } finally {
      core.close();
    }
  });
});

describe('上海时区', () => {
  it('UTC 23:09 算成上海次日 07:09，ISO 字段保持不变', () => {
    const createdAt = '2026-10-10T23:09:00.000Z';
    const card = {
      id: 'card_tz',
      cardType: 'idea' as const,
      title: '跨天',
      body: '虚构正文',
      starred: false,
      createdAt,
      deletedAt: null,
      extensions: [{ id: 'ext_tz', body: '虚构追记', createdAt }],
      rawInput: { status: 'present' as const, channel: 'agent' as const, text: '虚构原文' },
      fields: { category: 'other' as const, categorySource: 'auto' as const, captureGroupId: null },
      titleOrigin: 'user' as const,
      rev: 1,
      module: 'core',
      updatedAt: createdAt,
      createdBy: AGENT_SOURCE,
      updatedBy: AGENT_SOURCE,
      tags: [],
      attachmentIds: [],
      projectId: null,
    };
    const core = {
      card: { create: () => { throw new Error('不用写入'); } },
      getCard: () => card,
      searchCards: () => [{ card, field: 'body' as const, excerpt: '虚构摘录' }],
    } as unknown as IdeaToolCore;

    const searched = searchIdeas(core, { query: '虚构' });
    if (!searched.ok) throw new Error(searched.error);
    expect(searched.items[0]?.createdAt).toBe('2026-10-11');
    expect(renderSearch(searched)).toContain('2026-10-11');

    const got = getIdea(core, { id: card.id });
    if (!got.ok) throw new Error(got.error);
    expect(got.createdAt).toBe(createdAt);
    expect(got.createdAtLocal).toBe('2026-10-11 07:09');
    expect(got.extensions[0]).toMatchObject({ createdAt, createdAtLocal: '2026-10-11 07:09' });
    const text = renderGet(got);
    expect(text).toContain('创建时间：2026-10-11 07:09');
    expect(text).toContain('- 2026-10-11 07:09 虚构追记');
    expect(text).not.toContain(createdAt);
  });
});

describe('工具说明', () => {
  it('用调用 id 生成 requestId，描述写明不能收藏、追记、删除', () => {
    expect(ideaRequestId(' call-9 ')).toBe('dsh-agent:call-9');
    expect(() => ideaRequestId('   ')).toThrow(/id/);
    for (const description of [CAPTURE_DESCRIPTION, SEARCH_DESCRIPTION, GET_DESCRIPTION]) {
      expect(description).toContain(AGENT_LIMITATION);
    }
    const source = readFileSync(fileURLToPath(new URL('../src/idea-tools.ts', import.meta.url)), 'utf8');
    expect(source).not.toContain('@deepseek-ai');
  });
});
