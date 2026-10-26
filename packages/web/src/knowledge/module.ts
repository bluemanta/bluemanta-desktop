import type { WorkbenchModule } from '../shell/modules';
import { useKnowledgeInboxCount } from './api';

/** 知识台（ADR 0009）：主题、搜索、收件箱。侧栏计数是个人库收件箱里的文件数。 */
export const KNOWLEDGE_MODULE: WorkbenchModule = {
  id: 'knowledge',
  name: '知识台',
  icon: 'book',
  pathPrefix: '/knowledge',
  rootPath: '/knowledge',
  useCount: useKnowledgeInboxCount,
  sections: [
    { id: 'topics', label: '主题', path: '/knowledge' },
    { id: 'search', label: '搜索', path: '/knowledge/search' },
    { id: 'inbox', label: '收件箱', path: '/knowledge/inbox' },
  ],
  commands: [
    { id: 'knowledge-search', label: '搜索知识', path: '/knowledge/search' },
    { id: 'knowledge-inbox', label: '打开知识收件箱', path: '/knowledge/inbox' },
  ],
};
