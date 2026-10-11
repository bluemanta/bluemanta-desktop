import { readFileSync } from 'node:fs';

function readVersion(): string {
  try {
    const raw = readFileSync(new URL('../package.json', import.meta.url), 'utf8');
    const parsed = JSON.parse(raw) as { version?: unknown };
    return typeof parsed.version === 'string' ? parsed.version : '0.0.0';
  } catch {
    return '0.0.0';
  }
}

/** src/ 和 dist/ 都在包根目录下一层，所以同一个相对路径能找到 package.json。 */
export const SERVER_VERSION = readVersion();
