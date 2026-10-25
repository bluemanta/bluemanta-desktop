import {
  abbreviateHome,
  getSkill,
  listIssues,
  listSkills,
  type ReadError,
  type SkillEnv,
  type SkillIssue,
  type SkillSummary as CoreSkillSummary,
} from '@bluemanta/skills';
import { Hono, type Context } from 'hono';
import type {
  ApiErrorCode,
  ApiFailure,
  SkillDetailResponse,
  SkillIssueItem,
  SkillIssuesResponse,
  SkillListResponse,
  SkillSummary,
} from './api-types.js';

const NO_STORE = { 'cache-control': 'no-store' };
const SKILL_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function replaceHome(value: string, env: SkillEnv): string {
  // K1 的说明文字也可能内嵌绝对路径，而不只是把路径放在 `path` 字段。
  const withoutEmbeddedHome = value.split(`${env.home}/`).join('~/');
  return abbreviateHome(withoutEmbeddedHome, env.home);
}

function sanitize<T>(value: T, env: SkillEnv): T {
  if (typeof value === 'string') return replaceHome(value, env) as T;
  if (Array.isArray(value)) return value.map((item) => sanitize(item, env)) as T;
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, sanitize(item, env)])) as T;
  }
  return value;
}

function summary(value: CoreSkillSummary, env: SkillEnv): SkillSummary {
  const result = sanitize(value, env);
  return {
    name: result.name,
    managed: result.managed,
    source: result.source,
    ...(result.displayName === undefined ? {} : { displayName: result.displayName }),
    ...(result.visibility === undefined ? {} : { visibility: result.visibility }),
    ...(result.lifecycle === undefined ? {} : { lifecycle: result.lifecycle }),
    ...(result.scope === undefined ? {} : { scope: result.scope }),
    targets: result.targets,
    contentIssues: result.contentIssues,
    ...(result.frontmatter === undefined ? {} : { frontmatter: result.frontmatter }),
    hasContentIssues: result.contentIssues.length > 0,
  };
}

function failure(c: Context, status: number, code: ApiErrorCode, message: string, details: Partial<ApiFailure> = {}): Response {
  return c.json({ ok: false, code, message, ...details } satisfies ApiFailure, status as 400, NO_STORE);
}

function readFailure(c: Context, error: ReadError, env: SkillEnv): Response {
  const codes: Record<ReadError['code'], { status: number; code: ApiErrorCode }> = {
    manifest_not_found: { status: 404, code: 'skill_manifest_missing' },
    manifest_parse_error: { status: 422, code: 'skill_manifest_parse_error' },
    manifest_invalid: { status: 422, code: 'skill_manifest_invalid' },
    skill_not_found: { status: 404, code: 'not_found' },
    read_error: { status: 500, code: 'skill_read_error' },
  };
  const mapped = codes[error.code];
  return failure(c, mapped.status, mapped.code, replaceHome(error.message, env), {
    path: replaceHome(error.path, env),
    reason: replaceHome(error.reason, env),
    ...(error.line === undefined ? {} : { line: error.line }),
  });
}

function issueSuggestion(issue: SkillIssue): Pick<SkillIssueItem, 'suggestion' | 'command'> {
  if (issue.kind === 'installation' && issue.code !== 'unmanaged') {
    return {
      suggestion: '用 skill manager 重新安装这个 skill，然后再次检查。',
      command: `python3 ~/Documents/AgentSkillRepos/skill-manager/scripts/skill_manager.py install --name ${issue.skill}`,
    };
  }
  if (issue.code === 'unmanaged') return { suggestion: '确认来源后，把这个条目登记进 manifest；M1 不会自动修改登记表。' };
  if (issue.kind === 'dsh-override') return { suggestion: '检查 dsh 的发现目录和优先级，移除不需要的同名条目。' };
  return { suggestion: '检查源目录、SKILL.md 和 frontmatter，并手动修正后再次检查。' };
}

export function createSkillsApi(env: SkillEnv): Hono {
  const app = new Hono();

  app.get('/skills', (c) => {
    const result = listSkills(env);
    if (!result.ok) return readFailure(c, result.error, env);
    const skills = result.value.skills.map((item) => summary(item, env));
    const body: SkillListResponse = {
      ok: true,
      manifestPath: replaceHome(result.value.manifestPath, env),
      checkedAt: new Date().toISOString(),
      count: skills.length,
      skills,
      unmanaged: skills.filter((item) => !item.managed),
      dsh: sanitize(result.value.dsh, env),
    };
    return c.json(body, 200, NO_STORE);
  });

  app.get('/skills/:name', (c) => {
    const name = c.req.param('name');
    if (!SKILL_NAME.test(name)) return failure(c, 400, 'invalid_input', 'skill 名必须是 kebab-case');
    const result = getSkill(env, name);
    if (!result.ok) return readFailure(c, result.error, env);
    const body: SkillDetailResponse = {
      ok: true,
      checkedAt: new Date().toISOString(),
      skill: {
        ...summary(result.value, env),
        notes: sanitize(result.value.notes, env),
        body: sanitize(result.value.body, env),
        skillFile: replaceHome(result.value.skillFile, env),
        files: result.value.files,
      },
    };
    return c.json(body, 200, NO_STORE);
  });

  app.get('/skill-issues', (c) => {
    const result = listIssues(env);
    if (!result.ok) return readFailure(c, result.error, env);
    const grouped = new Map<SkillIssueItem['code'], SkillIssueItem[]>();
    for (const raw of result.value) {
      const issue = { ...sanitize(raw, env), ...issueSuggestion(raw) } as SkillIssueItem;
      const group = grouped.get(issue.code) ?? [];
      group.push(issue);
      grouped.set(issue.code, group);
    }
    const groups = [...grouped].map(([code, issues]) => ({ code, count: issues.length, issues }));
    const body: SkillIssuesResponse = {
      ok: true,
      checkedAt: new Date().toISOString(),
      count: result.value.length,
      groups,
    };
    return c.json(body, 200, NO_STORE);
  });

  for (const path of ['/skills', '/skills/:name', '/skill-issues']) {
    app.all(path, (c) => failure(c, 405, 'method_not_allowed', `不支持 ${c.req.method}`));
  }
  return app;
}
