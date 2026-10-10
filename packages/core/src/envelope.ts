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
