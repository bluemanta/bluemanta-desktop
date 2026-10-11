import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { shouldShowRaw } from '../src/raw-text.js';

describe('原文是否显示', () => {
  it('正文和原文不同时显示，相同、正文已包含、legacy 或空白时不显示', () => {
    const present = { status: 'present' as const, channel: 'web' as const, text: '用户原话' };
    expect(shouldShowRaw('整理后的正文', present)).toBe(true);
    expect(shouldShowRaw('用户原话', present)).toBe(false);
    expect(shouldShowRaw('  用户原话  ', { ...present, text: '用户原话' })).toBe(false);
    expect(shouldShowRaw('用户   原话', { ...present, text: '用户 原话' })).toBe(false);
    expect(shouldShowRaw('前缀 用户原话 后缀', present)).toBe(false);
    expect(shouldShowRaw('整理后的正文\n用户原话', { ...present, text: '用户\n原话' })).toBe(false);
    expect(shouldShowRaw('整理后的正文', { status: 'legacy' })).toBe(false);
    expect(shouldShowRaw('整理后的正文', { status: 'present', channel: 'agent', text: '   ' })).toBe(false);
    expect(shouldShowRaw('整理后的正文', null)).toBe(false);
  });

  it('浏览器端内嵌了同一套判断', () => {
    const root = fileURLToPath(new URL('..', import.meta.url));
    const library = readFileSync(root + 'src/raw-text.js', 'utf8').replace(/^export /gm, '');
    const client = readFileSync(root + 'client.js', 'utf8');
    const normalized = (value: string) => value.replace(/\s+/g, ' ').trim();
    expect(normalized(client).includes(normalized(library))).toBe(true);
  });
});
