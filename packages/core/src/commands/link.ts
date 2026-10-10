import type { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';
import { advance } from '../envelope.js';
import { commandFailure, type CommandResult } from '../errors.js';
import { applied, execute } from '../execute.js';
import { guardRev, missingEndpoint } from '../guards.js';
import { createId } from '../ids.js';
import { getLink, insertLink, saveLink } from '../rows.js';
import type { Link } from '../types.js';
import { requestFields, targetFields } from '../validation.js';

const MODULE = 'core';

const linkCreateSchema = z
  .object({
    ...requestFields,
    from: z.string().min(1),
    to: z.string().min(1),
    rel: z.string().min(1),
  })
  .strict();

const linkDeleteSchema = z
  .object({
    ...requestFields,
    ...targetFields,
  })
  .strict();

export type LinkCreateInput = z.infer<typeof linkCreateSchema>;
export type LinkDeleteInput = z.infer<typeof linkDeleteSchema>;

export function createLink(db: DatabaseSync, raw: unknown): CommandResult<Link> {
  return execute(
    db,
    {
      name: 'link.create',
      schema: linkCreateSchema,
      apply(database, input, now) {
        const missing = missingEndpoint(database, input.from, input.to);
        if (missing) return commandFailure('not_found', `关联的对象不存在：${missing}`);
        const record: Link = {
          id: createId('link'),
          module: MODULE,
          rev: 1,
          createdAt: now,
          updatedAt: now,
          createdBy: input.source,
          updatedBy: input.source,
          deletedAt: null,
          from: input.from,
          to: input.to,
          rel: input.rel,
        };
        insertLink(database, record);
        return applied(record, null);
      },
    },
    raw,
  );
}

export function deleteLink(db: DatabaseSync, raw: unknown): CommandResult<Link> {
  return execute(
    db,
    {
      name: 'link.delete',
      schema: linkDeleteSchema,
      apply(database, input, now) {
        const current = getLink(database, input.id);
        if (current === null) return commandFailure('not_found', '记录不存在');
        const problem = guardRev(current, input.rev, 'active');
        if (problem) return problem;
        const record = advance(current, input.source, now, now);
        saveLink(database, record);
        return applied(record, current.rev);
      },
    },
    raw,
  );
}
