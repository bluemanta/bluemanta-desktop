import { existsSync } from 'node:fs';
import type { DatabaseSync } from 'node:sqlite';
import './silence-sqlite.js';
import { getRows, runOne } from './sql.js';

export const WORKBENCH_SOURCE_SYSTEM = 'bluemanta-workbench';

export type ImportSourceType = 'project' | 'entry' | 'idea' | 'attachment';

export type ImportSourceRecord = {
  sourceSystem: string;
  sourceType: ImportSourceType;
  sourceId: string;
  sourceUpdatedAt: string;
  targetId: string;
  importedAt: string;
  raw: unknown;
};

export type ImportSourceInsert = {
  sourceSystem: string;
  sourceType: ImportSourceType;
  sourceId: string;
  sourceUpdatedAt: string;
  targetId: string;
  importedAt: string;
  rawJson: string;
};

type ImportSourceRow = {
  source_system: string;
  source_type: ImportSourceType;
  source_id: string;
  source_updated_at: string;
  target_id: string;
  imported_at: string;
  raw_json: string;
};

function toRecord(row: ImportSourceRow): ImportSourceRecord {
  return {
    sourceSystem: row.source_system,
    sourceType: row.source_type,
    sourceId: row.source_id,
    sourceUpdatedAt: row.source_updated_at,
    targetId: row.target_id,
    importedAt: row.imported_at,
    raw: JSON.parse(row.raw_json) as unknown,
  };
}

export function insertImportSource(db: DatabaseSync, row: ImportSourceInsert): void {
  runOne(
    db,
    `INSERT INTO import_sources (
      source_system, source_type, source_id, source_updated_at, target_id, imported_at, raw_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      row.sourceSystem,
      row.sourceType,
      row.sourceId,
      row.sourceUpdatedAt,
      row.targetId,
      row.importedAt,
      row.rawJson,
    ],
  );
}

export function listImportSources(db: DatabaseSync): ImportSourceRecord[] {
  const rows = getRows<ImportSourceRow>(
    db,
    `SELECT source_system, source_type, source_id, source_updated_at, target_id, imported_at, raw_json
     FROM import_sources
     ORDER BY rowid ASC`,
  );
  return rows.map((row) => toRecord(row));
}

function openReadonly(dbPath: string): DatabaseSync {
  const { DatabaseSync } = process.getBuiltinModule('node:sqlite');
  return new DatabaseSync(dbPath, { readOnly: true, timeout: 5000 });
}

/** 只读台账。库不存在或还没有这张表时返回空列表，不建库、不迁移。 */
export function readImportLedger(dbPath: string): ImportSourceRecord[] {
  if (!existsSync(dbPath)) return [];
  const db = openReadonly(dbPath);
  try {
    db.exec('PRAGMA query_only = ON');
    const table = db
      .prepare("SELECT 1 AS ok FROM sqlite_master WHERE type = 'table' AND name = 'import_sources'")
      .get();
    if (table === undefined) return [];
    return listImportSources(db);
  } finally {
    db.close();
  }
}
