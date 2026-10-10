import type {
  Card,
  CardCreateInput,
  CardSearchField,
  CardSearchHit,
  CardSearchOptions,
  CommandErrorCode,
  CommandResult,
  IdeaCategory,
  RawInput,
  Source,
} from '@bluemanta/core';

/**
 * 灵感工具的执行逻辑。从 dsh 插件抽出，命令行和 MCP 共用。
 * 只接收 core 和参数，不引用 dsh，也不另写标题、分类或去重规则。
 * 分类中文名与 docs/specs/idea-rules.md 第 3 节一致，这里只做显示。
 */
export const AGENT_SOURCE = { kind: 'agent', name: 'dsh-agent' } as const;

export const IDEA_CAPTURE_TOOL = 'bluemanta_idea_capture';
export const IDEA_SEARCH_TOOL = 'bluemanta_idea_search';
export const IDEA_GET_TOOL = 'bluemanta_idea_get';

export const SEARCH_LIMIT_DEFAULT = 10;
export const SEARCH_LIMIT_MAX = 50;

export const AGENT_LIMITATION = '不能收藏、追记、删除，这些需要用户在灵感台界面操作。';

export const CAPTURE_DESCRIPTION =
  '当用户要记下一条灵感、想法或备忘时使用，例如「帮我记一下：……」。' +
  'body 是正文，title 是可选标题，category 是可选分类，只能是 product（产品想法）、learning（学习备忘）、work（工作事务）、life（生活随想）、other（其他）。' +
  '标题和正文至少一个非空；都没给、或只有空白时会拒绝，不会写入。' +
  AGENT_LIMITATION;

export const SEARCH_DESCRIPTION =
  '当用户要查找已有灵感时使用，例如「我之前有没有关于 X 的想法」。' +
  'query 是必填关键词，按空白分开，每个词都要命中。limit 是返回条数，省略时为 10，最大 50。' +
  'category 可选，取值与记录工具相同。starredOnly 为 true 时只返回已收藏的灵感。' +
  '默认不含回收站。没有匹配时 message 为「没有找到」。' +
  '每条结果的 createdAt 是创建日期（YYYY-MM-DD），field 是命中字段（title 标题、body 正文、rawInput 原文、category 分类），excerpt 是摘录。' +
  AGENT_LIMITATION;

export const GET_DESCRIPTION =
  '当已经知道灵感 id，需要读取完整内容时使用。' +
  '返回标题、正文、分类中文名、是否收藏、创建时间、追记列表和原文。' +
  '在回收站中的照常返回，notice 为「在回收站中」。' +
  '没有保留原文的历史记录 rawInput.status 为 legacy，note 为「无原文」。' +
  AGENT_LIMITATION;

export const CATEGORY_LABELS: Record<IdeaCategory, string> = {
  product: '产品想法',
  learning: '学习备忘',
  work: '工作事务',
  life: '生活随想',
  other: '其他',
};

const FIELD_LABELS: Record<CardSearchField, string> = {
  title: '标题',
  body: '正文',
  rawInput: '原文',
  category: '分类',
};

export const IDEA_CATEGORY_VALUES = ['product', 'learning', 'work', 'life', 'other'] as const;

/** 用工具调用 id 生成稳定的 requestId，同一次调用重试时 core 不会再写一条。 */
export function ideaRequestId(callId: string): string {
  const id = callId.trim();
  if (id === '') throw new Error('工具调用缺少 id，不能写入');
  return `dsh-agent:${id}`;
}

export type IdeaToolCore = {
  card: {
    create: (input: CardCreateInput) => CommandResult<Card>;
  };
  getCard: (id: string) => Card | null;
  searchCards: (query: string, options?: CardSearchOptions) => CardSearchHit[];
};

export type IdeaToolFailure = {
  ok: false;
  error: string;
  code?: CommandErrorCode;
};

export type CaptureIdeaInput = {
  requestId: string;
  body?: string;
  title?: string;
  category?: IdeaCategory;
  /** 缺省为 dsh-agent，保持 T6 的来源。 */
  source?: Source;
  /** 显式原文。省略时由 core 按正文和来源生成。 */
  rawInput?: RawInput;
};

export type CaptureIdeaResult =
  | {
      ok: true;
      id: string;
      title: string;
      category: string;
      fallbackTitle: boolean;
    }
  | IdeaToolFailure;

export type SearchIdeaInput = {
  query: string;
  limit?: number;
  category?: IdeaCategory;
  starredOnly?: boolean;
};

export type IdeaSearchItem = {
  id: string;
  title: string;
  category: string;
  createdAt: string;
  field: CardSearchField;
  excerpt: string;
};

export type SearchIdeaResult =
  | {
      ok: true;
      count: number;
      limit: number;
      message: string;
      items: IdeaSearchItem[];
    }
  | IdeaToolFailure;

export type IdeaExtensionView = {
  id: string;
  body: string;
  createdAt: string;
};

export type IdeaRawView =
  | { status: 'present'; channel: 'web' | 'bot' | 'agent'; text: string }
  | { status: 'legacy'; note: '无原文' };

export type GetIdeaResult =
  | {
      ok: true;
      id: string;
      title: string;
      body: string;
      category: string;
      starred: boolean;
      createdAt: string;
      inTrash: boolean;
      notice: string;
      extensions: IdeaExtensionView[];
      rawInput: IdeaRawView;
    }
  | IdeaToolFailure;

export function captureIdea(core: IdeaToolCore, input: CaptureIdeaInput): CaptureIdeaResult {
  const requestId = input.requestId.trim();
  if (requestId === '') return fail('invalid_input', '缺少请求 id');

  const result = core.card.create({
    requestId,
    source: input.source ?? AGENT_SOURCE,
    cardType: 'idea',
    ...(input.title === undefined ? {} : { title: input.title }),
    ...(input.body === undefined ? {} : { body: input.body }),
    ...(input.category === undefined ? {} : { fields: { category: input.category } }),
    ...(input.rawInput === undefined ? {} : { rawInput: input.rawInput }),
  });
  if (!result.ok) return fail(result.code, result.message);
  const card = result.record;
  if (card.cardType !== 'idea') return fail('invalid_input', '写入的记录不是灵感');
  return {
    ok: true,
    id: card.id,
    title: card.title,
    category: CATEGORY_LABELS[card.fields.category],
    fallbackTitle: card.titleOrigin === 'fallback',
  };
}

export function searchIdeas(core: IdeaToolCore, input: SearchIdeaInput): SearchIdeaResult {
  if (input.query.trim() === '') return fail('invalid_input', 'query 不能为空');
  const limit = resolveSearchLimit(input.limit);
  if (typeof limit !== 'number') return limit;

  const hits = core.searchCards(input.query, { cardType: 'idea' });
  const matched = hits.filter((hit) => {
    if (hit.card.cardType !== 'idea') return false;
    if (input.category !== undefined && hit.card.fields.category !== input.category) return false;
    if (input.starredOnly === true && !hit.card.starred) return false;
    return true;
  });
  const items = matched.slice(0, limit).map(toSearchItem);
  return {
    ok: true,
    count: items.length,
    limit,
    message: items.length === 0 ? '没有找到' : '',
    items,
  };
}

export function getIdea(core: IdeaToolCore, input: { id: string }): GetIdeaResult {
  const id = input.id.trim();
  if (id === '') return fail('invalid_input', 'id 不能为空');
  const card = core.getCard(id);
  if (card === null) return fail('not_found', '没有找到这条灵感');
  if (card.cardType !== 'idea') return fail('invalid_input', '这条记录不是灵感');
  const inTrash = card.deletedAt !== null;
  return {
    ok: true,
    id: card.id,
    title: card.title,
    body: card.body,
    category: CATEGORY_LABELS[card.fields.category],
    starred: card.starred,
    createdAt: card.createdAt,
    inTrash,
    notice: inTrash ? '在回收站中' : '',
    extensions: card.extensions.map((extension) => ({
      id: extension.id,
      body: extension.body,
      createdAt: extension.createdAt,
    })),
    rawInput: rawView(card.rawInput),
  };
}

export function renderCapture(value: CaptureIdeaResult): string {
  if (!value.ok) return `没有记下：${value.error}`;
  const titleNote = value.fallbackTitle ? '（标题由正文生成）' : '';
  return `已记下灵感「${value.title}」${titleNote}，分类：${value.category}，id：${value.id}`;
}

export function renderSearch(value: SearchIdeaResult): string {
  if (!value.ok) return value.error;
  if (value.items.length === 0) return '没有找到';
  const lines = value.items.map((item) => {
    return `${item.createdAt} 「${item.title}」（${item.category}）命中${FIELD_LABELS[item.field]}：${item.excerpt} id：${item.id}`;
  });
  return lines.join('\n');
}

export function renderGet(value: GetIdeaResult): string {
  if (!value.ok) return value.error;
  const lines = [
    ...(value.notice === '' ? [] : [value.notice]),
    `标题：${value.title}`,
    `分类：${value.category}`,
    `收藏：${value.starred ? '是' : '否'}`,
    `创建时间：${value.createdAt}`,
    `正文：${value.body}`,
  ];
  if (value.rawInput.status === 'legacy') lines.push('原文：无原文');
  else lines.push(`原文：${value.rawInput.text}`);
  if (value.extensions.length === 0) lines.push('追记：无');
  else {
    lines.push('追记：');
    for (const extension of value.extensions) {
      lines.push(`- ${extension.createdAt} ${extension.body}`);
    }
  }
  return lines.join('\n');
}

function fail(code: CommandErrorCode, error: string): IdeaToolFailure {
  return { ok: false, error, code };
}

function resolveSearchLimit(limit: number | undefined): number | IdeaToolFailure {
  if (limit === undefined) return SEARCH_LIMIT_DEFAULT;
  if (!Number.isInteger(limit) || limit < 1) {
    return fail('invalid_input', 'limit 需要是 1 到 50 的整数');
  }
  return Math.min(limit, SEARCH_LIMIT_MAX);
}

function toSearchItem(hit: CardSearchHit): IdeaSearchItem {
  const card = hit.card;
  const category = card.cardType === 'idea' ? CATEGORY_LABELS[card.fields.category] : '';
  return {
    id: card.id,
    title: card.title,
    category,
    createdAt: card.createdAt.slice(0, 10),
    field: hit.field,
    excerpt: hit.excerpt,
  };
}

function rawView(rawInput: RawInput): IdeaRawView {
  if (rawInput.status === 'legacy') return { status: 'legacy', note: '无原文' };
  return { status: 'present', channel: rawInput.channel, text: rawInput.text };
}
