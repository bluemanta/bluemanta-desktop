import { describe, expect, it } from 'vitest';
import { DSH_APP_ORIGIN, normalizeOrigin, parseEmbed, parseLaunchHash, PARENT_KEY, readLaunch, TOKEN_KEY } from './launch';

function memoryStorage(): Pick<Storage, 'getItem' | 'setItem'> & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return { data, getItem: (key) => data.get(key) ?? null, setItem: (key, value) => void data.set(key, value) };
}

function fakeWindow(url: string) {
  const parsed = new URL(url);
  const replaced: string[] = [];
  return {
    replaced,
    location: { pathname: parsed.pathname, search: parsed.search, hash: parsed.hash },
    history: { state: null, replaceState: (_state: unknown, _unused: string, next: string) => void replaced.push(next) },
    localStorage: memoryStorage(),
    sessionStorage: memoryStorage(),
  };
}

describe('启动参数', () => {
  it('从 hash 读口令和父窗口 origin，并从地址栏抹掉', () => {
    const win = fakeWindow('http://127.0.0.1:9/ideas?embed=main#token=abc&parent=http%3A%2F%2Flocalhost%3A5000');
    const launch = readLaunch(win);
    expect(launch).toEqual({ token: 'abc', parentOrigin: 'http://localhost:5000', embed: 'main', sidebarDirect: false });
    expect(win.localStorage.data.get(TOKEN_KEY)).toBe('abc');
    expect(win.sessionStorage.data.get(PARENT_KEY)).toBe('http://localhost:5000');
    expect(win.replaced).toEqual(['/ideas?embed=main']);
  });

  it('没有 hash 时用存下的口令，不改地址', () => {
    const win = fakeWindow('http://127.0.0.1:9/ideas');
    win.localStorage.setItem(TOKEN_KEY, 'saved');
    expect(readLaunch(win).token).toBe('saved');
    expect(win.replaced).toEqual([]);
  });

  it('不认可的 origin 和嵌入值', () => {
    expect(normalizeOrigin('javascript:alert(1)')).toBeNull();
    expect(normalizeOrigin('http://a.test/path')).toBeNull();
    expect(normalizeOrigin('http://a.test/')).toBe('http://a.test');
    expect(parseLaunchHash('#parent=*').parentOrigin).toBeNull();
    expect(normalizeOrigin(DSH_APP_ORIGIN)).toBe(DSH_APP_ORIGIN);
    expect(normalizeOrigin('dsh-app://app/')).toBe(DSH_APP_ORIGIN);
    expect(normalizeOrigin('dsh-app://other')).toBeNull();
    expect(parseEmbed('?embed=other')).toBeNull();
    expect(parseEmbed('?embed=sidebar')).toBe('sidebar');
  });

  it('只有右侧栏一开始就是单条灵感时不给返回', () => {
    expect(readLaunch(fakeWindow('http://127.0.0.1:9/ideas/card_1?embed=sidebar')).sidebarDirect).toBe(true);
    expect(readLaunch(fakeWindow('http://127.0.0.1:9/ideas?embed=sidebar')).sidebarDirect).toBe(false);
    expect(readLaunch(fakeWindow('http://127.0.0.1:9/ideas/stats?embed=sidebar')).sidebarDirect).toBe(false);
    expect(readLaunch(fakeWindow('http://127.0.0.1:9/ideas/trash?embed=sidebar')).sidebarDirect).toBe(false);
    expect(readLaunch(fakeWindow('http://127.0.0.1:9/ideas/card_1')).sidebarDirect).toBe(false);
  });
});
