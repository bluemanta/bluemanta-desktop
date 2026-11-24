import type { RegistryLocation, Warning } from '../types.js';

/** Spec personalos-sources 1.1. Unknown method words are kept in `methodRaw` and treated as 登记. */
export type SourceMethod = '查询' | '副本' | '登记' | '推入';
export type Runner = 'launchd' | 'codex' | 'claude';

export interface RegisteredSource {
  name: string; method: SourceMethod; methodRaw: string; location: RegistryLocation;
  taskRefs: string[]; interval: { text: string; ms: number } | null;
  probe: string | null; successMarks: string[];
  card: { title: string; path: string; anchor: string | null } | null; line: number;
}
export interface RegisteredTask { ref: string; runner: Runner | null; label: string; name: string; purpose: string; ignored: boolean; log: string | null; logVisible: boolean; line: number }
export interface SourcesRegistry { exists: boolean; sources: RegisteredSource[]; tasks: RegisteredTask[]; warnings: Warning[] }

export type FreshnessLevel = 'ok' | 'aging' | 'stale' | 'probe_missing' | 'none';
export interface Freshness { level: FreshnessLevel; lastSuccessAt: string | null; lastRun: { at: string; status: string } | null; mode: 'log' | 'mtime' | null }

export type TaskKind = '定时' | '常驻' | '其他';
/**
 * launchd: running / ok / failed / signaled / not_loaded / unknown / unreadable.
 * codex, claude: active / paused / ended / managed.
 * missing: registered but not found at the runner.
 */
export type TaskState = 'running' | 'ok' | 'failed' | 'signaled' | 'not_loaded' | 'unknown' | 'unreadable' | 'active' | 'paused' | 'ended' | 'managed' | 'missing';

/** A task as found at its runner, before it is joined with the registry. */
export interface DiscoveredTask {
  ref: string; runner: Runner; label: string; name: string; kind: TaskKind;
  schedule: string; nextRun: string | null; state: TaskState; lastExit: number | null;
  lastOutputAt: string | null; selfBuilt: boolean; configPath: string; program: string[] | null;
  outputPaths: string[]; description?: string;
}
export interface TaskView extends Omit<DiscoveredTask, 'outputPaths'> {
  registered: boolean; purpose: string; sourceNames: string[];
  logPath: string | null; logVisible: boolean; resultText: string;
}
export interface SourceView extends Omit<RegisteredSource, 'probe'> {
  probe: { display: string; exists: boolean } | null; freshness: Freshness;
}
export interface SourcesResult {
  registry: { exists: boolean; path: string };
  sources: SourceView[]; tasks: TaskView[]; services: TaskView[]; unregistered: TaskView[];
  summary: { failedTasks: number; staleSources: number; unregistered: number };
  generatedAt: string; warnings: Warning[];
}
