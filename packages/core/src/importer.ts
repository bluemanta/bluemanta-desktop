import { copyFileSync, mkdirSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';
import { areaExists } from './areas.js';
import { commandFailure, type CommandFailure, type CommandResult } from './errors.js';
import { applied, execute } from './execute.js';
import { requireLiveProject } from './guards.js';
import { createId } from './ids.js';
import {
  insertImportSource,
  WORKBENCH_SOURCE_SYSTEM,
  type ImportSourceType,
} from './import-sources.js';
import { getAttachment, insertAttachment, insertCard, insertProject } from './rows.js';
import { hasIdeaContent } from './titles.js';
import type { Attachment, Card, CardExtension, Project, Source } from './types.js';
import {
  cardBodySchema,
  cardTitleSchema,
  extensionBodySchema,
  formatZodError,
  isoDateTimeSchema,
  locationSchema,
  rawInputSchema,
  requestFields,
  sourceSchema,
} from './validation.js';

const MODULE = 'core';
const IDEA_ATTACHMENT_LIMIT = 4;
const CONTENT_MESSAGE = '标题、正文、附件至少要有一项非空';
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const MAX_IMAGE_EDGE = 16384;

const MIME_EXTENSION = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/gif': '.gif',
  'image/webp': '.webp',
} as const;

const provenanceFields = {
  sourceId: z.string().min(1),
  sourceUpdatedAt: isoDateTimeSchema,
  raw: z.unknown(),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
  createdBy: sourceSchema,
  updatedBy: sourceSchema,
};

const importProjectSchema = z
  .object({
    ...requestFields,
    ...provenanceFields,
    title: z.string().min(1),
    area: z.string().min(1),
    status: z.enum(['active', 'paused', 'done', 'archived']),
    background: z.string(),
    positioning: z.string(),
    pinned: z.boolean(),
    locations: z.array(locationSchema).optional(),
  })
  .strict();

const importEntrySchema = z
  .object({
    ...requestFields,
    ...provenanceFields,
    projectId: z.string().min(1),
    title: cardTitleSchema,
    titleOrigin: z.enum(['user', 'fallback']),
    body: cardBodySchema,
  })
  .strict();

const importIdeaSchema = z
  .object({
    ...requestFields,
    ...provenanceFields,
    title: cardTitleSchema,
    titleOrigin: z.enum(['user', 'fallback']),
    body: cardBodySchema,
    rawInput: rawInputSchema,
    category: z.enum(['product', 'learning', 'work', 'life', 'other']),
    categorySource: z.enum(['auto', 'user']),
    captureGroupId: z.string().min(1).nullable(),
    starred: z.boolean(),
    deletedAt: isoDateTimeSchema.nullable(),
    extensions: z.array(
      z
        .object({
          body: extensionBodySchema,
          createdAt: isoDateTimeSchema,
        })
        .strict(),
    ),
    attachmentIds: z.array(z.string().min(1)).max(IDEA_ATTACHMENT_LIMIT),
  })
  .strict();

const importAttachmentSchema = z
  .object({
    ...requestFields,
    ...provenanceFields,
    mime: z.enum(['image/jpeg', 'image/png', 'image/gif', 'image/webp']),
    byteSize: z.number().int().nonnegative().max(MAX_IMAGE_BYTES),
    width: z.number().int().positive().max(MAX_IMAGE_EDGE).nullable(),
    height: z.number().int().positive().max(MAX_IMAGE_EDGE).nullable(),
    sha256: z.string().regex(/^[0-9a-fA-F]{64}$/, 'sha256 需要是 64 位十六进制'),
  })
  .strict();

export type ImportProjectInput = Omit<z.infer<typeof importProjectSchema>, 'requestId' | 'source'>;
export type ImportEntryInput = Omit<z.infer<typeof importEntrySchema>, 'requestId' | 'source'>;
export type ImportIdeaInput = Omit<z.infer<typeof importIdeaSchema>, 'requestId' | 'source'>;
export type ImportAttachmentInput = Omit<z.infer<typeof importAttachmentSchema>, 'requestId' | 'source'>;

type Provenance = {
  sourceId: string;
  sourceUpdatedAt: string;
  raw?: unknown;
  createdAt: string;
  updatedAt: string;
  createdBy: Source;
  updatedBy: Source;
};

export function workbenchImportRequestId(sourceType: ImportSourceType, sourceId: string): string {
  return `workbench:${sourceType}:${sourceId}`;
}

function withCommandMeta<T extends Provenance>(sourceType: ImportSourceType, input: T): T & { requestId: string; source: Source } {
  return {
    ...input,
    requestId: workbenchImportRequestId(sourceType, input.sourceId),
    source: input.createdBy,
  };
}

function invalid(error: z.ZodError): CommandFailure {
  return commandFailure('invalid_input', formatZodError(error));
}

function remember(
  db: DatabaseSync,
  sourceType: ImportSourceType,
  input: Provenance,
  targetId: string,
  now: string,
): void {
  insertImportSource(db, {
    sourceSystem: WORKBENCH_SOURCE_SYSTEM,
    sourceType,
    sourceId: input.sourceId,
    sourceUpdatedAt: input.sourceUpdatedAt,
    targetId,
    importedAt: now,
    rawJson: JSON.stringify(input.raw ?? null),
  });
}

export function validateImportProject(input: ImportProjectInput): CommandFailure | null {
  const parsed = importProjectSchema.safeParse(withCommandMeta('project', input));
  if (!parsed.success) return invalid(parsed.error);
  return null;
}

export function validateImportEntry(input: ImportEntryInput): CommandFailure | null {
  const parsed = importEntrySchema.safeParse(withCommandMeta('entry', input));
  if (!parsed.success) return invalid(parsed.error);
  return null;
}

export function validateImportIdea(input: ImportIdeaInput): CommandFailure | null {
  const parsed = importIdeaSchema.safeParse(withCommandMeta('idea', input));
  if (!parsed.success) return invalid(parsed.error);
  if (!hasIdeaContent(parsed.data.title, parsed.data.body, parsed.data.attachmentIds)) {
    return commandFailure('invalid_input', CONTENT_MESSAGE);
  }
  return null;
}

export function validateImportAttachment(input: ImportAttachmentInput): CommandFailure | null {
  const parsed = importAttachmentSchema.safeParse(withCommandMeta('attachment', input));
  if (!parsed.success) return invalid(parsed.error);
  return null;
}

export function importProject(db: DatabaseSync, input: ImportProjectInput): CommandResult<Project> {
  return execute(
    db,
    {
      name: 'import.workbench.project',
      schema: importProjectSchema,
      apply(database, command, now) {
        if (!areaExists(database, command.area)) {
          return commandFailure('invalid_input', `未知领域 id：${command.area}`);
        }
        const record: Project = {
          id: createId('project'),
          module: MODULE,
          rev: 1,
          createdAt: command.createdAt,
          updatedAt: command.updatedAt,
          createdBy: command.createdBy,
          updatedBy: command.updatedBy,
          deletedAt: null,
          title: command.title,
          area: command.area,
          status: command.status,
          background: command.background,
          positioning: command.positioning,
          pinned: command.pinned,
          locations: command.locations ?? [],
        };
        insertProject(database, record);
        remember(database, 'project', command, record.id, now);
        return applied(record, null);
      },
    },
    withCommandMeta('project', input),
  );
}

export function importEntry(db: DatabaseSync, input: ImportEntryInput): CommandResult<Card> {
  return execute(
    db,
    {
      name: 'import.workbench.entry',
      schema: importEntrySchema,
      apply(database, command, now) {
        const missing = requireLiveProject(database, command.projectId);
        if (missing) return missing;
        const record: Card = {
          id: createId('card'),
          module: MODULE,
          rev: 1,
          createdAt: command.createdAt,
          updatedAt: command.updatedAt,
          createdBy: command.createdBy,
          updatedBy: command.updatedBy,
          deletedAt: null,
          cardType: 'note',
          title: command.title,
          titleOrigin: command.titleOrigin,
          body: command.body,
          rawInput: { status: 'legacy' },
          starred: false,
          tags: [],
          attachmentIds: [],
          extensions: [],
          projectId: command.projectId,
          fields: {},
        };
        insertCard(database, record);
        remember(database, 'entry', command, record.id, now);
        return applied(record, null);
      },
    },
    withCommandMeta('entry', input),
  );
}

export function importIdea(db: DatabaseSync, input: ImportIdeaInput): CommandResult<Card> {
  return execute(
    db,
    {
      name: 'import.workbench.idea',
      schema: importIdeaSchema,
      apply(database, command, now) {
        if (!hasIdeaContent(command.title, command.body, command.attachmentIds)) {
          return commandFailure('invalid_input', CONTENT_MESSAGE);
        }
        for (const attachmentId of command.attachmentIds) {
          const attachment = getAttachment(database, attachmentId);
          if (!attachment || attachment.deletedAt !== null) {
            return commandFailure('not_found', '附件不存在');
          }
        }
        const extensions: CardExtension[] = command.extensions.map((extension) => ({
          id: createId('ext'),
          body: extension.body,
          createdAt: extension.createdAt,
        }));
        const record: Card = {
          id: createId('card'),
          module: MODULE,
          rev: 1,
          createdAt: command.createdAt,
          updatedAt: command.updatedAt,
          createdBy: command.createdBy,
          updatedBy: command.updatedBy,
          deletedAt: command.deletedAt,
          cardType: 'idea',
          title: command.title,
          titleOrigin: command.titleOrigin,
          body: command.body,
          rawInput: command.rawInput,
          starred: command.starred,
          tags: [],
          attachmentIds: command.attachmentIds,
          extensions,
          projectId: null,
          fields: {
            category: command.category,
            categorySource: command.categorySource,
            captureGroupId: command.captureGroupId,
          },
        };
        insertCard(database, record);
        remember(database, 'idea', command, record.id, now);
        return applied(record, null);
      },
    },
    withCommandMeta('idea', input),
  );
}

function unlinkQuiet(path: string | undefined): void {
  if (!path) return;
  try {
    unlinkSync(path);
  } catch {
    // 文件可能还没复制成功。
  }
}

export function importAttachment(
  db: DatabaseSync,
  dataDir: string,
  sourceFile: string,
  input: ImportAttachmentInput,
): CommandResult<Attachment> {
  const copied: { absolute?: string } = {};
  try {
    const result = execute(
      db,
      {
        name: 'import.workbench.attachment',
        schema: importAttachmentSchema,
        apply(database, command, now) {
          const id = createId('attachment');
          const extension = MIME_EXTENSION[command.mime];
          const relativePath = `media/${id}${extension}`;
          const absolute = join(dataDir, 'media', `${id}${extension}`);
          mkdirSync(join(dataDir, 'media'), { recursive: true });
          try {
            copyFileSync(sourceFile, absolute);
          } catch {
            return commandFailure('invalid_input', '附件文件无法复制');
          }
          copied.absolute = absolute;
          try {
            const record: Attachment = {
              id,
              module: MODULE,
              rev: 1,
              createdAt: command.createdAt,
              updatedAt: command.updatedAt,
              createdBy: command.createdBy,
              updatedBy: command.updatedBy,
              deletedAt: null,
              mime: command.mime,
              byteSize: command.byteSize,
              width: command.width,
              height: command.height,
              sha256: command.sha256.toLowerCase(),
              path: relativePath,
            };
            insertAttachment(database, record);
            remember(database, 'attachment', command, record.id, now);
            return applied(record, null);
          } catch (error) {
            unlinkQuiet(absolute);
            copied.absolute = undefined;
            throw error;
          }
        },
      },
      withCommandMeta('attachment', input),
    );
    if (!result.ok) unlinkQuiet(copied.absolute);
    return result;
  } catch (error) {
    unlinkQuiet(copied.absolute);
    throw error;
  }
}
