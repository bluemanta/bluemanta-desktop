import { spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const openTs = fileURLToPath(new URL('../src/open.ts', import.meta.url));
const indexTs = fileURLToPath(new URL('../src/index.ts', import.meta.url));
const silenceTs = fileURLToPath(new URL('../src/silence-sqlite.ts', import.meta.url));
const SQLITE_WARNING = 'SQLite is an experimental feature and might change at any time';

function run(code: string, cwd?: string): { status: number | null; stderr: string; stdout: string } {
  const result = spawnSync(
    process.execPath,
    ['--experimental-strip-types', '--input-type=module', '--eval', code],
    {
      cwd,
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

  it('产品代码在打开数据库时按需加载 node:sqlite，而不是值导入', () => {
    const srcDir = fileURLToPath(new URL('../src', import.meta.url));
    const files = readdirSync(srcDir, { recursive: true }).map(String).filter((file) => file.endsWith('.ts'));
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      const source = readFileSync(join(srcDir, file), 'utf8');
      expect(source, file).not.toMatch(/^import\s+\{(?!\s*type\b)[^;]*['"]node:sqlite['"]/m);
      expect(source, file).not.toMatch(/^import\s+\*\s+as\s+\w+\s+from\s+['"]node:sqlite['"]/m);
    }
    expect(readFileSync(openTs, 'utf8')).toContain("process.getBuiltinModule('node:sqlite')");
  });

  it('import(@bluemanta/core) 并打开数据库时不打印 SQLite ExperimentalWarning', () => {
    const tsc = fileURLToPath(new URL('../../../node_modules/typescript/bin/tsc', import.meta.url));
    const project = fileURLToPath(new URL('../tsconfig.build.json', import.meta.url));
    const built = spawnSync(process.execPath, [tsc, '-p', project], { encoding: 'utf8' });
    expect(built.status, built.stderr).toBe(0);

    const dir = mkdtempSync(join(tmpdir(), 'bluemanta-sqlite-'));
    const root = fileURLToPath(new URL('../../..', import.meta.url));
    const loaded = run(
      `
      import { openCore } from '@bluemanta/core';
      process.emitWarning('bluemanta-other-experimental', 'ExperimentalWarning');
      const core = openCore({ dataDir: ${JSON.stringify(dir)} });
      console.log('schema ' + core.schemaVersion);
      core.close();
    `,
      root,
    );
    expect(loaded.status, loaded.stderr).toBe(0);
    expect(loaded.stderr).not.toContain(SQLITE_WARNING);
    expect(loaded.stderr).toContain('bluemanta-other-experimental');
    expect(loaded.stdout).toContain('schema 2');
  });
});
