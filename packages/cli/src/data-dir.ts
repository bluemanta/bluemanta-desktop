import { defaultDataDir } from '@bluemanta/core';

/** `--data-dir` 优先，其次 `BLUEMANTA_DATA_DIR`，都没有时用 core 的默认目录。空白视为未设置。 */
export function resolveDataDir(flag: string | undefined, env: NodeJS.ProcessEnv): string {
  const fromFlag = flag?.trim() ?? '';
  if (fromFlag !== '') return fromFlag;
  const fromEnv = env.BLUEMANTA_DATA_DIR?.trim() ?? '';
  if (fromEnv !== '') return fromEnv;
  return defaultDataDir();
}
