import type { DatabaseSync } from 'node:sqlite';
import { DEFAULT_AREAS } from './areas.js';

export const SCHEMA_VERSION = 1;

const SCHEMA_V1 = `
CREATE TABLE IF NOT EXISTS schema_meta (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  version INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS areas (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  role TEXT NOT NULL,
  description TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  module TEXT NOT NULL,
  rev INTEGER NOT NULL CHECK (rev >= 1),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  created_by TEXT NOT NULL CHECK (json_valid(created_by)),
  updated_by TEXT NOT NULL CHECK (json_valid(updated_by)),
  deleted_at TEXT,
  title TEXT NOT NULL,
  area TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('active', 'paused', 'done', 'archived')),
  pinned INTEGER NOT NULL CHECK (pinned IN (0, 1)),
  data TEXT NOT NULL CHECK (json_valid(data))
);

CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  module TEXT NOT NULL,
  rev INTEGER NOT NULL CHECK (rev >= 1),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  created_by TEXT NOT NULL CHECK (json_valid(created_by)),
  updated_by TEXT NOT NULL CHECK (json_valid(updated_by)),
  deleted_at TEXT,
  title TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('todo', 'doing', 'done', 'canceled')),
  project_id TEXT,
  priority TEXT CHECK (priority IS NULL OR priority IN ('high', 'normal', 'low')),
  due TEXT,
  blocked INTEGER NOT NULL CHECK (blocked IN (0, 1)),
  data TEXT NOT NULL CHECK (json_valid(data))
);

CREATE TABLE IF NOT EXISTS cards (
  id TEXT PRIMARY KEY,
  module TEXT NOT NULL,
  rev INTEGER NOT NULL CHECK (rev >= 1),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  created_by TEXT NOT NULL CHECK (json_valid(created_by)),
  updated_by TEXT NOT NULL CHECK (json_valid(updated_by)),
  deleted_at TEXT,
  card_type TEXT NOT NULL CHECK (card_type IN ('idea', 'scene', 'note')),
  title TEXT NOT NULL,
  starred INTEGER NOT NULL CHECK (starred IN (0, 1)),
  project_id TEXT,
  data TEXT NOT NULL CHECK (json_valid(data))
);

CREATE TABLE IF NOT EXISTS attachments (
  id TEXT PRIMARY KEY,
  module TEXT NOT NULL,
  rev INTEGER NOT NULL CHECK (rev >= 1),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  created_by TEXT NOT NULL CHECK (json_valid(created_by)),
  updated_by TEXT NOT NULL CHECK (json_valid(updated_by)),
  deleted_at TEXT,
  mime TEXT NOT NULL,
  byte_size INTEGER NOT NULL CHECK (byte_size >= 0),
  width INTEGER,
  height INTEGER,
  sha256 TEXT NOT NULL,
  path TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS links (
  id TEXT PRIMARY KEY,
  module TEXT NOT NULL,
  rev INTEGER NOT NULL CHECK (rev >= 1),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  created_by TEXT NOT NULL CHECK (json_valid(created_by)),
  updated_by TEXT NOT NULL CHECK (json_valid(updated_by)),
  deleted_at TEXT,
  from_id TEXT NOT NULL,
  to_id TEXT NOT NULL,
  rel TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  request_id TEXT NOT NULL UNIQUE,
  command TEXT NOT NULL,
  source TEXT NOT NULL CHECK (json_valid(source)),
  object_id TEXT NOT NULL,
  rev_before INTEGER,
  rev_after INTEGER,
  at TEXT NOT NULL,
  input_hash TEXT NOT NULL,
  result_json TEXT NOT NULL CHECK (json_valid(result_json))
);

CREATE INDEX IF NOT EXISTS idx_projects_area ON projects(area);
CREATE INDEX IF NOT EXISTS idx_projects_deleted_at ON projects(deleted_at);
CREATE INDEX IF NOT EXISTS idx_tasks_project_id ON tasks(project_id);
CREATE INDEX IF NOT EXISTS idx_tasks_deleted_at ON tasks(deleted_at);
CREATE INDEX IF NOT EXISTS idx_cards_card_type ON cards(card_type);
CREATE INDEX IF NOT EXISTS idx_cards_project_id ON cards(project_id);
CREATE INDEX IF NOT EXISTS idx_cards_deleted_at ON cards(deleted_at);
CREATE INDEX IF NOT EXISTS idx_links_from_id ON links(from_id);
CREATE INDEX IF NOT EXISTS idx_links_to_id ON links(to_id);
CREATE INDEX IF NOT EXISTS idx_links_deleted_at ON links(deleted_at);
CREATE INDEX IF NOT EXISTS idx_history_object_id ON history(object_id);
`;

type Migration = {
  version: number;
  up: (db: DatabaseSync) => void;
};

function migrateTo1(db: DatabaseSync): void {
  db.exec(SCHEMA_V1);
  const insert = db.prepare('INSERT INTO areas (id, name, role, description) VALUES (?, ?, ?, ?)');
  for (const area of DEFAULT_AREAS) {
    insert.run(area.id, area.name, area.role, area.description);
  }
}

const MIGRATIONS: readonly Migration[] = [{ version: 1, up: migrateTo1 }];

export function readSchemaVersion(db: DatabaseSync): number | null {
  const table = db
    .prepare("SELECT 1 AS ok FROM sqlite_master WHERE type = 'table' AND name = 'schema_meta'")
    .get();
  if (table === undefined) return null;
  const row = db.prepare('SELECT version FROM schema_meta WHERE id = 1').get() as
    | { version: number | bigint }
    | undefined;
  if (!row) return null;
  const version = Number(row.version);
  if (!Number.isInteger(version)) return null;
  return version;
}

export function applyMigrations(db: DatabaseSync, fromVersion: number): void {
  const pending = MIGRATIONS.filter((migration) => migration.version > fromVersion);
  if (pending.length === 0) return;

  db.exec('BEGIN IMMEDIATE');
  try {
    for (const migration of pending) {
      migration.up(db);
      db.prepare(
        `INSERT INTO schema_meta (id, version) VALUES (1, ?)
         ON CONFLICT(id) DO UPDATE SET version = excluded.version`,
      ).run(migration.version);
    }
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}
