import { resolveDataDir } from '@bluemanta/cli/data-dir';

export const DEFAULT_PORT = 4310;

const COMMANDS = ['start', 'url', 'open', 'service'] as const;
export type ServerCommand = (typeof COMMANDS)[number];

export const SERVICE_ACTIONS = ['install', 'uninstall', 'status', 'restart', 'print'] as const;
export type ServiceAction = (typeof SERVICE_ACTIONS)[number];

const FLAGS = ['--data-dir', '--port'] as const;

export type ServerArgs =
  | {
      command: 'start' | 'url' | 'open';
      dataDir: string;
      port: number;
    }
  | {
      command: 'service';
      action: ServiceAction;
      /** 命令行上显式写的 `--data-dir`。不读环境变量，没写就是 undefined。 */
      explicitDataDir?: string;
      /** 命令行上显式写的 `--port`。 */
      explicitPort?: number;
    };

export type ArgsResult = { ok: true; value: ServerArgs } | { ok: false; message: string };

export const USAGE = [
  '用法：bluemanta-server <start|url|open> [--data-dir <目录>] [--port <端口>]',
  '      bluemanta-server service <install|uninstall|status|restart|print> [--data-dir <目录>] [--port <端口>]',
].join('\n');

function parsePort(value: string, label: string): number | string {
  if (!/^\d+$/.test(value.trim())) return `${label} 需要是 1 到 65535 的整数`;
  const port = Number(value.trim());
  if (!Number.isInteger(port) || port < 1 || port > 65535) return `${label} 需要是 1 到 65535 的整数`;
  return port;
}

function readFlag(argv: readonly string[], index: number, name: string): { value: string | undefined; next: number } {
  const token = argv[index] ?? '';
  if (token === name) return { value: argv[index + 1], next: index + 1 };
  return { value: token.slice(name.length + 1), next: index };
}

function isServiceAction(token: string): token is ServiceAction {
  return (SERVICE_ACTIONS as readonly string[]).includes(token);
}

/**
 * `start` / `url` / `open`：数据目录 `--data-dir` → `BLUEMANTA_DATA_DIR` → core 默认目录；端口 `--port` → `BLUEMANTA_SERVER_PORT` → 4310。
 * `service`：`--data-dir` 和 `--port` 只在命令行显式写出时才算数，不读环境变量（开机自启不能悄悄继承当前 shell）。
 */
export function parseArgs(argv: readonly string[], env: NodeJS.ProcessEnv): ArgsResult {
  let command: ServerCommand | undefined;
  let serviceAction: ServiceAction | undefined;
  let dataDirFlag: string | undefined;
  let portFlag: string | undefined;
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index] ?? '';
    const flag = FLAGS.find((name) => token === name || token.startsWith(`${name}=`));
    if (flag !== undefined) {
      const { value, next } = readFlag(argv, index, flag);
      index = next;
      if (value === undefined || value.trim() === '' || value.startsWith('--')) {
        return { ok: false, message: `${flag} 需要一个值` };
      }
      if ((flag === '--data-dir' ? dataDirFlag : portFlag) !== undefined) {
        return { ok: false, message: `${flag} 只能写一次` };
      }
      if (flag === '--data-dir') dataDirFlag = value;
      else portFlag = value;
      continue;
    }
    if (token.startsWith('--')) return { ok: false, message: `未知参数 ${token}` };
    if (command === 'service' && isServiceAction(token)) {
      if (serviceAction !== undefined) return { ok: false, message: 'service 只能有一个动作' };
      serviceAction = token;
      continue;
    }
    if (!(COMMANDS as readonly string[]).includes(token)) {
      return { ok: false, message: command === 'service' ? `未知的 service 动作 ${token}` : `未知子命令 ${token}` };
    }
    if (command !== undefined) return { ok: false, message: '只能有一个子命令' };
    command = token as ServerCommand;
  }
  if (command === undefined) return { ok: false, message: '需要子命令 start、url、open 或 service' };
  if (command === 'service') {
    if (serviceAction === undefined) {
      return { ok: false, message: '需要 service 的动作：install、uninstall、status、restart 或 print' };
    }
    let explicitPort: number | undefined;
    if (portFlag !== undefined) {
      const parsed = parsePort(portFlag, '--port');
      if (typeof parsed === 'string') return { ok: false, message: parsed };
      explicitPort = parsed;
    }
    return { ok: true, value: { command, action: serviceAction, explicitDataDir: dataDirFlag, explicitPort } };
  }

  let port = DEFAULT_PORT;
  const envPort = env.BLUEMANTA_SERVER_PORT?.trim() ?? '';
  if (portFlag !== undefined) {
    const parsed = parsePort(portFlag, '--port');
    if (typeof parsed === 'string') return { ok: false, message: parsed };
    port = parsed;
  } else if (envPort !== '') {
    const parsed = parsePort(envPort, 'BLUEMANTA_SERVER_PORT');
    if (typeof parsed === 'string') return { ok: false, message: parsed };
    port = parsed;
  }

  return { ok: true, value: { command, dataDir: resolveDataDir(dataDirFlag, env), port } };
}
