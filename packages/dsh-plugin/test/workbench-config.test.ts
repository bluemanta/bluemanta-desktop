import { describe, expect, it, vi } from 'vitest';
import {
  CONSOLE_PROBE_TIMEOUT_MS,
  DEFAULT_CONSOLE_URL,
  loadWorkbenchConfig,
  probeConsole,
  resolveConsoleUrl,
} from '../src/workbench-config.js';

const url = 'http://localhost:3002/dashboard?view=today';
const offline = '工作台没有在运行（http://localhost:3002）。请先启动 SalesOS Console，插件不会替你启动。';

describe('工作台地址', () => {
  it.each([undefined, '', '   '])('空值使用默认地址 (%s)', (raw) => {
    expect(DEFAULT_CONSOLE_URL).toBe('http://127.0.0.1:3001/dashboard');
    expect(resolveConsoleUrl(raw)).toEqual({ ok: true, url: DEFAULT_CONSOLE_URL });
  });

  it.each([url, 'http://127.0.0.1:3002/', 'http://[::1]:3002/dashboard', 'http://localhost:80/'])(
    '保留显式端口、路径和查询，去掉 hash (%s)', (value) => {
      expect(resolveConsoleUrl(' ' + value + '#fragment ')).toEqual({ ok: true, url: value });
    },
  );

  it.each([
    ['https://localhost:3002', 'http 协议'],
    ['http://example.invalid:3002', '本机地址'],
    ['http://127.1:3002', '本机地址'],
    ['http://localhost/?port=:3002', '端口'],
    ['http://[::1]/', '端口'],
    ['http://sample:secret@localhost:3002', '用户名或密码'],
    ['http://localhost:70000', '端口'],
    ['invalid', '格式'],
  ])('拒绝无效地址并说明原因 (%s)', (input, reason) => {
    expect(resolveConsoleUrl(input)).toEqual({ ok: false, reason: expect.stringContaining(reason) });
  });
});

describe('Console 在线探测', () => {
  it.each([200, 302, 404])('用 GET 取响应头，%i 即在线', async (status) => {
    const get = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status }));
    await expect(probeConsole(url, get)).resolves.toEqual({ ok: true });
    expect(get).toHaveBeenCalledExactlyOnceWith(url, {
      method: 'GET', redirect: 'manual', signal: expect.any(AbortSignal),
    });
  });

  it('500 起返回状态码和 origin', async () => {
    await expect(probeConsole(url, async () => new Response(null, { status: 500 }))).resolves.toEqual({
      ok: false, reason: '工作台返回 500（http://localhost:3002）',
    });
  });

  it('拒绝连接时提示先启动 Console', async () => {
    const refused = vi.fn<typeof fetch>().mockRejectedValue(new Error('ECONNREFUSED'));
    await expect(probeConsole(url, refused)).resolves.toEqual({ ok: false, reason: offline });
  });

  it('达到超时时限后中止 GET 并提示离线', async () => {
    expect(CONSOLE_PROBE_TIMEOUT_MS).toBe(1500);
    const pending: typeof fetch = (_url, init) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(init.signal?.reason), { once: true });
    });
    await expect(probeConsole(url, pending, 5)).resolves.toEqual({ ok: false, reason: offline });
  });
});

describe('工作台配置', () => {
  it('只探测合法 URL，失败结果不回显无效配置中的凭据', async () => {
    const get = vi.fn<typeof fetch>().mockResolvedValue(new Response());
    const invalid = await loadWorkbenchConfig({ BLUEMANTA_CONSOLE_URL: 'http://sample:secret@localhost:3002' }, get);
    expect(invalid).toEqual({ ok: false, url: '', reason: expect.stringContaining('密码') });
    expect(get).not.toHaveBeenCalled();
    await expect(loadWorkbenchConfig({ BLUEMANTA_CONSOLE_URL: url + '#hash' }, get)).resolves.toEqual({ ok: true, url });
    expect(get.mock.calls[0]?.[0]).toBe(url);
  });

  it('读取配置和请求抛出的异常都转成失败结果', async () => {
    const get = vi.fn<typeof fetch>().mockImplementation(() => { throw new Error('unavailable'); });
    const env = { get BLUEMANTA_CONSOLE_URL(): string { throw new Error('unreadable'); } };
    await expect(loadWorkbenchConfig(env, get)).resolves.toMatchObject({ ok: false, reason: expect.any(String) });
    expect(get).not.toHaveBeenCalled();
    await expect(loadWorkbenchConfig({ BLUEMANTA_CONSOLE_URL: url }, get)).resolves.toEqual({ ok: false, url, reason: offline });
  });
});
