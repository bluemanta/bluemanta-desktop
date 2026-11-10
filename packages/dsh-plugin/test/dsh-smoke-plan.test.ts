import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_DSH_SMOKE_BIN,
  DSH_ENGINE_RANGE,
  RESERVED_SMOKE_PORTS,
  SMOKE_PANELS,
  allChecksPassed,
  assessFrame,
  choosePort,
  formatCheck,
  hasIncompatibleWarning,
  incompatibleExcerpt,
  knowledgeFixtureHome,
  missingBinMessage,
  parseHostVersion,
  parseSmokeArgs,
  parseWebUrls,
  pluginAddArgs,
  profileCreateArgs,
  resolveSmokeBin,
  serveArgs,
  smokeEnv,
  webUrlForPort,
} from '../src/dsh-smoke-plan.js';

const repoRoot = fileURLToPath(new URL('../../..', import.meta.url));

describe('dsh:smoke 计划', () => {
  it('参数、默认 dsh 路径和保留端口', () => {
    expect(parseSmokeArgs([])).toEqual({ keep: false, unknown: [] });
    expect(parseSmokeArgs(['--keep'])).toEqual({ keep: true, unknown: [] });
    expect(parseSmokeArgs(['--', '--keep'])).toEqual({ keep: true, unknown: [] });
    expect(parseSmokeArgs(['--nope'])).toEqual({ keep: false, unknown: ['--nope'] });
    expect(resolveSmokeBin(undefined)).toBe(DEFAULT_DSH_SMOKE_BIN);
    expect(resolveSmokeBin('  ')).toBe(DEFAULT_DSH_SMOKE_BIN);
    expect(resolveSmokeBin('/tmp/dsh')).toBe('/tmp/dsh');
    expect(DEFAULT_DSH_SMOKE_BIN).toBe('/Applications/DeepSeek Harness.app/Contents/Resources/runtime/cli/bin/dsh');
    expect(missingBinMessage('/tmp/dsh')).toContain('DSH_SMOKE_BIN');
    expect(RESERVED_SMOKE_PORTS).toEqual([4310, 4311, 4312]);
    expect(choosePort([4310, 4311, 4312, 3092], [])).toBe(3092);
    expect(choosePort([4310, 4311, 4312], [])).toBeNull();
    expect(choosePort([3092, 4400], [3092])).toBe(4400);
    expect(choosePort([0, 70000, 1.5], [])).toBeNull();
  });

  it('识别拒载提示、宿主版本和带 token 的网页地址', () => {
    const line = 'Plugin @bluemanta/dsh-plugin@0.0.0 is incompatible with dsh 0.2.2-rc.1: requirements {"engines.dsh":"0.2.1-rc.2"}';
    expect(hasIncompatibleWarning(line)).toBe(true);
    expect(hasIncompatibleWarning('is\nincompatible with dsh 0.2.2-rc.1')).toBe(true);
    expect(hasIncompatibleWarning('plugin added')).toBe(false);
    expect(incompatibleExcerpt(`noise\n${line}\nmore`)).toContain('is incompatible with dsh');
    expect(parseHostVersion('0.2.2-rc.1\n')).toBe('0.2.2-rc.1');
    expect(parseHostVersion('dsh version 0.2.2-rc.1')).toBe('0.2.2-rc.1');
    const url = 'dsh web: http://127.0.0.1:34521/?token=abc.def';
    expect(parseWebUrls(url)).toEqual(['http://127.0.0.1:34521/?token=abc.def']);
    expect(webUrlForPort(`${url}\nhttp://127.0.0.1:1/?token=no`, 34521)).toBe('http://127.0.0.1:34521/?token=abc.def');
    expect(webUrlForPort(url, 3092)).toBe('');
  });

  it('主区 iframe 要带 data-html-preview、非空 name，并指向本次端口', () => {
    expect(SMOKE_PANELS.map((panel) => [panel.label, panel.frameName, panel.readyName])).toEqual([
      ['灵感台', 'bluemanta-ideas-main', '灵感清单'],
      ['知识台', 'bluemanta-knowledge-main', '主题清单'],
    ]);
    const src = 'http://127.0.0.1:34521/ideas?embed=main#token=abc';
    expect(assessFrame({ preview: true, name: 'bluemanta-ideas-main', src, serverPort: 34521 })).toEqual({ ok: true, reason: '' });
    expect(assessFrame({ preview: false, name: 'bluemanta-ideas-main', src, serverPort: 34521 }).ok).toBe(false);
    expect(assessFrame({ preview: true, name: '  ', src, serverPort: 34521 }).reason).toContain('name');
    expect(assessFrame({ preview: true, name: 'bluemanta-ideas-main', src, serverPort: 4310 }).reason).toContain('4310');
    expect(assessFrame({ preview: true, name: 'bluemanta-ideas-main', src: 'http://localhost:34521/ideas', serverPort: 34521 }).ok).toBe(true);
  });

  it('隔离环境覆盖用户的 DSH_HOME，知识库指向虚构夹具', () => {
    const env = smokeEnv(
      { DSH_HOME: '/Users/someone/.dsh', DSH_PROFILE: 'desktop', PATH: '/usr/bin', BLUEMANTA_SERVER_PORT: '4310' },
      { dshHome: '/tmp/smoke/home', dataDir: '/tmp/smoke/data', knowledgeHome: '/tmp/smoke/knowledge' },
      { serverPort: 34521 },
    );
    expect(env.DSH_HOME).toBe('/tmp/smoke/home');
    expect(env.DSH_PROFILE).toBeUndefined();
    expect(env.DSH_TELEMETRY_DISABLED).toBe('1');
    expect(env.BLUEMANTA_DATA_DIR).toBe('/tmp/smoke/data');
    expect(env.BLUEMANTA_KNOWLEDGE_HOME).toBe('/tmp/smoke/knowledge');
    expect(env.BLUEMANTA_SERVER_PORT).toBe('34521');
    expect(env.PATH).toBe('/usr/bin');
    expect(knowledgeFixtureHome('/repo')).toBe('/repo/packages/knowledge/fixtures/home');
    expect(profileCreateArgs()).toEqual(['--profile', 'bluemanta-smoke', '--from-default-profile', 'web', '--dump-config']);
    expect(pluginAddArgs()).toEqual(['plugin', '--profile', 'bluemanta-smoke', 'add', './packages/dsh-plugin']);
    expect(serveArgs('bluemanta-smoke', 34521)).toEqual(['--profile', 'bluemanta-smoke', '--port', '34521', '--no-open']);
  });

  it('三项检查都要 PASS 才算通过', () => {
    expect(formatCheck(1, true, '插件没有被拒载')).toBe('检查 1 PASS 插件没有被拒载');
    expect(formatCheck(1, false, '插件被拒载：一行')).toBe('检查 1 FAIL 插件被拒载：一行');
    expect(allChecksPassed([{ ok: true }, { ok: true }, { ok: true }])).toBe(true);
    expect(allChecksPassed([{ ok: true }, { ok: false }, { ok: true }])).toBe(false);
    expect(allChecksPassed([{ ok: true }])).toBe(false);
  });

  it('根脚本和说明写了自检入口、运行范围', () => {
    const rootPkg = JSON.parse(readFileSync(fileURLToPath(new URL('../../../package.json', import.meta.url)), 'utf8')) as {
      scripts?: Record<string, string>;
    };
    expect(rootPkg.scripts?.['dsh:smoke']).toBe('node packages/dsh-plugin/scripts/dsh-smoke.mjs');
    const readme = readFileSync(fileURLToPath(new URL('../README.md', import.meta.url)), 'utf8');
    expect(readme).toContain(DSH_ENGINE_RANGE);
    expect(readme).toContain('npm run dsh:smoke');
    expect(readme).toContain('DSH_SMOKE_BIN');
    expect(readme).toContain('--keep');
    expect(readme).toContain('灵感清单');
    expect(readme).toContain('主题清单');
  });

  it('找不到 dsh 或不认识参数时非 0 退出，不启动构建', () => {
    const script = fileURLToPath(new URL('../scripts/dsh-smoke.mjs', import.meta.url));
    const missing = spawnSync(process.execPath, [script], {
      cwd: repoRoot,
      env: { ...process.env, DSH_SMOKE_BIN: '/tmp/bluemanta-no-such-dsh' },
      encoding: 'utf8',
    });
    expect(missing.status).not.toBe(0);
    expect(missing.stderr).toContain('DSH_SMOKE_BIN');
    expect(missing.stdout).not.toContain('npm run build');

    const unknown = spawnSync(process.execPath, [script, '--nope'], {
      cwd: repoRoot,
      env: process.env,
      encoding: 'utf8',
    });
    expect(unknown.status).not.toBe(0);
    expect(unknown.stderr).toContain('不认识的参数');
  });

  it('detached 子进程是进程组组长，按组结束后进程不在', async () => {
    const child = spawn('sleep', ['30'], { detached: true, stdio: 'ignore' });
    try {
      expect(child.pid).toBeGreaterThan(0);
      const pgid = execFileSync('ps', ['-o', 'pgid=', '-p', String(child.pid)], { encoding: 'utf8' }).trim();
      expect(Number(pgid)).toBe(child.pid);
    } finally {
      if (child.pid) {
        try { process.kill(-child.pid, 'SIGTERM'); } catch { /* 已经退出。 */ }
      }
    }
    const gone = await new Promise<boolean>((resolve) => {
      if (child.exitCode !== null) resolve(true);
      else child.once('exit', () => resolve(true));
      setTimeout(() => resolve(child.exitCode !== null), 2000);
    });
    expect(gone).toBe(true);
  });
});
