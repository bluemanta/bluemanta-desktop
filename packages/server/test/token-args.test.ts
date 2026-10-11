import { chmodSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { defaultDataDir } from '@bluemanta/core';
import { afterEach, describe, expect, it } from 'vitest';
import { DEFAULT_PORT, parseArgs } from '../src/args.js';
import { loadToken, tokenFilePath } from '../src/token.js';
import { removeTempDirs, tempDir } from './helpers.js';

afterEach(removeTempDirs);

describe('口令文件', () => {
  it('首次生成 64 位十六进制口令，权限 600；之后读同一个', () => {
    const dir = join(tempDir(), 'nested');
    const warnings: string[] = [];
    const token = loadToken(dir, (line) => warnings.push(line));
    expect(token).toMatch(/^[0-9a-f]{64}$/);
    const file = tokenFilePath(dir);
    expect(statSync(file).mode & 0o777).toBe(0o600);
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual({ token });
    expect(loadToken(dir, (line) => warnings.push(line))).toBe(token);
    expect(warnings).toEqual([]);
  });

  it('权限过宽时改回 600 并提示一次，提示里没有口令', () => {
    const dir = tempDir();
    const token = loadToken(dir, () => {});
    chmodSync(tokenFilePath(dir), 0o644);
    const warnings: string[] = [];
    expect(loadToken(dir, (line) => warnings.push(line))).toBe(token);
    expect(statSync(tokenFilePath(dir)).mode & 0o777).toBe(0o600);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('600');
    expect(warnings[0]).not.toContain(token);
    loadToken(dir, (line) => warnings.push(line));
    expect(warnings).toHaveLength(1);
  });

  it('内容无效时报错，不覆盖', () => {
    const dir = tempDir();
    writeFileSync(tokenFilePath(dir), '{"token":"short"}', { mode: 0o600 });
    expect(() => loadToken(dir, () => {})).toThrow(/local-server\.json/);
    expect(readFileSync(tokenFilePath(dir), 'utf8')).toBe('{"token":"short"}');
  });
});

describe('命令行参数', () => {
  it('数据目录：--data-dir → BLUEMANTA_DATA_DIR → core 默认目录', () => {
    expect(parseArgs(['start', '--data-dir', '/tmp/a'], { BLUEMANTA_DATA_DIR: '/tmp/b' })).toEqual({
      ok: true,
      value: { command: 'start', dataDir: '/tmp/a', port: DEFAULT_PORT },
    });
    expect(parseArgs(['url'], { BLUEMANTA_DATA_DIR: '/tmp/b' })).toMatchObject({ ok: true, value: { dataDir: '/tmp/b' } });
    expect(parseArgs(['open'], { BLUEMANTA_DATA_DIR: '  ' })).toMatchObject({ ok: true, value: { dataDir: defaultDataDir() } });
  });

  it('端口：--port → BLUEMANTA_SERVER_PORT → 4310', () => {
    expect(parseArgs(['start'], {})).toMatchObject({ ok: true, value: { port: 4310 } });
    expect(parseArgs(['start'], { BLUEMANTA_SERVER_PORT: '5001' })).toMatchObject({ ok: true, value: { port: 5001 } });
    expect(parseArgs(['start', '--port=5002'], { BLUEMANTA_SERVER_PORT: '5001' })).toMatchObject({
      ok: true,
      value: { port: 5002 },
    });
    expect(parseArgs(['--port', '5003', 'url'], {})).toMatchObject({ ok: true, value: { command: 'url', port: 5003 } });
  });

  it('参数不对时报错', () => {
    for (const argv of [
      [],
      ['stop'],
      ['start', 'url'],
      ['start', '--port'],
      ['start', '--port', 'abc'],
      ['start', '--port', '0'],
      ['start', '--port', '70000'],
      ['start', '--port', '1', '--port', '2'],
      ['start', '--data-dir'],
      ['start', '--verbose'],
    ]) {
      expect(parseArgs(argv, {}).ok, argv.join(' ')).toBe(false);
    }
    expect(parseArgs(['start'], { BLUEMANTA_SERVER_PORT: 'x' }).ok).toBe(false);
  });
});
