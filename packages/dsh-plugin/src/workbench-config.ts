export const DEFAULT_CONSOLE_URL = 'http://127.0.0.1:3001/dashboard';
export const WORKBENCH_CONFIG_PATH = 'api/bluemanta/workbench-config';
export const CONSOLE_PROBE_TIMEOUT_MS = 1500;

export type ConsoleUrlResult = { ok: true; url: string } | { ok: false; reason: string };
export type WorkbenchConfig = { ok: true; url: string } | { ok: false; url: string; reason: string };

export function resolveConsoleUrl(raw: string | undefined): ConsoleUrlResult {
  const input = raw?.trim() || DEFAULT_CONSOLE_URL;
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    return { ok: false, reason: '工作台地址格式无效，请检查主机和端口。' };
  }
  if (url.protocol !== 'http:') return { ok: false, reason: '工作台地址只接受 http 协议。' };

  // URL 会展开 IPv4 简写、抹掉默认端口。按原始主机和端口核对配置。
  const authority = /^http:\/\/([^/?#]*)/i.exec(input)?.[1] ?? '';
  if (url.username || url.password || authority.includes('@')) {
    return { ok: false, reason: '工作台地址不能带用户名或密码。' };
  }
  const host = authority.replace(/:\d*$/, '').toLowerCase();
  if (host !== url.hostname || !['127.0.0.1', 'localhost', '[::1]'].includes(host)) {
    return { ok: false, reason: '工作台地址只能是本机地址：127.0.0.1、localhost 或 [::1]。' };
  }
  if (!/:\d+$/.test(authority)) return { ok: false, reason: '工作台地址必须写明端口。' };
  url.hash = '';
  const href = url.port ? url.href : url.href.replace(url.origin, url.origin + ':80');
  return { ok: true, url: href };
}

export async function probeConsole(
  url: string,
  fetchImpl: typeof fetch = globalThis.fetch,
  timeoutMs: number = CONSOLE_PROBE_TIMEOUT_MS,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const origin = new URL(url).origin;
  try {
    const response = await fetchImpl(url, {
      method: 'GET',
      redirect: 'manual',
      signal: AbortSignal.timeout(timeoutMs),
    });
    // 只取响应头。及时释放可能仍在传输的页面正文。
    void response.body?.cancel().catch(() => {});
    if (response.status >= 500) return { ok: false, reason: `工作台返回 ${response.status}（${origin}）` };
    return { ok: true };
  } catch {
    return { ok: false, reason: `工作台没有在运行（${origin}）。请先启动 SalesOS Console，插件不会替你启动。` };
  }
}

export async function loadWorkbenchConfig(env: NodeJS.ProcessEnv, fetchImpl?: typeof fetch): Promise<WorkbenchConfig> {
  let url = '';
  try {
    const resolved = resolveConsoleUrl(env.BLUEMANTA_CONSOLE_URL);
    if (!resolved.ok) return { ...resolved, url };
    url = resolved.url;
    return { ...await probeConsole(url, fetchImpl), url };
  } catch {
    return { ok: false, url, reason: '读取工作台配置失败。' };
  }
}
