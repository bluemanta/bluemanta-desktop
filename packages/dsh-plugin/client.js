/**
 * 浏览器端：dsh 里只放装网页的框。
 * 左侧栏「灵感台」（面板 id 仍是 bluemanta.ideas）和右侧栏页类型 bluemanta.idea
 * 都是铺满的 iframe。agent 工具卡片、关闭确认和侧栏品牌留在这里。
 * 消息桥纯函数与 src/frame-bridge.js 保持同一份文本（测试会核对）。
 * 右侧栏与工具卡片的纯函数与 src/idea-sidebar.js 保持同一份文本（测试会核对）。
 * 请求用相对路径、开头不带 /，以兼容 Desktop 的 dsh-app:// 挂载。
 * 不 import dsh 的客户端包。
 */
window.__ModuleLoader__.load({
  id: '@bluemanta/dsh-plugin',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const shell = { sidebarRight: null, ctx: null, baseUrl: '' }
    const frames = new Set()
    const railIndex = { lists: new Map(), ideas: new Map() }
    const railClose = {
      entries: new Map(),
      listeners: new Set(),
      pending: new Set(),
      mark(tabId, dirty) {
        if (!tabId) return
        const entry = this.entries.get(tabId) || { dirty: false, allow: false }
        entry.dirty = dirty
        if (!dirty) entry.allow = false
        this.entries.set(tabId, entry)
      },
      permit(tabId) {
        const entry = this.entries.get(tabId)
        if (!entry) return
        entry.dirty = false
        entry.allow = true
      },
      request(tabId) {
        if (!tabId) return
        this.pending.add(tabId)
        for (const listener of this.listeners) listener(tabId)
      },
    }
    const PANEL_ID = 'bluemanta.ideas'
    const CONFIG_ROUTE = 'api/bluemanta/web-config'

    /**
 * 右侧栏灵感 tab 与对话工具卡片的纯函数。client.js 内嵌同一份文本（测试会核对）。
 * 只解析导航参数和工具结果文本，不读写业务数据。
 */

const IDEA_TAB_KIND = 'bluemanta.idea';

const IDEA_TAB_ID = '@bluemanta/dsh-plugin/idea';

const IDEA_CAPTURE_NAME = 'bluemanta_idea_capture';

const IDEA_SEARCH_NAME = 'bluemanta_idea_search';

const IDEA_GET_NAME = 'bluemanta_idea_get';

const CATEGORY_LABELS = ['产品想法', '学习备忘', '工作事务', '生活随想', '其他'];

function ideaParams(navigation) {
  const params = navigation && navigation.params;
  if (!params || typeof params !== 'object') return { id: '', title: '' };
  const id = typeof params.id === 'string' ? params.id.trim() : '';
  const title = typeof params.title === 'string' ? params.title.trim() : '';
  return { id, title };
}

function sidebarIsMounted(sidebarRight) {
  try {
    const mounted = sidebarRight && sidebarRight.mounted;
    if (!mounted || typeof mounted.getSnapshot !== 'function') return false;
    const value = mounted.getSnapshot();
    return value != null && value !== '';
  } catch {
    return false;
  }
}

function subscribeSidebarMounted(sidebarRight, listener) {
  try {
    const mounted = sidebarRight && sidebarRight.mounted;
    if (!mounted || typeof mounted.subscribe !== 'function') return function unsubscribe() {};
    const unsubscribe = mounted.subscribe(listener);
    return typeof unsubscribe === 'function' ? unsubscribe : function unsubscribeMissing() {};
  } catch {
    return function unsubscribeFailed() {};
  }
}

function openIdeaTab(sidebarRight, params) {
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

function parseToolArgs(raw) {
  if (typeof raw !== 'string' || raw.trim() === '') return null;
  try {
    const value = JSON.parse(raw);
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    return value;
  } catch {
    return null;
  }
}

function toolResultText(block) {
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

function ideaToolCard(toolName, phase, args, resultText, isError) {
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

function tabIsOpen(openTabs, sessionId, tabId) {
  if (!tabId || !Array.isArray(openTabs)) return false;
  for (const tab of openTabs) {
    if (!tab || tab.tabId !== tabId) continue;
    if (sessionId && tab.sessionId !== sessionId) continue;
    return true;
  }
  return false;
}

/** 同一个灵感已经打开时聚焦那个 tab，否则新开。 */
function planRailOpen(knownTabId, openTabs, sessionId) {
  if (tabIsOpen(openTabs, sessionId, knownTabId)) return { action: 'focus', tabId: knownTabId };
  return { action: 'open' };
}

/** 后打开的重复标签让位给已经记下的那个。 */
function planRailClaim(knownTabId, openTabs, sessionId, tabId) {
  if (knownTabId && knownTabId !== tabId && tabIsOpen(openTabs, sessionId, knownTabId)) {
    return { action: 'focus-existing', tabId: knownTabId };
  }
  return { action: 'keep', tabId };
}

/** 未保存时拦截关闭；调用方已经确认过则放行。 */
function planRailClose(entry) {
  if (!entry || entry.dirty !== true || entry.allow === true) return 'allow';
  return 'confirm';
}

    /**
 * 消息桥的纯函数。client.js 内嵌同一份文本（测试会核对）。
 * 只判断来源和拼地址、引用文字，不碰 dsh。
 */

function messageOrigin(baseUrl) {
  if (typeof baseUrl !== 'string' || baseUrl === '') return '';
  try {
    const url = new URL(baseUrl);
    return url.origin && url.origin !== 'null' ? url.origin : '';
  } catch {
    return '';
  }
}

/** 只接受自己放进去的 iframe，且 origin 等于网页的 baseUrl。 */
function isOwnFrameMessage(frames, event, baseUrl) {
  const origin = messageOrigin(baseUrl);
  if (!origin || !event || event.origin !== origin || !event.source) return false;
  if (!frames || typeof frames[Symbol.iterator] !== 'function') return false;
  for (const frame of frames) {
    if (frame && frame.contentWindow === event.source) return true;
  }
  return false;
}

function embedFrameUrl(baseUrl, token, parentOrigin, embed, id) {
  const origin = messageOrigin(baseUrl);
  if (!origin) return '';
  const path = id ? '/ideas/' + encodeURIComponent(id) : '/ideas';
  const mode = embed === 'sidebar' ? 'sidebar' : 'main';
  const hash = 'token=' + encodeURIComponent(String(token ?? '')) + '&parent=' + encodeURIComponent(String(parentOrigin ?? ''));
  return origin + path + '?embed=' + mode + '#' + hash;
}

function quoteText(id, title) {
  return '【灵感】' + title + '（bluemanta 灵感 id：' + id + '）';
}

function appendQuote(draft, text) {
  const source = typeof draft === 'string' ? draft : '';
  if (source.trim() === '') return text + ' ';
  return source.replace(/\s+$/, '') + ' ' + text + ' ';
}

/**
 * Desktop 把快捷键交给 dsh 用的 iframe 标记。
 * 依据 S5（dsh 0.2.0-rc.2，提交 c1b47e41fc 的 apps/desktop/src/preload-app.ts）：
 * 获焦 iframe 要匹配 iframe[data-html-preview]，且 name 非空、等于原生层报来的 frame 名，dsh 才会执行命令。
 * 升级 dsh 时要回归。网页里不要设置 window.name，否则 frame 名对不上。
 * client.js 内嵌同一份文本（测试会核对）。
 */

const MAIN_FRAME_NAME = 'bluemanta-ideas-main'

const SIDEBAR_FRAME_PREFIX = 'bluemanta-ideas-sidebar-'

/** 主区固定名字；右侧栏按 tabId 规范化，同一 tab 生命周期内不变，不同 tab 不同。 */
function htmlPreviewFrameName(embed, tabId) {
  if (embed !== 'sidebar') return MAIN_FRAME_NAME
  return SIDEBAR_FRAME_PREFIX + normalizeFrameToken(tabId)
}

/** 空字符串属性即可匹配 [data-html-preview]。 */
function htmlPreviewFrameAttrs(embed, tabId) {
  return {
    'data-html-preview': '',
    name: htmlPreviewFrameName(embed, tabId),
  }
}

/**
 * 适合做 browsing context 名字的字符原样保留。
 * 其余写成 ~十六进制~，保证不同 tabId 不会撞成同一个 name。
 */
function normalizeFrameToken(tabId) {
  const raw = typeof tabId === 'string' ? tabId : ''
  if (raw === '') return '~'
  let out = ''
  for (const char of raw) {
    if (/^[A-Za-z0-9._-]$/.test(char)) out += char
    else out += '~' + char.codePointAt(0).toString(16) + '~'
  }
  return out
}

/**
 * 知识台入口、右侧栏知识 tab 与知识工具卡片的纯函数（ADR 0009，KB5）。client.js 内嵌同一份文本（测试会核对）。
 * 只拼地址、解析导航参数和工具结果文本，不读写知识库。
 */

const KNOWLEDGE_PANEL_ID = 'bluemanta.knowledge';

const KNOWLEDGE_TAB_KIND = 'bluemanta.knowledge';

const KNOWLEDGE_TAB_ID = '@bluemanta/dsh-plugin/knowledge';

const KNOWLEDGE_ROUTE_NAME = 'bluemanta_knowledge_route';

const KNOWLEDGE_SEARCH_NAME = 'bluemanta_knowledge_search';

const KNOWLEDGE_READ_NAME = 'bluemanta_knowledge_read';

function knowledgeParams(navigation) {
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
function knowledgeWebPath(params) {
  const library = params && typeof params.library === 'string' ? params.library : '';
  const path = knowledgeSegments(params && params.path);
  if (!/^[a-z0-9][a-z0-9-]*$/.test(library) || path === '') return '/knowledge';
  const kind = params.kind === 'topic' ? 'topic' : 'file';
  return '/knowledge/lib/' + library + '/' + kind + '/' + path;
}

function knowledgeFrameUrl(baseUrl, token, parentOrigin, embed, webPath) {
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
function knowledgeFrameName(embed, tabId) {
  if (embed !== 'sidebar') return 'bluemanta-knowledge-main';
  let token = '';
  for (const char of typeof tabId === 'string' ? tabId : '') {
    token += /^[A-Za-z0-9._-]$/.test(char) ? char : '~' + char.codePointAt(0).toString(16) + '~';
  }
  return 'bluemanta-knowledge-sidebar-' + (token || '~');
}

/** 在右侧栏开一个知识 tab。没有右侧栏（不在对话里）时返回 false，不抛错。 */
function openKnowledgeTab(sidebarRight, params) {
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

function knowledgeToolCard(toolName, phase, args, resultText, isError) {
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

    function snapshotTabs(sidebarRight) {
      try {
        const source = sidebarRight && sidebarRight.openTabs
        if (!source || typeof source.getSnapshot !== 'function') return []
        const value = source.getSnapshot()
        return Array.isArray(value) ? value : []
      } catch {
        return []
      }
    }

    function sessionIdOf(sidebarRight) {
      try {
        const mounted = sidebarRight && sidebarRight.mounted
        if (!mounted || typeof mounted.getSnapshot !== 'function') return ''
        const value = mounted.getSnapshot()
        return typeof value === 'string' ? value : ''
      } catch {
        return ''
      }
    }

    function focusRailTab(sidebarRight, tabId) {
      if (!tabId || !sidebarRight || typeof sidebarRight.focus !== 'function') return false
      try {
        sidebarRight.focus(tabId)
        return true
      } catch {
        return false
      }
    }

    function railIdeaKey(sessionId, ideaId) {
      return sessionId + '\n' + ideaId
    }

    function openTrackedIdea(sidebarRight, params) {
      const id = params && typeof params.id === 'string' ? params.id.trim() : ''
      if (!id) return false
      const sessionId = sessionIdOf(sidebarRight)
      if (sessionId) {
        const known = railIndex.ideas.get(railIdeaKey(sessionId, id)) || ''
        const plan = planRailOpen(known, snapshotTabs(sidebarRight), sessionId)
        if (plan.action === 'focus') return focusRailTab(sidebarRight, plan.tabId)
      }
      return openIdeaTab(sidebarRight, params)
    }

    function pruneRailIndex(openTabs) {
      for (const [sessionId, tabId] of railIndex.lists) {
        if (tabIsOpen(openTabs, sessionId, tabId)) continue
        railClose.entries.delete(tabId)
        railIndex.lists.delete(sessionId)
      }
      for (const [key, tabId] of railIndex.ideas) {
        const sessionId = key.slice(0, key.indexOf('\n'))
        if (tabIsOpen(openTabs, sessionId, tabId)) continue
        railClose.entries.delete(tabId)
        railIndex.ideas.delete(key)
      }
    }

    function postTheme(frame) {
      const origin = messageOrigin(shell.baseUrl)
      if (!origin || !frame || !frame.contentWindow) return
      try {
        frame.contentWindow.postMessage({ type: 'bm:theme', dark: document.body.hasAttribute('data-ds-dark-theme') }, origin)
      } catch {
        // 框已经卸掉时忽略。
      }
    }

    function reply(source, origin, action, result, requestId) {
      if (!source || !origin) return
      const body = { type: 'bm:result', action, ok: result.ok === true }
      if (result.reason) body.reason = result.reason
      if (requestId !== undefined) body.requestId = requestId
      try { source.postMessage(body, origin) } catch { /* 框已经关掉 */ }
    }

    function openFromBridge(msg) {
      if (!sidebarIsMounted(shell.sidebarRight)) return { ok: false, reason: '当前不在对话里' }
      const id = typeof msg.id === 'string' ? msg.id.trim() : ''
      const title = typeof msg.title === 'string' ? msg.title.trim() : ''
      if (!id) return { ok: false, reason: '缺少灵感 id' }
      return openTrackedIdea(shell.sidebarRight, title ? { id, title } : { id })
        ? { ok: true }
        : { ok: false, reason: '没有打开右侧栏' }
    }

    function quoteIntoDraft(ctx, msg) {
      const mounted = ctx && ctx.sidebarRight && ctx.sidebarRight.mounted
      const sessionId = mounted && typeof mounted.getSnapshot === 'function' ? mounted.getSnapshot() : ''
      if (!sessionId) return { ok: false, reason: '当前不在对话里' }
      if (!ctx.sessions || typeof ctx.sessions.scope !== 'function') return { ok: false, reason: '找不到会话作用域' }
      const actx = ctx.sessions.scope(sessionId)
      if (!actx || typeof actx.get !== 'function') return { ok: false, reason: '找不到会话作用域' }
      const conversation = actx.get('conversation')
      if (!conversation || !conversation.input || typeof conversation.input.for !== 'function') {
        return { ok: false, reason: '对话服务不可用' }
      }
      const input = conversation.input.for(actx)
      const snapshot = input.state && typeof input.state.getSnapshot === 'function' ? input.state.getSnapshot() : {}
      const text = quoteText(String(msg.id || ''), String(msg.title || ''))
      input.setDraft(appendQuote(snapshot && snapshot.draft, text))
      if (typeof input.focus === 'function') input.focus()
      return { ok: true }
    }

    function handleBridgeMessage(event) {
      if (!isOwnFrameMessage(frames, event, shell.baseUrl)) return
      const origin = messageOrigin(shell.baseUrl)
      const msg = event.data || {}
      const requestId = Object.prototype.hasOwnProperty.call(msg, 'requestId') ? msg.requestId : undefined
      if (msg.type === 'bm:ready') {
        const frame = [...frames].find((item) => item.contentWindow === event.source)
        if (frame) postTheme(frame)
        return
      }
      if (msg.type === 'bm:openSidebar') {
        let result
        try { result = openFromBridge(msg) } catch (error) {
          result = { ok: false, reason: String(error && error.message || error) }
        }
        reply(event.source, origin, '在右侧栏打开', result, requestId)
        return
      }
      if (msg.type === 'bm:quote') {
        let result
        try { result = quoteIntoDraft(shell.ctx, msg) } catch (error) {
          result = { ok: false, reason: String(error && error.message || error) }
        }
        reply(event.source, origin, '在对话中引用', result, requestId)
        return
      }
      if (msg.type === 'bm:dirty') {
        const frame = [...frames].find((item) => item.contentWindow === event.source)
        const tabId = frame && frame.dataset ? frame.dataset.tabId : ''
        if (tabId) railClose.mark(tabId, msg.dirty === true)
        reply(event.source, origin, '未保存修改', { ok: true }, requestId)
      }
    }

    function useWebConfig() {
      const [config, setConfig] = React.useState({ status: 'loading', reason: '' })
      const [attempt, setAttempt] = React.useState(0)
      const retry = React.useCallback(() => setAttempt((value) => value + 1), [])
      React.useEffect(() => {
        let alive = true
        setConfig({ status: 'loading', reason: '' })
        fetch(CONFIG_ROUTE, { cache: 'no-store' }).then((response) => response.json()).then((body) => {
          if (!alive) return
          if (body && body.ok === true && body.baseUrl && body.token) {
            shell.baseUrl = String(body.baseUrl)
            setConfig({ status: 'ready', baseUrl: String(body.baseUrl), token: String(body.token), reason: '' })
            return
          }
          setConfig({ status: 'error', reason: (body && body.reason) || '本地服务没有启动' })
        }).catch((error) => {
          if (!alive) return
          setConfig({ status: 'error', reason: '本地服务没有启动：' + String(error && error.message || error) })
        })
        return () => { alive = false }
      }, [attempt])
      return [config, retry]
    }

    function WebFrame({ embed, id, tabId, path, label }) {
      const [config, retry] = useWebConfig()
      const [loaded, setLoaded] = React.useState(false)
      const ref = React.useRef(null)
      const name = label || '灵感台'
      const src = config.status !== 'ready'
        ? ''
        : path
          ? knowledgeFrameUrl(config.baseUrl, config.token, location.origin, embed, path)
          : embedFrameUrl(config.baseUrl, config.token, location.origin, embed, id || '')
      React.useEffect(() => { setLoaded(false) }, [src])
      React.useEffect(() => {
        const frame = ref.current
        if (!frame) return undefined
        frames.add(frame)
        return () => { frames.delete(frame) }
      }, [src])
      const frameStyle = { flex: '1 1 auto', width: '100%', height: '100%', border: 0, background: 'transparent' }
      const boxStyle = { display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0, position: 'relative' }
      if (config.status === 'error') {
        return h('div', { style: { ...boxStyle, alignItems: 'center', justifyContent: 'center', gap: 12, padding: 24 }, 'data-bluemanta-frame': 'error' },
          h('p', { style: { margin: 0, color: 'var(--dsw-alias-label-primary)', textAlign: 'center' } }, config.reason),
          h('button', {
            type: 'button',
            onClick: retry,
            style: {
              border: '1px solid var(--dsw-alias-border-l3)',
              background: 'transparent',
              color: 'var(--dsw-alias-label-primary)',
              borderRadius: 6,
              padding: '4px 12px',
              cursor: 'pointer',
            },
          }, '重试'))
      }
      return h('div', { style: boxStyle, 'data-bluemanta-frame': embed },
        config.status !== 'ready' || !loaded
          ? h('p', { style: { margin: 0, padding: 16, color: 'var(--dsw-alias-label-secondary)' } }, label ? '正在打开' + label + '…' : '正在打开灵感台…')
          : null,
        src ? h('iframe', {
          ref,
          src,
          title: name,
          // data-html-preview 与 name 是为了让 Desktop 把快捷键交给 dsh，依据 S5。升级 dsh 时要回归。
          ...htmlPreviewFrameAttrs(embed, tabId),
          // 知识台的框另起名字，和灵感台的框不重名。
          ...(path ? { name: knowledgeFrameName(embed, tabId) } : {}),
          'data-tab-id': tabId || '',
          style: frameStyle,
          onLoad: () => setLoaded(true),
        }) : null)
    }

    function IdeasIcon({ size }) {
      const px = size || 16
      return h('svg', {
        width: px, height: px, viewBox: '0 0 24 24', fill: 'none',
        stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true,
      },
      h('path', { d: 'M9 18h6' }),
      h('path', { d: 'M10 21h4' }),
      h('path', { d: 'M12 3a6 6 0 0 0-3.6 10.8c.4.3.6.8.6 1.3V16h6v-.9c0-.5.2-1 .6-1.3A6 6 0 0 0 12 3z' }))
    }

    function useSidebarOpen() {
      const [open, setOpen] = React.useState(() => sidebarIsMounted(shell.sidebarRight))
      React.useEffect(() => {
        setOpen(sidebarIsMounted(shell.sidebarRight))
        return subscribeSidebarMounted(shell.sidebarRight, () => {
          setOpen(sidebarIsMounted(shell.sidebarRight))
        })
      }, [])
      return open
    }

    const toolLine = { display: 'flex', gap: 8, alignItems: 'center', justifyContent: 'space-between' }
    const toolTitle = { color: 'var(--dsw-alias-label-primary)', fontSize: 13 }
    const toolMeta = { color: 'var(--dsw-alias-label-secondary)', fontSize: 12, margin: '2px 0 0' }

    function OpenIdeaButton({ id, title }) {
      const open = useSidebarOpen()
      if (!open || !id) return null
      return h('button', {
        type: 'button',
        onClick: () => { openTrackedIdea(shell.sidebarRight, { id, title }) },
        style: {
          flex: '0 0 auto',
          border: '1px solid var(--dsw-alias-border-l3)',
          background: 'transparent',
          color: 'var(--dsw-alias-label-primary)',
          borderRadius: 6,
          padding: '2px 10px',
          cursor: 'pointer',
        },
      }, '打开')
    }

    function KnowledgeIcon({ size }) {
      const px = size || 16
      return h('svg', {
        width: px, height: px, viewBox: '0 0 24 24', fill: 'none',
        stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true,
      },
      h('path', { d: 'M5 4.5A1.5 1.5 0 0 1 6.5 3H19v15H6.5A1.5 1.5 0 0 0 5 19.5z' }),
      h('path', { d: 'M5 19.5A1.5 1.5 0 0 0 6.5 21H19' }),
      h('path', { d: 'M9 7h6M9 10.5h4' }))
    }

    function OpenKnowledgeButton({ library, path, topic, title }) {
      const open = useSidebarOpen()
      if (!open || !library || !path) return null
      return h('button', {
        type: 'button',
        onClick: () => { openKnowledgeTab(shell.sidebarRight, { library, path, kind: topic ? 'topic' : 'file', title: title || '' }) },
        style: {
          flex: '0 0 auto',
          border: '1px solid var(--dsw-alias-border-l3)',
          background: 'transparent',
          color: 'var(--dsw-alias-label-primary)',
          borderRadius: 6,
          padding: '2px 10px',
          cursor: 'pointer',
        },
      }, '打开')
    }

    function KnowledgeToolView(props) {
      const phase = props && props.phase
      const block = props && props.block
      const toolName = (props && props.toolName) || ''
      let args = null
      let text = ''
      let failed = false
      if (phase === 'result' && block) {
        args = parseToolArgs(block.call && block.call.argsRaw)
        text = toolResultText(block)
        failed = block.isError === true || block.error != null
      } else if (block && typeof block.argsRaw === 'string') {
        args = parseToolArgs(block.argsRaw)
      }
      const model = knowledgeToolCard(toolName, phase === 'result' ? 'result' : 'start', args, text, failed)
      let body = null
      if (model.kind === 'pending') body = h('p', { style: toolMeta }, model.label)
      else if (model.kind === 'error') body = h('p', { style: toolMeta }, model.message)
      else if (model.kind === 'route') {
        body = model.empty
          ? h('p', { style: toolMeta }, '没有匹配的主题')
          : h('ul', { style: { listStyle: 'none', margin: 0, padding: 0 } }, model.items.map((item) => h('li', { key: item.library + ':' + item.path, style: { ...toolLine, padding: '4px 0' } },
            h('div', null,
              h('div', { style: toolTitle }, '主题：' + item.name),
              h('div', { style: toolMeta }, [item.library === 'arsenal' ? 'Arsenal' : '个人库', item.matched ? '命中 ' + item.matched : ''].filter(Boolean).join(' · '))),
            h(OpenKnowledgeButton, { library: item.library, path: item.path, topic: true, title: item.name }))))
      } else if (model.kind === 'search') {
        body = model.empty
          ? h('p', { style: toolMeta }, '没有找到')
          : h('ul', { style: { listStyle: 'none', margin: 0, padding: 0 } }, model.items.map((item, index) => h('li', { key: index, style: { ...toolLine, padding: '4px 0' } },
            h('div', { style: { minWidth: 0 } },
              h('div', { style: toolTitle }, item.title),
              h('div', { style: { ...toolMeta, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } },
                (item.source === 'idea' ? '灵感 · ' : (item.library === 'arsenal' ? 'Arsenal · ' : '个人库 · ')) + item.excerpt)),
            item.source === 'idea'
              ? h(OpenIdeaButton, { id: item.ideaId, title: item.title })
              : h(OpenKnowledgeButton, { library: item.library, path: item.path, topic: false, title: item.title }))))
      } else if (model.kind === 'read') {
        body = h('div', { style: toolLine },
          h('div', { style: toolTitle }, (model.topic ? '已读主题：' : '已读：') + model.title),
          h(OpenKnowledgeButton, { library: model.library, path: model.path, topic: model.topic, title: model.title }))
      }
      return h('div', { 'data-bluemanta-tool': toolName, style: { padding: '4px 0' } }, body)
    }

    function KnowledgeTabTitle(props) {
      const info = props.useTabInfo()
      const params = knowledgeParams(info && info.tab && info.tab.navigation)
      return params.title || '知识台'
    }

    function KnowledgeSidebarTab(props) {
      const info = props.useTabInfo()
      const params = knowledgeParams(info && info.tab && info.tab.navigation)
      const tabId = info && info.tab ? info.tab.id : ''
      return h('div', { style: { display: 'flex', flexDirection: 'column', height: '100%' }, 'data-bluemanta-sidebar': 'knowledge' },
        h(WebFrame, { embed: 'sidebar', path: knowledgeWebPath(params), tabId, label: '知识台' }))
    }

    function registerKnowledge(ctx) {
      ctx.slots.inject('main', () => ctx.slots.register({ name: 'main', key: KNOWLEDGE_PANEL_ID }, KnowledgeMainPage))
      ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
        name: 'sidebar.panellist', id: KNOWLEDGE_PANEL_ID, order: 11, label: '知识台',
      }, KnowledgeIcon))
      ctx.effect(() => ctx.sidebarRightTabs.register({
        id: KNOWLEDGE_TAB_ID,
        kind: KNOWLEDGE_TAB_KIND,
        multiple: true,
        title: () => '知识',
        guide: [{
          id: 'knowledge',
          order: 41,
          title: () => '知识台',
          description: () => '嵌入的知识台：主题、搜索、收件箱',
          icon: KnowledgeIcon,
        }],
      }), 'bluemanta: knowledge tab type')
      ctx.effect(() => ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register({
        name: 'sidebar.right.pane.tab',
        key: KNOWLEDGE_TAB_ID,
      }, KnowledgeSidebarTab)), 'bluemanta: knowledge tab body')
      ctx.effect(() => ctx.slots.inject('sidebar.right.pane.tab.title', () => ctx.slots.register({
        name: 'sidebar.right.pane.tab.title',
        key: KNOWLEDGE_TAB_ID,
      }, KnowledgeTabTitle)), 'bluemanta: knowledge tab title')
      for (const name of [KNOWLEDGE_ROUTE_NAME, KNOWLEDGE_SEARCH_NAME, KNOWLEDGE_READ_NAME]) {
        ctx.effect(() => ctx.slots.inject('tool.call.toolview', () => ctx.slots.register({
          name: 'tool.call.toolview',
          key: name,
        }, KnowledgeToolView)), 'bluemanta: knowledge tool view ' + name)
      }
    }

    function IdeaToolView(props) {
      const phase = props && props.phase
      const block = props && props.block
      const toolName = (props && props.toolName) || ''
      let args = null
      let text = ''
      let failed = false
      if (phase === 'result' && block) {
        args = parseToolArgs(block.call && block.call.argsRaw)
        text = toolResultText(block)
        failed = block.isError === true || block.error != null
      } else if (block && typeof block.argsRaw === 'string') {
        args = parseToolArgs(block.argsRaw)
      }
      const model = ideaToolCard(toolName, phase === 'result' ? 'result' : 'start', args, text, failed)
      let body = null
      if (model.kind === 'pending') body = h('p', { style: toolMeta }, model.label)
      else if (model.kind === 'error') body = h('p', { style: toolMeta }, model.message)
      else if (model.kind === 'capture') {
        body = h('div', { style: toolLine },
          h('div', { style: toolTitle }, '已记录灵感：' + model.title + ' · ' + model.category),
          h(OpenIdeaButton, { id: model.id, title: model.title }))
      } else if (model.kind === 'search') {
        body = model.empty
          ? h('p', { style: toolMeta }, '没有找到')
          : h('ul', { style: { listStyle: 'none', margin: 0, padding: 0 } }, model.items.map((item) => h('li', { key: item.id, style: { ...toolLine, padding: '4px 0' } },
            h('div', null,
              h('div', { style: toolTitle }, item.title || '未命名灵感'),
              h('div', { style: toolMeta }, [item.category, item.date].filter(Boolean).join(' · '))),
            h(OpenIdeaButton, { id: item.id, title: item.title }))))
      } else if (model.kind === 'get') {
        body = h('div', { style: toolLine },
          h('div', null,
            h('div', { style: toolTitle }, model.title),
            model.excerpt ? h('p', { style: toolMeta }, model.excerpt) : null),
          h(OpenIdeaButton, { id: model.id, title: model.title }))
      }
      return h('div', { 'data-bluemanta-tool': toolName, style: { padding: '4px 0' } }, body)
    }

    function IdeaTabTitle(props) {
      const info = props.useTabInfo()
      const params = ideaParams(info && info.tab && info.tab.navigation)
      if (!params.id) return '灵感台'
      return params.title || '灵感'
    }

    function LeaveDialog({ onCancel, onLeave }) {
      return h('div', {
        role: 'alertdialog',
        'aria-modal': 'true',
        'aria-label': '有未保存的修改',
        style: {
          position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: 'var(--dsw-alias-bg-mask, transparent)',
        },
      },
      h('div', {
        style: {
          background: 'var(--dsw-alias-bg-layer-1)',
          color: 'var(--dsw-alias-label-primary)',
          borderRadius: 8,
          padding: 16,
          maxWidth: 320,
        },
      },
      h('p', { style: { margin: '0 0 12px' } }, '有未保存的修改。确定离开？'),
      h('div', { style: { display: 'flex', gap: 8, justifyContent: 'flex-end' } },
        h('button', { type: 'button', onClick: onCancel }, '取消'),
        h('button', { type: 'button', onClick: onLeave }, '离开'))))
    }

    function IdeaSidebarTab(props) {
      const info = props.useTabInfo()
      const navigation = info && info.tab ? info.tab.navigation : null
      const params = ideaParams(navigation)
      const actions = info && info.tab ? info.tab.actions : null
      const tabId = info && info.tab ? info.tab.id : ''
      const [confirming, setConfirming] = React.useState(false)
      React.useLayoutEffect(() => {
        if (!tabId) return undefined
        const sessionId = sessionIdOf(shell.sidebarRight)
        if (!sessionId) return undefined
        const known = params.id
          ? (railIndex.ideas.get(railIdeaKey(sessionId, params.id)) || '')
          : (railIndex.lists.get(sessionId) || '')
        const plan = planRailClaim(known, snapshotTabs(shell.sidebarRight), sessionId, tabId)
        if (plan.action === 'focus-existing') {
          try {
            if (actions && typeof actions.close === 'function') actions.close()
          } catch {
            // 重复标签关不掉时留在原地。
          }
          focusRailTab(shell.sidebarRight, plan.tabId)
          return undefined
        }
        if (params.id) railIndex.ideas.set(railIdeaKey(sessionId, params.id), tabId)
        else railIndex.lists.set(sessionId, tabId)
        return undefined
      }, [tabId, params.id])
      React.useEffect(() => {
        function onAsk(asked) {
          if (asked !== tabId) return
          railClose.pending.delete(tabId)
          setConfirming(true)
        }
        railClose.listeners.add(onAsk)
        if (railClose.pending.has(tabId)) onAsk(tabId)
        return () => { railClose.listeners.delete(onAsk) }
      }, [tabId])
      function leave() {
        setConfirming(false)
        railClose.permit(tabId)
        if (actions && typeof actions.close === 'function') {
          try { actions.close() } catch { /* 标签已经关掉 */ }
        }
      }
      return h('div', { style: { position: 'relative', display: 'flex', flexDirection: 'column', height: '100%' }, 'data-bluemanta-sidebar': 'idea' },
        h(WebFrame, { embed: 'sidebar', id: params.id, tabId }),
        confirming ? h(LeaveDialog, { onCancel: () => setConfirming(false), onLeave: leave }) : null)
    }

    function registerIdeaSidebar(ctx) {
      shell.sidebarRight = ctx.sidebarRight
      ctx.effect(() => ctx.sidebarRightTabs.register({
        id: IDEA_TAB_ID,
        kind: IDEA_TAB_KIND,
        multiple: true,
        title: () => '灵感',
        guide: [{
          id: 'desk',
          order: 40,
          title: () => '灵感台',
          description: () => '嵌入的网页版灵感台',
          icon: IdeasIcon,
        }],
      }), 'bluemanta: idea tab type')
      ctx.effect(() => ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register({
        name: 'sidebar.right.pane.tab',
        key: IDEA_TAB_ID,
      }, IdeaSidebarTab)), 'bluemanta: idea tab body')
      ctx.effect(() => ctx.slots.inject('sidebar.right.pane.tab.title', () => ctx.slots.register({
        name: 'sidebar.right.pane.tab.title',
        key: IDEA_TAB_ID,
      }, IdeaTabTitle)), 'bluemanta: idea tab title')
      ctx.effect(() => {
        const source = ctx.sidebarRight && ctx.sidebarRight.openTabs
        if (!source || typeof source.subscribe !== 'function') return undefined
        const sync = () => {
          try { pruneRailIndex(snapshotTabs(ctx.sidebarRight)) } catch { /* 清单暂时读不到时保留已记下的 tab */ }
        }
        const unsubscribe = source.subscribe(sync)
        sync()
        return typeof unsubscribe === 'function' ? unsubscribe : undefined
      }, 'bluemanta: idea tab index')
      ctx.effect(() => {
        if (!ctx.sidebarRight || typeof ctx.sidebarRight.registerCloseHandler !== 'function') return undefined
        return ctx.sidebarRight.registerCloseHandler(IDEA_TAB_KIND, (sessionId, tab) => {
          const tabId = tab && tab.id
          const entry = railClose.entries.get(tabId)
          if (planRailClose(entry) === 'confirm') {
            railClose.request(tabId)
            try { ctx.sidebarRight.focus(tabId) } catch { /* 聚焦失败时标签仍留着 */ }
            throw new Error('有未保存的修改')
          }
          if (entry) entry.allow = false
        })
      }, 'bluemanta: idea close guard')
      for (const name of [IDEA_CAPTURE_NAME, IDEA_SEARCH_NAME, IDEA_GET_NAME]) {
        ctx.effect(() => ctx.slots.inject('tool.call.toolview', () => ctx.slots.register({
          name: 'tool.call.toolview',
          key: name,
        }, IdeaToolView)), 'bluemanta: idea tool view ' + name)
      }
    }

    function BrandMark({ size = 24, className }) {
      return h('svg', {
        width: size, height: size, viewBox: '0 0 24 24', className,
        role: 'img', 'aria-label': 'bluemanta', 'data-bluemanta-brand': 'mark',
      },
      h('rect', { x: 1, y: 1, width: 22, height: 22, rx: 6, fill: '#2A715A' }),
      h('text', {
        x: 12, y: 16.5, textAnchor: 'middle', fontSize: 14, fontWeight: 700,
        fontFamily: 'system-ui, sans-serif', fill: '#FFFFFF',
      }, 'b'))
    }

    function BrandName() {
      return h('span', {
        'data-bluemanta-brand': 'name',
        style: { fontSize: 18, fontWeight: 600, letterSpacing: '-0.01em', color: 'var(--dsw-alias-label-primary)' },
      }, 'bluemanta')
    }

    function MainPage() {
      return h(WebFrame, { embed: 'main', id: '' })
    }

    function KnowledgeMainPage() {
      return h(WebFrame, { embed: 'main', path: '/knowledge', label: '知识台' })
    }

    return {
      inject: ['slots', 'sidebarRightTabs', 'sidebarRight', 'sessions'],
      apply(ctx) {
        shell.ctx = ctx
        ctx.slots.inject('sidebar.brand.mark', () =>
          ctx.slots.inject('sidebar.brand.name', function* () {
            yield ctx.slots.register({ name: 'sidebar.brand.mark' }, BrandMark)
            yield ctx.slots.register({ name: 'sidebar.brand.name' }, BrandName)
          }))
        ctx.slots.inject('conversation.hero.brand.mark', () =>
          ctx.slots.register({ name: 'conversation.hero.brand.mark' }, BrandMark))
        ctx.slots.inject('main', () => ctx.slots.register({ name: 'main', key: PANEL_ID }, MainPage))
        ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
          name: 'sidebar.panellist', id: PANEL_ID, order: 10, label: '灵感台',
        }, IdeasIcon))
        registerIdeaSidebar(ctx)
        registerKnowledge(ctx)
        ctx.effect(() => {
          const onMessage = (event) => handleBridgeMessage(event)
          window.addEventListener('message', onMessage)
          const observer = new MutationObserver(() => { frames.forEach((frame) => postTheme(frame)) })
          observer.observe(document.body, { attributes: true, attributeFilter: ['data-ds-dark-theme'] })
          return () => {
            window.removeEventListener('message', onMessage)
            observer.disconnect()
          }
        }, 'bluemanta: bridge')
      },
    }
  },
})
