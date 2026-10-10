import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openCore, type Core } from '@bluemanta/core';
import { afterEach, describe, expect, it } from 'vitest';
import { handleCards, handleHealth, type CardsBody, type ErrorBody, type HealthBody } from '../src/routes.js';

const source = { kind: 'human' as const, name: '测试者' };
const dirs: string[] = [];

function tempCore(): Core {
  const dir = mkdtempSync(join(tmpdir(), 'bluemanta-plugin-'));
  dirs.push(dir);
  return openCore({ dataDir: dir });
}

afterEach(() => {
  while (dirs.length > 0) {
    const dir = dirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

function request(path: string, method = 'GET'): Request {
  return new Request(`http://127.0.0.1${path}`, { method });
}

async function bodyOf<T>(response: Response): Promise<T> {
  return response.json() as Promise<T>;
}

describe('health', () => {
  it('空库返回 schema、数据目录和零计数', async () => {
    const core = tempCore();
    try {
      const response = handleHealth(core, request('/api/bluemanta/health'));
      expect(response.status).toBe(200);
      expect(response.headers.get('cache-control')).toBe('no-store');
      await expect(bodyOf<HealthBody>(response)).resolves.toEqual({
        schemaVersion: core.schemaVersion,
        dataDir: core.dataDir,
        counts: { projects: 0, tasks: 0, cards: 0 },
      });
    } finally {
      core.close();
    }
  });

  it('计数只含未进回收站的记录', async () => {
    const core = tempCore();
    try {
      const project = unwrap(core.project.create({
        requestId: 'p1',
        source,
        title: '虚构项目',
        area: 'product',
        background: '背景',
      }));
      unwrap(core.task.create({
        requestId: 't1',
        source,
        title: '虚构任务',
        projectId: project.id,
      }));
      const kept = unwrap(core.card.create({
        requestId: 'c1',
        source,
        cardType: 'idea',
        title: '留下的灵感',
        rawInput: { status: 'legacy' },
        fields: { category: 'product', captureGroupId: null },
      }));
      const trashed = unwrap(core.card.create({
        requestId: 'c2',
        source,
        cardType: 'idea',
        title: '丢弃的灵感',
        rawInput: { status: 'legacy' },
        fields: { category: 'life', captureGroupId: null },
      }));
      unwrap(core.card.delete({ requestId: 'c2-del', source, id: trashed.id, rev: trashed.rev }));

      const response = handleHealth(core, request('/api/bluemanta/health'));
      const body = await bodyOf<HealthBody>(response);
      expect(body.counts).toEqual({ projects: 1, tasks: 1, cards: 1 });
      expect(body.dataDir).toBe(core.dataDir);
      expect(kept.id).toMatch(/^card_/);
    } finally {
      core.close();
    }
  });

  it('非 GET 返回 405', async () => {
    const core = tempCore();
    try {
      const response = handleHealth(core, request('/api/bluemanta/health', 'POST'));
      expect(response.status).toBe(405);
      await expect(bodyOf<ErrorBody>(response)).resolves.toEqual({ error: 'read only' });
    } finally {
      core.close();
    }
  });
});

describe('cards', () => {
  it('默认不含回收站，trash=1 只返回回收站', async () => {
    const core = tempCore();
    try {
      const active = unwrap(core.card.create({
        requestId: 'idea-active',
        source,
        cardType: 'idea',
        title: '还在的灵感',
        body: '正文',
        rawInput: { status: 'present', channel: 'web', text: '原始' },
        fields: { category: 'work', captureGroupId: null },
      }));
      const trashed = unwrap(core.card.create({
        requestId: 'idea-trash',
        source,
        cardType: 'idea',
        title: '回收站灵感',
        rawInput: { status: 'legacy' },
        fields: { category: 'other' },
      }));
      const deleted = unwrap(core.card.delete({
        requestId: 'idea-trash-del',
        source,
        id: trashed.id,
        rev: trashed.rev,
      }));
      unwrap(core.card.create({
        requestId: 'scene-1',
        source,
        cardType: 'scene',
        title: '场景占位',
        rawInput: { status: 'legacy' },
      }));

      const allIdeas = handleCards(core, request('/api/bluemanta/cards?cardType=idea'));
      expect(allIdeas.status).toBe(200);
      const activeBody = await bodyOf<CardsBody>(allIdeas);
      expect(activeBody.count).toBe(1);
      expect(activeBody.cards).toEqual([active]);

      const explicit = handleCards(core, request('/api/bluemanta/cards?cardType=idea&trash=0'));
      expect(await bodyOf<CardsBody>(explicit)).toEqual(activeBody);

      const trash = handleCards(core, request('/api/bluemanta/cards?cardType=idea&trash=1'));
      expect(trash.status).toBe(200);
      const trashBody = await bodyOf<CardsBody>(trash);
      expect(trashBody.count).toBe(1);
      expect(trashBody.cards).toEqual([deleted]);
      expect(trashBody.cards[0]?.deletedAt).not.toBeNull();
    } finally {
      core.close();
    }
  });

  it('q 走搜索，并附带命中字段和摘录', async () => {
    const core = tempCore();
    try {
      const matched = unwrap(core.card.create({
        requestId: 'search-hit',
        source,
        cardType: 'idea',
        title: 'Alpha 灵感',
        body: '正文里有 Beta',
        fields: { category: 'learning' },
      }));
      unwrap(core.card.create({
        requestId: 'search-miss',
        source,
        cardType: 'idea',
        title: '别的卡片',
        body: '没有目标词',
        fields: { category: 'work' },
      }));

      const response = handleCards(core, request('/api/bluemanta/cards?q=alpha%20beta'));
      expect(response.status).toBe(200);
      const body = await bodyOf<CardsBody>(response);
      expect(body.count).toBe(1);
      expect(body.cards).toHaveLength(1);
      const hit = body.cards[0];
      expect(hit).toMatchObject({ id: matched.id, field: 'title', excerpt: 'Alpha 灵感' });

      const byCategory = handleCards(core, request('/api/bluemanta/cards?q=' + encodeURIComponent('学习备忘')));
      const categoryBody = await bodyOf<CardsBody>(byCategory);
      expect(categoryBody.cards.map((card) => card.id)).toEqual([matched.id]);
      expect(categoryBody.cards[0]).toMatchObject({ field: 'category', excerpt: '学习备忘' });
    } finally {
      core.close();
    }
  });

  it('非法参数返回 400', async () => {
    const core = tempCore();
    try {
      const cases = [
        '/api/bluemanta/cards?trash=2',
        '/api/bluemanta/cards?trash=true',
        '/api/bluemanta/cards?trash=',
        '/api/bluemanta/cards?cardType=poem',
        '/api/bluemanta/cards?cardType=IDEA',
        '/api/bluemanta/cards?cardType=idea&cardType=note',
        '/api/bluemanta/cards?trash=0&trash=1',
        '/api/bluemanta/cards?q=',
        '/api/bluemanta/cards?q=%20',
        '/api/bluemanta/cards?q=a&q=b',
      ];
      for (const path of cases) {
        const response = handleCards(core, request(path));
        expect(response.status, path).toBe(400);
        const body = await bodyOf<ErrorBody>(response);
        expect(body.error.length, path).toBeGreaterThan(0);
      }
    } finally {
      core.close();
    }
  });
});

function unwrap<T extends { id: string }>(result: { ok: true; record: T } | { ok: false; code: string; message: string }): T {
  if (!result.ok) throw new Error(`${result.code}: ${result.message}`);
  return result.record;
}
