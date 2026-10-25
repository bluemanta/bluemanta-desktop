import { describe, expect, it } from 'vitest';
import { IDEAS_MODULE, moduleForPath, moduleSwitchCommands, type WorkbenchModule } from './modules';

const fake: WorkbenchModule = {
  id: 'fake',
  name: '假模块',
  icon: 'extension',
  pathPrefix: '/fake',
  rootPath: '/fake',
  sections: [{ id: 'home', label: '首页', path: '/fake' }],
  commands: [{ id: 'home', label: '打开首页', path: '/fake' }],
};

describe('workbench module registry', () => {
  it('matches a module by its path prefix', () => {
    expect(moduleForPath('/ideas/stats', [IDEAS_MODULE, fake])?.id).toBe('ideas');
    expect(moduleForPath('/fake/item/one', [IDEAS_MODULE, fake])?.id).toBe('fake');
    expect(moduleForPath('/unknown', [IDEAS_MODULE, fake])).toBeUndefined();
  });

  it('builds switching commands for registered modules', () => {
    const modules = [IDEAS_MODULE, fake];
    expect(moduleSwitchCommands(modules)).toContainEqual({ id: 'module-fake', label: '切换到 假模块', path: '/fake' });
  });

  it('does not show redundant module switching with one module', () => {
    expect(moduleSwitchCommands([IDEAS_MODULE])).toEqual([]);
  });
});
