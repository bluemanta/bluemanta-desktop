/**
 * 知识台入口、右侧栏知识 tab 与知识工具卡片的纯函数（ADR 0009，KB5）。client.js 内嵌同一份文本（测试会核对）。
 * 只拼地址、解析导航参数和工具结果文本，不读写知识库。
 */

export const KNOWLEDGE_PANEL_ID = 'bluemanta.knowledge';

export const KNOWLEDGE_TAB_KIND = 'bluemanta.knowledge';

export const KNOWLEDGE_TAB_ID = '@bluemanta/dsh-plugin/knowledge';

export const KNOWLEDGE_ROUTE_NAME = 'bluemanta_knowledge_route';

export const KNOWLEDGE_SEARCH_NAME = 'bluemanta_knowledge_search';

export const KNOWLEDGE_READ_NAME = 'bluemanta_knowledge_read';

export function knowledgeParams(navigation) {
  const params = navigation && navigation.params;
  if (!params || typeof params !== 'object') return { library: '', path: '', kind: '', title: '' };
  const text = (value) => (typeof value === 'string' ? value.trim() : '');
  const kind = params.kind === 'topic' || params.kind === 'file' ? params.kind : '';
  return { library: text(params.library), path: text(params.path), kind, title: text(params.title) };
}

function knowledgeSegments(path) {
  return String(path || '')
    .split('/')
    .filter((part) => part !== '' && part !== '.' && part !== '..')
    .map((part) => encodeURIComponent(part))
    .join('/');
}

/** 网页里的路径：没有 path 时是主题页；主题目录开主题，其余开阅读器。 */
export function knowledgeWebPath(params) {
  const library = params && typeof params.library === 'string' ? params.library : '';
  const path = knowledgeSegments(params && params.path);
  if (!/^[a-z0-9][a-z0-9-]*$/.test(library) || path === '') return '/knowledge';
  const kind = params.kind === 'topic' ? 'topic' : 'file';
  return '/knowledge/lib/' + library + '/' + kind + '/' + path;
}

export function knowledgeFrameUrl(baseUrl, token, parentOrigin, embed, webPath) {
  let origin = '';
  try {
    origin = new URL(String(baseUrl || '')).origin;
  } catch {
    return '';
  }
  if (!origin || origin === 'null') return '';
  const path = typeof webPath === 'string' && webPath.startsWith('/knowledge') ? webPath : '/knowledge';
  const mode = embed === 'sidebar' ? 'sidebar' : 'main';
  const hash = 'token=' + encodeURIComponent(String(token ?? '')) + '&parent=' + encodeURIComponent(String(parentOrigin ?? ''));
  return origin + path + '?embed=' + mode + '#' + hash;
}

/** 与灵感台的框名分开，避免两个框同名时 Desktop 把快捷键交错框（S5）。 */
export function knowledgeFrameName(embed, tabId) {
  if (embed !== 'sidebar') return 'bluemanta-knowledge-main';
  let token = '';
  for (const char of typeof tabId === 'string' ? tabId : '') {
    token += /^[A-Za-z0-9._-]$/.test(char) ? char : '~' + char.codePointAt(0).toString(16) + '~';
  }
  return 'bluemanta-knowledge-sidebar-' + (token || '~');
}

/** 在右侧栏开一个知识 tab。没有右侧栏（不在对话里）时返回 false，不抛错。 */
export function openKnowledgeTab(sidebarRight, params) {
  try {
    const mounted = sidebarRight && sidebarRight.mounted;
    const snapshot = mounted && typeof mounted.getSnapshot === 'function' ? mounted.getSnapshot() : undefined;
    if (!snapshot || typeof sidebarRight.openTab !== 'function') return false;
    sidebarRight.openTab(KNOWLEDGE_TAB_KIND, { params });
    return true;
  } catch {
    return false;
  }
}

function knowledgeBlocks(text) {
  const blocks = [];
  let current = null;
  for (const line of String(text || '').split('\n')) {
    const head = /^(\d+)\. (.+)$/.exec(line);
    if (head) {
      current = { title: head[2].trim(), lines: [] };
      blocks.push(current);
    } else if (current && line.startsWith('   ')) {
      current.lines.push(line.trim());
    }
  }
  return blocks;
}

function knowledgeField(lines, label) {
  for (const line of lines) {
    if (line.startsWith(label + '：')) return line.slice(label.length + 1);
  }
  return '';
}

function knowledgeLocation(line) {
  const match = /^库：([a-z0-9-]+)　路径：([^　]+)/.exec(line || '');
  return match ? { library: match[1], path: match[2] } : null;
}

export function knowledgeToolCard(toolName, phase, args, resultText, isError) {
  if (phase !== 'result') {
    if (toolName === KNOWLEDGE_ROUTE_NAME) return { kind: 'pending', label: '正在定位知识主题…' };
    if (toolName === KNOWLEDGE_SEARCH_NAME) return { kind: 'pending', label: '正在搜索知识库…' };
    if (toolName === KNOWLEDGE_READ_NAME) return { kind: 'pending', label: '正在读取知识…' };
    return { kind: 'pending', label: '正在处理…' };
  }
  const text = typeof resultText === 'string' ? resultText.trim() : '';
  if (isError) return { kind: 'error', message: text || '调用失败' };
  if (/^没有(路由|搜索|读取)：/.test(text)) return { kind: 'error', message: text.replace(/^没有(路由|搜索|读取)：/, '') || text };
  if (toolName === KNOWLEDGE_ROUTE_NAME) {
    if (text.startsWith('没有匹配的主题')) return { kind: 'route', items: [], empty: true };
    const items = knowledgeBlocks(text)
      .map((block) => {
        const location = knowledgeLocation(block.lines.find((line) => line.startsWith('库：')));
        if (!location) return null;
        return { name: block.title, library: location.library, path: location.path, matched: knowledgeField(block.lines, '命中') };
      })
      .filter(Boolean);
    return { kind: 'route', items, empty: items.length === 0 };
  }
  if (toolName === KNOWLEDGE_SEARCH_NAME) {
    if (text.startsWith('没有找到')) return { kind: 'search', items: [], empty: true };
    const items = knowledgeBlocks(text)
      .map((block) => {
        const excerpt = knowledgeField(block.lines, '摘录');
        const ideaId = knowledgeField(block.lines, '灵感 id').trim();
        if (ideaId) return { source: 'idea', title: block.title, ideaId, library: '', path: '', excerpt };
        const location = knowledgeLocation(block.lines.find((line) => line.startsWith('库：')));
        if (!location) return null;
        return { source: 'library', title: block.title, ideaId: '', library: location.library, path: location.path, excerpt };
      })
      .filter(Boolean);
    return { kind: 'search', items, empty: items.length === 0 };
  }
  if (toolName === KNOWLEDGE_READ_NAME) {
    const location = knowledgeLocation(text.split('\n')[0]);
    if (!location) return { kind: 'error', message: text || '读取失败' };
    const topic = /\n主题文件：/.test(text);
    const parts = location.path.split('/');
    return { kind: 'read', library: location.library, path: location.path, topic, title: parts[parts.length - 1] || location.path };
  }
  return { kind: 'error', message: text || '调用失败' };
}
