import { homedir } from 'node:os';
import { join, normalize, sep } from 'node:path';
import type { KnowledgeEnv, LibraryConfig, LibraryInput } from './types.js';

export type KnowledgeEnvOverrides = {
  home?: string;
  libraries?: readonly LibraryInput[];
};

/** Default libraries from ADR 0011: PersonalOS and Arsenal (the old ~/Documents/Knowledge library was dropped in iteration 4, spec 14.1). `BLUEMANTA_KNOWLEDGE_HOME` points development and tests at fictional homes. */
export function defaultKnowledgeEnv(overrides: KnowledgeEnvOverrides = {}): KnowledgeEnv & { libraries: readonly LibraryConfig[] } {
  const home = overrides.home ?? process.env.BLUEMANTA_KNOWLEDGE_HOME ?? homedir();
  return {
    home,
    libraries: (overrides.libraries ?? [
      { id: 'personalos', kind: 'personalos', name: 'PersonalOS', root: join(home, 'Documents', 'PersonalOS'), writable: false },
      { kind: 'arsenal', id: 'arsenal', name: 'Arsenal', root: join(home, 'Documents', 'Shuyun', 'SalesOS', 'Arsenal'), writable: false },
    ] satisfies readonly LibraryInput[]).map((library) => ({ ...library, kind: library.kind ?? 'arsenal' })),
  };
}

/** Replaces only a complete home path segment, avoiding false matches such as /home/ann-other. */
export function abbreviateHome(path: string, home: string): string {
  const normalizedPath = normalize(path);
  const normalizedHome = normalize(home);
  if (normalizedPath === normalizedHome) return '~';
  return normalizedPath.startsWith(`${normalizedHome}${sep}`) ? `~${normalizedPath.slice(normalizedHome.length)}` : path;
}
