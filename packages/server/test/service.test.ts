import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseArgs, type ServiceAction } from '../src/args.js';
import { runServerCommand } from '../src/run.js';
import {
  disabledPlistFilename,
  escapeXml,
  lastLines,
  nodeMajorVersion,
  parseLaunchctlPrint,
  PLIST_FILENAME,
  portFromPlist,
  renderPlist,
  repoRootFromCli,
  runServiceCommand,
  SERVICE_LABEL,
  type CommandResult,
  type PlistInput,
  type ServiceFiles,
  type ServiceIo,
} from '../src/service.js';

const HOME = '/Users/tester';
const CLI = '/Users/tester/repo/packages/server/dist/cli.js';
const NODE = '/opt/node/bin/node';
const PLIST = join(HOME, 'Library', 'LaunchAgents', PLIST_FILENAME);
const LOG = join(HOME, 'Library', 'Logs', 'BluemantaDesktop', 'server.log');
const FIXED_NOW = new Date('2026-10-11T12:26:41.199Z');

const basePlist: PlistInput = {
  nodePath: NODE,
  cliPath: CLI,
  workingDirectory: '/Users/tester/repo',
  logPath: LOG,
};

function memoryFiles(seed?: Array<[string, string]>): {
  stored: Map<string, string>;
  dirs: string[];
  files: ServiceFiles;
} {
  const stored = new Map<string, string>(seed);
  const dirs: string[] = [];
  return {
    stored,
    dirs,
    files: {
      exists: (path) => stored.has(path) || dirs.includes(path),
      readFile: (path) => {
        const value = stored.get(path);
        if (value === undefined) throw new Error(`ENOENT ${path}`);
        return value;
      },
      writeFile: (path, content) => {
        stored.set(path, content);
      },
      mkdir: (path) => {
        dirs.push(path);
      },
      rename: (from, to) => {
        const value = stored.get(from);
        if (value === undefined) throw new Error(`ENOENT ${from}`);
        stored.set(to, value);
        stored.delete(from);
      },
    },
  };
}

function harness(options?: {
  action?: ServiceAction;
  explicitDataDir?: string;
  explicitPort?: number;
  loaded?: boolean;
  health?: (port: number) => Promise<boolean>;
  portOccupiedByOther?: (port: number) => Promise<boolean>;
  nodeVersion?: string;
  platform?: NodeJS.Platform;
  cliExists?: boolean;
  execPath?: string;
  cliPath?: string;
  bootoutCode?: number;
  bootstrapCode?: number;
  kickstartCode?: number;
  printCode?: number;
  printStderr?: string;
  files?: ReturnType<typeof memoryFiles>;
  clock?: { now: () => number; sleep: (ms: number) => Promise<void> };
}): {
  stored: Map<string, string>;
  dirs: string[];
  calls: string[][];
  stdout: string[];
  stderr: string[];
  run: () => Promise<number>;
} {
  const bucket = options?.files ?? memoryFiles();
  if (options?.cliExists !== false) bucket.stored.set(options?.cliPath ?? CLI, '');
  const calls: string[][] = [];
  let loaded = options?.loaded ?? false;
  const stdout: string[] = [];
  const stderr: string[] = [];
  const exec = async (file: string, args: readonly string[]): Promise<CommandResult> => {
    calls.push([file, ...args]);
    const sub = args[0];
    if (sub === 'print') {
      if (options?.printCode !== undefined && options.printCode !== 0 && options.printCode !== 113) {
        return { code: options.printCode, stdout: '', stderr: options.printStderr ?? 'launchctl print failed' };
      }
      return {
        code: loaded ? 0 : 113,
        stdout: loaded ? 'state = running\n\tpid = 42\n' : '',
        stderr: loaded ? '' : (options?.printStderr ?? 'Could not find service'),
      };
    }
    if (sub === 'bootout') {
      if ((options?.bootoutCode ?? 0) !== 0) return { code: options?.bootoutCode ?? 1, stdout: '', stderr: 'bootout failed' };
      loaded = false;
      return { code: 0, stdout: '', stderr: '' };
    }
    if (sub === 'bootstrap') {
      return { code: options?.bootstrapCode ?? 0, stdout: '', stderr: options?.bootstrapCode ? 'bootstrap failed' : '' };
    }
    if (sub === 'kickstart') {
      return { code: options?.kickstartCode ?? 0, stdout: '', stderr: options?.kickstartCode ? 'kickstart failed' : '' };
    }
    return { code: 1, stdout: '', stderr: `unexpected ${args.join(' ')}` };
  };
  const io: ServiceIo = {
    action: options?.action ?? 'install',
    explicitDataDir: options?.explicitDataDir,
    explicitPort: options?.explicitPort,
    stdout: (line) => stdout.push(line),
    stderr: (line) => stderr.push(line),
    platform: options?.platform ?? 'darwin',
    execPath: options?.execPath ?? NODE,
    cliPath: options?.cliPath ?? CLI,
    homeDir: HOME,
    uid: 501,
    nodeVersion: options?.nodeVersion ?? 'v24.11.0',
    now: () => FIXED_NOW,
    clock: options?.clock,
    exec,
    files: bucket.files,
    health: options?.health ?? (async () => false),
    portOccupiedByOther: options?.portOccupiedByOther ?? (async () => false),
  };
  return {
    stored: bucket.stored,
    dirs: bucket.dirs,
    calls,
    stdout,
    stderr,
    run: () => runServiceCommand(io),
  };
}

describe('renderPlist', () => {
  it('默认不写环境变量，KeepAlive 只在异常退出时重启', () => {
    const xml = renderPlist(basePlist);
    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>\n')).toBe(true);
    expect(xml).toContain('<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">');
    expect(xml).toContain('<key>Label</key>\n  <string>com.bluemanta.server</string>');
    expect(xml).toContain(`<key>ProgramArguments</key>
  <array>
    <string>${NODE}</string>
    <string>${CLI}</string>
    <string>start</string>
  </array>`);
    expect(xml).toContain('<key>WorkingDirectory</key>\n  <string>/Users/tester/repo</string>');
    expect(xml).toContain('<key>RunAtLoad</key>\n  <true/>');
    expect(xml).toContain(`<key>KeepAlive</key>
  <dict>
    <key>SuccessfulExit</key>
    <false/>
  </dict>`);
    expect(xml).toContain('<key>ThrottleInterval</key>\n  <integer>10</integer>');
    expect(xml).toContain(`<key>StandardOutPath</key>\n  <string>${LOG}</string>`);
    expect(xml).toContain(`<key>StandardErrorPath</key>\n  <string>${LOG}</string>`);
    expect(xml).not.toContain('EnvironmentVariables');
    expect(xml).not.toContain('BLUEMANTA_');
    expect(xml.endsWith('</plist>\n')).toBe(true);
  });

  it('只把显式传入的数据目录写进环境变量', () => {
    const xml = renderPlist({ ...basePlist, dataDir: '/tmp/bluemanta-try' });
    expect(xml).toContain('<key>BLUEMANTA_DATA_DIR</key>\n    <string>/tmp/bluemanta-try</string>');
    expect(xml).not.toContain('BLUEMANTA_SERVER_PORT');
  });

  it('只把显式传入的端口写进环境变量', () => {
    const xml = renderPlist({ ...basePlist, port: 4400 });
    expect(xml).toContain('<key>BLUEMANTA_SERVER_PORT</key>\n    <string>4400</string>');
    expect(xml).not.toContain('BLUEMANTA_DATA_DIR');
  });

  it('路径里的空格保留，XML 特殊字符转义', () => {
    const nodePath = '/opt/Node & Tools/bin/node';
    const cliPath = '/Users/a b/repo/packages/server/dist/cli.js';
    const dataDir = `/tmp/a b/<c>&d"e'f`;
    const xml = renderPlist({
      nodePath,
      cliPath,
      workingDirectory: '/Users/a b/repo',
      logPath: '/Users/a b/Library/Logs/BluemantaDesktop/server.log',
      dataDir,
      port: 4310,
    });
    expect(xml).toContain(`<string>${escapeXml(nodePath)}</string>`);
    expect(xml).toContain(`<string>${escapeXml(cliPath)}</string>`);
    expect(xml).toContain('<string>/Users/a b/repo</string>');
    expect(xml).toContain(`<string>${escapeXml(dataDir)}</string>`);
    expect(xml).toContain('/tmp/a b/&lt;c&gt;&amp;d&quot;e&apos;f');
    expect(xml).not.toContain('<c>');
    expect(xml).not.toContain('Node & Tools');
    expect(repoRootFromCli(cliPath)).toBe('/Users/a b/repo');
  });
});

describe('service 命令', () => {
  it('print 只输出 plist，不写文件、不调用 launchctl，也不读环境变量', async () => {
    const box = harness({
      action: 'print',
      platform: 'linux',
    });
    const before = [...box.stored.keys()];
    expect(await box.run()).toBe(0);
    expect(box.stderr).toEqual([]);
    expect(box.calls).toEqual([]);
    expect(box.dirs).toEqual([]);
    expect([...box.stored.keys()]).toEqual(before);
    const xml = `${box.stdout.join('\n')}\n`;
    expect(xml).toBe(renderPlist(basePlist));
  });

  it('print 带上显式的数据目录和端口', async () => {
    const box = harness({
      action: 'print',
      explicitDataDir: '~/My Data',
      explicitPort: 4400,
      execPath: '/opt/Node & Tools/bin/node',
      cliPath: '/Users/a b/repo/packages/server/dist/cli.js',
    });
    expect(await box.run()).toBe(0);
    const xml = `${box.stdout.join('\n')}\n`;
    expect(xml).toBe(
      renderPlist({
        nodePath: '/opt/Node & Tools/bin/node',
        cliPath: '/Users/a b/repo/packages/server/dist/cli.js',
        workingDirectory: '/Users/a b/repo',
        logPath: LOG,
        dataDir: join(HOME, 'My Data'),
        port: 4400,
      }),
    );
    expect(box.calls).toEqual([]);
  });

  it('尚未加载时 install 写 plist 再 bootstrap', async () => {
    const box = harness({
      explicitDataDir: '/tmp/my data',
      health: async () => box.calls.some((call) => call[1] === 'bootstrap'),
    });
    expect(await box.run()).toBe(0);
    expect(box.calls.map((call) => call.join(' '))).toEqual([
      `launchctl print gui/501/${SERVICE_LABEL}`,
      `launchctl bootstrap gui/501 ${PLIST}`,
    ]);
    expect(box.dirs).toEqual([join(HOME, 'Library', 'Logs', 'BluemantaDesktop'), join(HOME, 'Library', 'LaunchAgents')]);
    expect(box.stored.get(PLIST)).toBe(renderPlist({ ...basePlist, dataDir: '/tmp/my data' }));
    expect(box.stdout).toEqual([
      `已安装开机自启：${PLIST}`,
      `日志：${LOG}`,
      '健康检查通过：http://127.0.0.1:4310/api/v1/health',
    ]);
  });

  it('已加载时先 bootout 再 bootstrap', async () => {
    const box = harness({
      loaded: true,
      explicitPort: 4400,
      health: async () => box.calls.some((call) => call[1] === 'bootstrap'),
    });
    expect(await box.run()).toBe(0);
    expect(box.calls.map((call) => call.join(' '))).toEqual([
      `launchctl print gui/501/${SERVICE_LABEL}`,
      `launchctl bootout gui/501/${SERVICE_LABEL}`,
      `launchctl bootstrap gui/501 ${PLIST}`,
    ]);
    expect(box.stored.get(PLIST)).toContain('<string>4400</string>');
    expect(box.stored.get(PLIST)).not.toContain('BLUEMANTA_DATA_DIR');
  });

  it('安装前端口已被非 bluemanta 占用时不写文件', async () => {
    const seen: number[] = [];
    const box = harness({
      explicitPort: 4400,
      portOccupiedByOther: async (port) => {
        seen.push(port);
        return true;
      },
    });
    expect(await box.run()).toBe(1);
    expect(seen).toEqual([4400]);
    expect(box.calls).toEqual([]);
    expect(box.stored.has(PLIST)).toBe(false);
    expect(box.stderr).toEqual(['端口 4400 被其他程序占用']);
  });

  it('Node 低于 24 时拒绝安装', async () => {
    const box = harness({ nodeVersion: 'v23.11.0' });
    expect(await box.run()).toBe(1);
    expect(box.stderr[0]).toContain('Node.js 24');
    expect(box.stderr[0]).toContain('v23.11.0');
    expect(box.calls).toEqual([]);
    expect(box.stored.has(PLIST)).toBe(false);
  });

  it('cli.js 不存在时提示先构建', async () => {
    const box = harness({ cliExists: false });
    expect(await box.run()).toBe(1);
    expect(box.stderr).toEqual([`找不到 ${CLI}。先在仓库根目录运行 npm run build`]);
    expect(box.stored.has(PLIST)).toBe(false);
  });

  it('健康检查失败时打印日志最后 20 行', async () => {
    let time = 0;
    const lines = Array.from({ length: 25 }, (_, index) => `L${String(index + 1).padStart(2, '0')}`);
    const box = harness({
      health: async () => false,
      clock: {
        now: () => time,
        sleep: async (ms) => {
          time += ms;
        },
      },
    });
    box.stored.set(LOG, `${lines.join('\n')}\n`);
    expect(await box.run()).toBe(1);
    expect(box.stdout.join('\n')).not.toContain('已安装');
    expect(box.stderr[0]).toContain('健康检查未通过');
    expect(box.stderr).toContain('L06');
    expect(box.stderr).toContain('L25');
    expect(box.stderr).not.toContain('L05');
    expect(box.stderr).not.toContain('L01');
  });

  it('bootstrap 失败时不报告成功', async () => {
    const box = harness({ bootstrapCode: 1, health: async () => true });
    expect(await box.run()).toBe(1);
    expect(box.stderr.some((line) => line.includes('bootstrap failed'))).toBe(true);
    expect(box.stdout).toEqual([]);
  });

  it('安装时已有 bluemanta 在听，会说明 launchd 不会反复拉起', async () => {
    const box = harness({ health: async () => true });
    expect(await box.run()).toBe(0);
    expect(box.stdout.some((line) => line.includes('已在运行'))).toBe(true);
    expect(box.stdout.some((line) => line.includes('service restart'))).toBe(true);
  });

  it('非 macOS 上 install 不调用 launchctl', async () => {
    const box = harness({ platform: 'linux' });
    expect(await box.run()).toBe(1);
    expect(box.stderr).toEqual(['开机自启只支持 macOS']);
    expect(box.calls).toEqual([]);
    expect(box.stored.has(PLIST)).toBe(false);
  });

  it('uninstall 已加载时先 bootout，再改名而不是删除', async () => {
    const box = harness({ action: 'uninstall', loaded: true });
    const body = '<plist>current</plist>\n';
    const previous = join(HOME, 'Library', 'LaunchAgents', disabledPlistFilename(FIXED_NOW));
    box.stored.set(PLIST, body);
    box.stored.set(previous, 'keep-me');
    const before = box.stored.size;
    expect(await box.run()).toBe(0);
    expect(box.calls.map((call) => call.join(' '))).toEqual([
      `launchctl print gui/501/${SERVICE_LABEL}`,
      `launchctl bootout gui/501/${SERVICE_LABEL}`,
    ]);
    expect(box.stored.has(PLIST)).toBe(false);
    expect(box.stored.get(previous)).toBe('keep-me');
    const renamed = `${previous}-2`;
    expect(box.stored.get(renamed)).toBe(body);
    expect(box.stored.size).toBe(before);
    expect(box.stdout.some((line) => line.includes('未删除') && line.includes(renamed))).toBe(true);
  });

  it('uninstall 未加载时不调用 bootout，仍然改名', async () => {
    const box = harness({ action: 'uninstall', loaded: false });
    box.stored.set(PLIST, 'body');
    expect(await box.run()).toBe(0);
    expect(box.calls.map((call) => call[1])).toEqual(['print']);
    expect(box.stored.has(PLIST)).toBe(false);
    expect(box.stored.get(join(HOME, 'Library', 'LaunchAgents', disabledPlistFilename(FIXED_NOW)))).toBe('body');
  });

  it('launchctl 状态异常时 uninstall 不改名', async () => {
    const box = harness({ action: 'uninstall', printCode: 1, printStderr: 'Operation not permitted' });
    box.stored.set(PLIST, 'body');
    expect(await box.run()).toBe(1);
    expect(box.stored.get(PLIST)).toBe('body');
    expect(box.stderr.join('\n')).toContain('Operation not permitted');
    expect(box.calls.map((call) => call[1])).toEqual(['print']);
  });

  it('bootout 失败时不改名', async () => {
    const box = harness({ action: 'uninstall', loaded: true, bootoutCode: 1 });
    box.stored.set(PLIST, 'body');
    expect(await box.run()).toBe(1);
    expect(box.stored.get(PLIST)).toBe('body');
    expect(box.stderr[0]).toContain('bootout failed');
  });

  it('没有安装过时 uninstall 不改名', async () => {
    const box = harness({ action: 'uninstall' });
    expect(await box.run()).toBe(1);
    expect(box.stdout).toEqual([`launchd 里没有 ${SERVICE_LABEL}`]);
    expect(box.stderr[0]).toContain('没有可改名的 plist');
    expect([...box.stored.keys()].some((path) => path.includes('.disabled-'))).toBe(false);
  });

  it('status 报告安装、launchd、健康检查和日志', async () => {
    const box = harness({
      action: 'status',
      loaded: true,
      health: async (port) => port === 4400,
    });
    box.stored.set(
      PLIST,
      renderPlist({
        ...basePlist,
        port: 4400,
      }),
    );
    expect(await box.run()).toBe(0);
    expect(box.stdout).toEqual([
      '已安装：是',
      `plist：${PLIST}`,
      'launchd：已加载（state = running，pid = 42）',
      '健康检查：http://127.0.0.1:4400/api/v1/health 有响应',
      `日志：${LOG}`,
    ]);
  });

  it('status 在未安装或健康检查无响应时退出码为 1', async () => {
    const box = harness({ action: 'status', health: async () => false });
    expect(await box.run()).toBe(1);
    expect(box.stdout).toContain('已安装：否');
    expect(box.stdout).toContain('launchd：未加载');
    expect(box.stdout.some((line) => line.includes('无响应'))).toBe(true);
  });

  it('restart 使用 kickstart -k，代码更新后重新拉起', async () => {
    const box = harness({
      action: 'restart',
      health: async () => box.calls.some((call) => call[1] === 'kickstart'),
    });
    box.stored.set(PLIST, renderPlist(basePlist));
    expect(await box.run()).toBe(0);
    expect(box.calls.map((call) => call.join(' '))).toEqual([`launchctl kickstart -k gui/501/${SERVICE_LABEL}`]);
    expect(box.stdout[0]).toContain('已重启');
  });

  it('还没安装时 restart 不调用 kickstart', async () => {
    const box = harness({ action: 'restart' });
    expect(await box.run()).toBe(1);
    expect(box.calls).toEqual([]);
    expect(box.stderr[0]).toContain('service install');
  });
});

describe('参数与入口', () => {
  it('service 的端口和数据目录必须显式写出，不读环境变量', () => {
    expect(parseArgs(['service', 'print'], { BLUEMANTA_DATA_DIR: '/tmp/env', BLUEMANTA_SERVER_PORT: '5001' })).toEqual({
      ok: true,
      value: { command: 'service', action: 'print', explicitDataDir: undefined, explicitPort: undefined },
    });
    expect(parseArgs(['service', 'install', '--data-dir', '/tmp/a b', '--port', '4400'], {})).toEqual({
      ok: true,
      value: { command: 'service', action: 'install', explicitDataDir: '/tmp/a b', explicitPort: 4400 },
    });
    expect(parseArgs(['--port=4401', 'service', 'status'], { BLUEMANTA_SERVER_PORT: 'nope' })).toMatchObject({
      ok: true,
      value: { action: 'status', explicitPort: 4401 },
    });
  });

  it('service 动作写错时退出码 2', () => {
    for (const argv of [[], ['service'], ['service', 'start'], ['service', 'install', 'print'], ['print']]) {
      expect(parseArgs(argv, {}).ok, argv.join(' ')).toBe(false);
    }
  });

  it('runServerCommand 的 print 只走标准输出，不创建 plist', async () => {
    const plist = join(homedir(), 'Library', 'LaunchAgents', PLIST_FILENAME);
    expect(existsSync(plist)).toBe(false);
    const stdout: string[] = [];
    const stderr: string[] = [];
    const code = await runServerCommand({
      argv: ['service', 'print', '--data-dir', '/tmp/a&b'],
      env: { BLUEMANTA_DATA_DIR: '/tmp/should-not-appear', BLUEMANTA_SERVER_PORT: '5001' },
      stdout: (line) => stdout.push(line),
      stderr: (line) => stderr.push(line),
      platform: 'linux',
    });
    expect(code).toBe(0);
    expect(stderr).toEqual([]);
    const xml = `${stdout.join('\n')}\n`;
    expect(xml).toContain('<key>Label</key>');
    expect(xml).toContain('<string>start</string>');
    expect(xml).toContain('/tmp/a&amp;b');
    expect(xml).not.toContain('should-not-appear');
    expect(xml).not.toContain('5001');
    expect(xml).not.toContain('<string>4310</string>');
    expect(existsSync(plist)).toBe(false);
    expect(existsSync(join(homedir(), 'Library', 'Logs', 'BluemantaDesktop'))).toBe(false);
  });

  it('缺少 service 动作时 runServerCommand 返回 2', async () => {
    const stderr: string[] = [];
    const code = await runServerCommand({
      argv: ['service'],
      env: {},
      stdout: () => {},
      stderr: (line) => stderr.push(line),
    });
    expect(code).toBe(2);
    expect(stderr[0]).toContain('install');
  });
});

describe('小函数', () => {
  it('版本号、launchctl 输出、日志尾行和 plist 里的端口', () => {
    expect(nodeMajorVersion('v24.0.0')).toBe(24);
    expect(nodeMajorVersion('v23.11.0')).toBe(23);
    expect(nodeMajorVersion('node')).toBeUndefined();
    expect(parseLaunchctlPrint('state = not running\n\tpid = 9\n')).toEqual({ state: 'not running', pid: '9' });
    expect(parseLaunchctlPrint('state = running\n')).toEqual({ state: 'running', pid: undefined });
    expect(lastLines(['L01', 'L02', 'L03'].join('\n'), 2)).toEqual(['L02', 'L03']);
    expect(portFromPlist('<key>BLUEMANTA_SERVER_PORT</key>\n    <string>4400</string>')).toBe(4400);
    expect(portFromPlist('<plist></plist>')).toBeUndefined();
    expect(disabledPlistFilename(FIXED_NOW)).toBe('com.bluemanta.server.plist.disabled-20261011T122641Z');
  });
});
