import type { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';
import { classifyIdea } from '../classify.js';
import { advance, bumpRev } from '../envelope.js';
import { commandFailure, type CommandResult } from '../errors.js';
import { applied, execute } from '../execute.js';
import { guardActiveCard, guardInTrash, guardRev, requireLiveProject } from '../guards.js';
import { createId } from '../ids.js';
import { deleteCardRow, deleteLinksOf, getCard, insertCard, saveCard } from '../rows.js';
import { hasIdeaContent, resolveIdeaTitle } from '../titles.js';
import type {
  Card,
  CardExtension,
  IdeaFields,
  PurgedCard,
  RawInput,
  Source,
  TitleOrigin,
} from '../types.js';
import {
  cardBodySchema,
  cardTitleSchema,
  extensionBodySchema,
  ideaFieldsInputSchema,
  rawInputSchema,
  requestFields,
  requirePatch,
  tagsSchema,
  targetFields,
} from '../validation.js';

const MODULE = 'core';
const IDEA_ATTACHMENT_LIMIT = 4;
const CONTENT_MESSAGE = '标题、正文、附件至少要有一项非空';

const sharedCreateFields = {
  ...requestFields,
  body: cardBodySchema.optional(),
  starred: z.boolean().optional(),
  tags: tagsSchema.optional(),
  projectId: z.string().min(1).nullable().optional(),
};

const cardCreateSchema = z.discriminatedUnion('cardType', [
  z
    .object({
      ...sharedCreateFields,
      cardType: z.literal('idea'),
      title: cardTitleSchema.optional(),
      rawInput: rawInputSchema.optional(),
      attachmentIds: z.array(z.string().min(1)).max(IDEA_ATTACHMENT_LIMIT).optional(),
      fields: ideaFieldsInputSchema.optional(),
    })
    .strict(),
  z
    .object({
      ...sharedCreateFields,
      cardType: z.literal('scene'),
      title: cardTitleSchema,
      rawInput: rawInputSchema,
      attachmentIds: z.array(z.string().min(1)).optional(),
    })
    .strict(),
  z
    .object({
      ...sharedCreateFields,
      cardType: z.literal('note'),
      title: cardTitleSchema,
      rawInput: rawInputSchema,
      attachmentIds: z.array(z.string().min(1)).optional(),
    })
    .strict(),
]);

const cardUpdateSchema = z
  .object({
    ...requestFields,
    ...targetFields,
    title: cardTitleSchema.optional(),
    body: cardBodySchema.optional(),
    tags: tagsSchema.optional(),
    attachmentIds: z.array(z.string().min(1)).optional(),
    projectId: z.string().min(1).nullable().optional(),
    fields: ideaFieldsInputSchema.optional(),
  })
  .strict()
  .superRefine(requirePatch(['title', 'body', 'tags', 'attachmentIds', 'projectId', 'fields']));

const cardRevSchema = z
  .object({
    ...requestFields,
    ...targetFields,
  })
  .strict();

const cardSetStarSchema = z
  .object({
    ...requestFields,
    ...targetFields,
    starred: z.boolean(),
  })
  .strict();

const cardAddExtensionSchema = z
  .object({
    ...requestFields,
    ...targetFields,
    body: extensionBodySchema,
  })
  .strict();

const cardDeleteExtensionSchema = z
  .object({
    ...requestFields,
    ...targetFields,
    extensionId: z.string().min(1),
  })
  .strict();

export type CardCreateInput = z.infer<typeof cardCreateSchema>;
export type CardUpdateInput = z.infer<typeof cardUpdateSchema>;
export type CardRevInput = z.infer<typeof cardRevSchema>;
export type CardSetStarInput = z.infer<typeof cardSetStarSchema>;
export type CardAddExtensionInput = z.infer<typeof cardAddExtensionSchema>;
export type CardDeleteExtensionInput = z.infer<typeof cardDeleteExtensionSchema>;

type IdeaFieldInput = z.infer<typeof ideaFieldsInputSchema>;

function defaultRawInput(source: Source, title: string, body: string): RawInput {
  const channel = source.kind === 'agent' ? 'agent' : 'web';
  const text = body !== '' ? body : title;
  return { status: 'present', channel, text };
}

function resolveIdeaFields(input: IdeaFieldInput, title: string, body: string, previous?: IdeaFields): IdeaFields {
  const captureGroupId = input.captureGroupId === undefined ? (previous?.captureGroupId ?? null) : input.captureGroupId;
  if (input.category !== undefined) {
    return { category: input.category, categorySource: 'user', captureGroupId };
  }
  if (previous?.categorySource === 'user') {
    return { category: previous.category, categorySource: 'user', captureGroupId };
  }
  return { category: classifyIdea(title, body), categorySource: 'auto', captureGroupId };
}

function resolveStoredTitle(
  cardType: Card['cardType'],
  current: { title: string; titleOrigin: TitleOrigin } | null,
  inputTitle: string | undefined,
  body: string,
): { title: string; titleOrigin: TitleOrigin } {
  if (cardType === 'idea') {
    if (current !== null && inputTitle === undefined) {
      return { title: current.title, titleOrigin: current.titleOrigin };
    }
    return resolveIdeaTitle(inputTitle, body);
  }
  if (inputTitle !== undefined) return { title: inputTitle, titleOrigin: 'user' };
  if (current !== null) return { title: current.title, titleOrigin: current.titleOrigin };
  return { title: '', titleOrigin: 'user' };
}

export function createCard(db: DatabaseSync, raw: unknown): CommandResult<Card> {
  return execute(
    db,
    {
      name: 'card.create',
      schema: cardCreateSchema,
      apply(database, input, now) {
        if (input.starred === true && input.source.kind === 'agent') {
          return commandFailure('forbidden_source', '收藏只能由人执行');
        }
        if (typeof input.projectId === 'string') {
          const missing = requireLiveProject(database, input.projectId);
          if (missing) return missing;
        }
        const body = input.body ?? '';
        const attachmentIds = input.attachmentIds ?? [];
        if (input.cardType === 'idea' && !hasIdeaContent(input.title ?? '', body, attachmentIds)) {
          return commandFailure('invalid_input', CONTENT_MESSAGE);
        }
        const title = resolveStoredTitle(input.cardType, null, input.title, body);
        const rawInput =
          input.cardType === 'idea' ? (input.rawInput ?? defaultRawInput(input.source, title.title, body)) : input.rawInput;
        const shared = {
          id: createId('card'),
          module: MODULE,
          rev: 1,
          createdAt: now,
          updatedAt: now,
          createdBy: input.source,
          updatedBy: input.source,
          deletedAt: null,
          title: title.title,
          titleOrigin: title.titleOrigin,
          body,
          rawInput,
          starred: input.starred ?? false,
          tags: input.tags ?? [],
          attachmentIds,
          extensions: [] as CardExtension[],
          projectId: input.projectId ?? null,
        };
        const record: Card =
          input.cardType === 'idea'
            ? { ...shared, cardType: 'idea', fields: resolveIdeaFields(input.fields ?? {}, title.title, body) }
            : input.cardType === 'scene'
              ? { ...shared, cardType: 'scene', fields: {} }
              : { ...shared, cardType: 'note', fields: {} };
        insertCard(database, record);
        return applied(record, null);
      },
    },
    raw,
  );
}

export function updateCard(db: DatabaseSync, raw: unknown): CommandResult<Card> {
  return execute(
    db,
    {
      name: 'card.update',
      schema: cardUpdateSchema,
      apply(database, input, now) {
        const current = getCard(database, input.id);
        if (current === null) return commandFailure('not_found', '记录不存在');
        const problem = guardActiveCard(current, input.rev);
        if (problem) return problem;
        const projectId = input.projectId === undefined ? current.projectId : input.projectId;
        if (typeof projectId === 'string') {
          const missing = requireLiveProject(database, projectId);
          if (missing) return missing;
        }
        const attachmentIds = input.attachmentIds ?? current.attachmentIds;
        if (current.cardType === 'idea' && attachmentIds.length > IDEA_ATTACHMENT_LIMIT) {
          return commandFailure('invalid_input', '灵感最多 4 个附件');
        }
        if (current.cardType !== 'idea' && input.fields !== undefined) {
          return commandFailure('invalid_input', 'scene 和 note 不使用类型字段');
        }
        const body = input.body ?? current.body;
        const titleForContent = input.title === undefined ? current.title : input.title;
        if (current.cardType === 'idea' && !hasIdeaContent(titleForContent, body, attachmentIds)) {
          return commandFailure('invalid_input', CONTENT_MESSAGE);
        }
        const title = resolveStoredTitle(current.cardType, current, input.title, body);
        const fields: IdeaFields | Record<string, never> =
          current.cardType === 'idea'
            ? resolveIdeaFields(input.fields ?? {}, title.title, body, current.fields)
            : {};
        const patched: Card =
          current.cardType === 'idea'
            ? {
                ...current,
                title: title.title,
                titleOrigin: title.titleOrigin,
                body,
                tags: input.tags ?? current.tags,
                attachmentIds,
                projectId,
                fields: fields as IdeaFields,
              }
            : current.cardType === 'scene'
              ? {
                  ...current,
                  title: title.title,
                  titleOrigin: title.titleOrigin,
                  body,
                  tags: input.tags ?? current.tags,
                  attachmentIds,
                  projectId,
                  fields: {},
                }
              : {
                  ...current,
                  title: title.title,
                  titleOrigin: title.titleOrigin,
                  body,
                  tags: input.tags ?? current.tags,
                  attachmentIds,
                  projectId,
                  fields: {},
                };
        const record = advance(patched, input.source, now, current.deletedAt);
        saveCard(database, record);
        return applied(record, current.rev);
      },
    },
    raw,
  );
}

export function deleteCard(db: DatabaseSync, raw: unknown): CommandResult<Card> {
  return execute(
    db,
    {
      name: 'card.delete',
      schema: cardRevSchema,
      apply(database, input, now) {
        const current = getCard(database, input.id);
        if (current === null) return commandFailure('not_found', '记录不存在');
        const problem = guardRev(current, input.rev, 'active');
        if (problem) return problem;
        const record = advance(current, input.source, now, now);
        saveCard(database, record);
        return applied(record, current.rev);
      },
    },
    raw,
  );
}

export function restoreCard(db: DatabaseSync, raw: unknown): CommandResult<Card> {
  return execute(
    db,
    {
      name: 'card.restore',
      schema: cardRevSchema,
      apply(database, input, now) {
        const current = getCard(database, input.id);
        if (current === null) return commandFailure('not_found', '记录不存在');
        const problem = guardRev(current, input.rev, 'deleted');
        if (problem) return problem;
        const record = advance(current, input.source, now, null);
        saveCard(database, record);
        return applied(record, current.rev);
      },
    },
    raw,
  );
}

export function purgeCard(db: DatabaseSync, raw: unknown): CommandResult<PurgedCard> {
  return execute(
    db,
    {
      name: 'card.purge',
      schema: cardRevSchema,
      humanOnly: true,
      apply(database, input) {
        const current = getCard(database, input.id);
        if (current === null) return commandFailure('not_found', '记录不存在');
        const problem = guardInTrash(current, input.rev);
        if (problem) return problem;
        deleteLinksOf(database, current.id);
        deleteCardRow(database, current.id);
        return {
          ok: true,
          record: { id: current.id, attachmentIds: [...current.attachmentIds] },
          objectId: current.id,
          revBefore: current.rev,
          revAfter: null,
        };
      },
    },
    raw,
  );
}

export function setCardStar(db: DatabaseSync, raw: unknown): CommandResult<Card> {
  return execute(
    db,
    {
      name: 'card.setStar',
      schema: cardSetStarSchema,
      humanOnly: true,
      apply(database, input) {
        const current = getCard(database, input.id);
        if (current === null) return commandFailure('not_found', '记录不存在');
        const problem = guardActiveCard(current, input.rev);
        if (problem) return problem;
        const record = bumpRev({ ...current, starred: input.starred });
        saveCard(database, record);
        return applied(record, current.rev);
      },
    },
    raw,
  );
}

export function addCardExtension(db: DatabaseSync, raw: unknown): CommandResult<Card> {
  return execute(
    db,
    {
      name: 'card.addExtension',
      schema: cardAddExtensionSchema,
      humanOnly: true,
      apply(database, input, now) {
        const current = getCard(database, input.id);
        if (current === null) return commandFailure('not_found', '记录不存在');
        const problem = guardActiveCard(current, input.rev);
        if (problem) return problem;
        const extension: CardExtension = { id: createId('ext'), body: input.body, createdAt: now };
        const record = advance(
          { ...current, extensions: [...current.extensions, extension] },
          input.source,
          now,
          current.deletedAt,
        );
        saveCard(database, record);
        return applied(record, current.rev);
      },
    },
    raw,
  );
}

export function deleteCardExtension(db: DatabaseSync, raw: unknown): CommandResult<Card> {
  return execute(
    db,
    {
      name: 'card.deleteExtension',
      schema: cardDeleteExtensionSchema,
      humanOnly: true,
      apply(database, input, now) {
        const current = getCard(database, input.id);
        if (current === null) return commandFailure('not_found', '记录不存在');
        const problem = guardActiveCard(current, input.rev);
        if (problem) return problem;
        const extensions = current.extensions.filter((item) => item.id !== input.extensionId);
        if (extensions.length === current.extensions.length) return commandFailure('not_found', '追记不存在');
        const record = advance({ ...current, extensions }, input.source, now, current.deletedAt);
        saveCard(database, record);
        return applied(record, current.rev);
      },
    },
    raw,
  );
}
