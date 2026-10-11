import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { htmlPreviewFrameAttrs, htmlPreviewFrameName } from '../src/html-preview-frame.js';

describe('嵌入框交给 dsh 的快捷键标记', () => {
  it('主区 iframe 带 data-html-preview 和固定 name', () => {
    expect(htmlPreviewFrameAttrs('main', '')).toEqual({
      'data-html-preview': '',
      name: 'bluemanta-ideas-main',
    });
    expect(htmlPreviewFrameName('main', 'tab-ignored')).toBe('bluemanta-ideas-main');
  });

  it('右侧栏 name 稳定、非空，不同 tab 不同', () => {
    const first = htmlPreviewFrameAttrs('sidebar', 'tab-1');
    const again = htmlPreviewFrameAttrs('sidebar', 'tab-1');
    const second = htmlPreviewFrameAttrs('sidebar', 'tab-2');
    expect(first).toEqual({
      'data-html-preview': '',
      name: 'bluemanta-ideas-sidebar-tab-1',
    });
    expect(again.name).toBe(first.name);
    expect(second.name).toBe('bluemanta-ideas-sidebar-tab-2');
    expect(second.name).not.toBe(first.name);
    expect(first.name).not.toBe('bluemanta-ideas-main');
  });

  it('不适合做名字的字符会规范化，且不会把两个 tab 收成同一个 name', () => {
    const spaced = htmlPreviewFrameName('sidebar', 'tab 1');
    const literal = htmlPreviewFrameName('sidebar', 'tab~20~1');
    expect(spaced).toBe('bluemanta-ideas-sidebar-tab~20~1');
    expect(spaced).not.toBe(literal);
    expect(htmlPreviewFrameName('sidebar', '')).toBe('bluemanta-ideas-sidebar-~');
    expect(htmlPreviewFrameName('sidebar', 'a/b')).not.toContain('/');
  });
});

describe('client.js 把标记放在主区和右侧栏 iframe 上', () => {
  it('内嵌同一份纯函数，并写明升级 dsh 时要回归', () => {
    const root = fileURLToPath(new URL('..', import.meta.url));
    const library = readFileSync(root + 'src/html-preview-frame.js', 'utf8').replace(/^export /gm, '');
    const client = readFileSync(root + 'client.js', 'utf8');
    const normalized = (value: string) => value.replace(/\s+/g, ' ').trim();
    expect(normalized(client).includes(normalized(library))).toBe(true);
    expect(client).toContain('...htmlPreviewFrameAttrs(embed, tabId)');
    expect(client).toContain('升级 dsh 时要回归');
    expect(client).not.toMatch(/window\.name\s*=/);
  });
});
