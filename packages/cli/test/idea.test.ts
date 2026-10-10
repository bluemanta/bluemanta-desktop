import { spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openCore } from '@bluemanta/core';
import { afterEach, describe, expect, it } from 'vitest';
import { resolveDataDir } from '../src/data-dir.js';

const ideaJs = fileURLToPath(new URL('../dist/idea.js', import.meta.url));
const repoRoot = fileURLToPath(new URL('../../..', import.meta.url));
const dirs: string[] = [];

function tempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  while (dirs.length > 0) {
    const dir = dirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

type RunResult = {
  status: number | null;
  stdoutText: string;
  stderrText: string;
  scratchFiles: string[];
  error?: Error;
};

function run(args: string[], input: string, extraEnv: Record<string, string | undefined> = {}): RunResult {
  const scratch = tempDir('bluemanta-cli-scratch-');
  const env: NodeJS.ProcessEnv = { ...process.env, TMPDIR: scratch, TEMP: scratch, TMP: scratch };
  delete env.BLUEMANTA_DATA_DIR;
  for (const [key, value] of Object.entries(extraEnv)) {
    if (value === undefined) delete env[key];
    else env[key] = value;
  }
  const result = spawnSync(process.execPath, [ideaJs, ...args], {
    input,
    encoding: 'utf8',
    env,
    cwd: repoRoot,
    timeout: 15000,
  });
  return {
    status: result.status,
    stdoutText: result.stdout ?? '',
    stderrText: result.stderr ?? '',
    scratchFiles: readdirSync(scratch),
    ...(result.error === undefined ? {} : { error: result.error }),
  };
}

function oneLine(result: RunResult, hidden: string[]): Record<string, unknown> {
  expect(result.error).toBeUndefined();
  expect(result.scratchFiles).toEqual([]);
  expect(result.stdoutText.endsWith('\n')).toBe(true);
  expect(result.stdoutText.slice(0, -1)).not.toContain('\n');
  for (const text of hidden) expect(result.stderrText).not.toContain(text);
  return JSON.parse(result.stdoutText) as Record<string, unknown>;
}

const payload = {
  requestId: 'grok-demo-001',
  title: '虚构的产品标题',
  body: '一句话摘要',
  raw: '用户原话不应该出现在日志里',
  category: 'product',
  source: 'Grokbot',
};

describe('bluemanta-idea', () => {
  it('实现不写临时文件', () => {
    for (const file of ['idea.ts', 'run-idea.ts', 'idea-tools.ts', 'data-dir.ts']) {
      const source = readFileSync(fileURLToPath(new URL(`../src/${file}`, import.meta.url)), 'utf8');
      expect(source).not.toMatch(/writeFile|mkdtemp|createWriteStream|tmpdir\(/);
    }
    const tools = readFileSync(fileURLToPath(new URL('../src/idea-tools.ts', import.meta.url)), 'utf8');
    expect(tools).not.toContain('@deepseek-ai');
  });

  it('add 从标准输入写入，来源和原文 channel 正确，输出只有一行 JSON', () => {
    const dataDir = tempDir('bluemanta-cli-data-');
    const hidden = [payload.body, payload.raw, payload.title];
    const result = run(['add', '--data-dir', dataDir], JSON.stringify(payload), {
      BLUEMANTA_DATA_DIR: tempDir('bluemanta-cli-env-unused-'),
    });
    const body = oneLine(result, hidden);
    expect(result.status).toBe(0);
    expect(result.stdoutText).not.toContain(payload.raw);
    expect(body).toMatchObject({
      ok: true,
      title: '虚构的产品标题',
      category: '产品想法',
      duplicate: false,
    });
    expect(body.createdAt).toEqual(expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/));
    expect(Object.keys(body).sort()).toEqual(['category', 'createdAt', 'duplicate', 'id', 'ok', 'title']);

    const names = readdirSync(dataDir);
    expect(names.every((name) => name === 'store.sqlite' || name.startsWith('store.sqlite-'))).toBe(true);

    const core = openCore({ dataDir });
    try {
      const card = core.getCard(String(body.id));
      expect(card?.title).toBe('虚构的产品标题');
      expect(card?.createdBy).toEqual({ kind: 'agent', name: 'Grokbot' });
      expect(card?.updatedBy).toEqual({ kind: 'agent', name: 'Grokbot' });
      expect(card?.rawInput).toEqual({
        status: 'present',
        channel: 'bot',
        text: payload.raw,
      });
      expect(card?.createdAt).toBe(body.createdAt);
    } finally {
      core.close();
    }
  });

  it('同号同内容重复提交返回 duplicate，同号不同内容失败且退出码非 0', () => {
    const dataDir = tempDir('bluemanta-cli-data-');
    const first = run(['add', '--data-dir', dataDir], JSON.stringify(payload));
    const firstBody = oneLine(first, [payload.raw]);
    const second = run(['add', '--data-dir', dataDir], JSON.stringify(payload));
    const secondBody = oneLine(second, [payload.raw]);
    expect(second.status).toBe(0);
    expect(secondBody).toMatchObject({
      ok: true,
      id: firstBody.id,
      title: firstBody.title,
      duplicate: true,
      createdAt: firstBody.createdAt,
    });

    const mismatch = run(
      ['add', '--data-dir', dataDir],
      JSON.stringify({ ...payload, body: '另一句完全不同的虚构摘要' }),
    );
    const mismatchBody = oneLine(mismatch, ['另一句完全不同的虚构摘要', payload.raw]);
    expect(mismatch.status).not.toBe(0);
    expect(mismatchBody).toEqual({
      ok: false,
      code: 'duplicate_request_mismatch',
      message: '相同 requestId 的内容与首次请求不一致',
    });

    const core = openCore({ dataDir });
    try {
      expect(core.listCards({ cardType: 'idea' })).toHaveLength(1);
      expect(core.listHistory()).toHaveLength(1);
    } finally {
      core.close();
    }
  });

  it('空内容、非法 JSON 和缺少 requestId 都失败，不留下卡片', () => {
    const dataDir = tempDir('bluemanta-cli-data-');
    const blank = run(
      ['add', '--data-dir', dataDir],
      JSON.stringify({ requestId: 'blank-1', title: '   ', body: '\n\t' }),
    );
    expect(blank.status).not.toBe(0);
    expect(oneLine(blank, [])).toMatchObject({ ok: false, code: 'invalid_input' });

    const missing = run(['add', '--data-dir', dataDir], JSON.stringify({ title: '只有标题没有请求号' }));
    expect(missing.status).not.toBe(0);
    expect(oneLine(missing, ['只有标题没有请求号'])).toEqual({
      ok: false,
      code: 'invalid_input',
      message: '缺少 requestId',
    });

    const broken = run(['add', '--data-dir', dataDir], '{不是 json');
    expect(broken.status).not.toBe(0);
    expect(broken.stderrText).not.toContain('不是 json');
    expect(oneLine(broken, [])).toEqual({
      ok: false,
      code: 'invalid_input',
      message: '标准输入不是合法 JSON',
    });

    const core = openCore({ dataDir });
    try {
      expect(core.listCards()).toEqual([]);
    } finally {
      core.close();
    }
  });

  it('省略 raw 时由 core 生成原文，省略 source 时来源名是 bot', () => {
    const dataDir = tempDir('bluemanta-cli-data-');
    const result = run(
      ['--data-dir', dataDir, 'add'],
      JSON.stringify({ requestId: 'no-raw', body: '虚构正文交给 core' }),
    );
    const body = oneLine(result, ['虚构正文交给 core']);
    expect(result.status).toBe(0);
    expect(body).toMatchObject({ ok: true, title: '虚构正文交给 core', duplicate: false });
    const core = openCore({ dataDir });
    try {
      const card = core.getCard(String(body.id));
      expect(card?.createdBy).toEqual({ kind: 'agent', name: 'bot' });
      expect(card?.rawInput).toEqual({
        status: 'present',
        channel: 'agent',
        text: '虚构正文交给 core',
      });
    } finally {
      core.close();
    }
  });

  it('search 和 get 返回与工具函数相同的结果', () => {
    const dataDir = tempDir('bluemanta-cli-data-');
    const added = oneLine(
      run(['add', '--data-dir', dataDir], JSON.stringify(payload)),
      [payload.raw],
    );
    const searched = run(
      ['search', '--data-dir', dataDir],
      JSON.stringify({ query: '一句话摘要', limit: 10 }),
    );
    const searchBody = oneLine(searched, []);
    expect(searched.status).toBe(0);
    expect(searchBody).toMatchObject({
      ok: true,
      count: 1,
      limit: 10,
      message: '',
    });
    const items = searchBody.items as Array<Record<string, unknown>>;
    expect(items[0]).toMatchObject({
      id: added.id,
      title: '虚构的产品标题',
      category: '产品想法',
      field: 'body',
    });
    expect(items[0]?.createdAt).toEqual(expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/));

    const got = run(['get', '--data-dir', dataDir], JSON.stringify({ id: added.id }));
    const getBody = oneLine(got, []);
    expect(got.status).toBe(0);
    expect(getBody).toMatchObject({
      ok: true,
      id: added.id,
      title: '虚构的产品标题',
      body: payload.body,
      category: '产品想法',
      starred: false,
      inTrash: false,
      notice: '',
      rawInput: { status: 'present', channel: 'bot', text: payload.raw },
    });

    const missing = run(['get', '--data-dir', dataDir], JSON.stringify({ id: 'card_missing' }));
    expect(missing.status).not.toBe(0);
    expect(oneLine(missing, [])).toEqual({
      ok: false,
      code: 'not_found',
      message: '没有找到这条灵感',
    });
  });

  it('数据目录已被别的进程打开时仍能写入', () => {
    const dataDir = tempDir('bluemanta-cli-live-');
    const core = openCore({ dataDir });
    try {
      const result = run(
        ['add', '--data-dir', dataDir],
        JSON.stringify({ requestId: 'while-open', title: '打开着也能写' }),
      );
      const body = oneLine(result, ['打开着也能写']);
      expect(result.status).toBe(0);
      expect(core.getCard(String(body.id))?.title).toBe('打开着也能写');
    } finally {
      core.close();
    }
  });

  it('没有 --data-dir 时用 BLUEMANTA_DATA_DIR', () => {
    const dataDir = tempDir('bluemanta-cli-env-');
    const result = run(['add'], JSON.stringify({ requestId: 'from-env', title: '环境变量目录' }), {
      BLUEMANTA_DATA_DIR: dataDir,
    });
    expect(result.status).toBe(0);
    expect(oneLine(result, ['环境变量目录']).ok).toBe(true);
    expect(readdirSync(dataDir).some((name) => name.startsWith('store.sqlite'))).toBe(true);
  });
});

describe('数据目录', () => {
  it('参数优先于环境变量，空白回落到默认目录', () => {
    expect(resolveDataDir('/tmp/flag', { BLUEMANTA_DATA_DIR: '/tmp/env' })).toBe('/tmp/flag');
    expect(resolveDataDir('  ', { BLUEMANTA_DATA_DIR: '  /tmp/env  ' })).toBe('/tmp/env');
    expect(resolveDataDir(undefined, { BLUEMANTA_DATA_DIR: '   ' })).toBe(
      resolveDataDir(undefined, {}),
    );
  });
});
