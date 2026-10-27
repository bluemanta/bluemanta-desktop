/**
 * 与 dsh 的消息桥（docs/phase-1-5.md 第 3 节）。
 * 网页 → dsh：`bm:ready`、`bm:openSidebar`、`bm:quote`、`bm:dirty`。
 * dsh → 网页：`bm:theme { dark }`、`bm:chrome { leadingClearance }`、`bm:result { action, ok, reason? }`。
 * 只和 `#parent=<origin>` 指定的父窗口通信；没指定时既不发也不收。
 */

export type ThemeMessage = { type: 'bm:theme'; dark: boolean };

export type ChromeMessage = { type: 'bm:chrome'; leadingClearance: number };

export type ResultMessage = {
  type: 'bm:result';
  action: string;
  ok: boolean;
  reason?: string;
  requestId?: number;
};

export type ParentRequest = {
  type: 'bm:openSidebar' | 'bm:quote';
  id: string;
  title: string;
};

export const STANDALONE_HINT = '在 dsh 的对话里才能使用';

export function parseThemeMessage(data: unknown): ThemeMessage | null {
  if (typeof data !== 'object' || data === null) return null;
  const record = data as Record<string, unknown>;
  if (record.type !== 'bm:theme' || typeof record.dark !== 'boolean') return null;
  return { type: 'bm:theme', dark: record.dark };
}

/** 只接受有限的非负像素数。字符串、负数、NaN、Infinity 都丢掉。 */
export function parseChromeMessage(data: unknown): ChromeMessage | null {
  if (typeof data !== 'object' || data === null) return null;
  const record = data as Record<string, unknown>;
  if (record.type !== 'bm:chrome' || typeof record.leadingClearance !== 'number') return null;
  if (!Number.isFinite(record.leadingClearance) || record.leadingClearance < 0) return null;
  return { type: 'bm:chrome', leadingClearance: record.leadingClearance };
}

export function parseResultMessage(data: unknown): ResultMessage | null {
  if (typeof data !== 'object' || data === null) return null;
  const record = data as Record<string, unknown>;
  if (record.type !== 'bm:result' || typeof record.ok !== 'boolean') return null;
  const action = typeof record.action === 'string' ? record.action : '';
  const reason = typeof record.reason === 'string' && record.reason !== '' ? record.reason : undefined;
  const requestId = typeof record.requestId === 'number' ? record.requestId : undefined;
  return {
    type: 'bm:result',
    action,
    ok: record.ok,
    ...(reason ? { reason } : {}),
    ...(requestId !== undefined ? { requestId } : {}),
  };
}

type BridgeState = { waiters: Map<number, (result: ResultMessage) => void>; next: number };

function stateOf(win: Window): BridgeState {
  const host = win as Window & { __bmBridge?: BridgeState };
  host.__bmBridge ??= { waiters: new Map(), next: 1 };
  return host.__bmBridge;
}

export function canTalkToParent(win: Window, parentOrigin: string | null): boolean {
  return parentOrigin !== null && win.parent !== win;
}

export function postToParent(win: Window, parentOrigin: string | null, message: object): boolean {
  if (!canTalkToParent(win, parentOrigin) || parentOrigin === null) return false;
  win.parent.postMessage(message, parentOrigin);
  return true;
}

export type BridgeOptions = {
  parentOrigin: string | null;
  onTheme: (dark: boolean) => void;
  onChrome?: (leadingClearance: number) => void;
};

export function startBridge(win: Window, options: BridgeOptions): () => void {
  const { parentOrigin } = options;
  if (!canTalkToParent(win, parentOrigin) || parentOrigin === null) return () => {};

  const onMessage = (event: MessageEvent) => {
    if (event.origin !== parentOrigin || event.source !== win.parent) return;
    const theme = parseThemeMessage(event.data);
    if (theme) options.onTheme(theme.dark);
    const chrome = parseChromeMessage(event.data);
    if (chrome) options.onChrome?.(chrome.leadingClearance);
    const result = parseResultMessage(event.data);
    if (result?.requestId === undefined) return;
    const waiter = stateOf(win).waiters.get(result.requestId);
    if (!waiter) return;
    stateOf(win).waiters.delete(result.requestId);
    waiter(result);
  };
  win.addEventListener('message', onMessage);
  postToParent(win, parentOrigin, { type: 'bm:ready' });
  return () => win.removeEventListener('message', onMessage);
}

/** 请父窗口执行。独立打开时立刻返回「在 dsh 的对话里才能使用」，不发消息。 */
export function requestParent(
  win: Window,
  parentOrigin: string | null,
  message: ParentRequest,
  timeoutMs = 8_000,
): Promise<ResultMessage> {
  if (!canTalkToParent(win, parentOrigin)) {
    return Promise.resolve({ type: 'bm:result', action: message.type, ok: false, reason: STANDALONE_HINT });
  }
  const state = stateOf(win);
  const requestId = state.next;
  state.next += 1;
  return new Promise((resolve) => {
    const timer = win.setTimeout(() => {
      state.waiters.delete(requestId);
      resolve({ type: 'bm:result', action: message.type, ok: false, reason: '没有收到 dsh 的回复', requestId });
    }, timeoutMs);
    state.waiters.set(requestId, (result) => {
      win.clearTimeout(timer);
      resolve(result);
    });
    postToParent(win, parentOrigin, { ...message, requestId });
  });
}
