import type { IdeaCategory } from './types.js';

/** 分类的中文名。搜索按这个名字命中，不按枚举值。 */
export const CATEGORY_LABELS: Record<IdeaCategory, string> = {
  product: '产品想法',
  learning: '学习备忘',
  work: '工作事务',
  life: '生活随想',
  other: '其他',
};

/** 并列时的优先顺序。最高分为 0 时不在此列，返回 other。 */
export const CATEGORY_TIE_ORDER = ['product', 'learning', 'work', 'life'] as const;

export type ClassifiedCategory = (typeof CATEGORY_TIE_ORDER)[number];

export type IdeaKeyword = {
  category: ClassifiedCategory;
  weight: 2 | 4;
  text: string;
};

/**
 * 规格第 3 节的关键词表，原样移植。
 * 同一个词可以同时出现在权重 4 和权重 2，命中时分别计分。
 */
export const IDEA_KEYWORDS: readonly IdeaKeyword[] = [
  { category: 'product', weight: 4, text: '商业模式' },
  { category: 'product', weight: 4, text: '产品想法' },
  { category: 'product', weight: 4, text: '功能设计' },
  { category: 'product', weight: 4, text: '用户需求' },
  { category: 'product', weight: 4, text: '变现路径' },
  { category: 'product', weight: 4, text: '付费订阅' },
  { category: 'product', weight: 4, text: '定价策略' },
  { category: 'product', weight: 4, text: '增长策略' },
  { category: 'product', weight: 4, text: '竞品分析' },
  { category: 'product', weight: 4, text: '最小可行产品' },
  { category: 'product', weight: 4, text: '落地页' },
  { category: 'product', weight: 4, text: '产品功能' },
  { category: 'product', weight: 4, text: '商业点子' },
  { category: 'product', weight: 4, text: '收费模式' },
  { category: 'product', weight: 2, text: 'mvp' },
  { category: 'product', weight: 2, text: 'saas' },
  { category: 'product', weight: 2, text: '产品' },
  { category: 'product', weight: 2, text: '功能' },
  { category: 'product', weight: 2, text: '商业' },
  { category: 'product', weight: 2, text: '点子' },
  { category: 'product', weight: 2, text: '用户' },
  { category: 'product', weight: 2, text: '需求' },
  { category: 'product', weight: 2, text: '变现' },
  { category: 'product', weight: 2, text: '定价' },
  { category: 'product', weight: 2, text: '订阅' },
  { category: 'product', weight: 2, text: '原型' },
  { category: 'product', weight: 2, text: '竞品' },
  { category: 'product', weight: 2, text: '市场' },
  { category: 'product', weight: 2, text: '增长' },
  { category: 'product', weight: 2, text: '创业' },
  { category: 'product', weight: 2, text: '收费' },
  { category: 'product', weight: 2, text: '付费' },
  { category: 'product', weight: 2, text: '转化' },
  { category: 'product', weight: 2, text: '发布' },
  { category: 'product', weight: 2, text: 'app' },
  { category: 'product', weight: 2, text: '版本' },
  { category: 'product', weight: 2, text: '原型图' },
  { category: 'learning', weight: 4, text: '学习备忘' },
  { category: 'learning', weight: 4, text: '知识点' },
  { category: 'learning', weight: 4, text: '读书笔记' },
  { category: 'learning', weight: 4, text: '听了播客' },
  { category: 'learning', weight: 4, text: '课程笔记' },
  { category: 'learning', weight: 4, text: '复习要点' },
  { category: 'learning', weight: 4, text: '概念解释' },
  { category: 'learning', weight: 4, text: '论文' },
  { category: 'learning', weight: 4, text: '方法论' },
  { category: 'learning', weight: 2, text: '学习' },
  { category: 'learning', weight: 2, text: '读书' },
  { category: 'learning', weight: 2, text: '播客' },
  { category: 'learning', weight: 2, text: '笔记' },
  { category: 'learning', weight: 2, text: '课程' },
  { category: 'learning', weight: 2, text: '复习' },
  { category: 'learning', weight: 2, text: '记住' },
  { category: 'learning', weight: 2, text: '摘录' },
  { category: 'learning', weight: 2, text: '读到' },
  { category: 'learning', weight: 2, text: '原理' },
  { category: 'learning', weight: 2, text: '教程' },
  { category: 'learning', weight: 2, text: '英语' },
  { category: 'learning', weight: 2, text: '书里' },
  { category: 'learning', weight: 2, text: '听课' },
  { category: 'learning', weight: 2, text: '知识' },
  { category: 'learning', weight: 2, text: '概念' },
  { category: 'learning', weight: 2, text: 'podcast' },
  { category: 'learning', weight: 2, text: 'lesson' },
  { category: 'work', weight: 4, text: '工作事务' },
  { category: 'work', weight: 4, text: '售前' },
  { category: 'work', weight: 4, text: '职场待办' },
  { category: 'work', weight: 4, text: '客户跟进' },
  { category: 'work', weight: 4, text: '报价' },
  { category: 'work', weight: 4, text: '合同' },
  { category: 'work', weight: 4, text: '周报' },
  { category: 'work', weight: 4, text: '会议纪要' },
  { category: 'work', weight: 4, text: '项目进度' },
  { category: 'work', weight: 4, text: '出差' },
  { category: 'work', weight: 4, text: '工单' },
  { category: 'work', weight: 4, text: '交付' },
  { category: 'work', weight: 2, text: '客户' },
  { category: 'work', weight: 2, text: '职场' },
  { category: 'work', weight: 2, text: '待办' },
  { category: 'work', weight: 2, text: '会议' },
  { category: 'work', weight: 2, text: '同事' },
  { category: 'work', weight: 2, text: '老板' },
  { category: 'work', weight: 2, text: '提案' },
  { category: 'work', weight: 2, text: '跟进' },
  { category: 'work', weight: 2, text: '汇报' },
  { category: 'work', weight: 2, text: '邮件' },
  { category: 'work', weight: 2, text: '上班' },
  { category: 'work', weight: 2, text: '工作' },
  { category: 'work', weight: 2, text: '对接' },
  { category: 'work', weight: 2, text: 'deadline' },
  { category: 'work', weight: 2, text: 'okr' },
  { category: 'life', weight: 4, text: '生活随想' },
  { category: 'life', weight: 4, text: '散步时' },
  { category: 'life', weight: 4, text: '心情很' },
  { category: 'life', weight: 4, text: '晚饭' },
  { category: 'life', weight: 4, text: '家人' },
  { category: 'life', weight: 4, text: '想念' },
  { category: 'life', weight: 4, text: '感触' },
  { category: 'life', weight: 2, text: '生活' },
  { category: 'life', weight: 2, text: '散步' },
  { category: 'life', weight: 2, text: '随想' },
  { category: 'life', weight: 2, text: '心情' },
  { category: 'life', weight: 2, text: '情绪' },
  { category: 'life', weight: 2, text: '孩子' },
  { category: 'life', weight: 2, text: '旅行' },
  { category: 'life', weight: 2, text: '天气' },
  { category: 'life', weight: 2, text: '身体' },
  { category: 'life', weight: 2, text: '睡觉' },
  { category: 'life', weight: 2, text: '周末' },
];

const WHOLE_WORD = /^[a-z0-9][a-z0-9+\-]*$/;

type PreparedKeyword = IdeaKeyword & {
  folded: string;
  wholeWord: boolean;
};

const PREPARED: readonly PreparedKeyword[] = IDEA_KEYWORDS.map((keyword) => {
  const folded = casefold(keyword.text);
  return { ...keyword, folded, wholeWord: WHOLE_WORD.test(folded) };
});

/** 小写并折叠空白。关键词都在 BMP 内，`toLowerCase` 与 Unicode casefold 结果一致。 */
export function normalizeText(value: string): string {
  return casefold(value).replace(/\s+/gu, ' ').trim();
}

function casefold(value: string): string {
  return value.toLowerCase();
}

/** 整词边界只看 ASCII 字母和数字。汉字不算延续，否则「推荐 app」无法命中。 */
function isAsciiAlnum(char: string): boolean {
  return /^[a-z0-9]$/i.test(char);
}

function containsKeyword(text: string, keyword: PreparedKeyword): boolean {
  if (!keyword.wholeWord) return text.includes(keyword.folded);
  let from = 0;
  while (from <= text.length) {
    const at = text.indexOf(keyword.folded, from);
    if (at < 0) return false;
    const before = at === 0 ? '' : text[at - 1] ?? '';
    const afterIndex = at + keyword.folded.length;
    const after = afterIndex >= text.length ? '' : text[afterIndex] ?? '';
    const beforeOk = before === '' || !isAsciiAlnum(before);
    const afterOk = after === '' || !isAsciiAlnum(after);
    if (beforeOk && afterOk) return true;
    from = at + 1;
  }
  return false;
}

function segmentScore(text: string, category: ClassifiedCategory): number {
  let score = 0;
  for (const keyword of PREPARED) {
    if (keyword.category !== category) continue;
    if (containsKeyword(text, keyword)) score += keyword.weight;
  }
  return score;
}

/** 用标题和正文做本地关键词分类。两者折叠后都为空时返回 other。 */
export function classifyIdea(title: string, body: string): IdeaCategory {
  const normalizedTitle = normalizeText(title);
  const normalizedBody = normalizeText(body);
  if (normalizedTitle === '' && normalizedBody === '') return 'other';

  let best: ClassifiedCategory | null = null;
  let bestScore = 0;
  for (const category of CATEGORY_TIE_ORDER) {
    const score = segmentScore(normalizedTitle, category) * 2 + segmentScore(normalizedBody, category);
    if (score > bestScore) {
      best = category;
      bestScore = score;
    }
  }
  return best ?? 'other';
}
