import { realpathSync } from 'node:fs';
import { isAbsolute, join, posix, relative, sep } from 'node:path';
import { KnowledgeError } from './types.js';

/**
 * Normalizes a client-supplied library-relative path. Rejects absolute paths, `..`, NUL and backslashes,
 * so callers can only name files inside the library (ADR 0009 decision 7).
 */
export function normalizeRelPath(input: string): string {
  if (typeof input !== 'string' || input.includes('\0') || input.includes('\\')) {
    throw new KnowledgeError('invalid_path', '路径不合法');
  }
  const trimmed = input.trim().replace(/^\/+|\/+$/g, '');
  if (trimmed === '') return '';
  // 前导斜杠来自 URL 通配段，去掉后按库内相对路径处理；盘符一律拒绝。
  if (/^[A-Za-z]:/.test(trimmed)) throw new KnowledgeError('invalid_path', '只接受库内相对路径');
  const normalized = posix.normalize(trimmed);
  if (normalized === '..' || normalized.startsWith('../') || normalized.split('/').includes('..')) {
    throw new KnowledgeError('invalid_path', '路径不能越出库目录');
  }
  return normalized === '.' ? '' : normalized;
}

function within(root: string, target: string): boolean {
  const rel = relative(root, target);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

/**
 * Resolves a library-relative path to an absolute path and verifies that, after following symlinks,
 * it still lies inside the library root. Missing targets resolve without the symlink check.
 */
export function resolveInLibrary(root: string, relPath: string): string {
  const rel = normalizeRelPath(relPath);
  const target = rel === '' ? root : join(root, ...rel.split('/'));
  let realRoot: string;
  try {
    realRoot = realpathSync(root);
  } catch {
    throw new KnowledgeError('library_missing', '库目录不存在');
  }
  let realTarget: string;
  try {
    realTarget = realpathSync(target);
  } catch {
    return target;
  }
  if (!within(realRoot, realTarget)) throw new KnowledgeError('invalid_path', '路径指向库目录之外');
  return target;
}

/** Converts an absolute path below `root` to a `/`-separated library-relative path. */
export function toRelPath(root: string, absolute: string): string {
  return relative(root, absolute).split(sep).join('/');
}
