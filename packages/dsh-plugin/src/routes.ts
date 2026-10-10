import type { Card, CardSearchField, CardType, Core } from '@bluemanta/core';

/** 路由只依赖这些读取方法，方便在不启动 dsh 的情况下测试。 */
export type RouteCore = Pick<
  Core,
  'dataDir' | 'schemaVersion' | 'listProjects' | 'listTasks' | 'listCards' | 'searchCards'
>;

export const HEALTH_PATH = '/api/bluemanta/health';
export const CARDS_PATH = '/api/bluemanta/cards';

const CARD_TYPES = new Set<CardType>(['idea', 'scene', 'note']);

export type HealthBody = {
  schemaVersion: number;
  dataDir: string;
  counts: {
    projects: number;
    tasks: number;
    cards: number;
  };
};

export type SearchedCard = Card & {
  field: CardSearchField;
  excerpt: string;
};

export type CardsBody = {
  count: number;
  cards: Card[] | SearchedCard[];
};

export type ErrorBody = {
  error: string;
};

const JSON_HEADERS = { 'cache-control': 'no-store' };

function jsonError(status: number, error: string): Response {
  return Response.json({ error } satisfies ErrorBody, { status, headers: JSON_HEADERS });
}

/**
 * `GET /api/bluemanta/health`
 * counts 是未进回收站的记录数，和 core 列表的默认筛选一致。
 */
export function handleHealth(core: RouteCore, request: Request): Response {
  if (request.method !== 'GET') return jsonError(405, 'read only');
  const body: HealthBody = {
    schemaVersion: core.schemaVersion,
    dataDir: core.dataDir,
    counts: {
      projects: core.listProjects().length,
      tasks: core.listTasks().length,
      cards: core.listCards().length,
    },
  };
  return Response.json(body, { headers: JSON_HEADERS });
}

function singleParam(params: URLSearchParams, key: string): { ok: true; value: string | null } | { ok: false } {
  const values = params.getAll(key);
  if (values.length > 1) return { ok: false };
  return { ok: true, value: values[0] ?? null };
}

/**
 * `GET /api/bluemanta/cards?cardType=idea&trash=0|1&q=关键词`
 * 不带 trash 或 trash=0 时不含回收站；trash=1 只返回回收站。
 * cardType 可省略，省略时返回全部类型。
 * 带 q 时走搜索，每条结果附带命中字段和摘录。
 */
export function handleCards(core: RouteCore, request: Request): Response {
  if (request.method !== 'GET') return jsonError(405, 'read only');

  const params = new URL(request.url).searchParams;
  const cardTypeParam = singleParam(params, 'cardType');
  if (!cardTypeParam.ok) return jsonError(400, 'cardType 只能出现一次');
  const trashParam = singleParam(params, 'trash');
  if (!trashParam.ok) return jsonError(400, 'trash 只能出现一次');
  const queryParam = singleParam(params, 'q');
  if (!queryParam.ok) return jsonError(400, 'q 只能出现一次');

  const cardType = cardTypeParam.value;
  if (cardType !== null && !CARD_TYPES.has(cardType as CardType)) {
    return jsonError(400, 'cardType 只能是 idea、scene 或 note');
  }
  const trash = trashParam.value;
  if (trash !== null && trash !== '0' && trash !== '1') {
    return jsonError(400, 'trash 只能是 0 或 1');
  }
  const query = queryParam.value;
  if (query !== null && query.trim() === '') return jsonError(400, 'q 不能为空');

  const cardTypeFilter = cardType === null ? {} : { cardType: cardType as CardType };
  const deleted = trash === '1' ? ({ deleted: 'trash' as const } as const) : {};
  if (query !== null) {
    const hits = core.searchCards(query, { ...cardTypeFilter, ...deleted });
    const cards: SearchedCard[] = hits.map((hit) => ({ ...hit.card, field: hit.field, excerpt: hit.excerpt }));
    const body: CardsBody = { count: cards.length, cards };
    return Response.json(body, { headers: JSON_HEADERS });
  }

  const cards = core.listCards({ ...cardTypeFilter, ...deleted });
  const body: CardsBody = { count: cards.length, cards };
  return Response.json(body, { headers: JSON_HEADERS });
}
