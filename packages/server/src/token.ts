import { randomBytes } from 'node:crypto';
import { chmodSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export const TOKEN_FILE = 'local-server.json';

const TOKEN_PATTERN = /^[0-9a-f]{64}$/;

export function tokenFilePath(dataDir: string): string {
  return join(dataDir, TOKEN_FILE);
}

function isCode(error: unknown, code: string): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === code;
}

function createTokenFile(file: string): boolean {
  const token = randomBytes(32).toString('hex');
  try {
    writeFileSync(file, `${JSON.stringify({ token }, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
  } catch (error) {
    if (isCode(error, 'EEXIST')) return false;
    throw error;
  }
  chmodSync(file, 0o600);
  return true;
}

/**
 * 读数据目录下的 `local-server.json`，没有就生成（32 字节随机数，权限 600）。
 * 已有文件对同组或其他用户开放时改回 600，并经 `warn` 提示一次。
 */
export function loadToken(dataDir: string, warn: (message: string) => void): string {
  mkdirSync(dataDir, { recursive: true });
  const file = tokenFilePath(dataDir);
  let raw: string;
  try {
    raw = readFileSync(file, 'utf8');
  } catch (error) {
    if (!isCode(error, 'ENOENT')) throw error;
    createTokenFile(file);
    raw = readFileSync(file, 'utf8');
  }

  const mode = statSync(file).mode & 0o777;
  if ((mode & 0o077) !== 0) {
    chmodSync(file, 0o600);
    warn(`${TOKEN_FILE} 的权限是 ${mode.toString(8)}，已改回 600`);
  }

  let token: unknown;
  try {
    token = (JSON.parse(raw) as { token?: unknown }).token;
  } catch {
    token = undefined;
  }
  if (typeof token !== 'string' || !TOKEN_PATTERN.test(token)) {
    throw new Error(`${TOKEN_FILE} 内容无效：删除这个文件后重新启动，会生成新口令`);
  }
  return token;
}
