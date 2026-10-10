/**
 * 灵感台分栏与多 tab 的纯函数。client.js 内嵌同一份文本（测试会核对）。
 * 只处理界面偏好和 tab 开关，不读写业务数据。
 */

export const LIST_WIDTH_DEFAULT = 380;

export const LIST_WIDTH_MIN = 280;

export const LIST_WIDTH_RATIO = 0.6;

export const LIST_WIDTH_KEY = 'bluemanta.ideas.listWidth';

export const TAB_LIMIT = 8;

export const CREATE_TAB_ID = 'create';

export const TAB_LIMIT_MESSAGE = '已打开 8 个详情，且都有未保存的修改。请先保存或关闭其中一个。';

export function clampListWidth(preferred, appWidth) {
  const width = Number.isFinite(preferred) ? preferred : LIST_WIDTH_DEFAULT;
  const span = Number(appWidth);
  const max = Math.max(LIST_WIDTH_MIN, Math.floor((Number.isFinite(span) ? span : 0) * LIST_WIDTH_RATIO));
  return Math.min(max, Math.max(LIST_WIDTH_MIN, Math.round(width)));
}

export function readStoredListWidth(storage) {
  try {
    if (!storage || typeof storage.getItem !== 'function') return LIST_WIDTH_DEFAULT;
    const raw = storage.getItem(LIST_WIDTH_KEY);
    if (raw == null || raw === '') return LIST_WIDTH_DEFAULT;
    const value = Number(raw);
    if (!Number.isFinite(value)) return LIST_WIDTH_DEFAULT;
    return value;
  } catch {
    return LIST_WIDTH_DEFAULT;
  }
}

export function writeStoredListWidth(storage, width) {
  try {
    if (!storage || typeof storage.setItem !== 'function') return;
    storage.setItem(LIST_WIDTH_KEY, String(Math.round(width)));
  } catch {
    // 隐私模式或禁用存储时，宽度只留在本次会话。
  }
}

export function planOpenTab(tabs, request) {
  const existing = tabs.find((tab) => tab.id === request.id);
  if (existing) return { tabs, activeId: request.id, blocked: false, droppedId: null };
  let next = tabs.slice();
  let droppedId = null;
  if (next.length >= TAB_LIMIT) {
    const clean = next.filter((tab) => !tab.dirty).slice().sort((a, b) => a.openedAt - b.openedAt);
    if (clean.length === 0) return { tabs, activeId: null, blocked: true, droppedId: null };
    droppedId = clean[0].id;
    next = next.filter((tab) => tab.id !== droppedId);
  }
  next = next.concat([{
    id: request.id,
    kind: request.kind,
    dirty: false,
    openedAt: request.openedAt,
    generation: 0,
  }]);
  return { tabs: next, activeId: request.id, blocked: false, droppedId };
}

export function planCloseTab(tabs, activeId, id) {
  const index = tabs.findIndex((tab) => tab.id === id);
  if (index < 0) return { tabs, activeId };
  const next = tabs.filter((tab) => tab.id !== id);
  if (activeId !== id) return { tabs: next, activeId };
  const neighbor = next[index] || next[index - 1] || null;
  return { tabs: next, activeId: neighbor ? neighbor.id : null };
}

export function planReplaceCreate(tabs, activeId, cardId) {
  const index = tabs.findIndex((tab) => tab.id === CREATE_TAB_ID);
  if (index < 0) return { tabs, activeId };
  const next = tabs.map((tab) => (tab.id === CREATE_TAB_ID
    ? { id: cardId, kind: 'detail', dirty: false, openedAt: tab.openedAt, generation: 0 }
    : tab));
  return { tabs: next, activeId: activeId === CREATE_TAB_ID ? cardId : activeId };
}
