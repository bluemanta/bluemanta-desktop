import type { DatabaseSync, SQLInputValue } from 'node:sqlite';

export function getRow<T extends object>(
  db: DatabaseSync,
  sql: string,
  params: readonly SQLInputValue[] = [],
): T | undefined {
  const row = db.prepare(sql).get(...params);
  if (row === undefined) return undefined;
  return row as T;
}

export function getRows<T extends object>(
  db: DatabaseSync,
  sql: string,
  params: readonly SQLInputValue[] = [],
): T[] {
  return db.prepare(sql).all(...params) as T[];
}

export function run(db: DatabaseSync, sql: string, params: readonly SQLInputValue[] = []): number {
  const result = db.prepare(sql).run(...params);
  return Number(result.changes);
}

export function runOne(db: DatabaseSync, sql: string, params: readonly SQLInputValue[] = []): void {
  const changes = run(db, sql, params);
  if (changes !== 1) {
    throw new Error(`预期写入 1 行，实际 ${changes}`);
  }
}
