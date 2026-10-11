/**
 * 网页启动参数。口令和 dsh 页面的 origin 放在地址的 `#` 后面（不会发给服务器、不进日志），
 * 读到后存起来并从地址栏抹掉；嵌入方式放在查询串 `?embed=main|sidebar`，刷新后仍然有效。
 */

export type EmbedMode = 'main' | 'sidebar' | null;

export type LaunchHash = {
  token: string | null;
  parentOrigin: string | null;
  /** 抹掉 token 和 parent 之后剩下的 hash（不含 `#`），通常为空。 */
  rest: string;
};

export const TOKEN_KEY = 'bluemanta.token';
export const PARENT_KEY = 'bluemanta.parentOrigin';

/** Desktop 主窗口的 origin。这个协议在普通页面里是不透明的，不能靠 `URL.origin` 判断。 */
export const DSH_APP_ORIGIN = 'dsh-app://app';

/** 只接受 `http(s)://host[:port]`，以及 Desktop 的 `dsh-app://app`。 */
export function normalizeOrigin(value: string | null): string | null {
  if (!value) return null;
  const trimmed = value.trim().replace(/\/$/, '');
  if (trimmed === DSH_APP_ORIGIN) return DSH_APP_ORIGIN;
  try {
    const url = new URL(value);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    return url.origin === value.replace(/\/$/, '') ? url.origin : null;
  } catch {
    return null;
  }
}

export function parseLaunchHash(hash: string): LaunchHash {
  const params = new URLSearchParams(hash.replace(/^#/, ''));
  const token = params.get('token')?.trim() || null;
  const parentOrigin = normalizeOrigin(params.get('parent'));
  params.delete('token');
  params.delete('parent');
  return { token, parentOrigin, rest: params.toString() };
}

export function parseEmbed(search: string): EmbedMode {
  const value = new URLSearchParams(search).get('embed');
  return value === 'main' || value === 'sidebar' ? value : null;
}

export type Launch = {
  token: string | null;
  parentOrigin: string | null;
  embed: EmbedMode;
  /**
   * 右侧栏标签打开时地址就是 `/ideas/<id>`。
   * 这种详情不显示返回；从清单点进来的不算。
   */
  sidebarDirect: boolean;
};

/** 右侧栏一打开就是单条灵感（不是统计、回收站或清单）。 */
export function isDirectSidebarIdea(pathname: string, embed: EmbedMode): boolean {
  if (embed !== 'sidebar') return false;
  const match = pathname.match(/^\/ideas\/([^/]+)\/?$/);
  if (!match || !match[1]) return false;
  return match[1] !== 'stats' && match[1] !== 'trash';
}

type BrowserLike = {
  location: { pathname: string; search: string; hash: string };
  history: { state: unknown; replaceState: (state: unknown, unused: string, url: string) => void };
  localStorage: Pick<Storage, 'getItem' | 'setItem'>;
  sessionStorage: Pick<Storage, 'getItem' | 'setItem'>;
};

/** 在渲染前调用一次。 */
export function readLaunch(win: BrowserLike): Launch {
  const hash = parseLaunchHash(win.location.hash);
  if (hash.token) win.localStorage.setItem(TOKEN_KEY, hash.token);
  if (hash.parentOrigin) win.sessionStorage.setItem(PARENT_KEY, hash.parentOrigin);
  if (/(^#|&)(token|parent)=/.test(win.location.hash)) {
    const url = `${win.location.pathname}${win.location.search}${hash.rest ? `#${hash.rest}` : ''}`;
    win.history.replaceState(win.history.state, '', url);
  }
  const embed = parseEmbed(win.location.search);
  return {
    token: hash.token ?? win.localStorage.getItem(TOKEN_KEY),
    parentOrigin: hash.parentOrigin ?? normalizeOrigin(win.sessionStorage.getItem(PARENT_KEY)),
    embed,
    sidebarDirect: isDirectSidebarIdea(win.location.pathname, embed),
  };
}
