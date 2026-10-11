import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { shouldShowRaw } from '../src/raw-text.js';

type ShowRaw = typeof shouldShowRaw;

const present = { status: 'present' as const, channel: 'web' as const, text: '用户原话' };

const CASES: Array<[Parameters<ShowRaw>[0], Parameters<ShowRaw>[1], boolean]> = [
  ['整理后的正文', present, true],
  ['用户原话', present, false],
  ['  用户原话  ', { ...present, text: '用户原话' }, false],
  ['用户   原话', { ...present, text: '用户 原话' }, false],
  ['前缀 用户原话 后缀', present, false],
  ['整理后的正文\n用户  原话', { ...present, text: '用户\n原话' }, false],
  ['整理后的正文\n用户原话', { ...present, text: '用户\n原话' }, true],
  ['整理后的正文', { status: 'legacy' }, false],
  ['整理后的正文', { status: 'present', channel: 'agent', text: '   ' }, false],
  ['整理后的正文', null, false],
  [null, present, true],
  ['', { status: 'present', channel: 'bot', text: '' }, false],
];

function clientShouldShowRaw(): ShowRaw {
  const root = fileURLToPath(new URL('..', import.meta.url));
  const client = readFileSync(root + 'client.js', 'utf8');
  const start = client.indexOf('function foldSpace(value) {');
  const end = client.indexOf('return true;\n    }', client.indexOf('function shouldShowRaw(body, rawInput) {'));
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  const source = client.slice(start, end) + 'return true;\n}\nreturn shouldShowRaw;';
  return new Function(source)() as ShowRaw;
}

describe('原文是否显示', () => {
  it('正文和原文不同时显示，相同、正文已包含、legacy 或空白时不显示', () => {
    for (const [body, raw, expected] of CASES) {
      expect(shouldShowRaw(body, raw)).toBe(expected);
    }
  });

  it('浏览器端内嵌的判断与 core 一致', () => {
    const fromClient = clientShouldShowRaw();
    for (const [body, raw, expected] of CASES) {
      expect(fromClient(body, raw)).toBe(expected);
    }
  });
});
