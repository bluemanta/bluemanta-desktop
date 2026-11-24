import { readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, join } from 'node:path';
import { parsePlist, type PlistValue } from './plist.js';
import { calendarEntries, describeCalendar, describeInterval, nextCalendarRun } from './schedule.js';
import { shortenHome } from './registry.js';
import type { DiscoveredTask, TaskState } from './types.js';

export interface LaunchctlRow { pid: number | null; status: number; label: string }
/** `launchctl list` prints `PID\tStatus\tLabel`; PID is `-` when not running (spec 3.2). */
export function parseLaunchctlList(text: string): Map<string, LaunchctlRow> {
  const rows = new Map<string, LaunchctlRow>();
  for (const line of text.split(/\r?\n/)) {
    const match = /^\s*(-|\d+)\s+(-?\d+)\s+(\S.*?)\s*$/.exec(line); if (!match) continue;
    rows.set(match[3]!, { pid: match[1] === '-' ? null : Number(match[1]), status: Number(match[2]), label: match[3]! });
  }
  return rows;
}

const INTERPRETERS = /^(?:python|python3|node|bun|deno|ruby|sh|bash|zsh|uv)(?:[\d.]*)$/;
/** Spec 3.1: self-built when run by a common interpreter or from the user's own folders; never judged by label prefix. */
export function isSelfBuilt(program: string | undefined, home: string): boolean {
  if (!program) return false;
  if (INTERPRETERS.test(basename(program))) return true;
  if (!program.startsWith(`${home}/`)) return false;
  const rest = program.slice(home.length + 1);
  return /^(?:Developer|Documents|bin)\//.test(rest) || rest.startsWith('.');
}
/** Spec 5.2: values that look like secrets (≥ 24 of [A-Za-z0-9_-] with both letters and digits) become •••. */
export function redactArgument(value: string): string {
  return value.replace(/[A-Za-z0-9_-]{24,}/g, (token) => (/[A-Za-z]/.test(token) && /\d/.test(token) ? '•••' : token));
}

const str = (value: PlistValue | undefined): string | undefined => (typeof value === 'string' ? value : undefined);
function newest(paths: string[]): string | null {
  let latest: Date | null = null;
  for (const path of paths) { try { const mtime = statSync(path).mtime; if (!latest || mtime > latest) latest = mtime; } catch { /* Missing output file. */ } }
  return latest?.toISOString() ?? null;
}
function state(row: LaunchctlRow | undefined, listed: boolean): { state: TaskState; lastExit: number | null } {
  if (!listed) return { state: 'unknown', lastExit: null };
  if (!row) return { state: 'not_loaded', lastExit: null };
  if (row.pid !== null) return { state: 'running', lastExit: row.status };
  return { state: row.status === 0 ? 'ok' : row.status < 0 ? 'signaled' : 'failed', lastExit: row.status };
}

/** Spec 3.1–3.2. `list` is the parsed `launchctl list`, or null when it could not be read (all states become 未知). */
export function discoverLaunchd(dir: string, options: { home: string; now: Date; list: Map<string, LaunchctlRow> | null }): DiscoveredTask[] {
  let names: string[] = [];
  try { names = readdirSync(dir).filter((name) => name.endsWith('.plist')).sort(); } catch { return []; }
  return names.map((name): DiscoveredTask => {
    const configPath = shortenHome(join(dir, name), options.home); const fallback = name.replace(/\.plist$/, '');
    let plist: { [key: string]: PlistValue };
    try {
      const parsed = parsePlist(readFileSync(join(dir, name)));
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('not a dict');
      plist = parsed;
    } catch {
      return { ref: `launchd:${fallback}`, runner: 'launchd', label: fallback, name: fallback, kind: '其他', schedule: '无法读取', nextRun: null, state: 'unreadable', lastExit: null, lastOutputAt: null, selfBuilt: false, configPath, program: null, outputPaths: [] };
    }
    const label = str(plist.Label) ?? fallback;
    const args = Array.isArray(plist.ProgramArguments) ? plist.ProgramArguments.filter((item): item is string => typeof item === 'string') : [];
    const program = str(plist.Program) ?? args[0];
    const calendar = calendarEntries(plist.StartCalendarInterval);
    let schedule = '—'; let nextRun: string | null = null; let kind: DiscoveredTask['kind'] = '其他';
    if (calendar && calendar.length > 0) { schedule = describeCalendar(calendar); nextRun = nextCalendarRun(calendar, options.now)?.toISOString() ?? null; kind = '定时'; }
    else if (typeof plist.StartInterval === 'number') { schedule = describeInterval(plist.StartInterval); kind = '定时'; }
    else if (Array.isArray(plist.WatchPaths) || Array.isArray(plist.QueueDirectories)) { schedule = '文件变化时'; kind = '定时'; }
    else if (plist.KeepAlive !== undefined && plist.KeepAlive !== false) { schedule = '常驻'; kind = '常驻'; }
    else if (plist.RunAtLoad === true) { schedule = '开机启动'; kind = '常驻'; }
    const outputs = [str(plist.StandardOutPath), str(plist.StandardErrorPath)].filter((item): item is string => !!item);
    const status = state(options.list?.get(label), options.list !== null);
    const shown = (str(plist.Program) ? [str(plist.Program)!, ...args.slice(1)] : args).map((arg) => redactArgument(shortenHome(arg, options.home)));
    return {
      ref: `launchd:${label}`, runner: 'launchd', label, name: label, kind, schedule, nextRun, ...status,
      lastOutputAt: newest(outputs), selfBuilt: isSelfBuilt(program, options.home), configPath, program: shown, outputPaths: outputs,
    };
  });
}
