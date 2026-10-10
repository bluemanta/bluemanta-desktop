/** 优先用环境变量；空白或未设置时用 core 的默认目录。 */
export function resolveDataDir(envValue: string | undefined, fallback: () => string): string {
  const trimmed = envValue?.trim() ?? '';
  return trimmed === '' ? fallback() : trimmed;
}
