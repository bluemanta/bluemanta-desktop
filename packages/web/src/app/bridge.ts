/**
 * 与 dsh 的消息桥（docs/phase-1-5.md 第 3 节）。T12 只有两条：
 * 网页 → dsh `bm:ready`；dsh → 网页 `bm:theme { dark }`。
 * 只和 `#parent=<origin>` 指定的父窗口通信；没指定时既不发也不收。
 */

export type ThemeMessage = { type: 'bm:theme'; dark: boolean };

export function parseThemeMessage(data: unknown): ThemeMessage | null {
  if (typeof data !== 'object' || data === null) return null;
  const record = data as Record<string, unknown>;
  if (record.type !== 'bm:theme' || typeof record.dark !== 'boolean') return null;
  return { type: 'bm:theme', dark: record.dark };
}

export type BridgeOptions = {
  parentOrigin: string | null;
  onTheme: (dark: boolean) => void;
};

export function startBridge(win: Window, options: BridgeOptions): () => void {
  const { parentOrigin } = options;
  if (parentOrigin === null || win.parent === win) return () => {};

  const onMessage = (event: MessageEvent) => {
    if (event.origin !== parentOrigin || event.source !== win.parent) return;
    const theme = parseThemeMessage(event.data);
    if (theme) options.onTheme(theme.dark);
  };
  win.addEventListener('message', onMessage);
  win.parent.postMessage({ type: 'bm:ready' }, parentOrigin);
  return () => win.removeEventListener('message', onMessage);
}
