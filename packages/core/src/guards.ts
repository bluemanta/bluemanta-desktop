import type { DatabaseSync } from 'node:sqlite';
import { commandFailure, type CommandFailure } from './errors.js';
import { getRow } from './sql.js';
import type { Envelope } from './types.js';

export type RevMode = 'active' | 'deleted' | 'any';

export function guardRev(record: Envelope | null, rev: number, mode: RevMode): CommandFailure | null {
  if (!record) return commandFailure('not_found', '记录不存在');
  if (record.rev !== rev) return commandFailure('version_conflict', '版本不一致，请重新读取后再写入');
  if (mode === 'active' && record.deletedAt !== null) return commandFailure('invalid_input', '记录已在回收站');
  if (mode === 'deleted' && record.deletedAt === null) return commandFailure('invalid_input', '记录不在回收站');
  return null;
}

/** 回收站中的卡片不能修改、追记或收藏。 */
export function guardActiveCard(record: Envelope, rev: number): CommandFailure | null {
  if (record.rev !== rev) return commandFailure('version_conflict', '版本不一致，请重新读取后再写入');
  if (record.deletedAt !== null) return commandFailure('invalid_input', '卡片在回收站中，请先恢复');
  return null;
}

/** 彻底删除只能对回收站中的记录执行。 */
export function guardInTrash(record: Envelope, rev: number): CommandFailure | null {
  if (record.rev !== rev) return commandFailure('version_conflict', '版本不一致，请重新读取后再写入');
  if (record.deletedAt === null) return commandFailure('invalid_input', '不在回收站，不能彻底删除');
  return null;
}

export function requireLiveProject(db: DatabaseSync, projectId: string): CommandFailure | null {
  const row = getRow<{ deleted_at: string | null }>(
    db,
    'SELECT deleted_at FROM projects WHERE id = ?',
    [projectId],
  );
  if (!row || row.deleted_at !== null) return commandFailure('not_found', '项目不存在');
  return null;
}

const OBJECT_TABLES = ['projects', 'tasks', 'cards'] as const;

export function liveObjectExists(db: DatabaseSync, id: string): boolean {
  for (const table of OBJECT_TABLES) {
    const row = getRow<{ deleted_at: string | null }>(
      db,
      `SELECT deleted_at FROM ${table} WHERE id = ?`,
      [id],
    );
    if (row) return row.deleted_at === null;
  }
  return false;
}

export function missingEndpoint(db: DatabaseSync, from: string, to: string): string | null {
  if (!liveObjectExists(db, from)) return from;
  if (!liveObjectExists(db, to)) return to;
  return null;
}
