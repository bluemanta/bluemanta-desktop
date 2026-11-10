#!/usr/bin/env node
/**
 * Desktop 自动升级后的自检。
 *
 * 用隔离的 DSH_HOME、虚构灵感数据和虚构知识库启动 dsh，确认插件没有被拒载，
 * 左侧栏能打开灵感台和知识台。不读写 ~/.dsh，也不占用 4310、4311、4312。
 * 结束时（成功、失败、超时、Ctrl-C）关掉浏览器，按进程组结束 dsh 和它拉起的本地服务，
 * 并删除临时目录。--keep 只保留临时目录。
 */
import { spawn, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { createServer } from 'node:net';
import { mkdtempSync, existsSync, mkdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  FRAME_READY_TIMEOUT_MS,
  SMOKE_PANELS,
  SMOKE_PROFILE,
  WEB_READY_TIMEOUT_MS,
  allChecksPassed,
  assessFrame,
  formatCheck,
  hasIncompatibleWarning,
  incompatibleExcerpt,
  knowledgeFixtureHome,
  missingBinMessage,
  parseHostVersion,
  parseSmokeArgs,
  pluginAddArgs,
  pnpmMissingMessage,
  profileCreateArgs,
  resolveSmokeBin,
  seedArgs,
  serveArgs,
  smokeEnv,
  webUrlForPort,
  choosePort,
} from '../src/dsh-smoke-plan.js';

const root = dirname(dirname(dirname(dirname(fileURLToPath(import.meta.url)))));
const requireFromWeb = createRequire(new URL('../../web/package.json', import.meta.url));

const state = {
  tempRoot: '',
  keep: false,
  browser: null,
  page: null,
  child: null,
  logged: null,
  ports: [],
  log: '',
  startError: null,
  stopping: false,
};

let cleanupPromise = null;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function appendLog(text) {
  state.log += text;
}

function runLogged(command, args, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] });
    state.logged = child;
    child.on('exit', () => {
      if (state.logged === child) state.logged = null;
    });
    let output = '';
    const take = (chunk, stream) => {
      const text = chunk.toString();
      output += text;
      appendLog(text);
      stream.write(text);
    };
    child.stdout?.on('data', (chunk) => take(chunk, process.stdout));
    child.stderr?.on('data', (chunk) => take(chunk, process.stderr));
    child.on('error', reject);
    child.on('exit', (code, signal) => resolve({ code: code ?? (signal ? 1 : 0), signal, output }));
  });
}

async function runChecked(command, args, env, label) {
  const result = await runLogged(command, args, env);
  if (result.code !== 0) {
    throw new Error(`${label} 退出 ${result.signal ?? result.code}`);
  }
  return result;
}

function commandExists(command) {
  const probe = spawnSync(command, ['--version'], { encoding: 'utf8' });
  return probe.status === 0;
}

function ephemeralPort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      server.close(() => resolve(port));
    });
  });
}

function canListen(port) {
  return new Promise((resolve) => {
    const server = createServer();
    server.unref();
    server.once('error', () => resolve(false));
    server.listen({ port, host: '127.0.0.1', exclusive: true }, () => {
      server.close(() => resolve(true));
    });
  });
}

async function acquirePort(taken) {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const candidate = await ephemeralPort();
    const chosen = choosePort([candidate], taken);
    if (chosen !== null && await canListen(chosen)) return chosen;
  }
  throw new Error('找不到空闲端口');
}

async function portAcceptsHttp(port) {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/`, {
      signal: AbortSignal.timeout(1000),
      redirect: 'manual',
    });
    return response.status > 0;
  } catch {
    return false;
  }
}

function execText(command, args) {
  return new Promise((resolve) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    child.stdout?.on('data', (chunk) => { stdout += chunk.toString(); });
    child.on('error', () => resolve({ ok: false, stdout: '' }));
    child.on('exit', (code) => resolve({ ok: code === 0, stdout }));
  });
}

async function pidsOnPort(port) {
  const fromLsof = await execText('lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN', '-t']);
  if (fromLsof.ok) {
    return fromLsof.stdout.split(/\s+/).map(Number).filter((pid) => Number.isInteger(pid) && pid > 0);
  }
  const fromSs = await execText('ss', ['-ltnp', `sport = :${port}`]);
  if (!fromSs.ok) return [];
  return [...fromSs.stdout.matchAll(/pid=(\d+)/g)].map((match) => Number(match[1]));
}

async function mentionsTemp(pid) {
  if (!state.tempRoot) return false;
  const probed = await execText('ps', ['eww', '-p', String(pid)]);
  return probed.ok && probed.stdout.includes(state.tempRoot);
}

async function killGroup(child) {
  if (!child?.pid) return;
  const pid = child.pid;
  const exited = new Promise((resolve) => {
    if (child.exitCode !== null || child.signalCode) resolve();
    else child.once('exit', () => resolve());
  });
  try { process.kill(-pid, 'SIGTERM'); } catch { /* 进程组已经不在。 */ }
  const stopped = await Promise.race([exited.then(() => true), sleep(5000).then(() => false)]);
  if (!stopped) {
    try { process.kill(-pid, 'SIGKILL'); } catch { /* 进程组已经不在。 */ }
    await Promise.race([exited, sleep(2000)]);
  }
}

async function releasePorts() {
  for (const port of state.ports) {
    const pids = await pidsOnPort(port);
    for (const pid of pids) {
      if (!(await mentionsTemp(pid))) continue;
      try { process.kill(pid, 'SIGTERM'); } catch { /* 进程已经不在。 */ }
    }
  }
  const deadline = Date.now() + 8000;
  while (Date.now() < deadline) {
    const busy = [];
    for (const port of state.ports) {
      if (!(await canListen(port))) busy.push(port);
    }
    if (busy.length === 0) return true;
    await sleep(200);
  }
  return false;
}

async function cleanup() {
  state.stopping = true;
  if (cleanupPromise) return cleanupPromise;
  cleanupPromise = (async () => {
    let ok = true;
    if (state.browser) {
      const browser = state.browser;
      state.browser = null;
      await Promise.race([browser.close().catch(() => {}), sleep(5000)]);
    }
    if (state.logged?.pid) {
      try { state.logged.kill('SIGTERM'); } catch { /* 进程已经不在。 */ }
      state.logged = null;
    }
    if (state.child) {
      const child = state.child;
      state.child = null;
      await killGroup(child);
    }
    if (state.child) {
      const late = state.child;
      state.child = null;
      await killGroup(late);
    }
    const portsFree = await releasePorts();
    if (!portsFree) {
      console.error(`端口没有释放：${state.ports.join(', ')}`);
      ok = false;
    }
    if (state.tempRoot && !state.keep) {
      rmSync(state.tempRoot, { recursive: true, force: true });
      if (existsSync(state.tempRoot)) {
        console.error(`临时目录没有删除：${state.tempRoot}`);
        ok = false;
      }
    } else if (state.tempRoot && state.keep) {
      console.error(`保留临时目录：${state.tempRoot}`);
    }
    return ok;
  })();
  return cleanupPromise;
}

function requestStop(code) {
  state.stopping = true;
  cleanup().finally(() => process.exit(code));
}

function loadPlaywright() {
  try {
    return requireFromWeb('playwright');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`读不到 packages/web 依赖的 playwright：${message}`);
  }
}

function explainBrowserError(error) {
  const message = error instanceof Error ? error.message : String(error);
  if (/Executable doesn't exist|browserType\.launch|Please run the following command/.test(message)) {
    return `${message}\n没有找到 Playwright 自带的 Chromium。请复用 packages/web 已经安装的浏览器，不要在这次自检里重新下载。`;
  }
  return message;
}

async function dismissWelcome(page) {
  const overlay = page.locator('[class*="onboarding" i], [class*="welcome" i]');
  if (await overlay.count() === 0) return;
  const names = [/^(开始|继续|跳过|知道了|进入)$/, /get started/i, /^skip$/i, /^continue$/i];
  for (const name of names) {
    const button = overlay.getByRole('button', { name }).first();
    if (await button.count() === 0) continue;
    await button.click({ timeout: 2000 }).catch(() => {});
    return;
  }
}

async function waitForWeb(child, port) {
  const deadline = Date.now() + WEB_READY_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (state.startError) throw state.startError;
    if (child.exitCode !== null || child.signalCode) {
      throw new Error(`dsh 在网页就绪前退出 ${child.signalCode ?? child.exitCode}`);
    }
    const url = webUrlForPort(state.log, port);
    if (url && await portAcceptsHttp(port)) return url;
    await sleep(250);
  }
  throw new Error(`等待 dsh 网页端口 ${port} 超过 ${WEB_READY_TIMEOUT_MS / 1000} 秒`);
}

async function checkSidebar(page) {
  const nav = page.getByRole('navigation');
  for (const panel of SMOKE_PANELS) {
    const button = nav.getByRole('button', { name: panel.label, exact: true });
    try {
      await button.waitFor({ state: 'visible', timeout: FRAME_READY_TIMEOUT_MS });
    } catch {
      return { ok: false, reason: `左侧栏没有找到「${panel.label}」` };
    }
  }
  return { ok: true, reason: '左侧栏有「灵感台」和「知识台」' };
}

async function openPanel(page, panel, serverPort) {
  const button = page.getByRole('navigation').getByRole('button', { name: panel.label, exact: true });
  try {
    await button.click({ timeout: FRAME_READY_TIMEOUT_MS });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, reason: `点不开「${panel.label}」：${message}` };
  }
  const frame = page.locator(`iframe[data-html-preview][name="${panel.frameName}"]`);
  try {
    await frame.waitFor({ state: 'visible', timeout: FRAME_READY_TIMEOUT_MS });
  } catch {
    return { ok: false, reason: `「${panel.label}」主区没有出现带 data-html-preview 的 iframe` };
  }
  const assessed = assessFrame({
    preview: (await frame.getAttribute('data-html-preview')) !== null,
    name: (await frame.getAttribute('name')) ?? '',
    src: (await frame.getAttribute('src')) ?? '',
    serverPort,
  });
  if (!assessed.ok) return { ok: false, reason: `「${panel.label}」${assessed.reason}` };
  try {
    await page.frameLocator(`iframe[name="${panel.frameName}"]`)
      .getByRole(panel.readyRole, { name: panel.readyName })
      .waitFor({ state: 'visible', timeout: FRAME_READY_TIMEOUT_MS });
  } catch {
    return { ok: false, reason: `「${panel.label}」网页没有出现「${panel.readyName}」` };
  }
  return { ok: true, reason: `「${panel.label}」主区已加载（${panel.readyName}）` };
}

async function saveFailureShot() {
  if (!state.keep || !state.page || !state.tempRoot) return;
  const path = join(state.tempRoot, 'smoke-failure.png');
  await state.page.screenshot({ path, fullPage: true }).then(() => {
    console.error(`失败截图：${path}`);
  }).catch(() => {});
}

async function main() {
  const parsed = parseSmokeArgs(process.argv.slice(2));
  if (parsed.unknown.length > 0) {
    console.error(`不认识的参数：${parsed.unknown.join(' ')}`);
    console.error('用法：npm run dsh:smoke -- [--keep]');
    process.exitCode = 1;
    return;
  }
  state.keep = parsed.keep;
  process.on('SIGINT', () => requestStop(130));
  process.on('SIGTERM', () => requestStop(143));

  const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  if (manifest.name !== 'bluemanta-desktop') {
    throw new Error(`dsh:smoke 找不到仓库根目录，当前解析为 ${root}`);
  }

  const bin = resolveSmokeBin(process.env.DSH_SMOKE_BIN);
  let binIsFile = false;
  try {
    binIsFile = statSync(bin).isFile();
  } catch {
    binIsFile = false;
  }
  if (!binIsFile) {
    throw new Error(missingBinMessage(bin));
  }
  if (!commandExists('pnpm')) {
    throw new Error(pnpmMissingMessage());
  }

  await runChecked('npm', ['run', 'build'], process.env, 'npm run build');

  state.tempRoot = mkdtempSync(join(tmpdir(), 'bluemanta-dsh-smoke-'));
  const dshHome = join(state.tempRoot, 'home');
  const dataDir = join(state.tempRoot, 'data');
  mkdirSync(dshHome, { recursive: true });
  mkdirSync(dataDir, { recursive: true });
  const versionEnv = smokeEnv(process.env, {
    dshHome,
    dataDir,
    knowledgeHome: knowledgeFixtureHome(root),
  }, { serverPort: 0 });
  delete versionEnv.BLUEMANTA_SERVER_PORT;
  const version = await runChecked(bin, ['--version'], versionEnv, 'dsh --version');
  const hostVersion = parseHostVersion(version.output) || version.output.trim() || '未知';
  console.log(`宿主版本：${hostVersion}`);

  const knowledgeHome = knowledgeFixtureHome(root);
  if (!existsSync(join(knowledgeHome, 'Documents', 'Knowledge', 'Knowledge_Index.md'))) {
    throw new Error(`虚构知识库不在 ${knowledgeHome}`);
  }

  await runChecked(process.execPath, seedArgs(dataDir), process.env, '写入虚构灵感');

  const serverPort = await acquirePort([]);
  const webPort = await acquirePort([serverPort]);
  state.ports = [serverPort, webPort];
  console.log(`本地服务端口：${serverPort}`);
  console.log(`dsh 网页端口：${webPort}`);

  const env = smokeEnv(process.env, { dshHome, dataDir, knowledgeHome }, { serverPort });
  const created = await runLogged(bin, profileCreateArgs(), env);
  if (created.code !== 0 && !hasIncompatibleWarning(state.log)) {
    throw new Error(`建立 profile 退出 ${created.signal ?? created.code}`);
  }
  const added = await runLogged(bin, pluginAddArgs(), env);
  if (added.code !== 0 && !hasIncompatibleWarning(state.log)) {
    throw new Error(`安装插件退出 ${added.signal ?? added.code}`);
  }

  if (state.stopping) return false;
  const child = spawn(bin, serveArgs(SMOKE_PROFILE, webPort), {
    cwd: root,
    env,
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  state.child = child;
  if (state.stopping) {
    await killGroup(child);
    if (state.child === child) state.child = null;
    return false;
  }
  const take = (chunk, stream) => {
    const text = chunk.toString();
    appendLog(text);
    stream.write(text);
  };
  child.stdout?.on('data', (chunk) => take(chunk, process.stdout));
  child.stderr?.on('data', (chunk) => take(chunk, process.stderr));
  child.on('error', (error) => {
    state.startError = error;
    appendLog(`${error.message}\n`);
  });

  let webUrl = '';
  try {
    webUrl = await waitForWeb(child, webPort);
  } catch (error) {
    if (!hasIncompatibleWarning(state.log)) throw error;
  }

  const incompatible = hasIncompatibleWarning(state.log);
  const check1 = incompatible
    ? { ok: false, reason: `插件被拒载：${incompatibleExcerpt(state.log)}` }
    : { ok: true, reason: '插件没有被拒载' };
  console.log(formatCheck(1, check1.ok, check1.reason));

  let check2 = { ok: false, reason: 'dsh 网页没有起来，没有检查左侧栏' };
  let check3 = { ok: false, reason: 'dsh 网页没有起来，没有检查主区' };
  if (webUrl) {
    try {
      const { chromium } = loadPlaywright();
      state.browser = await chromium.launch({ headless: true });
      const context = await state.browser.newContext({
        viewport: { width: 1440, height: 900 },
        locale: 'zh-CN',
      });
      state.page = await context.newPage();
      state.page.setDefaultTimeout(FRAME_READY_TIMEOUT_MS);
      await state.page.goto(webUrl, { waitUntil: 'domcontentloaded', timeout: WEB_READY_TIMEOUT_MS });
      await dismissWelcome(state.page);
      check2 = await checkSidebar(state.page);
      if (check2.ok) {
        const reasons = [];
        let failed = '';
        for (const panel of SMOKE_PANELS) {
          const opened = await openPanel(state.page, panel, serverPort);
          if (!opened.ok) {
            failed = opened.reason;
            break;
          }
          reasons.push(opened.reason);
        }
        check3 = failed ? { ok: false, reason: failed } : { ok: true, reason: reasons.join('；') };
      } else {
        check3 = { ok: false, reason: '左侧栏入口不在，没有检查主区' };
      }
    } catch (error) {
      const message = explainBrowserError(error);
      check2 = { ok: false, reason: message };
      check3 = { ok: false, reason: '浏览器没有完成检查' };
    }
  }

  console.log(formatCheck(2, check2.ok, check2.reason));
  console.log(formatCheck(3, check3.ok, check3.reason));
  const passed = allChecksPassed([check1, check2, check3]);
  if (!passed) await saveFailureShot();
  return passed;
}

let passed = false;
try {
  passed = Boolean(await main());
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  passed = false;
}
const cleaned = await cleanup();
if (!passed || !cleaned) process.exitCode = 1;
