import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { LineCounter, parseDocument } from 'yaml';
import type { ManifestSkill, ReadResult, SkillManifest } from './types.js';

function failure(code: 'manifest_not_found' | 'manifest_parse_error' | 'manifest_invalid' | 'read_error', path: string, reason: string, line?: number): ReadResult<never> {
  return { ok: false, error: { code, path, reason, line, message: line ? `${path}:${line}: ${reason}` : `${path}: ${reason}` } };
}

export function readManifest(path: string): ReadResult<SkillManifest> {
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch (error) {
    const nodeError = error as NodeJS.ErrnoException;
    return failure(nodeError.code === 'ENOENT' ? 'manifest_not_found' : 'read_error', path, nodeError.message);
  }
  const lineCounter = new LineCounter();
  let document: ReturnType<typeof parseDocument>;
  try {
    document = parseDocument(text, { lineCounter });
  } catch (error) {
    return failure('manifest_parse_error', path, (error as Error).message);
  }
  if (document.errors.length > 0) {
    const error = document.errors[0]!;
    return failure('manifest_parse_error', path, error.message, error.linePos?.[0]?.line);
  }
  let parsed: unknown;
  try {
    parsed = document.toJS();
  } catch (error) {
    return failure('manifest_parse_error', path, (error as Error).message);
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return failure('manifest_invalid', path, 'manifest must be a mapping', 1);
  const root = parsed as Record<string, unknown>;
  if (!root.skills || typeof root.skills !== 'object' || Array.isArray(root.skills)) return failure('manifest_invalid', path, 'skills must be a mapping', 1);
  const skills: ManifestSkill[] = [];
  for (const [name, entryValue] of Object.entries(root.skills as Record<string, unknown>)) {
    if (!entryValue || typeof entryValue !== 'object' || Array.isArray(entryValue)) return failure('manifest_invalid', path, `skill "${name}" must be a mapping`);
    const entry = entryValue as Record<string, unknown>;
    if (typeof entry.source !== 'string' || entry.source === '') return failure('manifest_invalid', path, `skill "${name}" requires source`);
    const installs: Record<string, { path: string; mode: string; reason?: string }> = {};
    if (entry.install !== undefined) {
      if (!entry.install || typeof entry.install !== 'object' || Array.isArray(entry.install)) return failure('manifest_invalid', path, `skill "${name}" install must be a mapping`);
      for (const [tool, installValue] of Object.entries(entry.install as Record<string, unknown>)) {
        if (!installValue || typeof installValue !== 'object' || Array.isArray(installValue)) return failure('manifest_invalid', path, `install target "${tool}" must be a mapping`);
        const install = installValue as Record<string, unknown>;
        if (typeof install.path !== 'string' || typeof install.mode !== 'string') return failure('manifest_invalid', path, `install target "${tool}" requires path and mode`);
        installs[tool] = { ...install, path: install.path, mode: install.mode, reason: typeof install.reason === 'string' ? install.reason : undefined };
      }
    }
    skills.push({
      name,
      source: entry.source,
      displayName: typeof entry.display_name === 'string' ? entry.display_name : undefined,
      visibility: typeof entry.visibility === 'string' ? entry.visibility : undefined,
      lifecycle: typeof entry.lifecycle === 'string' ? entry.lifecycle : undefined,
      scope: typeof entry.scope === 'string' ? entry.scope : undefined,
      notes: Array.isArray(entry.notes) ? entry.notes.filter((item): item is string => typeof item === 'string') : [],
      install: installs,
      raw: entry,
    });
  }
  const locations = root.locations && typeof root.locations === 'object' && !Array.isArray(root.locations) ? root.locations as Record<string, unknown> : {};
  return { ok: true, value: {
    schemaVersion: typeof root.schema_version === 'number' ? root.schema_version : undefined,
    sourceRoot: typeof locations.skill_sources_root === 'string' ? locations.skill_sources_root : undefined,
    disabledRoot: join(dirname(path), 'disabled'),
    skills,
  } };
}
