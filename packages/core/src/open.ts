import './silence-sqlite.js';
import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { Core } from './core.js';
import { UnsupportedSchemaError } from './errors.js';
import { applyMigrations, readSchemaVersion, SCHEMA_VERSION } from './migrate.js';

export type OpenCoreOptions = {
  /** 数据目录。默认 `~/Library/Application Support/BluemantaDesktop/`。 */
  dataDir?: string;
};

export function defaultDataDir(): string {
  return join(homedir(), 'Library', 'Application Support', 'BluemantaDesktop');
}

function assertNodeVersion(): void {
  const major = Number(process.versions.node.split('.')[0]);
  if (!Number.isFinite(major) || major < 24) {
    throw new Error(`bluemanta core 需要 Node.js >= 24，当前是 ${process.versions.node}`);
  }
}

function prepareConnection(db: DatabaseSync): void {
  db.exec('PRAGMA foreign_keys = ON');
  db.exec('PRAGMA journal_mode = WAL');
}

function backupStamp(date: Date): string {
  const iso = date.toISOString();
  const [datePart, timePart] = iso.split('T');
  if (!datePart || !timePart) return iso.replace(/[-:.]/g, '');
  const time = timePart.replace('Z', '').replace('.', '').replace(/:/g, '');
  return `${datePart.replace(/-/g, '')}T${time}Z`;
}

function backupDatabase(dataDir: string, dbPath: string): void {
  const stamp = backupStamp(new Date());
  let folder = join(dataDir, 'backups', stamp);
  let suffix = 2;
  while (existsSync(folder)) {
    folder = join(dataDir, 'backups', `${stamp}-${suffix}`);
    suffix += 1;
  }
  mkdirSync(folder, { recursive: true });
  copyFileSync(dbPath, join(folder, 'store.sqlite'));
  for (const extra of ['-wal', '-shm']) {
    const source = `${dbPath}${extra}`;
    if (existsSync(source)) copyFileSync(source, join(folder, `store.sqlite${extra}`));
  }
}

function openDatabase(dbPath: string): DatabaseSync {
  return new DatabaseSync(dbPath, { timeout: 5000, enableForeignKeyConstraints: true });
}

export function openCore(options: OpenCoreOptions = {}): Core {
  assertNodeVersion();
  const dataDir = options.dataDir ?? defaultDataDir();
  mkdirSync(dataDir, { recursive: true });
  const dbPath = join(dataDir, 'store.sqlite');
  const existed = existsSync(dbPath);
  const db = openDatabase(dbPath);

  let current: number | null;
  try {
    current = readSchemaVersion(db);
  } catch (error) {
    db.close();
    throw error;
  }

  if (current !== null && current > SCHEMA_VERSION) {
    db.close();
    throw new UnsupportedSchemaError(current, SCHEMA_VERSION);
  }

  const needsMigration = current === null || current < SCHEMA_VERSION;
  if (existed && needsMigration) {
    try {
      db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
    } finally {
      db.close();
    }
    backupDatabase(dataDir, dbPath);
    const migrated = openDatabase(dbPath);
    try {
      prepareConnection(migrated);
      applyMigrations(migrated, current ?? 0);
    } catch (error) {
      migrated.close();
      throw error;
    }
    return new Core(migrated, dataDir, dbPath);
  }

  try {
    prepareConnection(db);
    if (needsMigration) applyMigrations(db, current ?? 0);
  } catch (error) {
    db.close();
    throw error;
  }
  return new Core(db, dataDir, dbPath);
}
