/**
 * `npm run dsh:smoke` 的纯函数：版本范围、端口、输出判断和清理条件。
 * 不启动进程，也不读写用户的 dsh 或知识库。
 */
import { join } from 'node:path';
import { htmlPreviewFrameName } from './html-preview-frame.js';
import { knowledgeFrameName } from './knowledge-sidebar.js';

/** 写代码和类型检查时对准的 dsh 版本。 */
export const DSH_REFERENCE_VERSION = '0.2.2-rc.1';

/** `engines.dsh` 和 peer 用同一个范围。预发布版本也参与匹配。 */
export const DSH_ENGINE_RANGE = '>=0.2.1-rc.2 <0.3.0-0';

/** Desktop 自带 CLI。可用 DSH_SMOKE_BIN 覆盖。 */
export const DEFAULT_DSH_SMOKE_BIN = '/Applications/DeepSeek Harness.app/Contents/Resources/runtime/cli/bin/dsh';

/** 4310 是用户常驻服务，4311 是 dev:dsh，4312 被 QQ 占用。 */
export const RESERVED_SMOKE_PORTS = [4310, 4311, 4312];

export const INCOMPATIBLE_MARK = 'is incompatible with dsh';

export const WEB_READY_TIMEOUT_MS = 60_000;

export const FRAME_READY_TIMEOUT_MS = 30_000;

export const SMOKE_PROFILE = 'bluemanta-smoke';

/**
 * 左侧栏入口，以及点开后要等的稳定元素。
 * 灵感台等「灵感清单」，知识台等「主题清单」。
 */
export const SMOKE_PANELS = [
  {
    label: '灵感台',
    frameName: htmlPreviewFrameName('main', ''),
    readyRole: 'listbox',
    readyName: '灵感清单',
  },
  {
    label: '知识台',
    frameName: knowledgeFrameName('main', ''),
    readyRole: 'listbox',
    readyName: '主题清单',
  },
];

export function parseSmokeArgs(argv) {
  const args = Array.isArray(argv) ? argv.filter((item) => item !== '--') : [];
  const unknown = args.filter((item) => item !== '--keep');
  return { keep: args.includes('--keep'), unknown };
}

export function resolveSmokeBin(envValue) {
  if (typeof envValue !== 'string') return DEFAULT_DSH_SMOKE_BIN;
  const trimmed = envValue.trim();
  return trimmed === '' ? DEFAULT_DSH_SMOKE_BIN : trimmed;
}

export function missingBinMessage(bin) {
  return `找不到 dsh 可执行文件：${bin}。可以设置 DSH_SMOKE_BIN 指向本机的 dsh。`;
}

export function pnpmMissingMessage() {
  return 'dsh:smoke 需要 pnpm 在 PATH 上：dsh plugin 会把安装转交给 pnpm。';
}

export function hasIncompatibleWarning(text) {
  const source = typeof text === 'string' ? text : '';
  if (source.includes(INCOMPATIBLE_MARK)) return true;
  return source.replace(/\s+/g, ' ').includes(INCOMPATIBLE_MARK);
}

/** 打印拒载提示时用的那一行；短语被换行拆开时，拼回含该短语的一段。 */
export function incompatibleExcerpt(text) {
  const source = typeof text === 'string' ? text : '';
  const flat = source.replace(/\s+/g, ' ');
  const index = flat.indexOf(INCOMPATIBLE_MARK);
  if (index < 0) return '';
  const start = Math.max(0, flat.lastIndexOf(' ', index - 80));
  const end = Math.min(flat.length, index + INCOMPATIBLE_MARK.length + 160);
  return flat.slice(start, end).trim();
}

export function parseHostVersion(text) {
  const source = typeof text === 'string' ? text : '';
  const match = source.match(/\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?/);
  return match ? match[0] : '';
}

export function parseWebUrls(text) {
  const source = typeof text === 'string' ? text : '';
  const matches = source.match(/https?:\/\/(?:127\.0\.0\.1|localhost|\[::1\]):\d+[^\s]*token=[^\s]+/g) ?? [];
  return matches.map((url) => url.replace(/[),.;]+$/, ''));
}

export function webUrlForPort(text, port) {
  const wanted = String(port);
  for (const url of parseWebUrls(text)) {
    try {
      if (new URL(url).port === wanted) return url;
    } catch {
      // 跳过无法解析的地址。
    }
  }
  return '';
}

export function iframeTargetsServer(src, serverPort) {
  if (typeof src !== 'string' || src === '') return false;
  try {
    const url = new URL(src);
    const hostOk = url.hostname === '127.0.0.1' || url.hostname === 'localhost';
    return hostOk && url.port === String(serverPort);
  } catch {
    return false;
  }
}

export function assessFrame(frame) {
  const name = typeof frame?.name === 'string' ? frame.name : '';
  const src = typeof frame?.src === 'string' ? frame.src : '';
  const serverPort = frame?.serverPort;
  if (frame?.preview !== true) return { ok: false, reason: '主区 iframe 没有 data-html-preview' };
  if (name.trim() === '') return { ok: false, reason: '主区 iframe 的 name 是空的' };
  if (!iframeTargetsServer(src, serverPort)) {
    return { ok: false, reason: `iframe 地址没有指向本次本地服务端口 ${serverPort}` };
  }
  return { ok: true, reason: '' };
}

export function choosePort(candidates, taken) {
  const blocked = new Set(RESERVED_SMOKE_PORTS);
  for (const port of Array.isArray(taken) ? taken : []) blocked.add(Number(port));
  for (const candidate of Array.isArray(candidates) ? candidates : []) {
    const port = Number(candidate);
    if (!Number.isInteger(port) || port < 1 || port > 65535) continue;
    if (blocked.has(port)) continue;
    return port;
  }
  return null;
}

export function formatCheck(index, ok, reason) {
  const detail = reason ? ` ${reason}` : '';
  return `检查 ${index} ${ok ? 'PASS' : 'FAIL'}${detail}`;
}

export function allChecksPassed(results) {
  return Array.isArray(results) && results.length === 3 && results.every((item) => item && item.ok === true);
}

export function knowledgeFixtureHome(repoRoot) {
  return join(repoRoot, 'packages', 'knowledge', 'fixtures', 'home');
}

export function smokeEnv(base, paths, ports) {
  const env = { ...(base ?? {}) };
  delete env.DSH_PROFILE;
  env.DSH_HOME = paths.dshHome;
  env.DSH_TELEMETRY_DISABLED = '1';
  env.BLUEMANTA_DATA_DIR = paths.dataDir;
  env.BLUEMANTA_KNOWLEDGE_HOME = paths.knowledgeHome;
  env.BLUEMANTA_SERVER_PORT = String(ports.serverPort);
  return env;
}

export function profileCreateArgs(profile = SMOKE_PROFILE) {
  return ['--profile', profile, '--from-default-profile', 'web', '--dump-config'];
}

export function pluginAddArgs(profile = SMOKE_PROFILE) {
  return ['plugin', '--profile', profile, 'add', './packages/dsh-plugin'];
}

export function serveArgs(profile, port) {
  return ['--profile', profile, '--port', String(port), '--no-open'];
}

export function seedArgs(dataDir) {
  return ['packages/web/scripts/seed-cli.ts', '--data-dir', dataDir];
}
