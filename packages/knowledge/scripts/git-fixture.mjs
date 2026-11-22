import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, writeFileSync, appendFileSync, renameSync, unlinkSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Require a fresh destination so this helper cannot reinitialize an existing library.
export function createGitFixture(destination) {
  const root = resolve(destination);
  mkdirSync(dirname(root), { recursive: true });
  mkdirSync(root);
  cpSync(fileURLToPath(new URL('../fixtures/home/Documents/PersonalOS', import.meta.url)), root, { recursive: true });
  const env = { PATH: process.env.PATH, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_AUTHOR_NAME: '纸星', GIT_AUTHOR_EMAIL: 'paper@example.invalid',
    GIT_COMMITTER_NAME: '纸星', GIT_COMMITTER_EMAIL: 'paper@example.invalid' };
  const git = (...args) => execFileSync('git', args, { cwd: root, env, stdio: 'pipe' });
  git('init', '--separate-git-dir=' + join(root, '.gitdata.nosync'), root);
  writeFileSync(join(root, '.gitdata.nosync/info/exclude'), '/.gitdata.nosync/\n');
  let ordinal = 0;
  function commit(title, body) {
    const date = new Date(Date.UTC(2026, 9, 20 + ordinal++, 2)).toISOString();
    env.GIT_AUTHOR_DATE = env.GIT_COMMITTER_DATE = date;
    git('add', '--all', '--', './');
    git('commit', '-m', title, ...(body ? ['-m', body] : []));
  }
  const write = (p, content) => writeFileSync(join(root, p), content);
  const add = (p, content) => appendFileSync(join(root, p), content);
  const move = (a, b) => renameSync(join(root, a), join(root, b));
  commit('建立纸星资料库');
  for (let i = 1; i <= 23; i++) {
    add('领域/写作/纸样.md', '纸样 ' + i + '\n');
    commit('[写作] 记录纸样 ' + i);
  }
  add('领域/工作/状态.md', '\n纸桥实验记录\n'); add('日志/2026-11.md', '\n纸桥实验完成\n');
  commit('[工作] 整理实验', '保留第一版观察。\n下次更换纸张。');
  for (const domain of ['工作','写作','技术']) write('领域/' + domain + '/纸桥.md', domain + '记录\n');
  commit('阶段 2：联查纸桥');
  move('领域/写作/纸桥.md','领域/写作/纸岸.md'); commit('调整中文文件名');
  unlinkSync(join(root,'领域/工作/纸桥.md')); commit('移除旧纸桥');
  write('.claude/纸星.md','虚构草稿\n'); commit('准备草稿');
  move('.claude/纸星.md','领域/技术/纸星.md'); commit('公开纸星');
  move('领域/技术/纸星.md','.claude/归档.md'); commit('收起纸星');
  move('.claude/归档.md','.claude/封存.md'); commit('封存草稿');
  write('蓝图/纸纹.bin',Buffer.from([0,128,255])); commit('[蓝图] 保存纸纹');
  for (let i=1;i<=7;i++) write('领域/技术/样本' + i + '.md', Array.from({length:610},(_,j)=>'虚构观测 '+i+'-'+j+'\n').join(''));
  commit('[技术] 导入七组观测');
  add('领域/写作/纸样.md','还在观察\n'); write('我/纸船.md','待折叠\n');
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (!process.argv[2]) throw new Error('需要新的目标目录');
  createGitFixture(process.argv[2]);
}
