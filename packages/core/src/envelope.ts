import type { Envelope, Source } from './types.js';

export function advance<T extends Envelope>(record: T, source: Source, now: string, deletedAt: string | null): T {
  return {
    ...record,
    rev: record.rev + 1,
    updatedAt: now,
    updatedBy: source,
    deletedAt,
  };
}

/** 收藏只推进版本，不改 updatedAt / updatedBy。 */
export function bumpRev<T extends Envelope>(record: T): T {
  return {
    ...record,
    rev: record.rev + 1,
  };
}

/** 移入回收站和恢复只改 deletedAt 并推进版本，不改 updatedAt / updatedBy。 */
export function setDeleted<T extends Envelope>(record: T, deletedAt: string | null): T {
  return {
    ...bumpRev(record),
    deletedAt,
  };
}
