import { monotonicFactory } from 'ulid';

const ulid = monotonicFactory();

export type IdPrefix = 'project' | 'task' | 'card' | 'link' | 'attachment' | 'ext';

export function createId(prefix: IdPrefix): string {
  return `${prefix}_${ulid()}`;
}
