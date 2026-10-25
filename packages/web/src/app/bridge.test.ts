import { describe, expect, it } from 'vitest';
import { canTalkToParent, parseResultMessage, postToParent, requestParent, STANDALONE_HINT, startBridge } from './bridge';

type Listener = (event: { origin: string; source: unknown; data: unknown }) => void;

function fakeWindow(parentOrigin: string | null) {
  const listeners: Listener[] = [];
  const posted: unknown[] = [];
  const parent = {
    postMessage(message: unknown, origin: string) {
      posted.push({ message, origin });
    },
  };
  const win = {
    parent,
    setTimeout(fn: () => void) {
      return fn as unknown as number;
    },
    clearTimeout() {},
    addEventListener(_type: string, listener: Listener) {
      listeners.push(listener);
    },
    removeEventListener(_type: string, listener: Listener) {
      const index = listeners.indexOf(listener);
      if (index >= 0) listeners.splice(index, 1);
    },
    emit(data: unknown, origin = parentOrigin ?? 'http://evil.test', source: unknown = parent) {
      for (const listener of [...listeners]) listener({ origin, source, data });
    },
  };
  return { win: win as unknown as Window, posted, parent, emit: win.emit, listeners };
}

describe('消息桥', () => {
  it('独立窗口不发消息，请求直接说明原因', async () => {
    const { win, posted } = fakeWindow(null);
    Object.defineProperty(win, 'parent', { value: win });
    expect(canTalkToParent(win, null)).toBe(false);
    expect(postToParent(win, null, { type: 'bm:dirty', dirty: true })).toBe(false);
    await expect(requestParent(win, null, { type: 'bm:quote', id: 'card_1', title: '海边' })).resolves.toEqual({
      type: 'bm:result',
      action: 'bm:quote',
      ok: false,
      reason: STANDALONE_HINT,
    });
    expect(posted).toEqual([]);
  });

  it('只收父窗口 origin 的结果，错误 origin 和其他来源忽略', async () => {
    const { win, posted, emit } = fakeWindow('http://localhost:3092');
    const themes: boolean[] = [];
    startBridge(win, { parentOrigin: 'http://localhost:3092', onTheme: (dark) => themes.push(dark) });
    expect(posted).toEqual([{ message: { type: 'bm:ready' }, origin: 'http://localhost:3092' }]);

    const pending = requestParent(win, 'http://localhost:3092', { type: 'bm:openSidebar', id: 'card_1', title: '海边' });
    const sent = posted[1] as { message: { requestId: number }; origin: string };
    expect(sent.origin).toBe('http://localhost:3092');
    expect(sent.message).toMatchObject({ type: 'bm:openSidebar', id: 'card_1', title: '海边' });

    emit({ type: 'bm:theme', dark: true }, 'http://evil.test');
    emit({ type: 'bm:result', action: '在右侧栏打开', ok: false, reason: '伪造', requestId: sent.message.requestId }, 'http://evil.test');
    emit({ type: 'bm:result', action: '在右侧栏打开', ok: false, reason: '不是父窗口', requestId: sent.message.requestId }, 'http://localhost:3092', { name: 'other' });
    expect(themes).toEqual([]);

    emit({ type: 'bm:theme', dark: true });
    emit({ type: 'bm:result', action: '在右侧栏打开', ok: true, requestId: sent.message.requestId });
    expect(themes).toEqual([true]);
    await expect(pending).resolves.toEqual({ type: 'bm:result', action: '在右侧栏打开', ok: true, requestId: sent.message.requestId });
  });

  it('bm:chrome 只接受父窗口的有限非负数，其他来源、非数字和负数都忽略', () => {
    const { win, emit } = fakeWindow('http://localhost:3092');
    const values: number[] = [];
    startBridge(win, {
      parentOrigin: 'http://localhost:3092',
      onTheme: () => {},
      onChrome: (value) => values.push(value),
    });

    emit({ type: 'bm:chrome', leadingClearance: 160 }, 'http://evil.test');
    emit({ type: 'bm:chrome', leadingClearance: 160 }, 'http://localhost:3092', { name: 'other' });
    emit({ type: 'bm:chrome', leadingClearance: '160' });
    emit({ type: 'bm:chrome', leadingClearance: -1 });
    emit({ type: 'bm:chrome', leadingClearance: Number.NaN });
    emit({ type: 'bm:chrome', leadingClearance: Number.POSITIVE_INFINITY });
    emit({ type: 'bm:chrome' });
    emit({ type: 'bm:chrome', leadingClearance: null });
    expect(values).toEqual([]);

    emit({ type: 'bm:chrome', leadingClearance: 160 });
    emit({ type: 'bm:chrome', leadingClearance: 0 });
    emit({ type: 'bm:chrome', leadingClearance: 84 });
    expect(values).toEqual([160, 0, 84]);
  });

  it('解析结果时丢掉空原因', () => {
    expect(parseResultMessage({ type: 'bm:result', ok: false })).toEqual({ type: 'bm:result', action: '', ok: false });
    expect(parseResultMessage({ type: 'bm:theme', dark: true })).toBeNull();
    expect(parseResultMessage(null)).toBeNull();
  });
});
