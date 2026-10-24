export interface SkillEnv {
  home: string;
  manifestPath: string;
  dshHome: string;
  agentsHome: string;
  /** Roots whose direct children are installations. Unknown manifest tool keys remain supported. */
  toolInstallDirs: Readonly<Record<string, string>>;
  /** Optional dsh roots at rank 300. */
  customSkillDirs: readonly string[];
}

export interface SkillInstall {
  path: string;
  mode: 'symlink' | 'pending' | 'external-managed' | string;
  reason?: string;
  [key: string]: unknown;
}

export interface ManifestSkill {
  name: string;
  source: string;
  displayName?: string;
  visibility?: string;
  lifecycle?: string;
  scope?: string;
  notes: readonly string[];
  install: Readonly<Record<string, SkillInstall>>;
  raw: Readonly<Record<string, unknown>>;
}

export interface SkillManifest {
  schemaVersion?: number;
  sourceRoot?: string;
  disabledRoot: string;
  skills: readonly ManifestSkill[];
}

export interface ReadError {
  code: 'manifest_not_found' | 'manifest_parse_error' | 'manifest_invalid' | 'skill_not_found' | 'read_error';
  message: string;
  path: string;
  line?: number;
  reason: string;
}

export type ReadResult<T> = { ok: true; value: T } | { ok: false; error: ReadError };

export type InstallStatus = 'ok' | 'broken' | 'missing' | 'not-link' | 'pending' | 'external' | 'unmanaged' | 'disabled';

export interface SkillTargetStatus {
  tool: string;
  path: string;
  status: InstallStatus;
  reason?: string;
  expectedSource?: string;
  actualTarget?: string;
}

export interface Frontmatter {
  name: string;
  description: string;
  whenToUse?: string;
  metadata?: unknown;
  disableModelInvocation: boolean;
  userInvocable: boolean;
  raw: Readonly<Record<string, unknown>>;
}

export interface ContentIssue {
  code: 'source-missing' | 'skill-file-missing' | 'frontmatter' | 'name-mismatch';
  message: string;
  path: string;
  line?: number;
}

export interface SkillSummary {
  name: string;
  managed: boolean;
  source: string | null;
  displayName?: string;
  visibility?: string;
  lifecycle?: string;
  scope?: string;
  notes: readonly string[];
  targets: readonly SkillTargetStatus[];
  contentIssues: readonly ContentIssue[];
  frontmatter?: Frontmatter;
}

export interface DshSkill {
  name: string;
  path: string;
  root: string;
  source: 'custom' | 'user-dsh' | 'user-agents';
  rank: number;
  frontmatter: Frontmatter;
}

export interface DshOverride {
  name: string;
  winner: DshSkill;
  overridden: readonly DshSkill[];
}

export interface DshView {
  loaded: readonly DshSkill[];
  overrides: readonly DshOverride[];
  issues: readonly ContentIssue[];
}

export interface SkillsSnapshot {
  manifestPath: string;
  skills: readonly SkillSummary[];
  dsh: DshView;
}

export interface SkillDetail extends SkillSummary {
  body: string;
  skillFile: string;
  files: readonly string[];
}

export interface SkillIssue {
  kind: 'installation' | 'content' | 'dsh-override' | 'dsh-content';
  code: InstallStatus | ContentIssue['code'] | 'overridden';
  message: string;
  skill: string;
  path?: string;
  tool?: string;
  line?: number;
}
