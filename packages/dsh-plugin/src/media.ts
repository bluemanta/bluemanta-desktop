import { mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve } from 'node:path';

/** 只允许数据目录 `media/` 之内的相对路径。 */
export function resolveStoredFile(dataDir: string, storedPath: string): string | null {
  if (storedPath.includes('\0')) return null;
  const root = resolve(dataDir, 'media');
  const absolute = resolve(dataDir, storedPath);
  const fromRoot = relative(root, absolute);
  if (fromRoot === '' || fromRoot.startsWith('..') || isAbsolute(fromRoot)) return null;
  return absolute;
}

export function writeStoredFile(dataDir: string, storedPath: string, bytes: Buffer): void {
  const absolute = resolveStoredFile(dataDir, storedPath);
  if (!absolute) throw new Error('附件路径无效');
  mkdirSync(dirname(absolute), { recursive: true });
  writeFileSync(absolute, bytes);
}

export function readStoredFile(dataDir: string, storedPath: string): Buffer | null {
  const absolute = resolveStoredFile(dataDir, storedPath);
  if (!absolute) return null;
  try {
    return readFileSync(absolute);
  } catch (error) {
    if (isNotFound(error)) return null;
    throw error;
  }
}

/** 文件本来就不在时也算清理成功。路径逃出 media/ 时返回 false。 */
export function removeStoredFile(dataDir: string, storedPath: string): boolean {
  const absolute = resolveStoredFile(dataDir, storedPath);
  if (!absolute) return false;
  try {
    unlinkSync(absolute);
    return true;
  } catch (error) {
    return isNotFound(error);
  }
}

function isNotFound(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT';
}
