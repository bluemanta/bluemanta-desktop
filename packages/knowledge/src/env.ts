import { homedir } from 'node:os';
import { join, normalize, sep } from 'node:path';
import type { KnowledgeEnv, LibraryConfig } from './types.js';

export type KnowledgeEnvOverrides = {
  home?: string;
  libraries?: readonly LibraryConfig[];
};

/** Default libraries from ADR 0009. `BLUEMANTA_KNOWLEDGE_HOME` points development and tests at fictional homes. */
export function defaultKnowledgeEnv(overrides: KnowledgeEnvOverrides = {}): KnowledgeEnv {
  const home = overrides.home ?? process.env.BLUEMANTA_KNOWLEDGE_HOME ?? homedir();
  return {
    home,
    libraries: overrides.libraries ?? [
      { id: 'personal', name: '个人', root: join(home, 'Documents', 'Knowledge'), writable: false },
      { id: 'arsenal', name: 'Arsenal', root: join(home, 'Documents', 'Shuyun', 'SalesOS', 'Arsenal'), writable: false },
    ],
  };
}

/** Replaces only a complete home path segment, avoiding false matches such as /home/ann-other. */
export function abbreviateHome(path: string, home: string): string {
  const normalizedPath = normalize(path);
  const normalizedHome = normalize(home);
  if (normalizedPath === normalizedHome) return '~';
  return normalizedPath.startsWith(`${normalizedHome}${sep}`) ? `~${normalizedPath.slice(normalizedHome.length)}` : path;
}
