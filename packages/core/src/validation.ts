import { z } from 'zod';

export function charLength(value: string): number {
  return Array.from(value).length;
}

export function limitChars(max: number, message: string) {
  return (value: string, ctx: z.RefinementCtx): void => {
    if (charLength(value) > max) {
      ctx.addIssue({ code: 'custom', message });
    }
  };
}

const ISO_DATE_TIME =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})?$/;

export function isIsoDateTime(value: string): boolean {
  if (!ISO_DATE_TIME.test(value)) return false;
  return Number.isFinite(Date.parse(value));
}

export const isoDateTimeSchema = z.string().superRefine((value, ctx) => {
  if (!isIsoDateTime(value)) {
    ctx.addIssue({ code: 'custom', message: '时间需要是 ISO 8601' });
  }
});

export function isIsoDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

export function formatZodError(error: z.ZodError): string {
  return error.issues
    .map((issue) => {
      const path = issue.path.length > 0 ? issue.path.join('.') : '输入';
      return `${path}: ${issue.message}`;
    })
    .join('；');
}

export function requirePatch(keys: readonly string[], message = '至少提供一个要修改的字段') {
  return (value: object, ctx: z.RefinementCtx): void => {
    const record = value as Record<string, unknown>;
    if (!keys.some((key) => record[key] !== undefined)) {
      ctx.addIssue({ code: 'custom', message });
    }
  };
}

export const sourceSchema = z
  .object({
    kind: z.enum(['human', 'agent']),
    name: z.string().min(1),
  })
  .strict();

export const requestFields = {
  requestId: z.string().min(1),
  source: sourceSchema,
};

export const targetFields = {
  id: z.string().min(1),
  rev: z.number().int().positive(),
};

export const cardTitleSchema = z.string().superRefine(limitChars(80, '标题不能超过 80 字'));

export const cardBodySchema = z.string().superRefine(limitChars(8000, '正文不能超过 8000 字'));

export const extensionBodySchema = z
  .string()
  .min(1)
  .superRefine(limitChars(8000, '追记不能超过 8000 字'));

export const dueSchema = z.string().superRefine((value, ctx) => {
  if (!isIsoDate(value)) {
    ctx.addIssue({ code: 'custom', message: '截止日期需要是 YYYY-MM-DD' });
  }
});

export const locationSchema = z
  .object({
    label: z.string().optional(),
    path: z.string().min(1).optional(),
    url: z.string().min(1).optional(),
  })
  .strict()
  .refine((location) => location.path !== undefined || location.url !== undefined, {
    message: '位置需要 path 或 url',
  });

/**
 * 调用方只传分类和捕捉分组。`categorySource` 由 core 决定：
 * 带 `category` 视为用户指定；省略 `captureGroupId` 即 null。
 */
export const ideaFieldsInputSchema = z
  .object({
    category: z.enum(['product', 'learning', 'work', 'life', 'other']).optional(),
    captureGroupId: z.string().min(1).nullable().optional(),
  })
  .strict();

export const rawInputSchema = z.union([
  z
    .object({
      status: z.literal('present'),
      channel: z.enum(['web', 'bot', 'agent']),
      text: z.string(),
    })
    .strict(),
  z
    .object({
      status: z.literal('legacy'),
    })
    .strict(),
]);

export const tagsSchema = z.array(z.string().min(1));

export const originSchema = z
  .object({
    module: z.string().min(1),
    objectId: z.string().min(1),
  })
  .strict();
