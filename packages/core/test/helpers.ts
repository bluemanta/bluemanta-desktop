import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openCore, type CardCreateInput, type CommandResult, type Core } from '../src/index.js';

export const human = { kind: 'human' as const, name: '测试者' };
export const agent = { kind: 'agent' as const, name: '测试代理' };

let sequence = 0;

export function req(): string {
  sequence += 1;
  return `req_${sequence}`;
}

export function must<T>(result: CommandResult<T>): T {
  if (!result.ok) throw new Error(`${result.code}: ${result.message}`);
  return result.record;
}

export function withCore(run: (core: Core, dir: string) => void): void {
  const dir = mkdtempSync(join(tmpdir(), 'bluemanta-core-'));
  const core = openCore({ dataDir: dir });
  try {
    run(core, dir);
  } finally {
    core.close();
    rmSync(dir, { recursive: true, force: true });
  }
}

export function tempDir(): string {
  return mkdtempSync(join(tmpdir(), 'bluemanta-core-'));
}

export function removeDir(dir: string): void {
  rmSync(dir, { recursive: true, force: true });
}

type IdeaInput = Extract<CardCreateInput, { cardType: 'idea' }>;

export function idea(overrides: Partial<IdeaInput> = {}): IdeaInput {
  return {
    requestId: req(),
    source: human,
    cardType: 'idea',
    title: '一个想法',
    body: '正文',
    rawInput: { status: 'present', channel: 'web', text: '原始输入' },
    fields: { category: 'product', categorySource: 'user', captureGroupId: null },
    ...overrides,
  };
}
