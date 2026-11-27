import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { WORKBENCH_CONFIG_PATH } from '../src/workbench-config.js';
import { WORKBENCH_CONFIG_ROUTE, workbenchFrameAttrs } from '../src/workbench-frame.js';

it('工作台使用独立框名，客户端配置路径与服务端一致', () => {
  expect(workbenchFrameAttrs()).toEqual({ 'data-html-preview': '', name: 'bluemanta-workbench-main' });
  expect(WORKBENCH_CONFIG_ROUTE).toBe('api/bluemanta/workbench-config');
  expect(WORKBENCH_CONFIG_ROUTE).toBe(WORKBENCH_CONFIG_PATH);
});

it('client.js 内嵌相同的工作台常量和纯函数', () => {
  const library = readFileSync(new URL('../src/workbench-frame.js', import.meta.url), 'utf8').replace(/^export /gm, '');
  const client = readFileSync(new URL('../client.js', import.meta.url), 'utf8');
  expect(client).toContain(library.trim());
  expect(client).toContain('...workbenchFrameAttrs()');
});
