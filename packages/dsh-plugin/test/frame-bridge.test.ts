import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { appendQuote, embedFrameUrl, isOwnFrameMessage, messageOrigin, quoteText } from '../src/frame-bridge.js';

describe('消息来源', () => {
  const base = 'http://127.0.0.1:4310';
  const frame = { contentWindow: { name: 'ours' } };
  const other = { contentWindow: { name: 'theirs' } };

  it('只接受自己的框，且 origin 等于 baseUrl', () => {
    const frames = new Set([frame]);
    const event = { origin: 'http://127.0.0.1:4310', source: frame.contentWindow, data: { type: 'bm:ready' } };
    expect(isOwnFrameMessage(frames, event, base)).toBe(true);
    expect(isOwnFrameMessage(frames, { ...event, origin: 'http://evil.test' }, base)).toBe(false);
    expect(isOwnFrameMessage(frames, { ...event, source: other.contentWindow }, base)).toBe(false);
    expect(isOwnFrameMessage(frames, { ...event, source: null }, base)).toBe(false);
    expect(isOwnFrameMessage(frames, event, '')).toBe(false);
    expect(isOwnFrameMessage(null, event, base)).toBe(false);
  });

  it('地址带口令和父窗口 origin，右侧栏带 id', () => {
    expect(messageOrigin('http://127.0.0.1:4310/')).toBe('http://127.0.0.1:4310');
    expect(embedFrameUrl(base, 'abc', 'http://localhost:3092', 'main', '')).toBe(
      'http://127.0.0.1:4310/ideas?embed=main#token=abc&parent=http%3A%2F%2Flocalhost%3A3092',
    );
    expect(embedFrameUrl(base, 'abc', 'dsh-app://app', 'sidebar', 'card 1')).toBe(
      'http://127.0.0.1:4310/ideas/card%201?embed=sidebar#token=abc&parent=dsh-app%3A%2F%2Fapp',
    );
  });

  it('引用文字追加在草稿末尾', () => {
    expect(quoteText('card_1', '海边')).toBe('【灵感】海边（bluemanta 灵感 id：card_1）');
    expect(appendQuote('请看这条灵感', quoteText('card_1', '海边'))).toBe(
      '请看这条灵感 【灵感】海边（bluemanta 灵感 id：card_1） ',
    );
    expect(appendQuote('  ', '【灵感】')).toBe('【灵感】 ');
    expect(appendQuote('已有  ', '下一句')).toBe('已有 下一句 ');
  });
});

describe('浏览器端内嵌消息桥', () => {
  it('client.js 含有同一份纯函数，回复不用星号 origin', () => {
    const root = fileURLToPath(new URL('..', import.meta.url));
    const library = readFileSync(root + 'src/frame-bridge.js', 'utf8').replace(/^export /gm, '');
    const client = readFileSync(root + 'client.js', 'utf8');
    const normalized = (value: string) => value.replace(/\s+/g, ' ').trim();
    expect(normalized(client).includes(normalized(library))).toBe(true);
    expect(client).not.toMatch(/postMessage\([\s\S]{0,120}'\*'/);
    expect(client).not.toContain('api/bluemanta/cards');
    expect(client).not.toContain('api/bluemanta/commands');
    expect(client).not.toContain('api/bluemanta/attachment');
    expect(client).not.toContain('api/bluemanta/health');
    expect(client).toContain('api/bluemanta/web-config');
    expect(client).toContain('正在打开灵感台…');
    expect(client).toContain("inject: ['slots', 'sidebarRightTabs', 'sidebarRight', 'sessions']");
  });
});
