import { closeSync, fstatSync, openSync, readdirSync, readSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { Freshness } from './types.js';

export const TAIL_BYTES = 64 * 1024;
const RUN_LINE = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?\s+(\S.*)$/;

/** Reads at most the last 64 KB of a file and drops a partial first line (spec 2.5, 4). */
export function readTail(path: string, bytes = TAIL_BYTES): string {
  const fd = openSync(path, 'r');
  try {
    const size = fstatSync(fd).size; const length = Math.min(size, bytes);
    const buffer = Buffer.alloc(length); readSync(fd, buffer, 0, length, size - length);
    const text = buffer.toString('utf8');
    return size > length ? text.slice(text.indexOf('\n') + 1) : text;
  } finally { closeSync(fd); }
}
export function tailLines(path: string, count: number): string[] {
  const lines = readTail(path).split(/\r?\n/);
  if (lines.at(-1) === '') lines.pop();
  return lines.slice(-count);
}
/** Run-log timestamps have no zone and are read as local time (spec 2.2). */
function localTime(match: RegExpExecArray): Date {
  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), Number(match[4]), Number(match[5]), Number(match[6] ?? 0));
}
export function parseRunLog(text: string, successMarks: readonly string[]): { lastRun: { at: Date; status: string } | null; lastSuccess: Date | null } | null {
  const lines = text.split(/\r?\n/).slice(-200); let lastRun: { at: Date; status: string } | null = null; let lastSuccess: Date | null = null;
  for (const line of lines) {
    const match = RUN_LINE.exec(line.trim()); if (!match) continue;
    const at = localTime(match); if (Number.isNaN(at.getTime())) continue;
    const status = match[7]!.trim(); lastRun = { at, status };
    if (successMarks.some((mark) => status.startsWith(mark))) lastSuccess = at;
  }
  return lastRun ? { lastRun, lastSuccess } : null;
}
function latestMtime(path: string): Date {
  const info = statSync(path); let latest = info.mtime;
  if (info.isDirectory()) {
    for (const name of readdirSync(path)) {
      try { const child = statSync(join(path, name)).mtime; if (child > latest) latest = child; } catch { /* Ignore vanished children. */ }
    }
  }
  return latest;
}
export function levelFor(lastSuccess: Date | null, intervalMs: number | null, now: Date): Freshness['level'] {
  if (intervalMs === null) return 'none';
  if (!lastSuccess) return 'stale';
  const age = now.getTime() - lastSuccess.getTime();
  return age <= intervalMs * 1.5 ? 'ok' : age <= intervalMs * 3 ? 'aging' : 'stale';
}
/** Spec personalos-sources 2. Only 副本 sources with a probe are measured; callers pass an absolute path. */
export function measureFreshness(path: string, options: { intervalMs: number | null; successMarks: readonly string[]; now: Date }): Freshness {
  let info;
  try { info = statSync(path); } catch { return { level: 'probe_missing', lastSuccessAt: null, lastRun: null, mode: null }; }
  if (info.isFile()) {
    let log = null; try { log = parseRunLog(readTail(path), options.successMarks); } catch { /* Unreadable: fall back to mtime. */ }
    if (log) {
      return {
        level: levelFor(log.lastSuccess, options.intervalMs, options.now), mode: 'log',
        lastSuccessAt: log.lastSuccess?.toISOString() ?? null,
        lastRun: log.lastRun ? { at: log.lastRun.at.toISOString(), status: log.lastRun.status } : null,
      };
    }
  }
  const mtime = latestMtime(path);
  return { level: levelFor(mtime, options.intervalMs, options.now), lastSuccessAt: mtime.toISOString(), lastRun: null, mode: 'mtime' };
}
