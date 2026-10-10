import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const openTs = fileURLToPath(new URL('../src/open.ts', import.meta.url));
const indexTs = fileURLToPath(new URL('../src/index.ts', import.meta.url));
const silenceTs = fileURLToPath(new URL('../src/silence-sqlite.ts', import.meta.url));
const SQLITE_WARNING = 'SQLite is an experimental feature and might change at any time';

function run(code: string): { status: number | null; stderr: string; stdout: string } {
  const result = spawnSync(
    process.execPath,
    ['--experimental-strip-types', '--input-type=module', '--eval', code],
    {
      encoding: 'utf8',
      env: { ...process.env, NODE_OPTIONS: '' },
    },
  );
  return { status: result.status, stderr: result.stderr, stdout: result.stdout };
}

describe('SQLite ExperimentalWarning', () => {
  it('open 与包入口都在加载 node:sqlite 之前装上过滤器', () => {
    for (const path of [openTs, indexTs]) {
      const source = readFileSync(path, 'utf8');
      const silenceAt = source.indexOf("import './silence-sqlite.js'");
      const sqliteAt = source.indexOf("node:sqlite");
      expect(silenceAt, path).toBeGreaterThanOrEqual(0);
      if (sqliteAt >= 0) expect(silenceAt, path).toBeLessThan(sqliteAt);
    }
  });

  it('只吞掉 SQLite 那一条 ExperimentalWarning', () => {
    const unfiltered = run(`process.emitWarning(${JSON.stringify(SQLITE_WARNING)}, 'ExperimentalWarning');`);
    expect(unfiltered.status).toBe(0);
    expect(unfiltered.stderr).toContain(SQLITE_WARNING);

    const filtered = run(`
      import ${JSON.stringify(silenceTs)};
      process.emitWarning(${JSON.stringify(SQLITE_WARNING)}, 'ExperimentalWarning');
      process.emitWarning('bluemanta-other-experimental', 'ExperimentalWarning');
      process.emitWarning('bluemanta-deprecation', 'DeprecationWarning');
    `);
    expect(filtered.status).toBe(0);
    expect(filtered.stderr).not.toContain(SQLITE_WARNING);
    expect(filtered.stderr).toContain('bluemanta-other-experimental');
    expect(filtered.stderr).toContain('bluemanta-deprecation');
  });

  it('先装上过滤器再加载 node:sqlite 时不打印这条警告', () => {
    const raw = run("import 'node:sqlite';");
    const filtered = run(`
      import ${JSON.stringify(silenceTs)};
      await import('node:sqlite');
    `);
    expect(raw.status).toBe(0);
    expect(filtered.status).toBe(0);
    expect(filtered.stderr).not.toContain(SQLITE_WARNING);
  });
});
