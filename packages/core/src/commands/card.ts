import type { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';
import { advance } from '../envelope.js';
import { commandFailure, type CommandResult } from '../errors.js';
import { applied, appliedPurge, execute } from '../execute.js';
import { guardRev, requireLiveProject } from '../guards.js';
import { createId } from '../ids.js';
import { deleteCardRow, deleteLinksOf, getCard, insertCard, saveCard } from '../rows.js';
import type { Card, CardExtension, IdeaFields, PurgedRecord } from '../types.js';
import {
  cardBodySchema,
  cardTitleSchema,
  extensionBodySchema,
  ideaFieldsSchema,
  rawInputSchema,
  requestFields,
  requirePatch,
  tagsSchema,
  targetFields,
} from '../validation.js';

const MODULE = 'core';
const IDEA_ATTACHMENT_LIMIT = 4;

const cardBaseFields = {
  ...requestFields,
  title: cardTitleSchema,
  body: cardBodySchema.optional(),
  rawInput: rawInputSchema,
  starred: z.boolean().optional(),
  tags: tagsSchema.optional(),
  projectId: z.string().min(1).nullable().optional(),
};

const cardCreateSchema = z.discriminatedUnion('cardType', [
  z
    .object({
      ...cardBaseFields,
      cardType: z.literal('idea'),
      attachmentIds: z.array(z.string().min(1)).max(IDEA_ATTACHMENT_LIMIT).optional(),
      fields: ideaFieldsSchema,
    })
    .strict(),
  z
    .object({
      ...cardBaseFields,
      cardType: z.literal('scene'),
      attachmentIds: z.array(z.string().min(1)).optional(),
    })
    .strict(),
  z
    .object({
      ...cardBaseFields,
      cardType: z.literal('note'),
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
    fields: ideaFieldsSchema.partial().optional(),
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

function patchCard(
  current: Card,
  patch: {
    title: string;
    body: string;
    tags: string[];
    attachmentIds: string[];
    projectId: string | null;
    fields: Partial<IdeaFields> | undefined;
  },
): Card {
  const shared = {
    title: patch.title,
    body: patch.body,
    tags: patch.tags,
    attachmentIds: patch.attachmentIds,
    projectId: patch.projectId,
  };
  if (current.cardType === 'idea') {
    return { ...current, ...shared, fields: { ...current.fields, ...definedFields(patch.fields ?? {}) } };
  }
  return { ...current, ...shared };
}

function definedFields(patch: Partial<IdeaFields>): Partial<IdeaFields> {
  const next: Partial<IdeaFields> = {};
  if (patch.category !== undefined) next.category = patch.category;
  if (patch.categorySource !== undefined) next.categorySource = patch.categorySource;
  if (patch.captureGroupId !== undefined) next.captureGroupId = patch.captureGroupId;
  return next;
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
        const shared = {
          id: createId('card'),
          module: MODULE,
          rev: 1,
          createdAt: now,
          updatedAt: now,
          createdBy: input.source,
          updatedBy: input.source,
          deletedAt: null,
          title: input.title,
          body: input.body ?? '',
          rawInput: input.rawInput,
          starred: input.starred ?? false,
          tags: input.tags ?? [],
          attachmentIds: input.attachmentIds ?? [],
          extensions: [] as CardExtension[],
          projectId: input.projectId ?? null,
        };
        const record: Card =
          input.cardType === 'idea'
            ? { ...shared, cardType: 'idea', fields: input.fields }
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
        const problem = guardRev(current, input.rev, 'active');
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
        const patched = patchCard(current, {
          title: input.title ?? current.title,
          body: input.body ?? current.body,
          tags: input.tags ?? current.tags,
          attachmentIds,
          projectId,
          fields: input.fields,
        });
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

export function purgeCard(db: DatabaseSync, raw: unknown): CommandResult<PurgedRecord> {
  return execute(
    db,
    {
      name: 'card.purge',
      schema: cardRevSchema,
      humanOnly: true,
      apply(database, input) {
        const current = getCard(database, input.id);
        if (current === null) return commandFailure('not_found', '记录不存在');
        const problem = guardRev(current, input.rev, 'any');
        if (problem) return problem;
        deleteLinksOf(database, current.id);
        deleteCardRow(database, current.id);
        return appliedPurge(current.id, current.rev);
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
      apply(database, input, now) {
        const current = getCard(database, input.id);
        if (current === null) return commandFailure('not_found', '记录不存在');
        const problem = guardRev(current, input.rev, 'active');
        if (problem) return problem;
        const record = advance({ ...current, starred: input.starred }, input.source, now, current.deletedAt);
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
      apply(database, input, now) {
        const current = getCard(database, input.id);
        if (current === null) return commandFailure('not_found', '记录不存在');
        const problem = guardRev(current, input.rev, 'active');
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
      apply(database, input, now) {
        const current = getCard(database, input.id);
        if (current === null) return commandFailure('not_found', '记录不存在');
        const problem = guardRev(current, input.rev, 'active');
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
