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
  return {
    root, sources, control,
    env: defaultSkillEnv({ home: root, dshHome: join(root, '.dsh'), agentsHome: join(root, '.agents') }),
  };
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
  it('returns frontmatter, body and notes when explicitly reading an external-managed skill', () => {
    const { env, sources, root } = fixture();
    const source = skill(sources, 'external-detail');
    writeManifest(env, sources, `  external-detail:\n    source: ${source}\n    notes:\n      - Fictional note.\n    install:\n      vendor-tool:\n        path: ${join(root, 'vendor-collection')}\n        mode: external-managed\n`);

    const result = getSkill(env, 'external-detail');
    expect(result).toMatchObject({ ok: true, value: {
      frontmatter: { name: 'external-detail', description: 'Fictional test skill' },
      body: '# Instructions\nDo a fictional task.\n',
      notes: ['Fictional note.'],
      files: ['SKILL.md', 'notes.txt'],
    } });
    expect(listIssues(env)).toEqual({ ok: true, value: [] });
  });

  it('validates content when a normal installation coexists with external management', () => {
    const { env, sources, root } = fixture();
    const source = skill(sources, 'mixed-demo', 'name: INVALID\ndescription: Fictional');
    const installed = join(root, 'managed-tool', 'mixed-demo');
    mkdirSync(join(root, 'managed-tool'));
    symlinkSync(source, installed);
    writeManifest(env, sources, `  mixed-demo:\n    source: ${source}\n    install:\n      managed-tool:\n        path: ${installed}\n        mode: symlink\n      external-tool:\n        path: ${join(root, 'vendor-collection')}\n        mode: external-managed\n`);

    const result = listIssues(env);
    expect(result.ok && result.value).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'content', code: 'frontmatter', skill: 'mixed-demo' }),
    ]));
  });

  it.each(['missing', 'collection', 'invalid'])('only records external-managed entries with %s sources', (kind) => {
    const { env, sources, root } = fixture();
    const source = join(sources, 'external-demo');
    if (kind === 'collection') skill(source, 'nested-demo');
    if (kind === 'invalid') skill(sources, 'external-demo', 'name: INVALID\ndescription: ""');
    writeManifest(env, sources, `  external-demo:\n    source: ${source}\n    install:\n      vendor-tool:\n        path: ${join(root, 'vendor-collection')}\n        mode: external-managed\n`);

    const result = listSkills(env);
    expect(result.ok && result.value.skills[0]).toMatchObject({
      name: 'external-demo', targets: [{ tool: 'vendor-tool', status: 'external' }], contentIssues: [],
    });
    expect(result.ok && result.value.skills[0]?.frontmatter).toBeUndefined();
    expect(listIssues(env)).toEqual({ ok: true, value: [] });
  });

  it('shows registered and unregistered disabled entries without listing them as issues', () => {
    const { env, sources, control } = fixture();
    const source = skill(sources, 'disabled-demo');
    const disabledRoot = join(control, 'disabled', 'codex');
    mkdirSync(disabledRoot, { recursive: true });
    symlinkSync(source, join(disabledRoot, 'disabled-demo'));
    symlinkSync(join(sources, 'removed-demo'), join(disabledRoot, 'orphan-demo'));
    writeManifest(env, sources, `  disabled-demo:\n    source: ${source}\n    install:\n      codex:\n        path: ${join(env.toolInstallDirs.codex!, 'disabled-demo')}\n        mode: pending\n`);

    const result = listSkills(env);
    expect(result.ok && result.value.skills).toMatchObject([
      { name: 'disabled-demo', targets: [{ status: 'disabled', path: join(disabledRoot, 'disabled-demo') }] },
      { name: 'orphan-demo', targets: [{ status: 'disabled', path: join(disabledRoot, 'orphan-demo') }] },
    ]);
    expect(listIssues(env)).toEqual({ ok: true, value: [] });
  });

  it('discovers only visible skill directories, directory links and Markdown files in installation roots', () => {
    const { env, sources, root, control } = fixture();
    const installs = join(root, 'fictional-tool');
    const scanEnv = { ...env, toolInstallDirs: { novel: installs } };
    mkdirSync(installs);
    const source = skill(sources, 'linked-demo');
    skill(installs, 'visible-demo');
    mkdirSync(join(installs, 'directory.md'));
    symlinkSync(source, join(installs, 'linked-demo'));
    writeFileSync(join(installs, 'flat-demo.md'), '---\nname: flat-demo\ndescription: Fictional\n---\n');
    symlinkSync(join(installs, 'flat-demo.md'), join(installs, 'linked-flat.md'));
    skill(installs, '.hidden-directory', 'name: hidden-demo\ndescription: Fictional');
    symlinkSync(source, join(installs, '.hidden-link'));
    symlinkSync(join(sources, 'gone'), join(installs, '.hidden-broken'));
    writeFileSync(join(installs, '.hidden.md'), '---\nname: hidden-flat\ndescription: Fictional\n---\n');
    writeFileSync(join(installs, '.DS_Store'), 'Fictional metadata');
    writeFileSync(join(installs, 'readme.txt'), '---\nname: readme\ndescription: Fictional\n---\n');
    symlinkSync(join(installs, 'readme.txt'), join(installs, 'linked-readme'));
    skill(join(control, 'disabled', '.hidden-tool'), 'hidden-disabled');
    writeManifest(env, sources, '  {}\n');

    const result = listSkills(scanEnv);
    if (!result.ok) throw new Error(result.error.message);
    expect(result.value.skills.map((item) => item.name)).toEqual([
      'directory.md', 'flat-demo', 'linked-demo', 'linked-flat', 'visible-demo',
    ]);
  });

  it('keeps broken registered and unregistered links visible when scanning installations', () => {
    const { env, sources } = fixture();
    const installs = env.toolInstallDirs.codex!;
    mkdirSync(installs, { recursive: true });
    const source = skill(sources, 'registered-demo');
    const other = skill(sources, 'other-demo');
    symlinkSync(join(sources, 'gone'), join(installs, 'registered-demo'));
    symlinkSync(other, join(installs, 'wrong-demo'));
    symlinkSync(join(sources, 'gone'), join(installs, 'loose-demo'));
    symlinkSync(join(sources, 'gone.md'), join(installs, 'loose-flat.md'));
    symlinkSync('loop-demo', join(installs, 'loop-demo'));
    writeManifest(env, sources, `  registered-demo:\n    source: ${source}\n    install:\n      codex:\n        path: ${join(installs, 'registered-demo')}\n        mode: symlink\n  wrong-demo:\n    source: ${source}\n    install:\n      codex:\n        path: ${join(installs, 'wrong-demo')}\n        mode: symlink\n`);

    const result = listIssues(env);
    if (!result.ok) throw new Error(result.error.message);
    expect(result.value).toEqual(expect.arrayContaining([
      expect.objectContaining({ skill: 'registered-demo', code: 'broken', path: join(installs, 'registered-demo') }),
      expect.objectContaining({ skill: 'wrong-demo', code: 'broken', path: join(installs, 'wrong-demo') }),
      expect.objectContaining({ skill: 'loose-demo', code: 'unmanaged', path: join(installs, 'loose-demo') }),
      expect.objectContaining({ skill: 'loose-flat', code: 'unmanaged', path: join(installs, 'loose-flat.md') }),
      expect.objectContaining({ skill: 'loop-demo', code: 'unmanaged', path: join(installs, 'loop-demo') }),
    ]));
  });

  it('preserves the .md suffix in unmanaged flat installation and issue paths', () => {
    const { env, sources } = fixture();
    const installs = env.toolInstallDirs.claude!;
    mkdirSync(installs, { recursive: true });
    const path = join(installs, 'flat-demo.md');
    writeFileSync(path, '---\nname: flat-demo\ndescription: Fictional\n---\n');
    writeManifest(env, sources, '  {}\n');

    const result = listSkills(env);
    expect(result.ok && result.value.skills).toMatchObject([
      { name: 'flat-demo', targets: [{ tool: 'claude', status: 'unmanaged', path }] },
    ]);
    expect(listIssues(env)).toMatchObject({ ok: true, value: [{ skill: 'flat-demo', path }] });
  });

  it('includes manifest notes in summaries and details and empty notes for unmanaged entries', () => {
    const { env, sources } = fixture();
    const source = skill(sources, 'noted-demo');
    const plainSource = skill(sources, 'plain-demo');
    mkdirSync(join(env.toolInstallDirs.codex!, 'loose-demo'), { recursive: true });
    writeManifest(env, sources, `  noted-demo:\n    source: ${source}\n    notes:\n      - Fictional first note.\n      - Fictional second note.\n  plain-demo:\n    source: ${plainSource}\n`);

    const result = listSkills(env);
    expect(result.ok && result.value.skills).toMatchObject([
      { name: 'loose-demo', notes: [] },
      { name: 'noted-demo', notes: ['Fictional first note.', 'Fictional second note.'] },
      { name: 'plain-demo', notes: [] },
    ]);
    const detail = getSkill(env, 'noted-demo');
    expect(detail.ok && detail.value).toMatchObject({ notes: ['Fictional first note.', 'Fictional second note.'] });
  });

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
  it.each(['custom', 'user-dsh', 'user-agents'])('ignores all hidden entries and non-Markdown files in %s discovery', (kind) => {
    const { env, sources, root } = fixture();
    const scanRoot = kind === 'custom' ? join(root, 'custom') : join(kind === 'user-dsh' ? env.dshHome : env.agentsHome, 'skills');
    const scanEnv = { ...env, customSkillDirs: kind === 'custom' ? [scanRoot] : [] };
    mkdirSync(scanRoot, { recursive: true });
    skill(scanRoot, 'visible-demo');
    symlinkSync(skill(sources, 'linked-demo'), join(scanRoot, 'linked-demo'));
    writeFileSync(join(scanRoot, 'flat-demo.md'), '---\nname: flat-demo\ndescription: Fictional\n---\n');
    const linkedFile = join(root, 'linked-file.md');
    writeFileSync(linkedFile, '---\nname: linked-flat\ndescription: Fictional\n---\n');
    symlinkSync(linkedFile, join(scanRoot, 'linked-flat.md'));
    skill(scanRoot, '.hidden-directory', 'name: hidden-directory\ndescription: Fictional');
    symlinkSync(skill(sources, 'hidden-link'), join(scanRoot, '.hidden-link'));
    writeFileSync(join(scanRoot, '.hidden.md'), '---\nname: hidden-flat\ndescription: Fictional\n---\n');
    writeFileSync(join(scanRoot, '.invalid.md'), 'Invalid hidden frontmatter');
    writeFileSync(join(scanRoot, '.DS_Store'), 'Fictional metadata');
    writeFileSync(join(scanRoot, 'readme.txt'), '---\nname: readme\ndescription: Fictional\n---\n');
    symlinkSync(linkedFile, join(scanRoot, 'linked-readme.txt'));
    symlinkSync(join(sources, 'gone'), join(scanRoot, 'broken-demo'));
    writeManifest(env, sources, '  {}\n');

    const result = listSkills(scanEnv);
    if (!result.ok) throw new Error(result.error.message);
    expect(result.value.dsh.loaded.map((item) => item.name)).toEqual(['flat-demo', 'linked-demo', 'linked-flat', 'visible-demo']);
    expect(result.value.dsh.issues).toEqual([]);
  });

  it.each(['disableModelInvocation', 'modelInvocable', 'userInvocable'])('rejects the legacy %s key and loads the valid lower-rank candidate', (key) => {
    const { env, sources } = fixture();
    const source = skill(sources, 'legacy-demo');
    const skillFile = join(source, 'SKILL.md');
    const dsh = join(env.dshHome, 'skills');
    mkdirSync(dsh, { recursive: true });
    symlinkSync(source, join(dsh, 'legacy-demo'));
    skill(join(env.agentsHome, 'skills'), 'legacy-demo');
    writeManifest(env, sources, `  legacy-demo:\n    source: ${source}\n`);

    for (const value of ['false', 'true', '0', 'null', '""']) {
      writeFileSync(skillFile, `---\nname: legacy-demo\ndescription: Fictional\n${key}: ${value}\ndisable-model-invocation: false\nuser-invocable: true\n---\n`);
      const result = listSkills(env);
      if (!result.ok) throw new Error(result.error.message);
      expect(result.value.skills[0]?.contentIssues).toEqual(expect.arrayContaining([
        expect.objectContaining({ code: 'frontmatter', path: skillFile, message: expect.stringContaining(key) }),
      ]));
      expect(result.value.skills[0]?.frontmatter).toBeUndefined();
      expect(result.value.dsh.loaded).toMatchObject([{ name: 'legacy-demo', rank: 500, source: 'user-agents' }]);
      expect(result.value.dsh.overrides).toEqual([]);
      expect(result.value.dsh.issues).toEqual(expect.arrayContaining([
        expect.objectContaining({ code: 'frontmatter', message: expect.stringContaining(key) }),
      ]));
      const issues = listIssues(env);
      expect(issues.ok && issues.value).toEqual(expect.arrayContaining([
        expect.objectContaining({ kind: 'content', code: 'frontmatter' }),
        expect.objectContaining({ kind: 'dsh-content', code: 'frontmatter' }),
      ]));
    }
  });

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
