import { useIdeaList } from '../api/queries';
import type { IconName } from '../ui/Icon';

export type ModuleSection = {
  id: string;
  label: string;
  path: string;
};

export type ModuleCommand = {
  id: string;
  label: string;
  path: string;
};

/** A top-level workbench module. New modules register their shell metadata here. */
export type WorkbenchModule = {
  id: string;
  name: string;
  icon: IconName;
  pathPrefix: string;
  rootPath: string;
  sections: readonly ModuleSection[];
  commands: readonly ModuleCommand[];
  useCount?: () => number | undefined;
};

function useIdeasCount(): number | undefined {
  return useIdeaList().data?.count;
}

export const IDEAS_MODULE: WorkbenchModule = {
  id: 'ideas',
  name: '灵感台',
  icon: 'idea',
  pathPrefix: '/ideas',
  rootPath: '/ideas',
  useCount: useIdeasCount,
  sections: [
    { id: 'list', label: '清单', path: '/ideas' },
    { id: 'stats', label: '统计', path: '/ideas/stats' },
    { id: 'trash', label: '回收站', path: '/ideas/trash' },
  ],
  commands: [
    { id: 'list', label: '切换到清单', path: '/ideas' },
    { id: 'stats', label: '切换到统计', path: '/ideas/stats' },
    { id: 'trash', label: '打开回收站', path: '/ideas/trash' },
  ],
};

export const MODULES: readonly WorkbenchModule[] = [IDEAS_MODULE];

export function moduleForPath(path: string, modules: readonly WorkbenchModule[] = MODULES): WorkbenchModule | undefined {
  return modules.find((module) => path === module.pathPrefix || path.startsWith(`${module.pathPrefix}/`));
}

export function moduleSwitchCommands(modules: readonly WorkbenchModule[]): ModuleCommand[] {
  if (modules.length < 2) return [];
  return modules.map((module) => ({ id: `module-${module.id}`, label: `切换到 ${module.name}`, path: module.rootPath }));
}
