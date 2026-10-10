import type { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';
import type { CommandResult } from '../errors.js';
import { applied, execute } from '../execute.js';
import { createId } from '../ids.js';
import { insertAttachment } from '../rows.js';
import type { Attachment } from '../types.js';
import { requestFields } from '../validation.js';

const MODULE = 'core';

/** 灵感台图片限制，见 idea-rules.md 第 8 节。 */
export const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
export const MAX_IMAGE_EDGE = 16384;

export const IMAGE_MIME = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'] as const;
export type ImageMime = (typeof IMAGE_MIME)[number];

export const IMAGE_EXTENSION: Record<ImageMime, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/gif': '.gif',
  'image/webp': '.webp',
};

const attachmentCreateSchema = z
  .object({
    ...requestFields,
    mime: z.enum(IMAGE_MIME),
    byteSize: z.number().int().positive().max(MAX_IMAGE_BYTES),
    width: z.number().int().positive().max(MAX_IMAGE_EDGE),
    height: z.number().int().positive().max(MAX_IMAGE_EDGE),
    sha256: z.string().regex(/^[0-9a-fA-F]{64}$/, 'sha256 需要是 64 位十六进制'),
  })
  .strict();

export type AttachmentCreateInput = z.infer<typeof attachmentCreateSchema>;

export function createAttachment(db: DatabaseSync, raw: unknown): CommandResult<Attachment> {
  return execute(
    db,
    {
      name: 'attachment.create',
      schema: attachmentCreateSchema,
      apply(database, input, now) {
        const id = createId('attachment');
        const record: Attachment = {
          id,
          module: MODULE,
          rev: 1,
          createdAt: now,
          updatedAt: now,
          createdBy: input.source,
          updatedBy: input.source,
          deletedAt: null,
          mime: input.mime,
          byteSize: input.byteSize,
          width: input.width,
          height: input.height,
          sha256: input.sha256.toLowerCase(),
          path: `media/${id}${IMAGE_EXTENSION[input.mime]}`,
        };
        insertAttachment(database, record);
        return applied(record, null);
      },
    },
    raw,
  );
}
