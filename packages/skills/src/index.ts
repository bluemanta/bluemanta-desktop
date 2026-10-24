import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { parseSkillFile } from './frontmatter.js';
import { readManifest } from './manifest.js';
import { scanDsh, scanManifestSkills } from './scanner.js';
import type { ReadResult, SkillDetail, SkillEnv, SkillIssue, SkillsSnapshot } from './types.js';

export { abbreviateHome, defaultSkillEnv, type SkillEnvOverrides } from './env.js';
export { parseSkillFile, type ParsedSkillFile } from './frontmatter.js';
export { readManifest } from './manifest.js';
export * from './types.js';

export function listSkills(env: SkillEnv): ReadResult<SkillsSnapshot> {
  const manifest = readManifest(env.manifestPath);
  if (!manifest.ok) return manifest;
  return { ok: true, value: {
    manifestPath: env.manifestPath,
    skills: scanManifestSkills(manifest.value, env),
    dsh: scanDsh(env),
  } };
}

export function getSkill(env: SkillEnv, name: string): ReadResult<SkillDetail> {
  const snapshot = listSkills(env);
  if (!snapshot.ok) return snapshot;
  const summary = snapshot.value.skills.find((skill) => skill.name === name && skill.managed);
  if (!summary || !summary.source) return { ok: false, error: {
    code: 'skill_not_found', path: env.manifestPath, reason: `Skill "${name}" is not registered`, message: `Skill "${name}" is not registered`,
  } };
  const skillFile = join(summary.source, 'SKILL.md');
  let text: string;
  let files: string[];
  try {
    text = readFileSync(skillFile, 'utf8');
    files = readdirSync(summary.source).sort();
  } catch (error) {
    return { ok: false, error: { code: 'read_error', path: skillFile, reason: (error as Error).message, message: `${skillFile}: ${(error as Error).message}` } };
  }
  const parsed = parseSkillFile(text, skillFile);
  return { ok: true, value: { ...summary, frontmatter: parsed.frontmatter, skillFile, body: parsed.body, files } };
}

export function listIssues(env: SkillEnv): ReadResult<readonly SkillIssue[]> {
  const snapshot = listSkills(env);
  if (!snapshot.ok) return snapshot;
  const issues: SkillIssue[] = [];
  for (const skill of snapshot.value.skills) {
    for (const target of skill.targets) {
      if (target.status === 'ok' || target.status === 'pending' || target.status === 'external' || target.status === 'disabled') continue;
      issues.push({ kind: 'installation', code: target.status, skill: skill.name, tool: target.tool, path: target.path, message: `${skill.name} is ${target.status} for ${target.tool}` });
    }
    for (const issue of skill.contentIssues) issues.push({ kind: 'content', code: issue.code, skill: skill.name, path: issue.path, line: issue.line, message: issue.message });
  }
  for (const override of snapshot.value.dsh.overrides) for (const hidden of override.overridden) issues.push({
    kind: 'dsh-override', code: 'overridden', skill: override.name, path: hidden.path,
    message: `${hidden.path} is overridden by rank ${override.winner.rank} skill at ${override.winner.path}`,
  });
  for (const issue of snapshot.value.dsh.issues) issues.push({ kind: 'dsh-content', code: issue.code, skill: '', path: issue.path, line: issue.line, message: issue.message });
  return { ok: true, value: issues };
}
