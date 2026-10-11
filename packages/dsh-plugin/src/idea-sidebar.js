/**
 * 右侧栏灵感 tab 与对话工具卡片的纯函数。client.js 内嵌同一份文本（测试会核对）。
 * 只解析导航参数和工具结果文本，不读写业务数据。
 */

export const IDEA_TAB_KIND = 'bluemanta.idea';

export const IDEA_TAB_ID = '@bluemanta/dsh-plugin/idea';

export const IDEA_CAPTURE_NAME = 'bluemanta_idea_capture';

export const IDEA_SEARCH_NAME = 'bluemanta_idea_search';

export const IDEA_GET_NAME = 'bluemanta_idea_get';

const CATEGORY_LABELS = ['产品想法', '学习备忘', '工作事务', '生活随想', '其他'];

export function ideaParams(navigation) {
  const params = navigation && navigation.params;
  if (!params || typeof params !== 'object') return { id: '', title: '' };
  const id = typeof params.id === 'string' ? params.id.trim() : '';
  const title = typeof params.title === 'string' ? params.title.trim() : '';
  return { id, title };
}

export function sidebarIsMounted(sidebarRight) {
  try {
    const mounted = sidebarRight && sidebarRight.mounted;
    if (!mounted || typeof mounted.getSnapshot !== 'function') return false;
    const value = mounted.getSnapshot();
    return value != null && value !== '';
  } catch {
    return false;
  }
}

export function subscribeSidebarMounted(sidebarRight, listener) {
  try {
    const mounted = sidebarRight && sidebarRight.mounted;
    if (!mounted || typeof mounted.subscribe !== 'function') return function unsubscribe() {};
    const unsubscribe = mounted.subscribe(listener);
    return typeof unsubscribe === 'function' ? unsubscribe : function unsubscribeMissing() {};
  } catch {
    return function unsubscribeFailed() {};
  }
}

export function openIdeaTab(sidebarRight, params) {
  if (!sidebarIsMounted(sidebarRight) || !sidebarRight || typeof sidebarRight.openTab !== 'function') return false;
  const id = params && typeof params.id === 'string' ? params.id.trim() : '';
  if (id === '') return false;
  const title = params && typeof params.title === 'string' ? params.title.trim() : '';
  const next = title === '' ? { id } : { id, title };
  try {
    sidebarRight.openTab(IDEA_TAB_KIND, { params: next });
    return true;
  } catch {
    return false;
  }
}

export function parseToolArgs(raw) {
  if (typeof raw !== 'string' || raw.trim() === '') return null;
  try {
    const value = JSON.parse(raw);
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    return value;
  } catch {
    return null;
  }
}

export function toolResultText(block) {
  if (!block || !Array.isArray(block.content)) return '';
  const parts = [];
  for (const item of block.content) {
    if (item && item.type === 'text' && typeof item.text === 'string') parts.push(item.text);
  }
  return parts.join('\n');
}

function excerptText(body) {
  const flat = String(body || '').replace(/\s+/g, ' ').trim();
  const chars = Array.from(flat);
  if (chars.length <= 120) return flat;
  return chars.slice(0, 120).join('') + '…';
}

function parseCaptureText(text) {
  const source = String(text || '').trim();
  const idMatch = source.match(/，id：(\S+)$/);
  if (!idMatch || idMatch.index == null) return null;
  let head = source.slice(0, idMatch.index);
  const prefix = '已记下灵感「';
  if (!head.startsWith(prefix)) return null;
  head = head.slice(prefix.length);
  const marker = '，分类：';
  const at = head.lastIndexOf(marker);
  if (at < 0) return null;
  const category = head.slice(at + marker.length);
  if (!CATEGORY_LABELS.includes(category)) return null;
  let title = head.slice(0, at);
  const note = '」（标题由正文生成）';
  if (title.endsWith(note)) title = title.slice(0, -note.length);
  else if (title.endsWith('」')) title = title.slice(0, -1);
  else return null;
  return { title, category, id: idMatch[1] };
}

function parseSearchChunk(chunk) {
  const source = String(chunk || '').trim();
  const idMatch = source.match(/ id：(\S+)$/);
  if (!idMatch || idMatch.index == null) return null;
  const head = source.slice(0, idMatch.index);
  const dateMatch = head.match(/^(\d{4}-\d{2}-\d{2}) 「/);
  if (!dateMatch) return null;
  const rest = head.slice(dateMatch[0].length - 1);
  for (const category of CATEGORY_LABELS) {
    const marker = '」（' + category + '）命中';
    const at = rest.lastIndexOf(marker);
    if (at < 1 || !rest.startsWith('「')) continue;
    const tail = rest.slice(at + marker.length);
    const fieldMatch = tail.match(/^(标题|正文|原文|分类)：([\s\S]*)$/);
    if (!fieldMatch) continue;
    return {
      id: idMatch[1],
      title: rest.slice(1, at),
      category,
      date: dateMatch[1],
      excerpt: fieldMatch[2],
    };
  }
  return null;
}

function parseSearchText(text) {
  const source = String(text || '').trim();
  if (source === '') return null;
  const chunks = source.split(/\n(?=\d{4}-\d{2}-\d{2} 「)/);
  const items = [];
  for (const chunk of chunks) {
    const item = parseSearchChunk(chunk);
    if (!item) return null;
    items.push(item);
  }
  return items;
}

function labeledSection(text, label, followers) {
  const source = String(text || '');
  const token = label + '：';
  const start = source.indexOf(token);
  if (start < 0) return '';
  const from = start + token.length;
  let end = source.length;
  for (const follower of followers) {
    const at = source.indexOf('\n' + follower + '：', from);
    if (at >= 0 && at < end) end = at;
  }
  return source.slice(from, end).trim();
}

export function ideaToolCard(toolName, phase, args, resultText, isError) {
  if (phase !== 'result') {
    if (toolName === IDEA_CAPTURE_NAME) return { kind: 'pending', label: '正在记下灵感…' };
    if (toolName === IDEA_SEARCH_NAME) return { kind: 'pending', label: '正在查找灵感…' };
    if (toolName === IDEA_GET_NAME) return { kind: 'pending', label: '正在读取灵感…' };
    return { kind: 'pending', label: '正在处理…' };
  }
  const text = typeof resultText === 'string' ? resultText.trim() : '';
  if (isError) return { kind: 'error', message: text || '调用失败' };
  if (toolName === IDEA_CAPTURE_NAME) {
    if (text.startsWith('没有记下')) return { kind: 'error', message: text.replace(/^没有记下：?/, '') || text };
    const captured = parseCaptureText(text);
    if (!captured) return { kind: 'error', message: text || '没有记下' };
    return { kind: 'capture', title: captured.title || '未命名灵感', category: captured.category, id: captured.id };
  }
  if (toolName === IDEA_SEARCH_NAME) {
    if (text === '没有找到' || text === '') return { kind: 'search', items: [], empty: true };
    const items = parseSearchText(text);
    if (!items) return { kind: 'error', message: text || '查找失败' };
    return { kind: 'search', items, empty: items.length === 0 };
  }
  if (toolName === IDEA_GET_NAME) {
    if (!text.includes('\n标题：') && !text.startsWith('标题：')) {
      return { kind: 'error', message: text || '没有找到这条灵感' };
    }
    const id = args && typeof args.id === 'string' ? args.id.trim() : '';
    const title = labeledSection(text, '标题', ['分类', '收藏', '创建时间', '正文', '原文', '追记']);
    const body = labeledSection(text, '正文', ['原文', '追记']);
    return { kind: 'get', id, title: title || '未命名灵感', excerpt: excerptText(body) };
  }
  return { kind: 'error', message: text || '调用失败' };
}

export function tabIsOpen(openTabs, sessionId, tabId) {
  if (!tabId || !Array.isArray(openTabs)) return false;
  for (const tab of openTabs) {
    if (!tab || tab.tabId !== tabId) continue;
    if (sessionId && tab.sessionId !== sessionId) continue;
    return true;
  }
  return false;
}

/** 同一个灵感已经打开时聚焦那个 tab，否则新开。 */
export function planRailOpen(knownTabId, openTabs, sessionId) {
  if (tabIsOpen(openTabs, sessionId, knownTabId)) return { action: 'focus', tabId: knownTabId };
  return { action: 'open' };
}

/** 后打开的重复标签让位给已经记下的那个。 */
export function planRailClaim(knownTabId, openTabs, sessionId, tabId) {
  if (knownTabId && knownTabId !== tabId && tabIsOpen(openTabs, sessionId, knownTabId)) {
    return { action: 'focus-existing', tabId: knownTabId };
  }
  return { action: 'keep', tabId };
}

/** 未保存时拦截关闭；调用方已经确认过则放行。 */
export function planRailClose(entry) {
  if (!entry || entry.dirty !== true || entry.allow === true) return 'allow';
  return 'confirm';
}
