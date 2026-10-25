import { mkdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { defaultSkillEnv, type SkillEnv } from '@bluemanta/skills';
import { openCore, type Core } from '@bluemanta/core';
import { afterEach, describe, expect, it } from 'vitest';
import type { ApiFailure, SkillDetailResponse, SkillIssuesResponse, SkillListResponse } from '../src/api-types.js';
import { createApp } from '../src/app.js';
import { removeTempDirs, tempDir } from './helpers.js';

const PORT = 4310;
const TOKEN = '12'.repeat(32);
const HOST = `127.0.0.1:${PORT}`;
const cores: Core[] = [];

afterEach(() => {
  while (cores.length) cores.pop()?.close();
  removeTempDirs();
});

function fixture(): { home: string; env: SkillEnv; call: (path: string, token?: boolean, method?: string) => Promise<Response> } {
  const home = tempDir();
  const dataDir = tempDir();
  const core = openCore({ dataDir });
  cores.push(core);
  const env = defaultSkillEnv({
    home,
    dshHome: join(home, '.dsh'),
    agentsHome: join(home, '.agents'),
    toolInstallDirs: { codex: join(home, '.codex', 'skills'), claude: join(home, '.claude', 'skills') },
  });
  mkdirSync(join(home, 'Documents', 'AgentSkills'), { recursive: true });
  const app = createApp({ core, token: TOKEN, port: PORT, webDir: null, skillEnv: env });
  return {
    home,
    env,
    call: async (path, token = true, method = 'GET') => await app.request(`http://${HOST}${path}`, {
      method,
      headers: { host: HOST, ...(token ? { authorization: `Bearer ${TOKEN}` } : {}) },
    }),
  };
}

function prepareSkill(home: string, env: SkillEnv): void {
  const source = join(home, 'Documents', 'AgentSkillRepos', 'demo-writer');
  mkdirSync(source, { recursive: true });
  writeFileSync(join(source, 'SKILL.md'), `---\nname: demo-writer\ndescription: Fictional skill in ${home}/Documents\n---\n# Fictional\nRead ${home}/Documents only.\n`);
  writeFileSync(join(source, 'notes.txt'), 'fiction');
  mkdirSync(env.toolInstallDirs.claude!, { recursive: true });
  symlinkSync(source, join(env.toolInstallDirs.claude!, 'demo-writer'));
  mkdirSync(join(env.toolInstallDirs.codex!, 'loose-demo'), { recursive: true });
  mkdirSync(join(env.agentsHome, 'skills'), { recursive: true });
  symlinkSync(source, join(env.agentsHome, 'skills', 'demo-writer'));
  writeFileSync(env.manifestPath, `schema_version: 1
locations:
  skill_sources_root: ${join(home, 'Documents', 'AgentSkillRepos')}
skills:
  demo-writer:
    display_name: Demo Writer
    visibility: private
    lifecycle: stable
    scope: global
    source: ${source}
    notes:
      - Fictional note at ${home}/Documents
    install:
      codex:
        path: ${join(env.toolInstallDirs.codex!, 'demo-writer')}
        mode: symlink
      claude:
        path: ${join(env.toolInstallDirs.claude!, 'demo-writer')}
        mode: symlink
`);
}

async function body<T>(response: Response): Promise<T> {
  return await response.json() as T;
}

describe('Skill 台只读接口', () => {
  it('三条接口都需要口令，且只接受 GET', async () => {
    const h = fixture();
    for (const path of ['/api/v1/skills', '/api/v1/skills/demo-writer', '/api/v1/skill-issues']) {
      const unauthorized = await h.call(path, false);
      expect(unauthorized.status).toBe(401);
      expect(await body<ApiFailure>(unauthorized)).toMatchObject({ ok: false, code: 'unauthorized' });
      const wrongMethod = await h.call(path, true, 'POST');
      expect(wrongMethod.status).toBe(405);
      expect(await body<ApiFailure>(wrongMethod)).toMatchObject({ ok: false, code: 'method_not_allowed' });
    }
  });

  it('返回摘要、详情、unmanaged、dsh 汇总和分组问题，不泄露 home 绝对路径', async () => {
    const h = fixture();
    prepareSkill(h.home, h.env);

    const listResponse = await h.call('/api/v1/skills');
    expect(listResponse.status).toBe(200);
    const listText = await listResponse.clone().text();
    const list = await body<SkillListResponse>(listResponse);
    expect(list).toMatchObject({
      ok: true,
      count: 2,
      manifestPath: '~/Documents/AgentSkills/manifest.yaml',
      skills: expect.arrayContaining([
        expect.objectContaining({ name: 'demo-writer', displayName: 'Demo Writer', hasContentIssues: false }),
      ]),
      unmanaged: [expect.objectContaining({ name: 'loose-demo', managed: false })],
      dsh: { loaded: [expect.objectContaining({ name: 'demo-writer', path: '~/.agents/skills/demo-writer/SKILL.md' })] },
    });
    expect(listText).not.toContain(h.home);

    const detailResponse = await h.call('/api/v1/skills/demo-writer');
    const detailText = await detailResponse.clone().text();
    const detail = await body<SkillDetailResponse>(detailResponse);
    expect(detail.skill).toMatchObject({
      name: 'demo-writer',
      notes: ['Fictional note at ~/Documents'],
      body: expect.stringContaining('Read ~/Documents only.'),
      skillFile: '~/Documents/AgentSkillRepos/demo-writer/SKILL.md',
      files: ['SKILL.md', 'notes.txt'],
      frontmatter: { description: 'Fictional skill in ~/Documents' },
    });
    expect(detailText).not.toContain(h.home);

    const issuesResponse = await h.call('/api/v1/skill-issues');
    const issuesText = await issuesResponse.clone().text();
    const issues = await body<SkillIssuesResponse>(issuesResponse);
    expect(issues).toMatchObject({
      count: 2,
      groups: expect.arrayContaining([
        expect.objectContaining({ code: 'missing', issues: [expect.objectContaining({ skill: 'demo-writer', command: expect.stringContaining('install --name demo-writer') })] }),
        expect.objectContaining({ code: 'unmanaged', issues: [expect.objectContaining({ skill: 'loose-demo' })] }),
      ]),
    });
    expect(issuesText).not.toContain(h.home);
  });

  it('每次请求重读文件，并区分非法名称和不存在的 skill', async () => {
    const h = fixture();
    prepareSkill(h.home, h.env);
    expect((await body<SkillDetailResponse>(await h.call('/api/v1/skills/demo-writer'))).skill.notes).toEqual(['Fictional note at ~/Documents']);
    const manifest = String.raw`schema_version: 1
skills:
  demo-writer:
    source: ${h.home}/Documents/AgentSkillRepos/demo-writer
    notes: [Changed]
`;
    writeFileSync(h.env.manifestPath, manifest);
    expect((await body<SkillDetailResponse>(await h.call('/api/v1/skills/demo-writer'))).skill.notes).toEqual(['Changed']);

    expect((await h.call('/api/v1/skills/Bad_Name')).status).toBe(400);
    expect(await body<ApiFailure>(await h.call('/api/v1/skills/Bad_Name'))).toMatchObject({ code: 'invalid_input' });
    expect((await h.call('/api/v1/skills/not-registered')).status).toBe(404);
    expect(await body<ApiFailure>(await h.call('/api/v1/skills/not-registered'))).toMatchObject({ code: 'not_found' });
  });

  it('manifest 缺失和解析失败返回带缩写路径的结构化错误', async () => {
    const h = fixture();
    const missing = await h.call('/api/v1/skills');
    expect(missing.status).toBe(404);
    const missingText = await missing.clone().text();
    expect(await body<ApiFailure>(missing)).toMatchObject({
      code: 'skill_manifest_missing',
      path: '~/Documents/AgentSkills/manifest.yaml',
    });
    expect(missingText).not.toContain(h.home);

    writeFileSync(h.env.manifestPath, 'skills:\n  broken: [\n');
    const malformed = await h.call('/api/v1/skill-issues');
    expect(malformed.status).toBe(422);
    const malformedText = await malformed.clone().text();
    expect(await body<ApiFailure>(malformed)).toMatchObject({
      code: 'skill_manifest_parse_error',
      path: '~/Documents/AgentSkills/manifest.yaml',
      line: expect.any(Number),
      reason: expect.any(String),
    });
    expect(malformedText).not.toContain(h.home);
  });
});
