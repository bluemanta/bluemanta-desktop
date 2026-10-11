/**
 * macOS 用户级 LaunchAgent 的安装、卸载、状态和重启。
 * plist 自己拼 XML。launchctl 经可注入的执行函数，测试和 CI 不真的调用。
 * 本模块不会删除文件：卸载只把 plist 改名保留。
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { createConnection } from 'node:net';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_PORT, type ServiceAction } from './args.js';

export const SERVICE_LABEL = 'com.bluemanta.server';
export const PLIST_FILENAME = `${SERVICE_LABEL}.plist`;
/** 异常退出后至少隔这么久再拉，避免端口还没释放时连续重启。 */
export const THROTTLE_INTERVAL_SECONDS = 10;
export const HEALTH_TIMEOUT_MS = 15_000;
export const HEALTH_POLL_MS = 200;
const MIN_NODE_MAJOR = 24;

export type PlistInput = {
  nodePath: string;
  cliPath: string;
  workingDirectory: string;
  logPath: string;
  /** 只有安装时显式传了 `--data-dir` 才填。 */
  dataDir?: string;
  /** 只有安装时显式传了 `--port` 才填。 */
  port?: number;
};

export type CommandResult = {
  code: number;
  stdout: string;
  stderr: string;
};

export type ServiceFiles = {
  exists: (path: string) => boolean;
  readFile: (path: string) => string;
  writeFile: (path: string, content: string) => void;
  mkdir: (path: string) => void;
  rename: (from: string, to: string) => void;
};

export type ServiceIo = {
  action: ServiceAction;
  explicitDataDir?: string;
  explicitPort?: number;
  stdout: (line: string) => void;
  stderr: (line: string) => void;
  platform?: NodeJS.Platform;
  execPath?: string;
  cliPath?: string;
  homeDir?: string;
  uid?: number;
  nodeVersion?: string;
  now?: () => Date;
  clock?: { now: () => number; sleep: (ms: number) => Promise<void> };
  exec?: (file: string, args: readonly string[]) => Promise<CommandResult>;
  files?: ServiceFiles;
  health?: (port: number) => Promise<boolean>;
  portOccupiedByOther?: (port: number) => Promise<boolean>;
};

type Context = {
  action: ServiceAction;
  explicitDataDir?: string;
  explicitPort?: number;
  stdout: (line: string) => void;
  stderr: (line: string) => void;
  platform: NodeJS.Platform;
  nodePath: string;
  cliPath: string;
  workingDirectory: string;
  homeDir: string;
  uid: number;
  nodeVersion: string;
  plistPath: string;
  agentsDir: string;
  logFile: string;
  logDir: string;
  now: () => Date;
  clock: { now: () => number; sleep: (ms: number) => Promise<void> };
  exec: (file: string, args: readonly string[]) => Promise<CommandResult>;
  files: ServiceFiles;
  health: (port: number) => Promise<boolean>;
  portOccupiedByOther: (port: number) => Promise<boolean>;
};

const XML_ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&apos;',
};

export function escapeXml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => XML_ESCAPES[char] ?? char);
}

export function nodeMajorVersion(version: string): number | undefined {
  const match = /^v(\d+)/.exec(version.trim());
  if (match?.[1] === undefined) return undefined;
  const major = Number(match[1]);
  return Number.isInteger(major) ? major : undefined;
}

/** `packages/server/dist/cli.js` 往上三级是仓库根目录。 */
export function repoRootFromCli(cliPath: string): string {
  return resolve(dirname(cliPath), '..', '..', '..');
}

/**
 * 从 dist 运行时，cli.js 就在旁边。
 * 测试直接加载 src 时旁边没有 cli.js，改找编出来的 dist/cli.js。
 */
export function resolveCliPath(metaUrl: string = import.meta.url, exists: (path: string) => boolean = existsSync): string {
  const beside = fileURLToPath(new URL('./cli.js', metaUrl));
  if (exists(beside)) return beside;
  return fileURLToPath(new URL('../dist/cli.js', metaUrl));
}

export function servicePaths(homeDir: string): { agentsDir: string; plistPath: string; logDir: string; logFile: string } {
  const agentsDir = join(homeDir, 'Library', 'LaunchAgents');
  const logDir = join(homeDir, 'Library', 'Logs', 'BluemantaDesktop');
  return {
    agentsDir,
    plistPath: join(agentsDir, PLIST_FILENAME),
    logDir,
    logFile: join(logDir, 'server.log'),
  };
}

export function guiDomain(uid: number): string {
  return `gui/${uid}`;
}

export function serviceTarget(uid: number): string {
  return `${guiDomain(uid)}/${SERVICE_LABEL}`;
}

/** `2026-10-11T12:26:41.199Z` → `com.bluemanta.server.plist.disabled-20261011T122641Z`。 */
export function disabledPlistFilename(date: Date): string {
  const stamp = date.toISOString().replace(/\.\d{3}Z$/, 'Z').replace(/[-:]/g, '');
  return `${PLIST_FILENAME}.disabled-${stamp}`;
}

export function parseLaunchctlPrint(stdout: string): { state?: string; pid?: string } {
  const state = /^\s*state = (.*)$/m.exec(stdout)?.[1]?.trim();
  const pid = /^\s*pid = (\d+)\s*$/m.exec(stdout)?.[1];
  return {
    state: state === undefined || state === '' ? undefined : state,
    pid,
  };
}

export function portFromPlist(xml: string): number | undefined {
  const match = /<key>BLUEMANTA_SERVER_PORT<\/key>\s*<string>(\d+)<\/string>/.exec(xml);
  if (match?.[1] === undefined) return undefined;
  const port = Number(match[1]);
  if (!Number.isInteger(port) || port < 1 || port > 65535) return undefined;
  return port;
}

export function lastLines(text: string, count: number): string[] {
  const lines = text.split(/\r?\n/);
  if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
  return lines.slice(-count);
}

function stringTag(value: string, indent: string): string {
  return `${indent}<string>${escapeXml(value)}</string>`;
}

function keyTag(name: string, indent: string): string {
  return `${indent}<key>${escapeXml(name)}</key>`;
}

/** 纯函数。没传 dataDir / port 时不写 EnvironmentVariables，服务用自己的默认值。 */
export function renderPlist(input: PlistInput): string {
  const lines = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
    '<plist version="1.0">',
    '<dict>',
    keyTag('Label', '  '),
    stringTag(SERVICE_LABEL, '  '),
    keyTag('ProgramArguments', '  '),
    '  <array>',
    stringTag(input.nodePath, '    '),
    stringTag(input.cliPath, '    '),
    stringTag('start', '    '),
    '  </array>',
    keyTag('WorkingDirectory', '  '),
    stringTag(input.workingDirectory, '  '),
    keyTag('RunAtLoad', '  '),
    '  <true/>',
    keyTag('KeepAlive', '  '),
    '  <dict>',
    keyTag('SuccessfulExit', '    '),
    '    <false/>',
    '  </dict>',
    keyTag('ThrottleInterval', '  '),
    `  <integer>${THROTTLE_INTERVAL_SECONDS}</integer>`,
    keyTag('StandardOutPath', '  '),
    stringTag(input.logPath, '  '),
    keyTag('StandardErrorPath', '  '),
    stringTag(input.logPath, '  '),
  ];
  const env: Array<[string, string]> = [];
  if (input.dataDir !== undefined && input.dataDir !== '') env.push(['BLUEMANTA_DATA_DIR', input.dataDir]);
  if (input.port !== undefined) env.push(['BLUEMANTA_SERVER_PORT', String(input.port)]);
  if (env.length > 0) {
    lines.push(keyTag('EnvironmentVariables', '  '), '  <dict>');
    for (const [name, value] of env) {
      lines.push(keyTag(name, '    '), stringTag(value, '    '));
    }
    lines.push('  </dict>');
  }
  lines.push('</dict>', '</plist>', '');
  return lines.join('\n');
}

function realFiles(): ServiceFiles {
  return {
    exists: (path) => existsSync(path),
    readFile: (path) => readFileSync(path, 'utf8'),
    writeFile: (path, content) => writeFileSync(path, content, { encoding: 'utf8', mode: 0o644 }),
    mkdir: (path) => mkdirSync(path, { recursive: true }),
    rename: (from, to) => renameSync(from, to),
  };
}

export function execFile(file: string, args: readonly string[]): Promise<CommandResult> {
  return new Promise((resolveResult) => {
    const child = spawn(file, [...args], { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    let settled = false;
    const finish = (code: number) => {
      if (settled) return;
      settled = true;
      resolveResult({ code, stdout, stderr });
    };
    child.stdout?.setEncoding('utf8').on('data', (chunk: string) => {
      stdout += chunk;
    });
    child.stderr?.setEncoding('utf8').on('data', (chunk: string) => {
      stderr += chunk;
    });
    child.once('error', (error) => {
      stderr += error.message;
      finish(1);
    });
    child.once('exit', (code) => finish(code ?? 1));
  });
}

async function defaultHealth(port: number): Promise<boolean> {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/v1/health`, { signal: AbortSignal.timeout(2000) });
    if (!response.ok) return false;
    const body = (await response.json()) as { service?: unknown };
    return body.service === 'bluemanta';
  } catch {
    return false;
  }
}

function portIsOpen(port: number): Promise<boolean> {
  return new Promise((resolvePort) => {
    const socket = createConnection({ host: '127.0.0.1', port });
    const finish = (open: boolean) => {
      socket.destroy();
      resolvePort(open);
    };
    socket.setTimeout(1000);
    socket.once('connect', () => finish(true));
    socket.once('timeout', () => finish(false));
    socket.once('error', () => finish(false));
  });
}

async function defaultPortOccupiedByOther(port: number): Promise<boolean> {
  if (await defaultHealth(port)) return false;
  return portIsOpen(port);
}

function expandHome(path: string, homeDir: string): string {
  if (path === '~') return homeDir;
  if (path.startsWith('~/')) return join(homeDir, path.slice(2));
  return path;
}

function createContext(io: ServiceIo): Context {
  const homeDir = io.homeDir ?? homedir();
  const cliPath = io.cliPath ?? resolveCliPath();
  const paths = servicePaths(homeDir);
  const uid = io.uid ?? (typeof process.getuid === 'function' ? process.getuid() : 0);
  return {
    action: io.action,
    explicitDataDir: io.explicitDataDir,
    explicitPort: io.explicitPort,
    stdout: io.stdout,
    stderr: io.stderr,
    platform: io.platform ?? process.platform,
    nodePath: io.execPath ?? process.execPath,
    cliPath,
    workingDirectory: repoRootFromCli(cliPath),
    homeDir,
    uid,
    nodeVersion: io.nodeVersion ?? process.version,
    ...paths,
    now: io.now ?? (() => new Date()),
    clock: io.clock ?? {
      now: () => Date.now(),
      sleep: (ms) => new Promise((resolveSleep) => setTimeout(resolveSleep, ms)),
    },
    exec: io.exec ?? execFile,
    files: io.files ?? realFiles(),
    health: io.health ?? defaultHealth,
    portOccupiedByOther: io.portOccupiedByOther ?? defaultPortOccupiedByOther,
  };
}

function plistInput(ctx: Context): PlistInput {
  const dataDir =
    ctx.explicitDataDir === undefined ? undefined : resolve(expandHome(ctx.explicitDataDir, ctx.homeDir));
  return {
    nodePath: ctx.nodePath,
    cliPath: ctx.cliPath,
    workingDirectory: ctx.workingDirectory,
    logPath: ctx.logFile,
    dataDir,
    port: ctx.explicitPort,
  };
}

function healthUrl(port: number): string {
  return `http://127.0.0.1:${port}/api/v1/health`;
}

function commandText(result: CommandResult): string {
  const text = `${result.stderr}${result.stdout}`.trim();
  return text === '' ? `退出码 ${result.code}` : text;
}

async function launchctl(ctx: Context, args: readonly string[]): Promise<CommandResult> {
  const result = await ctx.exec('launchctl', args);
  if (result.code !== 0 && result.stderr.includes('ENOENT')) throw new Error('找不到 launchctl');
  return result;
}

/** `launchctl print` 找不到服务时退出码是 113，并写 Could not find service。其他失败不要当成「未加载」。 */
function isServiceMissing(result: CommandResult): boolean {
  if (result.code === 113) return true;
  return /Could not find service|service not found/i.test(`${result.stderr}\n${result.stdout}`);
}

async function launchdState(ctx: Context): Promise<{ loaded: boolean; stdout: string }> {
  const result = await launchctl(ctx, ['print', serviceTarget(ctx.uid)]);
  if (result.code === 0) return { loaded: true, stdout: result.stdout };
  if (isServiceMissing(result)) return { loaded: false, stdout: '' };
  throw new Error(`查不到 launchd 状态：${commandText(result)}`);
}

function listenPort(ctx: Context): number {
  if (ctx.explicitPort !== undefined) return ctx.explicitPort;
  if (ctx.files.exists(ctx.plistPath)) {
    try {
      const fromFile = portFromPlist(ctx.files.readFile(ctx.plistPath));
      if (fromFile !== undefined) return fromFile;
    } catch {
      // 读不到已安装的 plist 时用默认端口。
    }
  }
  return DEFAULT_PORT;
}

async function waitForHealth(ctx: Context, port: number): Promise<boolean> {
  const deadline = ctx.clock.now() + HEALTH_TIMEOUT_MS;
  for (;;) {
    if (await ctx.health(port)) return true;
    if (ctx.clock.now() >= deadline) return false;
    await ctx.clock.sleep(HEALTH_POLL_MS);
  }
}

function printLogTail(ctx: Context): void {
  if (!ctx.files.exists(ctx.logFile)) {
    ctx.stderr(`日志文件还不存在：${ctx.logFile}`);
    return;
  }
  let text: string;
  try {
    text = ctx.files.readFile(ctx.logFile);
  } catch (error) {
    ctx.stderr(`读不到日志：${error instanceof Error ? error.message : String(error)}`);
    return;
  }
  const lines = lastLines(text, 20);
  ctx.stderr(`日志最后 ${lines.length} 行（${ctx.logFile}）：`);
  for (const line of lines) ctx.stderr(line);
}

function printPlist(ctx: Context): number {
  const plist = renderPlist(plistInput(ctx));
  ctx.stdout(plist.endsWith('\n') ? plist.slice(0, -1) : plist);
  return 0;
}

async function install(ctx: Context): Promise<number> {
  const major = nodeMajorVersion(ctx.nodeVersion);
  if (major === undefined || major < MIN_NODE_MAJOR) {
    ctx.stderr(`需要 Node.js ${MIN_NODE_MAJOR} 或更新（当前 ${ctx.nodeVersion}）。开机自启会记下现在这个 Node 的路径`);
    return 1;
  }
  if (!ctx.files.exists(ctx.cliPath)) {
    ctx.stderr(`找不到 ${ctx.cliPath}。先在仓库根目录运行 npm run build`);
    return 1;
  }
  const port = ctx.explicitPort ?? DEFAULT_PORT;
  if (await ctx.portOccupiedByOther(port)) {
    ctx.stderr(`端口 ${port} 被其他程序占用`);
    return 1;
  }
  const alreadyServing = await ctx.health(port);
  ctx.files.mkdir(ctx.logDir);
  ctx.files.mkdir(ctx.agentsDir);
  ctx.files.writeFile(ctx.plistPath, renderPlist(plistInput(ctx)));

  const state = await launchdState(ctx);
  if (state.loaded) {
    const removed = await launchctl(ctx, ['bootout', serviceTarget(ctx.uid)]);
    if (removed.code !== 0) {
      ctx.stderr(`没能卸下已加载的服务：${commandText(removed)}`);
      return 1;
    }
  }
  const loaded = await launchctl(ctx, ['bootstrap', guiDomain(ctx.uid), ctx.plistPath]);
  if (loaded.code !== 0) {
    ctx.stderr(`没能加载 launchd 服务：${commandText(loaded)}`);
    printLogTail(ctx);
    return 1;
  }
  const healthy = await waitForHealth(ctx, port);
  if (!healthy) {
    ctx.stderr(`健康检查未通过：${healthUrl(port)}`);
    printLogTail(ctx);
    return 1;
  }
  ctx.stdout(`已安装开机自启：${ctx.plistPath}`);
  ctx.stdout(`日志：${ctx.logFile}`);
  ctx.stdout(`健康检查通过：${healthUrl(port)}`);
  if (alreadyServing) {
    ctx.stdout('安装前已有 bluemanta 服务在听这个端口。launchd 拉起的 start 发现「已在运行」会以 0 退出，并且不会反复重启。要改由开机自启接管，先停掉现有进程，再运行 service restart');
  }
  return 0;
}

function uniqueDisabledPath(ctx: Context): string {
  const base = join(ctx.agentsDir, disabledPlistFilename(ctx.now()));
  if (!ctx.files.exists(base)) return base;
  for (let index = 2; index < 1000; index += 1) {
    const candidate = `${base}-${index}`;
    if (!ctx.files.exists(candidate)) return candidate;
  }
  throw new Error('找不到可用的 plist 改名');
}

async function uninstall(ctx: Context): Promise<number> {
  const state = await launchdState(ctx);
  if (state.loaded) {
    const removed = await launchctl(ctx, ['bootout', serviceTarget(ctx.uid)]);
    if (removed.code !== 0) {
      ctx.stderr(`没能卸下 launchd 服务：${commandText(removed)}`);
      return 1;
    }
    ctx.stdout(`已从 launchd 卸下 ${SERVICE_LABEL}`);
  } else {
    ctx.stdout(`launchd 里没有 ${SERVICE_LABEL}`);
  }
  if (!ctx.files.exists(ctx.plistPath)) {
    ctx.stderr(`没有可改名的 plist：${ctx.plistPath}`);
    return state.loaded ? 0 : 1;
  }
  const next = uniqueDisabledPath(ctx);
  ctx.files.rename(ctx.plistPath, next);
  ctx.stdout(`plist 已改名（未删除）：${next}`);
  return 0;
}

async function status(ctx: Context): Promise<number> {
  const installed = ctx.files.exists(ctx.plistPath);
  const port = listenPort(ctx);
  const state = await launchdState(ctx);
  const healthy = await ctx.health(port);
  ctx.stdout(installed ? '已安装：是' : '已安装：否');
  ctx.stdout(`plist：${ctx.plistPath}`);
  if (state.loaded) {
    const parsed = parseLaunchctlPrint(state.stdout);
    const detail = [
      parsed.state === undefined ? undefined : `state = ${parsed.state}`,
      parsed.pid === undefined ? undefined : `pid = ${parsed.pid}`,
    ].filter((part) => part !== undefined);
    ctx.stdout(detail.length > 0 ? `launchd：已加载（${detail.join('，')}）` : 'launchd：已加载');
  } else {
    ctx.stdout('launchd：未加载');
  }
  ctx.stdout(`健康检查：${healthUrl(port)} ${healthy ? '有响应' : '无响应'}`);
  ctx.stdout(`日志：${ctx.logFile}`);
  return installed && healthy ? 0 : 1;
}

async function restart(ctx: Context): Promise<number> {
  if (!ctx.files.exists(ctx.plistPath)) {
    ctx.stderr(`还没安装开机自启（${ctx.plistPath}）。先运行 service install`);
    return 1;
  }
  const port = listenPort(ctx);
  const kicked = await launchctl(ctx, ['kickstart', '-k', serviceTarget(ctx.uid)]);
  if (kicked.code !== 0) {
    ctx.stderr(`没能重启服务：${commandText(kicked)}`);
    printLogTail(ctx);
    return 1;
  }
  const healthy = await waitForHealth(ctx, port);
  if (!healthy) {
    ctx.stderr(`健康检查未通过：${healthUrl(port)}`);
    printLogTail(ctx);
    return 1;
  }
  ctx.stdout(`已重启 ${SERVICE_LABEL}`);
  ctx.stdout(`健康检查通过：${healthUrl(port)}`);
  return 0;
}

export async function runServiceCommand(io: ServiceIo): Promise<number> {
  try {
    const ctx = createContext(io);
    if (ctx.action === 'print') return printPlist(ctx);
    if (ctx.platform !== 'darwin') {
      ctx.stderr('开机自启只支持 macOS');
      return 1;
    }
    switch (ctx.action) {
      case 'install':
        return await install(ctx);
      case 'uninstall':
        return await uninstall(ctx);
      case 'status':
        return await status(ctx);
      case 'restart':
        return await restart(ctx);
      default: {
        const unreachable: never = ctx.action;
        return unreachable;
      }
    }
  } catch (error) {
    io.stderr(`bluemanta 本地服务：${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }
}
