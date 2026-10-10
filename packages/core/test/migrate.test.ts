import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { openCore, UnsupportedSchemaError, type Core } from '../src/index.js';
import { removeDir, tempDir } from './helpers.js';

function sha256(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

describe('迁移', () => {
  it('空库建表并记录 schema 版本，且不备份', () => {
    const dir = tempDir();
    let core: Core | undefined;
    try {
      core = openCore({ dataDir: dir });
      expect(core.schemaVersion).toBe(1);
      expect(core.listAreas().map((area) => area.id)).toEqual(['work', 'content', 'product', 'growth', 'family']);
      expect(existsSync(join(dir, 'backups'))).toBe(false);

      const db = new DatabaseSync(core.dbPath, { readOnly: true });
      const names = db
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
        .all() as Array<{ name: string }>;
      db.close();
      expect(names.map((row) => row.name)).toEqual(
        expect.arrayContaining(['areas', 'attachments', 'cards', 'history', 'links', 'projects', 'schema_meta', 'tasks']),
      );
    } finally {
      core?.close();
      removeDir(dir);
    }
  });

  it('再次打开当前版本时不备份', () => {
    const dir = tempDir();
    const first = openCore({ dataDir: dir });
    first.close();
    const second = openCore({ dataDir: dir });
    try {
      expect(second.schemaVersion).toBe(1);
      expect(existsSync(join(dir, 'backups'))).toBe(false);
    } finally {
      second.close();
      removeDir(dir);
    }
  });

  it('数据库版本高于代码支持时拒绝打开，且不修改、不备份', () => {
    const dir = tempDir();
    const dbPath = join(dir, 'store.sqlite');
    const db = new DatabaseSync(dbPath);
    db.exec(`
      CREATE TABLE schema_meta (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        version INTEGER NOT NULL
      );
      INSERT INTO schema_meta (id, version) VALUES (1, 99);
    `);
    db.close();
    const before = sha256(dbPath);

    expect(() => openCore({ dataDir: dir })).toThrow(UnsupportedSchemaError);
    try {
      openCore({ dataDir: dir });
    } catch (error) {
      expect(error).toBeInstanceOf(UnsupportedSchemaError);
      if (error instanceof UnsupportedSchemaError) {
        expect(error.code).toBe('unsupported_schema_version');
        expect(error.dbVersion).toBe(99);
        expect(error.supportedVersion).toBe(1);
      }
    }

    expect(existsSync(join(dir, 'backups'))).toBe(false);
    expect(sha256(dbPath)).toBe(before);
    const check = new DatabaseSync(dbPath, { readOnly: true });
    const version = check.prepare('SELECT version FROM schema_meta WHERE id = 1').get() as { version: number };
    check.close();
    expect(version.version).toBe(99);
    removeDir(dir);
  });

  it('需要迁移时先备份，再把版本升到当前代码', () => {
    const dir = tempDir();
    const dbPath = join(dir, 'store.sqlite');
    const db = new DatabaseSync(dbPath);
    db.exec(`
      CREATE TABLE schema_meta (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        version INTEGER NOT NULL
      );
      INSERT INTO schema_meta (id, version) VALUES (1, 0);
      CREATE TABLE legacy_marker (id INTEGER PRIMARY KEY);
      INSERT INTO legacy_marker (id) VALUES (42);
    `);
    db.close();

    const core = openCore({ dataDir: dir });
    try {
      expect(core.schemaVersion).toBe(1);
      expect(core.listAreas()).toHaveLength(5);
      const backups = readdirSync(join(dir, 'backups'));
      expect(backups).toHaveLength(1);
      const backupPath = join(dir, 'backups', backups[0] ?? '', 'store.sqlite');
      const backup = new DatabaseSync(backupPath, { readOnly: true });
      const version = backup.prepare('SELECT version FROM schema_meta WHERE id = 1').get() as { version: number };
      const marker = backup.prepare('SELECT id FROM legacy_marker').get() as { id: number };
      backup.close();
      expect(version.version).toBe(0);
      expect(marker.id).toBe(42);
    } finally {
      core.close();
      removeDir(dir);
    }
  });
});
