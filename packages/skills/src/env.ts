import { homedir } from 'node:os';
import { join, normalize, sep } from 'node:path';
import type { SkillEnv } from './types.js';

export type SkillEnvOverrides = Partial<Omit<SkillEnv, 'toolInstallDirs'>> & {
  toolInstallDirs?: Readonly<Record<string, string>>;
};

export function defaultSkillEnv(overrides: SkillEnvOverrides = {}): SkillEnv {
  const home = overrides.home ?? process.env.BLUEMANTA_SKILL_HOME ?? homedir();
  return {
    home,
    manifestPath: overrides.manifestPath ?? join(home, 'Documents', 'AgentSkills', 'manifest.yaml'),
    dshHome: overrides.dshHome ?? process.env.DSH_HOME ?? join(home, '.dsh'),
    agentsHome: overrides.agentsHome ?? process.env.DSH_AGENTS_HOME ?? join(home, '.agents'),
    toolInstallDirs: overrides.toolInstallDirs ?? {
      codex: join(home, '.codex', 'skills'),
      claude: join(home, '.claude', 'skills'),
      cursor: join(home, '.cursor', 'skills'),
      agents: join(overrides.agentsHome ?? process.env.DSH_AGENTS_HOME ?? join(home, '.agents'), 'skills'),
    },
    customSkillDirs: overrides.customSkillDirs ?? [],
  };
}

/** Replaces only a complete home path segment, avoiding false matches such as /home/ann-other. */
export function abbreviateHome(path: string, home: string): string {
  const normalizedPath = normalize(path);
  const normalizedHome = normalize(home);
  if (normalizedPath === normalizedHome) return '~';
  return normalizedPath.startsWith(`${normalizedHome}${sep}`) ? `~${normalizedPath.slice(normalizedHome.length)}` : path;
}
