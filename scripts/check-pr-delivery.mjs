import { execFileSync } from 'node:child_process';

const repo = 'bluemanta/bluemanta-desktop';
const [prNumber, expectedArgument, ...extra] = process.argv.slice(2);
const result = { status: 'not-run', repo, problems: [] };

try {
  if (extra.length || (prNumber && !/^[1-9]\d*$/.test(prNumber))) {
    throw new Error('用法：node scripts/check-pr-delivery.mjs [PR号] [预期完整SHA]');
  }
  const expected = expectedArgument ?? execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  if (!/^[a-f0-9]{40}$/.test(expected)) throw new Error('预期提交必须是完整的40位SHA');
  result.expectedHead = expected;

  if (!expectedArgument) {
    const dirty = execFileSync('git', ['status', '--porcelain', '--untracked-files=all'], { encoding: 'utf8' }).trim();
    if (dirty) result.problems.push('工作区还有未提交文件，不能声明完整交付');
  }

  const fields = 'number,url,state,baseRefName,headRefName,headRefOid,isCrossRepository';
  let pr;
  if (prNumber) {
    pr = JSON.parse(execFileSync('gh', ['pr', 'view', prNumber, '--repo', repo, '--json', fields], { encoding: 'utf8' }));
  } else {
    const branch = execFileSync('git', ['branch', '--show-current'], { encoding: 'utf8' }).trim();
    if (!branch || branch === 'main') throw new Error('请在任务分支运行；独立验收可显式传入PR号与预期SHA');
    const prs = JSON.parse(execFileSync('gh', ['pr', 'list', '--repo', repo, '--state', 'open', '--head', branch, '--json', fields], { encoding: 'utf8' }));
    if (prs.length !== 1) {
      result.problems.push(`任务分支应有且仅有一个打开的PR，实际为${prs.length}`);
    } else {
      pr = prs[0];
    }
  }

  if (pr) {
    result.pr = pr;
    if (pr.state !== 'OPEN') result.problems.push('PR未处于打开状态');
    if (pr.baseRefName !== 'main') result.problems.push('PR目标分支不是main');
    if (pr.isCrossRepository) result.problems.push('PR分支不在本项目仓库');
    if (pr.headRefOid !== expected) result.problems.push('PR head与预期提交不一致，返工可能尚未推送');
    const refs = execFileSync('git', ['ls-remote', `https://github.com/${repo}.git`, `refs/heads/${pr.headRefName}`, `refs/pull/${pr.number}/head`], { encoding: 'utf8' });
    const remote = Object.fromEntries(refs.trim().split('\n').filter(Boolean).map(line => {
      const [sha, ref] = line.split('\t');
      return [ref, sha];
    }));
    result.remote = remote;
    if (remote[`refs/heads/${pr.headRefName}`] !== expected) result.problems.push('远端任务分支与预期提交不一致');
    if (remote[`refs/pull/${pr.number}/head`] !== expected) result.problems.push('远端PR引用与预期提交不一致');
  }

  result.status = result.problems.length ? 'failed' : 'verified';
  process.exitCode = result.problems.length ? 1 : 0;
} catch (error) {
  result.status = 'not-run';
  result.problems.push(error.message);
  process.exitCode = 2;
}

console.log(JSON.stringify(result, null, 2));
