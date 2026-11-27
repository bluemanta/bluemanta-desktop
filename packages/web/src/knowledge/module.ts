import type { WorkbenchModule } from '../shell/modules';
import { usePersonalOsDueCount } from './api';

/** PersonalOS dashboard (ADR 0011); module identity and URL prefix stay stable. */
export const KNOWLEDGE_MODULE: WorkbenchModule = {
  id: 'knowledge',
  name: '知识台',
  icon: 'book',
  pathPrefix: '/knowledge',
  rootPath: '/knowledge/today',
  useCount: usePersonalOsDueCount,
  sections: [
    { id: 'today', label: '今天', path: '/knowledge/today' },
    { id: 'domains', label: '领域', path: '/knowledge/domains' },
    { id: 'resources', label: '资料', path: '/knowledge/resources' },
    { id: 'sources', label: '接入', path: '/knowledge/sources' },
    { id: 'activity', label: '动态', path: '/knowledge/activity' },
    { id: 'search', label: '搜索', path: '/knowledge/search' },
    { id: 'about', label: '关于', path: '/knowledge/about' },
  ],
  commands: [
    { id: 'knowledge-today', label: '知识台：今天', path: '/knowledge/today' },
    { id: 'knowledge-domains', label: '知识台：领域', path: '/knowledge/domains' },
    { id: 'knowledge-sources', label: '知识台：接入', path: '/knowledge/sources' },
    { id: 'knowledge-quick-note', label: '知识台：速记', path: '/knowledge/today?note=1' },
    { id: 'knowledge-search', label: '搜索知识', path: '/knowledge/search' },
    { id: 'knowledge-about', label: '知识台：关于', path: '/knowledge/about' },
  ],
};
