import { describe, expect, it } from 'vitest';
import { PLUGIN_PACKAGE, pluginNeedsAdd, profileNeedsCreate } from '../src/dev-dsh-plan.js';

describe('dev:dsh 重复运行', () => {
  it('profile 目录已存在时跳过创建，插件已在依赖里时跳过安装', () => {
    expect(profileNeedsCreate(false)).toBe(true);
    expect(profileNeedsCreate(true)).toBe(false);
    expect(pluginNeedsAdd([])).toBe(true);
    expect(pluginNeedsAdd(['other'])).toBe(true);
    expect(pluginNeedsAdd([PLUGIN_PACKAGE])).toBe(false);
    expect(pluginNeedsAdd(undefined)).toBe(true);
  });
});
