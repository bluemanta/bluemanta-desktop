import { lstatSync, readFileSync, readdirSync, realpathSync, statSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { KnowledgeError } from '../types.js';
import type { DocumentFile, FileContent, Warning } from './types.js';

export const MAX_PERSONALOS_BYTES = 1024 * 1024;
export function normalizePersonalOsPath(input: string): string {
  if (typeof input !== 'string' || input.includes('\0') || input.includes('\\') || isAbsolute(input) || /^[A-Za-z]:/.test(input)) throw new KnowledgeError('invalid_path', '只接受 PersonalOS 库内相对路径');
  const parts = input.split('/');
  if (parts.some((part) => part.startsWith('.'))) throw new KnowledgeError('invalid_path', '路径不能越界或包含隐藏文件');
  return parts.filter(Boolean).join('/');
}
function within(root: string, target: string): boolean {
  const rel = relative(root, target); return rel === '' || (!rel.startsWith(`..${sep}`) && rel !== '..' && !isAbsolute(rel));
}
/** Check every existing ancestor too: nonexistent targets must not bypass a parent symlink. */
function physical(root: string, target: string, placeholder = false): string {
  let realRoot: string;
  try { realRoot = realpathSync(root); } catch { throw new KnowledgeError('library_missing', '没有找到 PersonalOS'); }
  if (!within(resolve(root), resolve(target))) throw new KnowledgeError('invalid_path', '路径不能越出 PersonalOS');
  let ancestor = target;
  while (true) {
    let actual: string;
    try { actual = realpathSync(ancestor); }
    catch (error) {
      if (ancestor === root || dirname(ancestor) === ancestor) throw new KnowledgeError('read_error', '无法检查文件路径');
      // Only missing nodes may fall back to their parent; permissions and link loops are errors.
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw new KnowledgeError('invalid_path', '文件路径无法安全读取');
      try { if (lstatSync(ancestor).isSymbolicLink()) throw new KnowledgeError('invalid_path', '文件链接无法安全读取'); }
      catch (linkError) { if (linkError instanceof KnowledgeError) throw linkError; }
      ancestor = dirname(ancestor); continue;
    }
    if (!within(realRoot, actual)) throw new KnowledgeError('invalid_path', '路径指向 PersonalOS 之外');
    const segments = relative(realRoot, actual).split(sep).filter(Boolean);
    if (segments.some((part, index) => part.startsWith('.') && !(placeholder && ancestor === target && index === segments.length - 1 && /^\..+\.icloud$/.test(part)))) throw new KnowledgeError('invalid_path', '文件链接指向隐藏内容');
    return target;
  }
}
export function resolvePersonalOsPath(root: string, path: string): string {
  const rel = normalizePersonalOsPath(path); return physical(resolve(root), join(resolve(root), ...rel.split('/')));
}
export function personalOsExists(root: string): boolean { try { return statSync(root).isDirectory(); } catch { return false; } }
export function isPersonalOsDirectory(root: string, path: string): boolean {
  try { return statSync(resolvePersonalOsPath(root, path)).isDirectory(); } catch { return false; }
}
function metadata(path: string, absolute: string, availability: DocumentFile['availability'] = 'available'): DocumentFile {
  const stat = statSync(absolute);
  return { path, name: basename(path), kind: stat.isDirectory() ? 'directory' : /\.(md|markdown)$/i.test(path) ? 'markdown' : 'file', size: availability === 'icloud' ? 0 : stat.size, modifiedAt: stat.mtime.toISOString(), availability };
}
export function readPersonalOsFile(root: string, path: string): FileContent {
  const rel = normalizePersonalOsPath(path);
  if (!rel) throw new KnowledgeError('invalid_path', '没有指定文件');
  const absolute = resolvePersonalOsPath(root, rel);
  let info: ReturnType<typeof statSync>;
  try { info = statSync(absolute); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw new KnowledgeError('read_error', '文件读取失败');
    const placeholder = join(dirname(absolute), `.${basename(absolute)}.icloud`);
    try {
      physical(resolve(root), placeholder, true);
      if (statSync(placeholder).isFile()) return { ...metadata(rel, placeholder, 'icloud'), message: '尚未从 iCloud 下载' };
    } catch (placeholderError) {
      if (placeholderError instanceof KnowledgeError && placeholderError.code !== 'read_error') throw placeholderError;
    }
    throw new KnowledgeError('not_found', '文件不存在');
  }
  if (!info.isFile()) throw new KnowledgeError('not_found', '不是可读取的文件');
  const entry = metadata(rel, absolute);
  if (entry.kind !== 'markdown') return entry;
  try {
    const buffer = readFileSync(absolute); const truncated = buffer.length > MAX_PERSONALOS_BYTES;
    return { ...entry, content: buffer.subarray(0, MAX_PERSONALOS_BYTES).toString('utf8'), truncated, ...(truncated ? { message: '文件过长，仅显示前 1 MB' } : {}) };
  } catch { throw new KnowledgeError('read_error', '文件读取失败'); }
}
/** Visible children only. iCloud placeholders are represented by their original logical filename. */
export function listPersonalOsFiles(root: string, path = '', warnings: Warning[] = []): DocumentFile[] {
  let absolute: string;
  try { absolute = resolvePersonalOsPath(root, path); }
  catch { warnings.push({ code: 'directory_unreadable', message: '有目录无法安全读取' }); return []; }
  let entries: string[];
  try { entries = readdirSync(absolute); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') warnings.push({ code: 'directory_unreadable', message: '有目录读取失败' });
    return [];
  }
  const found: DocumentFile[] = [];
  for (const rawName of entries) {
    const cloud = /^\.(.+)\.icloud$/.exec(rawName);
    if (rawName.startsWith('.') && !cloud) continue;
    const name = cloud?.[1] ?? rawName;
    if (name.startsWith('.') || (cloud && entries.includes(name))) continue;
    const rel = path ? `${path}/${name}` : name;
    try {
      normalizePersonalOsPath(rel);
      const diskPath = cloud ? physical(resolve(root), join(absolute, rawName), true) : resolvePersonalOsPath(root, rel);
      const entry = metadata(rel, diskPath, cloud ? 'icloud' : 'available'); found.push(entry);
    } catch { warnings.push({ code: 'file_unreadable', message: '有文件无法安全读取' }); }
  }
  return found.sort((a, b) => Number(b.kind === 'directory') - Number(a.kind === 'directory') || a.name.localeCompare(b.name, 'zh-Hans-CN'));
}
export function walkPersonalOsFiles(root: string, path = '', warnings: Warning[] = [], depth = 0, seen = new Set<string>()): DocumentFile[] {
  if (depth > 12) return [];
  let real: string;
  try { real = realpathSync(resolvePersonalOsPath(root, path)); } catch { return []; }
  if (seen.has(real)) return []; seen.add(real);
  const result: DocumentFile[] = [];
  for (const entry of listPersonalOsFiles(root, path, warnings)) {
    if (entry.kind === 'directory') result.push(...walkPersonalOsFiles(root, entry.path, warnings, depth + 1, seen));
    else if (entry.kind === 'markdown' && entry.name !== 'CLAUDE.md') result.push(entry);
  }
  return result;
}
