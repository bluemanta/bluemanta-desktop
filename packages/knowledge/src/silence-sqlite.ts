const SQLITE_EXPERIMENTAL = 'SQLite is an experimental feature and might change at any time';

let installed = false;

function messageOf(warning: unknown): string {
  if (typeof warning === 'string') return warning;
  if (warning instanceof Error) return warning.message;
  return '';
}

function typeOf(warning: unknown, typeOrOptions: unknown): string {
  if (typeof typeOrOptions === 'string') return typeOrOptions;
  if (typeOrOptions && typeof typeOrOptions === 'object' && 'type' in typeOrOptions) {
    const type = (typeOrOptions as { type?: unknown }).type;
    if (typeof type === 'string') return type;
  }
  if (warning instanceof Error) return warning.name;
  return '';
}

/**
 * `node:sqlite` 首次加载时会发一条 ExperimentalWarning。
 * 只丢掉这一条，其它警告（包括别的 ExperimentalWarning）照常输出。
 */
export function silenceSqliteExperimentalWarning(): void {
  if (installed) return;
  installed = true;
  const original = process.emitWarning.bind(process);
  process.emitWarning = ((warning: unknown, type?: unknown, code?: unknown, ctor?: unknown) => {
    if (typeOf(warning, type) === 'ExperimentalWarning' && messageOf(warning).includes(SQLITE_EXPERIMENTAL)) {
      return;
    }
    return original(warning as string, type as never, code as never, ctor as never);
  }) as typeof process.emitWarning;
}

silenceSqliteExperimentalWarning();
