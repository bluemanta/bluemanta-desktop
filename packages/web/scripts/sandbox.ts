import { existsSync, readdirSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { homedir } from 'node:os';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_PORT } from '@bluemanta/server';

export const WEB_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
/** 开发与走查用的虚构数据目录，已在 .gitignore 里。 */
export const SANDBOX_ROOT = join(WEB_ROOT, '.dev-data');
export const WEB_DIST = join(WEB_ROOT, 'dist');

const REAL_DATA_DIRS = [
  join(homedir(), 'Library', 'Application Support', 'BluemantaDesktop'),
  join(homedir(), 'Library', 'Application Support', 'BluemantaOPC'),
];

/** 只允许在 `.dev-data/` 下建库，绝不碰真实数据目录。 */
export function sandboxDir(name: string): string {
  const dir = resolve(SANDBOX_ROOT, name);
  if (!dir.startsWith(SANDBOX_ROOT + sep)) throw new Error(`数据目录必须在 ${SANDBOX_ROOT} 下`);
  return dir;
}

export function assertNotRealDataDir(dir: string): void {
  const target = resolve(dir);
  for (const real of REAL_DATA_DIRS) {
    if (target === real || target.startsWith(real + sep)) throw new Error(`拒绝写入真实数据目录：${target}`);
  }
}

/** 清空沙盒目录，重新生成。 */
export function resetSandbox(dir: string): void {
  assertNotRealDataDir(dir);
  if (!resolve(dir).startsWith(SANDBOX_ROOT + sep)) throw new Error(`只能清空 ${SANDBOX_ROOT} 下的目录`);
  rmSync(dir, { recursive: true, force: true });
}

export function isEmptyDir(dir: string): boolean {
  return !existsSync(dir) || readdirSync(dir).length === 0;
}

/** 向系统要一个空闲端口，避开本地服务的正式端口。 */
export async function freePort(): Promise<number> {
  for (;;) {
    const port = await new Promise<number>((resolvePort, reject) => {
      const server = createServer();
      server.once('error', reject);
      server.listen(0, '127.0.0.1', () => {
        const address = server.address();
        const value = typeof address === 'object' && address ? address.port : 0;
        server.close(() => resolvePort(value));
      });
    });
    if (port !== DEFAULT_PORT && port !== 0) return port;
  }
}
