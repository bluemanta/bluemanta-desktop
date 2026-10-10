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
