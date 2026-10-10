import '../src/silence-sqlite.js';
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { openCore, SCHEMA_VERSION, UnsupportedSchemaError, type Core } from '../src/index.js';
import { removeDir, tempDir } from './helpers.js';

function openSqlite(path: string, options?: { readOnly?: boolean }): import('node:sqlite').DatabaseSync {
  const { DatabaseSync } = process.getBuiltinModule('node:sqlite');
  return options === undefined ? new DatabaseSync(path) : new DatabaseSync(path, options);
}

function sha256(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

describe('迁移', () => {
  it('空库建表并记录 schema 版本，且不备份', () => {
    const dir = tempDir();
    let core: Core | undefined;
    try {
      core = openCore({ dataDir: dir });
      expect(core.schemaVersion).toBe(SCHEMA_VERSION);
      expect(core.listAreas().map((area) => area.id)).toEqual(['work', 'content', 'product', 'growth', 'family']);
      expect(existsSync(join(dir, 'backups'))).toBe(false);

      const db = openSqlite(core.dbPath, { readOnly: true });
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
      expect(second.schemaVersion).toBe(SCHEMA_VERSION);
      expect(existsSync(join(dir, 'backups'))).toBe(false);
    } finally {
      second.close();
      removeDir(dir);
    }
  });

  it('数据库版本高于代码支持时拒绝打开，且不修改、不备份', () => {
    const dir = tempDir();
    const dbPath = join(dir, 'store.sqlite');
    const db = openSqlite(dbPath);
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
        expect(error.supportedVersion).toBe(SCHEMA_VERSION);
      }
    }

    expect(existsSync(join(dir, 'backups'))).toBe(false);
    expect(sha256(dbPath)).toBe(before);
    const check = openSqlite(dbPath, { readOnly: true });
    const version = check.prepare('SELECT version FROM schema_meta WHERE id = 1').get() as { version: number };
    check.close();
    expect(version.version).toBe(99);
    removeDir(dir);
  });

  it('需要迁移时先备份，再把版本升到当前代码', () => {
    const dir = tempDir();
    const dbPath = join(dir, 'store.sqlite');
    const db = openSqlite(dbPath);
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
      expect(core.schemaVersion).toBe(SCHEMA_VERSION);
      expect(core.listAreas()).toHaveLength(5);
      const backups = readdirSync(join(dir, 'backups'));
      expect(backups).toHaveLength(1);
      const backupPath = join(dir, 'backups', backups[0] ?? '', 'store.sqlite');
      const backup = openSqlite(backupPath, { readOnly: true });
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

  it('用 T1 版本建的库打开后 titleOrigin 为 user，且迁移前有备份', () => {
    const dir = tempDir();
    const dbPath = join(dir, 'store.sqlite');
    const db = openSqlite(dbPath);
    const createdBy = JSON.stringify({ kind: 'human', name: '旧数据' });
    const data = {
      body: '旧正文',
      rawInput: { status: 'legacy' },
      tags: ['旧'],
      attachmentIds: ['attachment_old'],
      extensions: [],
      fields: { category: 'work', categorySource: 'auto', captureGroupId: 'group_old' },
    };
    db.exec(`
      CREATE TABLE schema_meta (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        version INTEGER NOT NULL
      );
      INSERT INTO schema_meta (id, version) VALUES (1, 1);
      CREATE TABLE cards (
        id TEXT PRIMARY KEY,
        module TEXT NOT NULL,
        rev INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        created_by TEXT NOT NULL,
        updated_by TEXT NOT NULL,
        deleted_at TEXT,
        card_type TEXT NOT NULL,
        title TEXT NOT NULL,
        starred INTEGER NOT NULL,
        project_id TEXT,
        data TEXT NOT NULL
      );
    `);
    db.prepare(
      `INSERT INTO cards (
        id, module, rev, created_at, updated_at, created_by, updated_by, deleted_at,
        card_type, title, starred, project_id, data
      ) VALUES (?, 'core', 3, '2026-01-01T00:00:00.000Z', '2026-01-02T00:00:00.000Z', ?, ?, NULL, 'idea', '旧标题', 0, NULL, ?)`,
    ).run('card_legacy', createdBy, createdBy, JSON.stringify(data));
    db.close();

    const core = openCore({ dataDir: dir });
    try {
      expect(core.schemaVersion).toBe(SCHEMA_VERSION);
      const card = core.getCard('card_legacy');
      expect(card?.title).toBe('旧标题');
      expect(card?.titleOrigin).toBe('user');
      expect(card?.cardType).toBe('idea');
      if (card?.cardType === 'idea') {
        expect(card.fields).toEqual({ category: 'work', categorySource: 'auto', captureGroupId: 'group_old' });
      }
      expect(card?.attachmentIds).toEqual(['attachment_old']);

      const backups = readdirSync(join(dir, 'backups'));
      expect(backups).toHaveLength(1);
      const backup = openSqlite(join(dir, 'backups', backups[0] ?? '', 'store.sqlite'), { readOnly: true });
      const version = backup.prepare('SELECT version FROM schema_meta WHERE id = 1').get() as { version: number };
      const row = backup.prepare('SELECT data FROM cards WHERE id = ?').get('card_legacy') as { data: string };
      backup.close();
      expect(version.version).toBe(1);
      expect(JSON.parse(row.data)).not.toHaveProperty('titleOrigin');
    } finally {
      core.close();
      removeDir(dir);
    }
  });
});
