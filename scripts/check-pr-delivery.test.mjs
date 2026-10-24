import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const script = fileURLToPath(new URL('./check-pr-delivery.mjs', import.meta.url));
const sha = 'a'.repeat(40);
const other = 'b'.repeat(40);
const pr = {
  number: 21,
  url: 'https://github.com/bluemanta/bluemanta-desktop/pull/21',
  state: 'OPEN',
  baseRefName: 'main',
  headRefName: 'codex/example',
  headRefOid: sha,
  isCrossRepository: false,
};

const scenarios = [
  { name: '当前任务提交在PR和远端两个引用中一致', status: 'verified', exit: 0 },
  { name: '未开PR', prs: [], status: 'failed', exit: 1, problem: '实际为0' },
  { name: '同一分支出现多个PR', prs: [pr, pr], status: 'failed', exit: 1, problem: '实际为2' },
  { name: '工作区还有未交付的改动', dirty: ' M example.txt', status: 'failed', exit: 1, problem: '未提交文件' },
  { name: '返工只留在本机', pr: { ...pr, headRefOid: other }, remoteSha: other, status: 'failed', exit: 1, problem: '返工可能尚未推送' },
  { name: '查询中远端分支发生变化', remoteSha: other, status: 'failed', exit: 1, problem: '远端任务分支' },
  { name: '远端PR引用缺失', noPullRef: true, status: 'failed', exit: 1, problem: '远端PR引用' },
  { name: 'PR目标错误', pr: { ...pr, baseRefName: 'develop' }, status: 'failed', exit: 1, problem: '目标分支' },
  { name: 'PR已经关闭', pr: { ...pr, state: 'CLOSED' }, status: 'failed', exit: 1, problem: '打开状态' },
  { name: 'PR来源仓库错误', pr: { ...pr, isCrossRepository: true }, status: 'failed', exit: 1, problem: '不在本项目仓库' },
  { name: 'GitHub无法连接', offline: true, status: 'not-run', exit: 2, problem: 'network unavailable' },
  { name: '远端引用无法连接', remoteOffline: true, status: 'not-run', exit: 2, problem: 'remote unavailable' },
  { name: 'Git配置隐藏未跟踪文件时仍阻止漏交', realUntracked: true, status: 'failed', exit: 1, problem: '未提交文件' },
  { name: '拒绝不完整的预期SHA', args: ['21', 'abc1234'], status: 'not-run', exit: 2, problem: '40位SHA' },
  { name: '独立验收显式指定完整SHA', args: ['21', sha], dirty: ' M unrelated.txt', status: 'verified', exit: 0 },
];

for (const scenario of scenarios) {
  test(scenario.name, () => {
    const root = mkdtempSync(join(tmpdir(), 'bm-pr-check-'));
    try {
      const bin = join(root, 'bin');
      mkdirSync(bin);
      const fixture = { pr, sha, ...scenario };
      if (scenario.realUntracked) {
        fixture.git = execFileSync('which', ['git'], { encoding: 'utf8' }).trim();
        fixture.directory = join(root, 'work');
        execFileSync(fixture.git, ['init', '--quiet', fixture.directory]);
        execFileSync(fixture.git, ['-C', fixture.directory, 'config', 'status.showUntrackedFiles', 'no']);
        writeFileSync(join(fixture.directory, 'pending.txt'), 'uncommitted fixture');
      }
      writeFileSync(join(bin, 'gh'), `#!${process.execPath}\nconst f = JSON.parse(process.env.BM_PR_FIXTURE);\nif (f.offline) { console.error('network unavailable'); process.exit(1); }\nconsole.log(JSON.stringify(process.argv.includes('list') ? (f.prs ?? [f.pr]) : f.pr));\n`, { mode: 0o755 });
      writeFileSync(join(bin, 'git'), `#!${process.execPath}\nconst f = JSON.parse(process.env.BM_PR_FIXTURE);\nconst command = process.argv[2];\nif (command === 'rev-parse') console.log(f.sha);\nelse if (command === 'status') {\n  console.log(f.realUntracked ? require('node:child_process').execFileSync(f.git, process.argv.slice(2), {cwd: f.directory, encoding: 'utf8'}) : (f.dirty ?? ''));\n}\nelse if (command === 'branch') console.log(f.pr.headRefName);\nelse if (command === 'ls-remote') {\n  if (f.remoteOffline) { console.error('remote unavailable'); process.exit(1); }\n  console.log((f.remoteSha ?? f.sha) + '\\trefs/heads/' + f.pr.headRefName);\n  if (!f.noPullRef) console.log((f.remoteSha ?? f.sha) + '\\trefs/pull/' + f.pr.number + '/head');\n} else { console.error('unexpected git command'); process.exit(1); }\n`, { mode: 0o755 });
      const run = spawnSync(process.execPath, [script, ...(scenario.args ?? [])], {
        cwd: root,
        encoding: 'utf8',
        env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, BM_PR_FIXTURE: JSON.stringify(fixture) },
      });
      assert.equal(run.status, scenario.exit, run.stderr);
      const report = JSON.parse(run.stdout);
      assert.equal(report.status, scenario.status);
      if (scenario.problem) assert.ok(report.problems.some(problem => problem.includes(scenario.problem)), run.stdout);
      if (scenario.status === 'verified') assert.equal(report.expectedHead, report.pr.headRefOid);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
}
