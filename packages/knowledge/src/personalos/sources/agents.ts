import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describeRrule, nextRruleRun, parseRrule } from './schedule.js';
import { shortenHome } from './registry.js';
import type { DiscoveredTask } from './types.js';

/** Spec 3.3: only these top-level keys are read; prompts and everything else are never returned. */
export const CODEX_KEYS = ['id', 'name', 'kind', 'status', 'rrule', 'execution_environment'] as const;
type CodexFields = Partial<Record<(typeof CODEX_KEYS)[number], string>>;

/** Single-line `key = "value"` pairs before the first table header; basic escapes only. */
export function readCodexFields(toml: string): CodexFields {
  const fields: CodexFields = {};
  for (const line of toml.split(/\r?\n/)) {
    if (/^\s*\[/.test(line)) break;
    const match = /^\s*([A-Za-z_][A-Za-z0-9_-]*)\s*=\s*"((?:[^"\\]|\\.)*)"\s*(?:#.*)?$/.exec(line);
    if (!match || !(CODEX_KEYS as readonly string[]).includes(match[1]!)) continue;
    fields[match[1] as (typeof CODEX_KEYS)[number]] = match[2]!.replace(/\\(["\\nt])/g, (_, char: string) => (char === 'n' ? '\n' : char === 't' ? '\t' : char));
  }
  return fields;
}
function dirs(root: string): string[] {
  try { return readdirSync(root, { withFileTypes: true }).filter((entry) => entry.isDirectory() && !entry.name.startsWith('.')).map((entry) => entry.name).sort(); } catch { return []; }
}

export function discoverCodex(root: string, options: { home: string; now: Date }): DiscoveredTask[] {
  return dirs(root).flatMap((dir): DiscoveredTask[] => {
    const file = join(root, dir, 'automation.toml'); let toml: string;
    try { toml = readFileSync(file, 'utf8'); } catch { return []; }
    const fields = readCodexFields(toml); const label = fields.id ?? dir;
    const rule = fields.rrule ? parseRrule(fields.rrule) : null;
    let schedule = fields.rrule ?? '—'; let nextRun: string | null = null; let ended = false;
    if (rule) { schedule = describeRrule(rule); const next = nextRruleRun(rule, options.now); nextRun = next.next?.toISOString() ?? null; ended = next.ended; }
    const paused = fields.status === 'PAUSED';
    return [{
      ref: `codex:${label}`, runner: 'codex', label, name: fields.name ?? label, kind: '定时', schedule,
      nextRun: paused || ended ? null : nextRun, state: ended ? 'ended' : paused ? 'paused' : 'active', lastExit: null, lastOutputAt: null,
      selfBuilt: true, configPath: shortenHome(file, options.home), program: null, outputPaths: [],
    }];
  });
}

/** Spec 3.4: only the frontmatter `name` and `description` of SKILL.md. */
export function readFrontmatter(markdown: string): { name?: string; description?: string } {
  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(markdown); if (!match) return {};
  const result: { name?: string; description?: string } = {};
  for (const line of match[1]!.split(/\r?\n/)) {
    const field = /^(name|description):\s*(.*)$/.exec(line);
    if (field) result[field[1] as 'name' | 'description'] = field[2]!.trim().replace(/^(["'])(.*)\1$/, '$2');
  }
  return result;
}
export function discoverClaude(root: string, options: { home: string }): DiscoveredTask[] {
  return dirs(root).flatMap((dir): DiscoveredTask[] => {
    const file = join(root, dir, 'SKILL.md'); let markdown: string;
    try { markdown = readFileSync(file, 'utf8'); } catch { return []; }
    const meta = readFrontmatter(markdown); const label = dir;
    return [{
      ref: `claude:${label}`, runner: 'claude', label, name: meta.name ?? label, kind: '定时', schedule: '由 Claude 应用管理', nextRun: null,
      state: 'managed', lastExit: null, lastOutputAt: null, selfBuilt: true, configPath: shortenHome(file, options.home), program: null, outputPaths: [],
      ...(meta.description ? { description: meta.description } : {}),
    }];
  });
}
