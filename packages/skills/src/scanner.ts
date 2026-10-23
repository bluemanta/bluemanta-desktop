import { lstatSync, readFileSync, readdirSync, realpathSync, readlinkSync, statSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { parseSkillFile } from './frontmatter.js';
import type {
  ContentIssue, DshSkill, DshView, ManifestSkill, SkillEnv, SkillManifest, SkillSummary, SkillTargetStatus,
} from './types.js';

function exists(path: string): boolean {
  try { statSync(path); return true; } catch { return false; }
}

function lexicalTarget(path: string): string | undefined {
  try { return resolve(dirname(path), readlinkSync(path)); } catch { return undefined; }
}

function sameTarget(link: string, source: string): boolean {
  try { return realpathSync(link) === realpathSync(source); } catch { return lexicalTarget(link) === resolve(source); }
}

function disabledAt(manifest: SkillManifest, tool: string, name: string): string | undefined {
  const candidates = [join(manifest.disabledRoot, tool, name), join(manifest.disabledRoot, name)];
  return candidates.find((path) => {
    try { lstatSync(path); return true; } catch { return false; }
  });
}

function targetStatus(skill: ManifestSkill, tool: string, manifest: SkillManifest): SkillTargetStatus {
  const install = skill.install[tool]!;
  const disabled = disabledAt(manifest, tool, skill.name);
  if (disabled) return { tool, path: disabled, status: 'disabled', expectedSource: skill.source };
  if (install.mode === 'pending') return { tool, path: install.path, status: 'pending', reason: install.reason, expectedSource: skill.source };
  if (install.mode === 'external-managed') return { tool, path: install.path, status: 'external', reason: install.reason, expectedSource: skill.source };
  try {
    const stat = lstatSync(install.path);
    if (!stat.isSymbolicLink()) return { tool, path: install.path, status: 'not-link', expectedSource: skill.source };
    const actualTarget = lexicalTarget(install.path);
    if (!exists(install.path) || !sameTarget(install.path, skill.source)) {
      return { tool, path: install.path, status: 'broken', expectedSource: skill.source, actualTarget };
    }
    return { tool, path: install.path, status: 'ok', expectedSource: skill.source, actualTarget };
  } catch {
    return { tool, path: install.path, status: 'missing', expectedSource: skill.source };
  }
}

export function inspectContent(source: string): { frontmatter?: SkillSummary['frontmatter']; issues: ContentIssue[] } {
  if (!exists(source)) return { issues: [{ code: 'source-missing', message: 'Source directory does not exist', path: source }] };
  const skillFile = join(source, 'SKILL.md');
  if (!exists(skillFile)) return { issues: [{ code: 'skill-file-missing', message: 'Source directory has no SKILL.md', path: skillFile }] };
  try {
    const parsed = parseSkillFile(readFileSync(skillFile, 'utf8'), skillFile, basename(source));
    return { frontmatter: parsed.frontmatter, issues: [...parsed.issues] };
  } catch (error) {
    return { issues: [{ code: 'frontmatter', message: `Cannot read SKILL.md: ${(error as Error).message}`, path: skillFile }] };
  }
}

function directNames(root: string): string[] {
  try {
    return readdirSync(root, { withFileTypes: true })
      .filter((entry) => entry.name !== '.system' && (entry.isDirectory() || entry.isSymbolicLink() || entry.isFile()))
      .map((entry) => entry.name.endsWith('.md') ? entry.name.slice(0, -3) : entry.name);
  } catch { return []; }
}

function unmanaged(manifest: SkillManifest, env: SkillEnv): SkillSummary[] {
  const knownByTool = new Map<string, Set<string>>();
  for (const skill of manifest.skills) for (const tool of Object.keys(skill.install)) {
    const names = knownByTool.get(tool) ?? new Set<string>();
    names.add(skill.name);
    knownByTool.set(tool, names);
  }
  const found = new Map<string, SkillSummary>();
  for (const [tool, root] of Object.entries(env.toolInstallDirs)) {
    const known = knownByTool.get(tool) ?? new Set<string>();
    for (const name of directNames(root)) {
      if (known.has(name)) continue;
      const path = join(root, name);
      const current = found.get(name) ?? { name, managed: false, source: null, targets: [], contentIssues: [] };
      (current.targets as SkillTargetStatus[]).push({ tool, path, status: 'unmanaged' });
      found.set(name, current);
    }
  }
  // Disabled entries can outlive a manifest entry and must still be visible.
  for (const tool of directNames(manifest.disabledRoot)) {
    const toolRoot = join(manifest.disabledRoot, tool);
    for (const name of directNames(toolRoot)) {
      const registered = manifest.skills.some((skill) => skill.name === name);
      if (registered) continue;
      const current = found.get(name) ?? { name, managed: false, source: null, targets: [], contentIssues: [] };
      if (!current.targets.some((target) => target.tool === tool && target.status === 'disabled')) {
        (current.targets as SkillTargetStatus[]).push({ tool, path: join(toolRoot, name), status: 'disabled' });
      }
      found.set(name, current);
    }
  }
  return [...found.values()];
}

export function scanManifestSkills(manifest: SkillManifest, env: SkillEnv): SkillSummary[] {
  const managed = manifest.skills.map((skill): SkillSummary => {
    const content = inspectContent(skill.source);
    const targets = Object.keys(skill.install).sort().map((tool) => targetStatus(skill, tool, manifest));
    for (const tool of directNames(manifest.disabledRoot)) {
      if (targets.some((target) => target.tool === tool)) continue;
      const path = disabledAt(manifest, tool, skill.name);
      if (path) targets.push({ tool, path, status: 'disabled', expectedSource: skill.source });
    }
    return {
      name: skill.name,
      managed: true,
      source: skill.source,
      displayName: skill.displayName,
      visibility: skill.visibility,
      lifecycle: skill.lifecycle,
      scope: skill.scope,
      targets,
      contentIssues: content.issues,
      frontmatter: content.frontmatter,
    };
  });
  return [...managed, ...unmanaged(manifest, env)].sort((a, b) => a.name.localeCompare(b.name));
}

interface Root { path: string; source: DshSkill['source']; rank: number }

function dshCandidate(root: Root, entry: string): { path: string; expected?: string } | undefined {
  const path = join(root.path, entry);
  try {
    const stat = statSync(path);
    if (stat.isDirectory()) return { path: join(path, 'SKILL.md'), expected: entry };
    if (stat.isFile() && entry.endsWith('.md')) return { path };
  } catch { return undefined; }
  return undefined;
}

export function scanDsh(env: SkillEnv): DshView {
  const roots: Root[] = [
    ...env.customSkillDirs.map((path) => ({ path, source: 'custom' as const, rank: 300 })),
    { path: join(env.dshHome, 'skills'), source: 'user-dsh', rank: 400 },
    { path: join(env.agentsHome, 'skills'), source: 'user-agents', rank: 500 },
  ];
  const candidates: DshSkill[] = [];
  const issues: ContentIssue[] = [];
  for (const root of roots) {
    let entries: string[];
    try { entries = readdirSync(root.path).filter((entry) => !(root.source === 'user-dsh' && entry === '.system')); } catch { continue; }
    for (const entry of entries) {
      const candidate = dshCandidate(root, entry);
      if (!candidate || !exists(candidate.path)) continue;
      try {
        const parsed = parseSkillFile(readFileSync(candidate.path, 'utf8'), candidate.path, candidate.expected);
        issues.push(...parsed.issues);
        if (parsed.frontmatter && !parsed.issues.some((issue) => issue.code === 'frontmatter')) candidates.push({
          name: parsed.frontmatter.name, path: candidate.path, root: root.path, source: root.source, rank: root.rank, frontmatter: parsed.frontmatter,
        });
      } catch (error) {
        issues.push({ code: 'frontmatter', message: `Cannot read skill: ${(error as Error).message}`, path: candidate.path });
      }
    }
  }
  candidates.sort((a, b) => a.rank - b.rank || a.name.localeCompare(b.name));
  const byName = new Map<string, DshSkill[]>();
  for (const candidate of candidates) byName.set(candidate.name, [...(byName.get(candidate.name) ?? []), candidate]);
  const loaded: DshSkill[] = [];
  const overrides = [];
  for (const [name, matches] of byName) {
    const winner = matches[0]!;
    loaded.push(winner);
    if (matches.length > 1) overrides.push({ name, winner, overridden: matches.slice(1) });
  }
  return { loaded: loaded.sort((a, b) => a.name.localeCompare(b.name)), overrides, issues };
}
