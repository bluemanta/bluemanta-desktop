/** 三组搜索的虚构响应；额外旧 personal 命中用于验证页面不会显示旧库。 */
import type { KnowledgeSearchHit, KnowledgeSearchResponse } from '@bluemanta/server/api-types';
import type { Page } from '@playwright/test';

export const SEARCH_QUERY = '记录';
const shared = {
  source: 'library', ideaId: null, area: 'topic', updatedAt: '2026-11-21T00:00:00.000Z', matchMode: 'all',
} as const;
const hits: KnowledgeSearchHit[] = [
  {
    ...shared, library: 'personalos', path: '领域/工作/状态.md', title: '工作', domain: '工作',
    headings: ['工作', '现状'], excerpt: '雾灯便签是这次试点的记录代号，每次交流只记录一个问题。',
    topicPath: '领域/工作', topicName: '工作', score: 12,
  },
  {
    ...shared, library: 'arsenal', path: '01_业务主题/会员体系/Topic_Knowledge.md', title: '会员体系 Topic Knowledge',
    headings: ['会员体系 Topic Knowledge', '核心观点'], excerpt: '演示积分记录：积分要有消耗出口，否则会变成负债。',
    topicPath: '01_业务主题/会员体系', topicName: '会员体系', score: 9,
  },
  {
    ...shared, source: 'idea', library: null, path: null, ideaId: 'fixture-search-only-idea', area: null,
    title: '演示灵感：整理观察记录', headings: [], excerpt: '把虚构的观察记录整理成一张问题卡。',
    topicPath: null, topicName: null, score: 7,
  },
  {
    ...shared, library: 'personal', path: '02_职业与业务/售前方法/README.md', title: '旧个人库隔离标记',
    headings: [], excerpt: '这条虚构旧库记录不应出现在网页搜索。', topicPath: null, topicName: null, score: 6,
  },
];

export const THREE_GROUP_SEARCH: KnowledgeSearchResponse = { ok: true, query: SEARCH_QUERY, keywords: [SEARCH_QUERY], hits };

export async function mockThreeGroupSearch(page: Page, order: readonly string[] = ['personalos', 'arsenal', 'idea', 'personal']): Promise<void> {
  const response: KnowledgeSearchResponse = {
    ...THREE_GROUP_SEARCH,
    hits: order.flatMap((group) => hits.filter((hit) => (hit.source === 'idea' ? 'idea' : hit.library) === group)),
  };
  await page.route('**/api/v1/knowledge/search?**', (route) => route.fulfill({ json: response }));
}
