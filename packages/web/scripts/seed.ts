/**
 * 虚构数据种子：经 core 写入，覆盖设计规范第 10.2 条的数据情况。
 * 只用于开发、走查和截图；内容全部虚构，不对应任何真实灵感。
 *
 * 历史时间、legacy 原文和「导入」来源只能经 core 的导入命令写入（普通新建命令的时间取当前时间），
 * 所以大部分记录走 `core.importer`，另有一条走 `core.card.create`，覆盖网页真实的写入路径。
 */
import { createHash } from 'node:crypto';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DESKTOP_SOURCE, fallbackTitleFromBody, openCore, type Core, type IdeaCategory, type Source } from '@bluemanta/core';
import { gradientPng, type Rgb } from './png.ts';

export type SeedMode = 'full' | 'empty';

const SOURCES = {
  grok: { kind: 'agent', name: 'bot' },
  agent: { kind: 'agent', name: 'dsh-agent' },
  mcp: { kind: 'agent', name: 'mcp' },
  desktop: DESKTOP_SOURCE,
  imported: { kind: 'human', name: 'legacy_unknown' },
} as const satisfies Record<string, Source>;

type SourceKey = keyof typeof SOURCES;

const CHANNEL: Record<SourceKey, 'web' | 'bot' | 'agent'> = {
  grok: 'bot',
  agent: 'agent',
  mcp: 'agent',
  desktop: 'web',
  imported: 'web',
};

const PALETTE: readonly [Rgb, Rgb][] = [
  [
    [42, 113, 90],
    [227, 240, 234],
  ],
  [
    [110, 123, 242],
    [247, 246, 242],
  ],
  [
    [217, 130, 43],
    [251, 235, 184],
  ],
  [
    [212, 91, 138],
    [239, 237, 231],
  ],
];

type SeedIdea = {
  key: string;
  /** 省略时按正文生成兜底标题（与 core 规则一致）。 */
  title?: string;
  body: string;
  /** `undefined` 用正文作原文；`null` 表示 legacy；字符串原样作原文。 */
  raw?: string | null;
  category: IdeaCategory;
  source: SourceKey;
  at: number;
  starred?: boolean;
  extensions?: { text: string; at: number }[];
  images?: number;
  trashed?: boolean;
};

const DAY = 86_400_000;

function shanghaiDayStart(nowMs: number): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
  }).formatToParts(new Date(nowMs));
  const value = (type: string) => Number(parts.find((part) => part.type === type)?.value);
  return Date.UTC(value('year'), value('month') - 1, value('day')) - 8 * 3_600_000;
}

const LONG_BODY = [
  '季度复盘别只写做了什么，按「目标、结果、差距、原因、下一步」五段写，每段不超过三句话。',
  '目标那段直接抄季度初定下的数字，不要事后改口径；结果只写可以核对的事实，附上链接。',
  '差距要量化：差了多少、差在哪个环节。原因分成「可控」和「不可控」两栏，只对可控的那栏写改进动作。',
  '下一步最多三条，每条写清负责人和时间点。写完先发给一位同事读一遍，看能不能在五分钟内读懂。',
  '另外留一段「这季度学到的」，哪怕只有一句。半年后回头看，这一段往往比数字更有用。',
  '最后检查一遍：有没有把团队的成绩写成自己的，有没有把外部原因写成借口，有没有遗漏需要感谢的人。',
].join('\n\n');

const LONG_TITLE_BODY =
  '用热力图看一年的记录节奏，顺便把断档期标出来，看看是不是和出差、项目冲刺、家里有事这几类情况重合，如果重合就说明记录习惯需要一个更轻的入口，比如锁屏小组件或者语音';

function ideas(nowMs: number): SeedIdea[] {
  const dayStart = shanghaiDayStart(nowMs);
  const elapsed = Math.max(nowMs - dayStart, 60_000);
  const today = (fraction: number) => dayStart + Math.floor(elapsed * fraction);
  const ago = (days: number, hour: number, minute = 0) => dayStart - days * DAY + (hour * 60 + minute) * 60_000;

  return [
    {
      key: 'meeting-todo',
      title: '把会议纪要自动变成待办',
      body: '会后十分钟内，纪要里的「谁负责、何时交」自动生成任务卡，人只需确认。',
      raw: '开完会最烦的是整理待办，能不能让纪要直接变成任务？谁说了要做什么，自动拎出来，我点一下确认就行。',
      category: 'product',
      source: 'grok',
      at: today(0.9),
      starred: true,
      extensions: [{ text: '先从一个固定的周会开始试，只抽「负责人 + 截止时间」两项。', at: today(0.95) }],
      images: 2,
    },
    {
      key: 'kid-notebook',
      title: '给孩子的周末观察本',
      body: '每周记一件孩子自己发现的小事，月底一起翻看。可以配一张照片，让他自己写标题。',
      raw: '每周记一件孩子自己发现的小事，月底一起翻看。',
      category: 'life',
      source: 'grok',
      at: today(0.6),
    },
    {
      key: 'image-only',
      title: '',
      body: '',
      raw: '',
      category: 'other',
      source: 'mcp',
      at: today(0.3),
      images: 1,
    },
    {
      key: 'feedback-loop',
      title: '读书笔记：反馈回路那一章',
      body: '作者把习惯拆成「提示—行动—回报」，回报越即时，回路越稳。记录工具也一样：记完立刻能看到，才会继续记。',
      raw: '刚读到反馈回路那章，提示 行动 回报，回报要快。想想灵感台是不是也这样。',
      category: 'learning',
      source: 'agent',
      at: ago(1, 22, 8),
      starred: true,
    },
    {
      key: 'long-title',
      body: LONG_TITLE_BODY,
      category: 'product',
      source: 'desktop',
      at: ago(1, 18, 40),
    },
    {
      key: 'bookshelf',
      title: '周末整理书架',
      body: '旧书分三堆：留、送、换，送的放进小区漂流角。拍照记下送出去的书，年底看看送了多少。',
      raw: '周末整理书架 旧书分三堆 留 送 换',
      category: 'life',
      source: 'mcp',
      at: ago(1, 12, 3),
      images: 4,
    },
    {
      key: 'random-review',
      title: '灵感台加一个「随机回看」',
      body: '每天随机翻出一条一个月前的灵感，决定是延展、归档还是删掉，避免只记不看。',
      category: 'product',
      source: 'grok',
      at: ago(2, 21, 15),
    },
    {
      key: 'objections',
      title: '方案评审前先写「反对意见」',
      body: '评审会前自己先列三条最可能的反对意见，提前准备回应。',
      raw: '评审前先自己唱反调，列三条最可能被挑的地方。',
      category: 'work',
      source: 'grok',
      at: ago(3, 16, 20),
      starred: true,
      extensions: [
        { text: '试了一次，三条里猜中了两条。', at: ago(2, 10, 0) },
        { text: '可以做成模板：反对意见、证据、回应、仍未解决的问题。', at: ago(1, 9, 30) },
      ],
    },
    {
      key: 'voice-latency',
      title: '语音记灵感的延迟要低于 2 秒',
      body: '说完立刻看到文字，超过两秒就会打断思路。',
      raw: '语音记录 延迟 两秒以内 不然会断',
      category: 'product',
      source: 'mcp',
      at: ago(4, 11, 0),
      images: 1,
    },
    {
      key: 'color-theory',
      title: '学一点基础的色彩理论',
      body: '从色相环、明度对比开始，配合实际界面练习。',
      raw: '',
      category: 'learning',
      source: 'desktop',
      at: ago(4, 9, 30),
    },
    {
      key: 'river-run',
      title: '晨跑路线换成河边',
      body: '河边那条路有树荫，七点前人少。',
      raw: '晨跑换河边，有树荫，人少',
      category: 'life',
      source: 'grok',
      at: ago(5, 6, 50),
    },
    {
      key: 'quarter-review',
      title: '季度复盘的写法',
      body: LONG_BODY,
      category: 'work',
      source: 'desktop',
      at: ago(6, 15, 0),
    },
    {
      key: 'sql-window',
      title: '学 SQL 窗口函数',
      body: '先搞懂 PARTITION BY 和 ORDER BY 的组合，再练排名、累计和、环比三个例子。',
      raw: '窗口函数 partition by order by 排名 累计 环比',
      category: 'learning',
      source: 'mcp',
      at: ago(8, 20, 10),
    },
    {
      key: 'sticky-wall',
      title: '用便利贴墙规划季度',
      body: '把季度目标写在便利贴上贴满一面墙，每周挪一次位置。',
      raw: null,
      category: 'other',
      source: 'imported',
      at: ago(12, 10, 0),
    },
    {
      key: 'today-only',
      title: '一个只做「今天」的待办清单',
      body: '不做长期规划，只关心今天能完成的三件事。',
      raw: null,
      category: 'product',
      source: 'imported',
      at: ago(20, 21, 15),
      starred: true,
    },
    {
      key: 'bakery',
      title: '楼下新开的面包店周三休息',
      body: '周三想买早餐要换一家，或者前一天买好。',
      raw: '楼下面包店周三休息',
      category: 'other',
      source: 'grok',
      at: ago(40, 8, 20),
    },
    {
      key: 'podcast',
      title: '英语播客每天听 15 分钟',
      body: '通勤路上听，听完用一句话复述主要观点，记在这里。',
      raw: '每天通勤听英语播客十五分钟，听完复述一句',
      category: 'learning',
      source: 'agent',
      at: ago(70, 8, 45),
      images: 3,
    },
    {
      key: 'interview-notes',
      title: '客户访谈后 24 小时内发纪要',
      body: '趁记忆新鲜整理，附上下一步和负责人，客户感知会好很多。',
      category: 'work',
      source: 'desktop',
      at: ago(100, 15, 0),
    },
    {
      key: 'old-photos',
      title: '给父母拍一组旧照片',
      body: '把老相册里的照片翻拍一遍，按年份整理，配上他们口述的故事。',
      raw: null,
      category: 'life',
      source: 'imported',
      at: ago(150, 19, 30),
    },
    {
      key: 'shortcuts',
      title: '收集好用的快捷键',
      body: '把每天用得最多的十个快捷键写成一张卡片，贴在显示器边上，一个月后撕掉。',
      raw: '收集快捷键 贴显示器边上',
      category: 'other',
      source: 'mcp',
      at: ago(175, 14, 0),
    },
    {
      key: 'trashed',
      title: '已经移入回收站的一条',
      body: '这条在回收站里，清单里不应出现。',
      category: 'work',
      source: 'desktop',
      at: ago(9, 9, 0),
      trashed: true,
    },
  ];
}

function rawInputFor(idea: SeedIdea) {
  if (idea.raw === null) return { status: 'legacy' as const };
  const text = idea.raw ?? (idea.body !== '' ? idea.body : (idea.title ?? ''));
  return { status: 'present' as const, channel: CHANNEL[idea.source], text };
}

function importImages(core: Core, idea: SeedIdea, scratch: string): string[] {
  const ids: string[] = [];
  for (let index = 0; index < (idea.images ?? 0); index += 1) {
    const [from, to] = PALETTE[index % PALETTE.length]!;
    const width = 240 + index * 40;
    const height = 160;
    const bytes = gradientPng(width, height, from, to);
    const file = join(scratch, `${idea.key}-${index}.png`);
    writeFileSync(file, bytes);
    const iso = new Date(idea.at).toISOString();
    const result = core.importer.importAttachment(
      {
        sourceId: `seed-attachment-${idea.key}-${index}`,
        sourceUpdatedAt: iso,
        raw: null,
        createdAt: iso,
        updatedAt: iso,
        createdBy: SOURCES[idea.source],
        updatedBy: SOURCES[idea.source],
        mime: 'image/png',
        byteSize: bytes.byteLength,
        width,
        height,
        sha256: createHash('sha256').update(bytes).digest('hex'),
      },
      file,
    );
    if (!result.ok) throw new Error(`种子图片写入失败：${result.message}`);
    ids.push(result.record.id);
  }
  return ids;
}

export type SeedResult = { active: number; trashed: number; attachments: number };

/** 往 `dataDir` 写虚构数据。`empty` 只建库不写记录。 */
export function seedIdeas(dataDir: string, mode: SeedMode, nowMs = Date.now()): SeedResult {
  mkdirSync(dataDir, { recursive: true });
  const core = openCore({ dataDir });
  const result: SeedResult = { active: 0, trashed: 0, attachments: 0 };
  try {
    if (mode === 'empty') return result;
    const scratch = join(dataDir, '.seed-scratch');
    mkdirSync(scratch, { recursive: true });
    try {
      for (const idea of ideas(nowMs)) {
        const attachmentIds = importImages(core, idea, scratch);
        result.attachments += attachmentIds.length;
        const iso = new Date(idea.at).toISOString();
        const lastTouch = Math.max(idea.at, ...(idea.extensions ?? []).map((extension) => extension.at));
        const title = idea.title ?? '';
        const written = core.importer.importIdea({
          sourceId: `seed-idea-${idea.key}`,
          sourceUpdatedAt: new Date(lastTouch).toISOString(),
          raw: null,
          createdAt: iso,
          updatedAt: new Date(lastTouch).toISOString(),
          createdBy: SOURCES[idea.source],
          updatedBy: SOURCES[idea.source],
          title: title === '' ? fallbackTitleFromBody(idea.body) : title,
          titleOrigin: title === '' ? 'fallback' : 'user',
          body: idea.body,
          rawInput: rawInputFor(idea),
          category: idea.category,
          categorySource: 'auto',
          captureGroupId: null,
          starred: idea.starred ?? false,
          deletedAt: idea.trashed ? new Date(nowMs - DAY).toISOString() : null,
          extensions: (idea.extensions ?? []).map((extension) => ({
            body: extension.text,
            createdAt: new Date(extension.at).toISOString(),
          })),
          attachmentIds,
        });
        if (!written.ok) throw new Error(`种子灵感写入失败（${idea.key}）：${written.message}`);
        if (idea.trashed) result.trashed += 1;
        else result.active += 1;
      }

      // 网页自己的写入路径：来源 desktop，原文自动取正文，因此「原文与正文相同」不显示原文。
      const created = core.card.create({
        requestId: `seed-desktop-${nowMs}`,
        cardType: 'idea',
        source: DESKTOP_SOURCE,
        title: '咖啡店的「慢时段」定价实验',
        body: '下午两点到四点客流低谷，试试第二杯半价能否拉平曲线。',
      });
      if (!created.ok) throw new Error(`种子灵感写入失败（desktop）：${created.message}`);
      result.active += 1;
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
    return result;
  } finally {
    core.close();
  }
}
