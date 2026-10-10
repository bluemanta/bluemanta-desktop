import type { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';
import { advance } from '../envelope.js';
import { commandFailure, type CommandResult } from '../errors.js';
import { applied, appliedPurge, execute } from '../execute.js';
import { guardInTrash, guardRev, requireLiveProject } from '../guards.js';
import { createId } from '../ids.js';
import { deleteLinksOf, deleteTaskRow, getTask, insertTask, saveTask } from '../rows.js';
import type { PurgedRecord, Task } from '../types.js';
import { dueSchema, originSchema, requestFields, requirePatch, targetFields } from '../validation.js';

const MODULE = 'core';

const taskStatusSchema = z.enum(['todo', 'doing', 'done', 'canceled']);
const taskPrioritySchema = z.enum(['high', 'normal', 'low']);

const taskCreateSchema = z
  .object({
    ...requestFields,
    title: z.string().min(1),
    status: taskStatusSchema.optional(),
    blocked: z.boolean().optional(),
    blockedReason: z.string().nullable().optional(),
    projectId: z.string().min(1).nullable().optional(),
    due: dueSchema.nullable().optional(),
    priority: taskPrioritySchema.nullable().optional(),
    origin: originSchema.nullable().optional(),
    notes: z.string().optional(),
    ext: z.record(z.unknown()).optional(),
  })
  .strict();

const taskUpdateSchema = z
  .object({
    ...requestFields,
    ...targetFields,
    title: z.string().min(1).optional(),
    blocked: z.boolean().optional(),
    blockedReason: z.string().nullable().optional(),
    projectId: z.string().min(1).nullable().optional(),
    due: dueSchema.nullable().optional(),
    priority: taskPrioritySchema.nullable().optional(),
    origin: originSchema.nullable().optional(),
    notes: z.string().optional(),
    ext: z.record(z.unknown()).optional(),
  })
  .strict()
  .superRefine(
    requirePatch([
      'title',
      'blocked',
      'blockedReason',
      'projectId',
      'due',
      'priority',
      'origin',
      'notes',
      'ext',
    ]),
  );

const taskSetStatusSchema = z
  .object({
    ...requestFields,
    ...targetFields,
    status: taskStatusSchema,
  })
  .strict();

const taskRevSchema = z
  .object({
    ...requestFields,
    ...targetFields,
  })
  .strict();

export type TaskCreateInput = z.infer<typeof taskCreateSchema>;
export type TaskUpdateInput = z.infer<typeof taskUpdateSchema>;
export type TaskSetStatusInput = z.infer<typeof taskSetStatusSchema>;
export type TaskRevInput = z.infer<typeof taskRevSchema>;

function normalizeBlocked(
  blocked: boolean,
  blockedReason: string | null,
): { blocked: boolean; blockedReason: string | null } {
  return { blocked, blockedReason: blocked ? blockedReason : null };
}

export function createTask(db: DatabaseSync, raw: unknown): CommandResult<Task> {
  return execute(
    db,
    {
      name: 'task.create',
      schema: taskCreateSchema,
      apply(database, input, now) {
        if (typeof input.projectId === 'string') {
          const missing = requireLiveProject(database, input.projectId);
          if (missing) return missing;
        }
        const blockedState = normalizeBlocked(input.blocked ?? false, input.blockedReason ?? null);
        const record: Task = {
          id: createId('task'),
          module: MODULE,
          rev: 1,
          createdAt: now,
          updatedAt: now,
          createdBy: input.source,
          updatedBy: input.source,
          deletedAt: null,
          title: input.title,
          status: input.status ?? 'todo',
          blocked: blockedState.blocked,
          blockedReason: blockedState.blockedReason,
          projectId: input.projectId ?? null,
          due: input.due ?? null,
          priority: input.priority ?? null,
          origin: input.origin ?? null,
          notes: input.notes ?? '',
          ext: input.ext ?? {},
        };
        insertTask(database, record);
        return applied(record, null);
      },
    },
    raw,
  );
}

export function updateTask(db: DatabaseSync, raw: unknown): CommandResult<Task> {
  return execute(
    db,
    {
      name: 'task.update',
      schema: taskUpdateSchema,
      apply(database, input, now) {
        const current = getTask(database, input.id);
        if (current === null) return commandFailure('not_found', '记录不存在');
        const problem = guardRev(current, input.rev, 'active');
        if (problem) return problem;
        const projectId = input.projectId === undefined ? current.projectId : input.projectId;
        if (typeof projectId === 'string') {
          const missing = requireLiveProject(database, projectId);
          if (missing) return missing;
        }
        const blockedState = normalizeBlocked(
          input.blocked ?? current.blocked,
          input.blockedReason === undefined ? current.blockedReason : input.blockedReason,
        );
        const record = advance(
          {
            ...current,
            title: input.title ?? current.title,
            blocked: blockedState.blocked,
            blockedReason: blockedState.blockedReason,
            projectId,
            due: input.due === undefined ? current.due : input.due,
            priority: input.priority === undefined ? current.priority : input.priority,
            origin: input.origin === undefined ? current.origin : input.origin,
            notes: input.notes ?? current.notes,
            ext: input.ext ?? current.ext,
          },
          input.source,
          now,
          current.deletedAt,
        );
        saveTask(database, record);
        return applied(record, current.rev);
      },
    },
    raw,
  );
}

export function setTaskStatus(db: DatabaseSync, raw: unknown): CommandResult<Task> {
  return execute(
    db,
    {
      name: 'task.setStatus',
      schema: taskSetStatusSchema,
      apply(database, input, now) {
        const current = getTask(database, input.id);
        if (current === null) return commandFailure('not_found', '记录不存在');
        const problem = guardRev(current, input.rev, 'active');
        if (problem) return problem;
        const record = advance({ ...current, status: input.status }, input.source, now, current.deletedAt);
        saveTask(database, record);
        return applied(record, current.rev);
      },
    },
    raw,
  );
}

export function deleteTask(db: DatabaseSync, raw: unknown): CommandResult<Task> {
  return execute(
    db,
    {
      name: 'task.delete',
      schema: taskRevSchema,
      apply(database, input, now) {
        const current = getTask(database, input.id);
        if (current === null) return commandFailure('not_found', '记录不存在');
        const problem = guardRev(current, input.rev, 'active');
        if (problem) return problem;
        const record = advance(current, input.source, now, now);
        saveTask(database, record);
        return applied(record, current.rev);
      },
    },
    raw,
  );
}

export function restoreTask(db: DatabaseSync, raw: unknown): CommandResult<Task> {
  return execute(
    db,
    {
      name: 'task.restore',
      schema: taskRevSchema,
      apply(database, input, now) {
        const current = getTask(database, input.id);
        if (current === null) return commandFailure('not_found', '记录不存在');
        const problem = guardRev(current, input.rev, 'deleted');
        if (problem) return problem;
        const record = advance(current, input.source, now, null);
        saveTask(database, record);
        return applied(record, current.rev);
      },
    },
    raw,
  );
}

export function purgeTask(db: DatabaseSync, raw: unknown): CommandResult<PurgedRecord> {
  return execute(
    db,
    {
      name: 'task.purge',
      schema: taskRevSchema,
      humanOnly: true,
      apply(database, input) {
        const current = getTask(database, input.id);
        if (current === null) return commandFailure('not_found', '记录不存在');
        const problem = guardInTrash(current, input.rev);
        if (problem) return problem;
        deleteLinksOf(database, current.id);
        deleteTaskRow(database, current.id);
        return appliedPurge(current.id, current.rev);
      },
    },
    raw,
  );
}
