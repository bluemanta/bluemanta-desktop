#!/usr/bin/env node
/**
 * 本机派活给 Codex（ADR 0017）。
 *
 *   node scripts/codex-worker.mjs run --task <名字> --cd <worktree> --spec <说明书相对路径>
 *   node scripts/codex-worker.mjs resume --run <运行目录> --message-file <返工说明>
 *
 * Codex 只改文件：不加载用户配置（去掉插件和 MCP），沙箱 workspace-write，不弹审批。
 * 运行记录写到仓库外的 ~/Developer/.codex-runs/<时间>-<任务>/。
 * 提交、推送、开 PR 由 Claude Code 在验收后完成。
 */
import { spawn, spawnSync } from 'node:child_process';
import { createWriteStream, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

const RUNS_ROOT = join(homedir(), 'Developer', '.codex-runs');
const MODEL = 'gpt-6.2-astra';
const EFFORT = 'xhigh';
const MAIN_BRANCHES = new Set(['main', 'master']);

function fail(message) {
  console.error(`codex-worker：${message}`);
  process.exit(2);
}

function parseArgs(argv) {
  const [command, ...rest] = argv;
  const options = {};
  for (let i = 0; i < rest.length; i += 2) {
    const key = rest[i];
    if (!key || !key.startsWith('--') || rest[i + 1] === undefined) fail(`参数不对：${rest.join(' ')}`);
    options[key.slice(2)] = rest[i + 1];
  }
  return { command, options };
}

function git(cwd, args) {
  const result = spawnSync('git', ['-C', cwd, ...args], { encoding: 'utf8' });
  if (result.status !== 0) fail(`git ${args.join(' ')} 失败：${result.stderr.trim()}`);
  return result.stdout;
}

/** 第 0 关：必须是独立 worktree、不在 main、开工前干净，这样跑完的 diff 全是 Codex 的。 */
function checkWorktree(cwd) {
  if (!existsSync(cwd)) fail(`目录不存在：${cwd}`);
  const top = git(cwd, ['rev-parse', '--show-toplevel']).trim();
  if (resolve(top) !== resolve(cwd)) fail(`--cd 要指向 worktree 根目录：${top}`);
  const commonDir = resolve(cwd, git(cwd, ['rev-parse', '--git-common-dir']).trim());
  const gitDir = resolve(cwd, git(cwd, ['rev-parse', '--git-dir']).trim());
  if (commonDir === gitDir) fail('这是主检出，不是独立 worktree。先 git worktree add 再派活。');
  const branch = git(cwd, ['branch', '--show-current']).trim();
  if (!branch || MAIN_BRANCHES.has(branch)) fail(`不能在 ${branch || '游离 HEAD'} 上派活`);
  const dirty = git(cwd, ['status', '--porcelain']).trim();
  if (dirty) fail(`worktree 有未提交改动，先提交或清理：\n${dirty}`);
  return branch;
}

function preamble(spec) {
  return [
    '你是本仓库的实现者，Claude Code 负责验收。',
    `先读 AGENTS.md 和说明书 ${spec}，只做说明书里的事。`,
    '',
    '规则：',
    '1. 不提交、不推送、不建分支、不运行 npm install / npm ci（依赖已装好），不联网。',
    '2. 只改说明书「允许修改的路径」里的文件。不读写真实数据目录、~/.dsh、其他仓库。',
    '3. 说明书里「接口（已定死）」的名字和签名不要改。',
    '4. 说明书不清楚、和 ADR 冲突、或必须越界才能完成时，停下，不要猜。在最后的报告开头写「停工问题：」并说明。',
    '5. 每条验收如实标 verified / failed / not-run，写出实际命令和结果摘要。没跑过的不能写通过。',
    '6. 结束时最后一条消息就是报告，按说明书「交付物」的要求写，用中文。',
  ].join('\n');
}

function codexArgs(cwd, reportPath) {
  return [
    '--ignore-user-config',
    '-m', MODEL,
    '-c', `model_reasoning_effort="${EFFORT}"`,
    '-c', 'approval_policy="never"',
    '-s', 'workspace-write',
    '-C', cwd,
    '--json',
    '-o', reportPath,
  ];
}

function sessionIdFrom(eventsPath) {
  if (!existsSync(eventsPath)) return '';
  for (const line of readFileSync(eventsPath, 'utf8').split('\n')) {
    try {
      const event = JSON.parse(line);
      const id = event.thread_id || event.session_id || (event.msg && event.msg.session_id);
      if (typeof id === 'string' && id) return id;
    } catch {
      // 非 JSON 行忽略。
    }
  }
  return '';
}

/** 已跟踪文件的 diff 加上新文件全文，不动暂存区。 */
function writeDiff(cwd, path) {
  let patch = git(cwd, ['diff']);
  const untracked = git(cwd, ['ls-files', '--others', '--exclude-standard']).split('\n').filter(Boolean);
  for (const file of untracked) {
    const result = spawnSync('git', ['-C', cwd, 'diff', '--no-index', '--', '/dev/null', file], { encoding: 'utf8' });
    patch += result.stdout;
  }
  writeFileSync(path, patch);
  return git(cwd, ['status', '--porcelain']);
}

function runCodex(args, prompt, runDir, cwd, round) {
  const suffix = round === 0 ? '' : `-r${round}`;
  const eventsPath = join(runDir, `events${suffix}.jsonl`);
  const reportPath = join(runDir, `report${suffix}.md`);
  const events = createWriteStream(eventsPath);
  const stderr = createWriteStream(join(runDir, `stderr${suffix}.log`));
  const started = Date.now();
  const child = spawn('codex', [...args(reportPath), prompt], { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
  child.stdout.pipe(events);
  child.stderr.pipe(stderr);
  const stop = () => child.kill('SIGTERM');
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
  child.on('exit', (code, signal) => {
    events.end();
    stderr.end();
    const minutes = ((Date.now() - started) / 60000).toFixed(1);
    const sessionPath = join(runDir, 'session-id');
    const session = sessionIdFrom(eventsPath) || (existsSync(sessionPath) ? readFileSync(sessionPath, 'utf8').trim() : '');
    if (session) writeFileSync(sessionPath, session + '\n');
    const status = writeDiff(cwd, join(runDir, `diff${suffix}.patch`));
    console.log(`codex 退出：${signal || code}，用时 ${minutes} 分钟`);
    console.log(`会话：${session || '未找到'}`);
    console.log(`报告：${reportPath}`);
    console.log(`改动：\n${status || '（无）'}`);
    process.exit(code ?? 1);
  });
}

const { command, options } = parseArgs(process.argv.slice(2));

if (command === 'run') {
  const { task, cd, spec } = options;
  if (!task || !cd || !spec) fail('run 需要 --task --cd --spec');
  if (!/^[a-z0-9][a-z0-9-]*$/.test(task)) fail('任务名只用小写字母、数字和连字符');
  const cwd = resolve(cd);
  const branch = checkWorktree(cwd);
  if (!existsSync(join(cwd, spec))) fail(`说明书不在 worktree 里：${spec}`);
  const stamp = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '');
  const runDir = join(RUNS_ROOT, `${stamp}-${task}`);
  mkdirSync(runDir, { recursive: true });
  const prompt = preamble(spec);
  writeFileSync(join(runDir, 'prompt.md'), prompt + '\n');
  writeFileSync(join(runDir, 'meta.json'), JSON.stringify({ task, cwd, spec, branch, base: git(cwd, ['rev-parse', 'HEAD']).trim(), model: MODEL, effort: EFFORT }, null, 2) + '\n');
  console.log(`运行目录：${runDir}`);
  runCodex((report) => ['exec', ...codexArgs(cwd, report)], prompt, runDir, cwd, 0);
} else if (command === 'resume') {
  const { run, 'message-file': messageFile } = options;
  if (!run || !messageFile) fail('resume 需要 --run --message-file');
  const runDir = resolve(run);
  const meta = JSON.parse(readFileSync(join(runDir, 'meta.json'), 'utf8'));
  const session = readFileSync(join(runDir, 'session-id'), 'utf8').trim();
  const message = readFileSync(resolve(messageFile), 'utf8');
  const round = (meta.rounds || 0) + 1;
  if (round > 2) fail('已经返工两轮，按 ADR 0017 停下，由 Claude Code 接手或找 Chris。');
  meta.rounds = round;
  writeFileSync(join(runDir, 'meta.json'), JSON.stringify(meta, null, 2) + '\n');
  writeFileSync(join(runDir, `prompt-r${round}.md`), message);
  // resume 不接受 -s / -C，沙箱和审批用 -c 传；工作目录由 spawn 的 cwd 决定。
  const args = (report) => [
    'exec', 'resume', '--ignore-user-config',
    '-m', MODEL,
    '-c', `model_reasoning_effort="${EFFORT}"`,
    '-c', 'approval_policy="never"',
    '-c', 'sandbox_mode="workspace-write"',
    '--json', '-o', report,
    session,
  ];
  runCodex(args, message, runDir, meta.cwd, round);
} else {
  fail('用法：run --task --cd --spec ｜ resume --run --message-file');
}
