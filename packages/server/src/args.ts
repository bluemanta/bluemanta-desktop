import { resolveDataDir } from '@bluemanta/cli/data-dir';

export const DEFAULT_PORT = 4310;

const COMMANDS = ['start', 'url', 'open'] as const;
export type ServerCommand = (typeof COMMANDS)[number];

const FLAGS = ['--data-dir', '--port'] as const;

export type ServerArgs = {
  command: ServerCommand;
  dataDir: string;
  port: number;
};

export type ArgsResult = { ok: true; value: ServerArgs } | { ok: false; message: string };

export const USAGE = '用法：bluemanta-server <start|url|open> [--data-dir <目录>] [--port <端口>]';

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

/** 数据目录：`--data-dir` → `BLUEMANTA_DATA_DIR` → core 默认目录。端口：`--port` → `BLUEMANTA_SERVER_PORT` → 4310。 */
export function parseArgs(argv: readonly string[], env: NodeJS.ProcessEnv): ArgsResult {
  let command: ServerCommand | undefined;
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
    if (!(COMMANDS as readonly string[]).includes(token)) return { ok: false, message: `未知子命令 ${token}` };
    if (command !== undefined) return { ok: false, message: '只能有一个子命令' };
    command = token as ServerCommand;
  }
  if (command === undefined) return { ok: false, message: '需要子命令 start、url 或 open' };

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
