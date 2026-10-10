import type { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';
import { areaExists } from '../areas.js';
import { advance } from '../envelope.js';
import { commandFailure, type CommandResult } from '../errors.js';
import { applied, execute } from '../execute.js';
import { guardRev } from '../guards.js';
import { createId } from '../ids.js';
import { getProject, insertProject, saveProject } from '../rows.js';
import type { Project } from '../types.js';
import { locationSchema, requestFields, requirePatch, targetFields } from '../validation.js';

const MODULE = 'core';

const projectCreateSchema = z
  .object({
    ...requestFields,
    title: z.string().min(1),
    area: z.string().min(1),
    status: z.enum(['active', 'paused', 'done', 'archived']).optional(),
    background: z.string().optional(),
    positioning: z.string().optional(),
    pinned: z.boolean().optional(),
    locations: z.array(locationSchema).optional(),
  })
  .strict();

const projectUpdateSchema = z
  .object({
    ...requestFields,
    ...targetFields,
    title: z.string().min(1).optional(),
    area: z.string().min(1).optional(),
    background: z.string().optional(),
    positioning: z.string().optional(),
    pinned: z.boolean().optional(),
    locations: z.array(locationSchema).optional(),
  })
  .strict()
  .superRefine(requirePatch(['title', 'area', 'background', 'positioning', 'pinned', 'locations']));

const projectSetStatusSchema = z
  .object({
    ...requestFields,
    ...targetFields,
    status: z.enum(['active', 'paused', 'done', 'archived']),
  })
  .strict();

export type ProjectCreateInput = z.infer<typeof projectCreateSchema>;
export type ProjectUpdateInput = z.infer<typeof projectUpdateSchema>;
export type ProjectSetStatusInput = z.infer<typeof projectSetStatusSchema>;

export function createProject(db: DatabaseSync, raw: unknown): CommandResult<Project> {
  return execute(
    db,
    {
      name: 'project.create',
      schema: projectCreateSchema,
      apply(database, input, now) {
        if (!areaExists(database, input.area)) {
          return commandFailure('invalid_input', `未知领域 id：${input.area}`);
        }
        const record: Project = {
          id: createId('project'),
          module: MODULE,
          rev: 1,
          createdAt: now,
          updatedAt: now,
          createdBy: input.source,
          updatedBy: input.source,
          deletedAt: null,
          title: input.title,
          area: input.area,
          status: input.status ?? 'active',
          background: input.background ?? '',
          positioning: input.positioning ?? '',
          pinned: input.pinned ?? false,
          locations: input.locations ?? [],
        };
        insertProject(database, record);
        return applied(record, null);
      },
    },
    raw,
  );
}

export function updateProject(db: DatabaseSync, raw: unknown): CommandResult<Project> {
  return execute(
    db,
    {
      name: 'project.update',
      schema: projectUpdateSchema,
      apply(database, input, now) {
        const current = getProject(database, input.id);
        if (current === null) return commandFailure('not_found', '记录不存在');
        const problem = guardRev(current, input.rev, 'active');
        if (problem) return problem;
        if (input.area !== undefined && !areaExists(database, input.area)) {
          return commandFailure('invalid_input', `未知领域 id：${input.area}`);
        }
        const record: Project = advance(
          {
            ...current,
            title: input.title ?? current.title,
            area: input.area ?? current.area,
            background: input.background ?? current.background,
            positioning: input.positioning ?? current.positioning,
            pinned: input.pinned ?? current.pinned,
            locations: input.locations ?? current.locations,
          },
          input.source,
          now,
          current.deletedAt,
        );
        saveProject(database, record);
        return applied(record, current.rev);
      },
    },
    raw,
  );
}

export function setProjectStatus(db: DatabaseSync, raw: unknown): CommandResult<Project> {
  return execute(
    db,
    {
      name: 'project.setStatus',
      schema: projectSetStatusSchema,
      apply(database, input, now) {
        const current = getProject(database, input.id);
        if (current === null) return commandFailure('not_found', '记录不存在');
        const problem = guardRev(current, input.rev, 'active');
        if (problem) return problem;
        const record = advance({ ...current, status: input.status }, input.source, now, current.deletedAt);
        saveProject(database, record);
        return applied(record, current.rev);
      },
    },
    raw,
  );
}
