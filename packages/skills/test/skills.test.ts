import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { abbreviateHome, defaultSkillEnv, getSkill, listIssues, listSkills, parseSkillFile, readManifest, type SkillEnv } from '../src/index.js';

const roots: string[] = [];
afterEach(() => { while (roots.length) rmSync(roots.pop()!, { recursive: true, force: true }); });

function fixture(): { root: string; env: SkillEnv; sources: string; control: string } {
  const root = mkdtempSync(join(tmpdir(), 'bluemanta-skills-'));
  roots.push(root);
  const sources = join(root, 'Documents', 'AgentSkillRepos');
  const control = join(root, 'Documents', 'AgentSkills');
  mkdirSync(sources, { recursive: true });
  mkdirSync(control, { recursive: true });
  return { root, sources, control, env: defaultSkillEnv({ home: root }) };
}

function skill(sources: string, name: string, header = `name: ${name}\ndescription: Fictional test skill`, body = '# Instructions\nDo a fictional task.'): string {
  const source = join(sources, name);
  mkdirSync(source, { recursive: true });
  writeFileSync(join(source, 'SKILL.md'), `---\n${header}\n---\n${body}\n`);
  writeFileSync(join(source, 'notes.txt'), 'fiction');
  return source;
}

function writeManifest(env: SkillEnv, sources: string, entries: string): void {
  writeFileSync(env.manifestPath, `schema_version: 1\nunknown_top_level: ignored\nlocations:\n  skill_sources_root: ${sources}\nskills:\n${entries}`);
}

describe('environment and manifest', () => {
  it('uses injectable defaults and safely abbreviates home', () => {
    const env = defaultSkillEnv({ home: '/tmp/fictional-home', dshHome: '/tmp/dsh', toolInstallDirs: { novel: '/tmp/novel' } });
    expect(env.manifestPath).toBe('/tmp/fictional-home/Documents/AgentSkills/manifest.yaml');
    expect(env.dshHome).toBe('/tmp/dsh');
    expect(env.toolInstallDirs).toEqual({ novel: '/tmp/novel' });
    expect(abbreviateHome('/tmp/fictional-home/a', env.home)).toBe('~/a');
    expect(abbreviateHome('/tmp/fictional-home-other/a', env.home)).toBe('/tmp/fictional-home-other/a');
  });

  it('returns missing and line-numbered YAML errors instead of throwing', () => {
    const { env } = fixture();
    expect(readManifest(env.manifestPath)).toMatchObject({ ok: false, error: { code: 'manifest_not_found' } });
    writeFileSync(env.manifestPath, 'skills:\n  bad: [\n');
    expect(listSkills(env)).toMatchObject({ ok: false, error: { code: 'manifest_parse_error', line: 3 } });
  });

  it('accepts omitted install, unknown keys and nested sources', () => {
    const { env, sources } = fixture();
    const nested = skill(join(sources, 'vendor', 'skills'), 'nested-demo');
    writeManifest(env, sources, `  nested-demo:\n    source: ${nested}\n    mystery: preserved\n`);
    const result = listSkills(env);
    expect(result.ok && result.value.skills[0]).toMatchObject({ name: 'nested-demo', targets: [], contentIssues: [] });
  });
});

describe('installation status and content', () => {
  it('covers all eight statuses without writing outside the temporary home', () => {
    const { env, sources, control, root } = fixture();
    const names = ['demo-ok', 'demo-broken', 'demo-missing', 'demo-copy', 'demo-pending', 'demo-external', 'demo-disabled', 'demo-disabled-uninstalled'];
    const source = Object.fromEntries(names.map((name) => [name, skill(sources, name)]));
    const installs = join(root, '.codex', 'skills');
    mkdirSync(installs, { recursive: true });
    symlinkSync(source['demo-ok']!, join(installs, 'demo-ok'));
    symlinkSync(join(sources, 'wrong-target'), join(installs, 'demo-broken'));
    mkdirSync(join(installs, 'demo-copy'));
    mkdirSync(join(installs, 'loose-demo'));
    mkdirSync(join(control, 'disabled', 'codex'), { recursive: true });
    symlinkSync(source['demo-disabled']!, join(control, 'disabled', 'codex', 'demo-disabled'));
    symlinkSync(source['demo-disabled-uninstalled']!, join(control, 'disabled', 'codex', 'demo-disabled-uninstalled'));
    const row = (name: string, mode: string, reason = '') => `  ${name}:\n    source: ${source[name]}\n    extra: ignored\n    install:\n      codex:\n        path: ${join(installs, name)}\n        mode: ${mode}\n${reason ? `        reason: ${reason}\n` : ''}`;
    writeManifest(env, sources,
      row('demo-ok', 'symlink') + row('demo-broken', 'symlink') + row('demo-missing', 'symlink') +
      row('demo-copy', 'symlink') + row('demo-pending', 'pending', 'Waiting for fictional discovery.') +
      `  demo-external:\n    source: ${source['demo-external']}\n    install:\n      vendor-tool:\n        path: ${join(root, 'vendor', 'many-skills')}\n        mode: external-managed\n` +
      row('demo-disabled', 'symlink') + `  demo-disabled-uninstalled:\n    source: ${source['demo-disabled-uninstalled']}\n`);

    const result = listSkills(env);
    if (!result.ok) throw new Error(result.error.message);
    const statuses = Object.fromEntries(result.value.skills.flatMap((item) => item.targets.map((target) => [`${item.name}:${target.tool}`, target.status])));
    expect(statuses).toMatchObject({
      'demo-ok:codex': 'ok', 'demo-broken:codex': 'broken', 'demo-missing:codex': 'missing',
      'demo-copy:codex': 'not-link', 'demo-pending:codex': 'pending', 'demo-external:vendor-tool': 'external',
      'loose-demo:codex': 'unmanaged', 'demo-disabled:codex': 'disabled',
      'demo-disabled-uninstalled:codex': 'disabled',
    });
    const pending = result.value.skills.find((item) => item.name === 'demo-pending')?.targets[0];
    expect(pending?.reason).toBe('Waiting for fictional discovery.');
  });

  it('reports missing sources, missing files, invalid frontmatter, and directory-name mismatch', () => {
    const { env, sources } = fixture();
    const noFile = join(sources, 'no-file'); mkdirSync(noFile);
    const invalid = skill(sources, 'bad-frontmatter', 'name: Bad Name\ndescription: ""\nuser-invocable: perhaps');
    const mismatch = skill(sources, 'directory-name', 'name: other-name\ndescription: Fictional');
    writeManifest(env, sources, `  gone:\n    source: ${join(sources, 'gone')}\n  no-file:\n    source: ${noFile}\n  bad-frontmatter:\n    source: ${invalid}\n  directory-name:\n    source: ${mismatch}\n`);
    const result = listIssues(env);
    if (!result.ok) throw new Error(result.error.message);
    expect(result.value.map((issue) => issue.code)).toEqual(expect.arrayContaining(['source-missing', 'skill-file-missing', 'frontmatter', 'name-mismatch']));
  });

  it('returns body, parsed frontmatter, and a sorted first-level file list', () => {
    const { env, sources } = fixture();
    const source = skill(sources, 'demo-detail', 'name: demo-detail\ndescription: Fictional\ndisable-model-invocation: YES\nuser-invocable: 0', 'Detailed body');
    writeManifest(env, sources, `  demo-detail:\n    source: ${source}\n`);
    const detail = getSkill(env, 'demo-detail');
    expect(detail.ok && detail.value).toMatchObject({ body: 'Detailed body\n', files: ['SKILL.md', 'notes.txt'], frontmatter: { disableModelInvocation: true, userInvocable: false } });
    expect(getSkill(env, 'unknown')).toMatchObject({ ok: false, error: { code: 'skill_not_found' } });
  });
});

describe('dsh view', () => {
  it('follows links, recognizes only direct bundles and flat files, skips .system, and records rank overrides', () => {
    const { env, sources } = fixture();
    writeManifest(env, sources, '  {}\n');
    const agents = join(env.agentsHome, 'skills');
    const dsh = join(env.dshHome, 'skills');
    mkdirSync(agents, { recursive: true }); mkdirSync(dsh, { recursive: true });
    const shared = skill(sources, 'shared-demo');
    symlinkSync(shared, join(agents, 'shared-demo'));
    skill(dsh, 'shared-demo');
    writeFileSync(join(agents, 'flat-demo.md'), '---\nname: flat-demo\ndescription: Flat fictional skill\n---\nFlat body');
    mkdirSync(join(agents, 'nested', 'too-deep'), { recursive: true });
    writeFileSync(join(agents, 'nested', 'too-deep', 'SKILL.md'), '---\nname: too-deep\ndescription: no\n---\n');
    mkdirSync(join(dsh, '.system', 'hidden-demo'), { recursive: true });
    writeFileSync(join(dsh, '.system', 'hidden-demo', 'SKILL.md'), '---\nname: hidden-demo\ndescription: hidden\n---\n');
    skill(agents, 'invalid-demo', 'name: INVALID\ndescription: invalid');

    const result = listSkills(env);
    if (!result.ok) throw new Error(result.error.message);
    expect(result.value.dsh.loaded.map((item) => item.name)).toEqual(['flat-demo', 'shared-demo']);
    expect(result.value.dsh.loaded.find((item) => item.name === 'shared-demo')).toMatchObject({ rank: 400, source: 'user-dsh' });
    expect(result.value.dsh.overrides).toHaveLength(1);
    expect(result.value.dsh.overrides[0]?.overridden[0]).toMatchObject({ rank: 500, source: 'user-agents' });
    expect(result.value.dsh.issues.some((issue) => issue.path.includes('invalid-demo'))).toBe(true);
  });

  it('matches dsh boolean grammar', () => {
    const accepted = ['true', 'false', 'yes', 'no', 'on', 'off', '1', '0'];
    for (const value of accepted) expect(parseSkillFile(`---\nname: demo\ndescription: Demo\nuser-invocable: ${value}\n---\n`, '/tmp/demo')).toMatchObject({ issues: [] });
    expect(parseSkillFile('---\nname: demo\ndescription: Demo\nuser-invocable: maybe\n---\n', '/tmp/demo').issues[0]?.code).toBe('frontmatter');
  });
});
