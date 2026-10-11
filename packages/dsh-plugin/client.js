/**
 * 浏览器端：左侧栏「灵感台」，以及对话右侧栏里的灵感 tab 和工具卡片。
 * 宽屏是清单与详情左右分栏，窄屏是整页详情。
 * 输出格式与 spikes/s1-panel/plugin/client.js 相同。React 来自 dsh 的浏览器模块表。
 * 请求用相对路径、开头不带 /，以兼容 Desktop 的 dsh-app:// 挂载。
 * 上海时区的日期函数与 src/shanghai.js 保持同一份文本（测试会核对）。
 * 右侧栏与工具卡片的纯函数与 src/idea-sidebar.js 保持同一份文本（测试会核对）。
 * 原文是否显示与 src/raw-text.js 保持同一份文本（测试会核对）。
 */
window.__ModuleLoader__.load({
  id: '@bluemanta/dsh-plugin',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const shell = { sidebarRight: null }
    const ideaDrafts = new Map()
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
    const titleBus = {
      titles: new Map(),
      listeners: new Set(),
      set(id, title) {
        if (!id || this.titles.get(id) === title) return
        this.titles.set(id, title)
        for (const listener of this.listeners) listener()
      },
      get(id) { return this.titles.get(id) || '' },
      subscribe(listener) {
        this.listeners.add(listener)
        return () => { this.listeners.delete(listener) }
      },
    }
    const PANEL_ID = 'bluemanta.ideas'
    const CARDS_ROUTE = 'api/bluemanta/cards?cardType=idea'
    const TRASH_ROUTE = 'api/bluemanta/cards?cardType=idea&trash=1'
    const COMMANDS_ROUTE = 'api/bluemanta/commands'
    const CATEGORY = { product: '产品想法', learning: '学习备忘', work: '工作事务', life: '生活随想', other: '其他' }
    const CATEGORIES = Object.keys(CATEGORY)
    const MATCH = { title: '匹配标题', body: '匹配正文', rawInput: '匹配原文', category: '匹配分类' }
    const NAV = [
      { id: 'list', label: '灵感清单' },
      { id: 'stats', label: '数据统计' },
      { id: 'trash', label: '回收站' },
    ]

    const SHANGHAI = 'Asia/Shanghai';

    const WEEKDAY_INDEX = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 };

    function pad(value) {
      return value < 10 ? '0' + value : String(value);
    }

    function shanghaiParts(ms) {
      const fmt = new Intl.DateTimeFormat('en-US', {
        timeZone: SHANGHAI,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23',
        weekday: 'short',
      });
      const bag = {};
      for (const part of fmt.formatToParts(new Date(ms))) bag[part.type] = part.value;
      return {
        year: Number(bag.year),
        month: Number(bag.month),
        day: Number(bag.day),
        hour: Number(bag.hour),
        minute: Number(bag.minute),
        weekday: bag.weekday,
      };
    }

    function dayKey(ms) {
      const parts = shanghaiParts(ms);
      return parts.year + '-' + pad(parts.month) + '-' + pad(parts.day);
    }

    function shiftDay(key, delta) {
      const [year, month, day] = key.split('-').map(Number);
      const utc = new Date(Date.UTC(year, month - 1, day));
      utc.setUTCDate(utc.getUTCDate() + delta);
      return utc.getUTCFullYear() + '-' + pad(utc.getUTCMonth() + 1) + '-' + pad(utc.getUTCDate());
    }

    function formatDayLabel(key, nowMs) {
      const [year, month, day] = key.split('-').map(Number);
      const text = month + '月' + day + '日';
      return year === shanghaiParts(nowMs).year ? text : year + '年' + text;
    }

    function relativeTime(iso, nowMs) {
      const created = Date.parse(iso);
      if (!Number.isFinite(created)) return '';
      const key = dayKey(created);
      const today = dayKey(nowMs);
      if (key === today) {
        const diff = Math.max(0, nowMs - created);
        if (diff < 60000) return '刚刚';
        if (diff < 3600000) return Math.floor(diff / 60000) + ' 分钟前';
        return Math.floor(diff / 3600000) + ' 小时前';
      }
      if (key === shiftDay(today, -1)) return '昨天';
      return formatDayLabel(key, nowMs);
    }

    function mondayKey(nowMs) {
      const weekday = WEEKDAY_INDEX[shanghaiParts(nowMs).weekday] ?? 0;
      return shiftDay(dayKey(nowMs), -weekday);
    }

    function summarizeCounts(cards, nowMs) {
      const today = dayKey(nowMs);
      const monday = mondayKey(nowMs);
      const monthPrefix = today.slice(0, 7);
      let week = 0;
      let month = 0;
      let starred = 0;
      for (const card of cards) {
        const key = dayKey(Date.parse(card.createdAt));
        if (key >= monday && key <= today) week += 1;
        if (key.startsWith(monthPrefix)) month += 1;
        if (card.starred) starred += 1;
      }
      return { all: cards.length, week, month, starred };
    }

    function heatmapWeeks(cards, columns, nowMs) {
      const today = dayKey(nowMs);
      const weekday = WEEKDAY_INDEX[shanghaiParts(nowMs).weekday] ?? 0;
      const end = shiftDay(today, 6 - weekday);
      const start = shiftDay(end, -(columns * 7 - 1));
      const counts = new Map();
      for (const card of cards) {
        const key = dayKey(Date.parse(card.createdAt));
        counts.set(key, (counts.get(key) || 0) + 1);
      }
      const weeks = [];
      for (let column = 0; column < columns; column += 1) {
        const days = [];
        for (let row = 0; row < 7; row += 1) {
          const key = shiftDay(start, column * 7 + row);
          const future = key > today;
          days.push({ key, count: future ? 0 : counts.get(key) || 0, future });
        }
        weeks.push(days);
      }
      return weeks;
    }

    const CSS = `
.bm-app, .bm-app * { box-sizing: border-box; }
.bm-app {
  position: relative; display: flex; height: 100%; min-height: 0; overflow: hidden;
  color: var(--dsw-alias-label-primary); background: transparent;
}
.bm-app[data-narrow="true"] { flex-direction: column; }
.bm-nav {
  width: 160px; flex: none; display: flex; flex-direction: column; gap: 2px;
  padding: 28px 12px 24px; border-right: 0.5px solid var(--dsw-alias-border-l3);
}
.bm-app[data-narrow="true"] .bm-nav {
  width: auto; flex-direction: row; overflow-x: auto; border-right: 0;
  border-bottom: 0.5px solid var(--dsw-alias-border-l3); padding: 12px 16px;
}
.bm-app[data-platform="darwin"] .bm-nav { padding-top: calc(28px + var(--dsh-frame-top-clearance, 0px)); }
.bm-nav-btn {
  height: 32px; padding: 0 10px; border: 0; border-radius: var(--dsw-radius-md);
  background: transparent; color: var(--dsw-alias-label-secondary);
  font: inherit; font-size: 13px; line-height: 20px; text-align: left; cursor: pointer;
  white-space: nowrap;
}
.bm-nav-btn:hover { background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-primary); }
.bm-nav-btn.is-on { background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-state-business-primary); font-weight: 500; }
.bm-nav-btn:focus-visible { outline: var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary)); outline-offset: 1px; }
.bm-column { width: 100%; max-width: 960px; margin: 0 auto; }
.bm-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; padding-top: 28px; }
.bm-app[data-platform="darwin"]:not([data-narrow="true"]) .bm-head { padding-top: calc(28px + var(--dsh-frame-top-clearance, 0px)); }
.bm-app[data-narrow="true"] .bm-head { padding-top: 16px; }
.bm-title { margin: 0; font-size: 20px; font-weight: 500; line-height: 28px; }
.bm-intro { margin: 4px 0 0; font-size: 13px; line-height: 20px; color: var(--dsw-alias-label-secondary); }
.bm-toolbar { display: flex; flex-direction: column; gap: 12px; margin-top: 20px; }
.bm-search { position: relative; display: flex; align-items: center; }
.bm-search input, .bm-field input, .bm-field textarea, .bm-field select {
  width: 100%; border: 0.5px solid var(--dsw-alias-border-l4); border-radius: var(--dsw-radius-md);
  background: var(--dsw-alias-bg-layer-3); color: var(--dsw-alias-label-primary);
  font: inherit; font-size: 13px; outline: none;
}
.bm-search input { height: 40px; padding: 0 36px 0 14px; }
.bm-search input:focus, .bm-field input:focus, .bm-field textarea:focus, .bm-field select:focus {
  border-color: var(--dsw-alias-state-business-primary);
  box-shadow: inset 0 0 0 0.5px var(--dsw-alias-state-business-primary);
}
.bm-search .bm-icon-btn { position: absolute; right: 6px; }
.bm-icon-btn, .bm-star, .bm-shot button, .bm-thumb {
  border: 0; background: transparent; color: var(--dsw-alias-label-tertiary); cursor: pointer;
  font: inherit;
}
.bm-icon-btn { width: 28px; height: 28px; border-radius: var(--dsw-radius-md); }
.bm-icon-btn:hover, .bm-star:hover, .bm-thumb:hover { background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-primary); }
.bm-filters { display: flex; flex-direction: column; gap: 8px; }
.bm-filter { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
.bm-filter-label { font-size: 12px; line-height: 18px; color: var(--dsw-alias-label-tertiary); min-width: 28px; }
.bm-choices { display: flex; flex-wrap: wrap; gap: 4px; }
.bm-choice {
  height: 28px; padding: 0 10px; border: 0.5px solid transparent; border-radius: var(--dsw-radius-md);
  background: transparent; color: var(--dsw-alias-label-secondary); font: inherit; font-size: 13px; cursor: pointer;
}
.bm-choice:hover { background: var(--dsw-alias-interactive-bg-hover); }
.bm-choice.is-on { color: var(--dsw-alias-state-business-primary); border-color: var(--dsw-alias-state-business-primary); }
.bm-chip {
  display: inline-flex; align-items: center; gap: 4px; height: 28px; padding: 0 8px 0 10px;
  border-radius: var(--dsw-radius-md); background: var(--dsw-alias-bg-layer-3);
  color: var(--dsw-alias-label-primary); font-size: 13px;
}
.bm-status { margin: 20px 0 0; font-size: 13px; line-height: 20px; color: var(--dsw-alias-label-tertiary); }
.bm-error { margin: 12px 0 0; font-size: 13px; line-height: 20px; color: var(--dsw-alias-state-error-primary); }
.bm-list { list-style: none; margin: 12px 0 0; padding: 0; display: flex; flex-direction: column; gap: 2px; }
.bm-row {
  display: flex; align-items: flex-start; gap: 8px; margin: 0 -8px; padding: 4px 8px 4px 0;
  border-radius: var(--dsw-radius-xl);
}
.bm-row:hover { background: var(--dsw-alias-interactive-bg-hover); }
.bm-row.is-active { background: var(--dsw-alias-markdown-tag, var(--dsw-alias-interactive-bg-hover)); }
.bm-row-main {
  flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 4px;
  padding: 8px; border: 0; background: transparent; color: inherit; text-align: left;
  font: inherit; cursor: pointer; border-radius: var(--dsw-radius-lg);
}
.bm-row-title { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
.bm-name { font-size: 14px; line-height: 22px; font-weight: 500; }
.bm-tag, .bm-ext {
  display: inline-flex; align-items: center; height: 18px; padding: 0 7px;
  border-radius: var(--dsw-radius-sm, 4px); background: var(--dsw-alias-bg-layer-3);
  color: var(--dsw-alias-label-secondary); font-size: 10px; line-height: 1;
}
.bm-summary { margin: 0; font-size: 13px; line-height: 20px; color: var(--dsw-alias-label-secondary);
  overflow: hidden; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; }
.bm-meta { font-size: 12px; line-height: 18px; color: var(--dsw-alias-label-tertiary); }
.bm-thumb { width: 56px; height: 56px; margin-top: 8px; padding: 0; border-radius: var(--dsw-radius-md); overflow: hidden; flex: none; }
.bm-thumb img, .bm-shot img, .bm-light img { display: block; width: 100%; height: 100%; object-fit: cover; }
.bm-star { width: 32px; height: 32px; margin-top: 8px; border-radius: var(--dsw-radius-md); flex: none; display: inline-flex; align-items: center; justify-content: center; }
.bm-star.is-on { color: var(--dsw-alias-state-warn-primary); }
.bm-metrics { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 20px; }
.bm-metric {
  min-width: 96px; padding: 12px 14px; border-radius: var(--dsw-radius-lg);
  background: var(--dsw-alias-bg-layer-2); border: 0.5px solid var(--dsw-alias-border-l3);
}
.bm-metric span { display: block; font-size: 12px; line-height: 18px; color: var(--dsw-alias-label-tertiary); }
.bm-metric b { display: block; margin-top: 2px; font-size: 20px; line-height: 28px; font-weight: 500; font-variant-numeric: tabular-nums; }
.bm-heat { display: grid; grid-auto-flow: column; grid-template-rows: repeat(7, minmax(0, 1fr)); gap: 3px; width: 100%; margin-top: 16px; }
.bm-cell {
  aspect-ratio: 1; width: 100%; padding: 0; border: 0; border-radius: var(--dsw-radius-sm, 3px);
  box-shadow: inset 0 0 0 0.5px var(--dsw-alias-border-l3); cursor: pointer;
}
.bm-cell:disabled { cursor: default; opacity: 0.4; }
.bm-cell:focus-visible, .bm-choice:focus-visible, .bm-btn:focus-visible, .bm-row-main:focus-visible,
.bm-tab:focus-visible, .bm-tab-close:focus-visible, .bm-splitter:focus-visible, .bm-back:focus-visible {
  outline: var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary));
  outline-offset: 1px;
}
.bm-stage { flex: 1; min-width: 0; min-height: 0; display: flex; flex-direction: column; }
.bm-stage[hidden] { display: none; }
.bm-scroll { overflow: auto; padding: 0 clamp(24px, 4vw, 48px) 48px; }
.bm-split { flex: 1; min-width: 0; min-height: 0; display: flex; }
.bm-list-pane { flex: none; min-width: 0; min-height: 0; overflow: auto; padding: 0 16px 32px; }
.bm-splitter {
  flex: none; width: 5px; margin: 0 -2px; padding: 0; border: 0; position: relative; z-index: 1;
  background: transparent; cursor: col-resize; touch-action: none;
}
.bm-splitter::before {
  content: ''; position: absolute; top: 0; bottom: 0; left: 2px; width: 0.5px;
  background: var(--dsw-alias-border-l3);
}
.bm-splitter:hover::before, .bm-splitter:focus-visible::before {
  left: 1.5px; width: 2px; background: var(--dsw-alias-state-business-primary);
}
.bm-detail-pane { flex: 1; min-width: 0; min-height: 0; display: flex; flex-direction: column; }
.bm-app[data-narrow="true"] .bm-split { flex-direction: column; }
.bm-app[data-narrow="true"] .bm-list-pane { flex: 1; width: auto; }
.bm-app[data-narrow="true"] .bm-splitter,
.bm-app[data-narrow="true"] .bm-tabstrip,
.bm-app[data-narrow="true"] .bm-back { display: none; }
.bm-app[data-narrow="true"][data-page="detail"] .bm-list-pane { display: none; }
.bm-app[data-narrow="true"]:not([data-page="detail"]) .bm-detail-pane { display: none; }
.bm-app[data-narrow="true"][data-page="detail"] .bm-back { display: inline-flex; }
.bm-back {
  display: none; flex: none; align-items: center; width: fit-content; height: 32px;
  margin: 12px 16px 0; padding: 0 10px; border: 0; border-radius: var(--dsw-radius-md);
  background: transparent; color: var(--dsw-alias-label-secondary); font: inherit; font-size: 13px; cursor: pointer;
}
.bm-back:hover { background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-primary); }
.bm-app[data-platform="darwin"][data-narrow="true"][data-page="detail"] .bm-back {
  margin-top: calc(12px + var(--dsh-frame-top-clearance, 0px));
}
.bm-tabstrip {
  flex: none; display: flex; align-items: flex-end; min-width: 0; height: 38px;
  padding: 10px 10px 0;
}
.bm-app[data-platform="darwin"]:not([data-narrow="true"]) .bm-tabstrip {
  padding-top: calc(10px + var(--dsh-frame-top-clearance, 0px));
  height: calc(38px + var(--dsh-frame-top-clearance, 0px));
}
.bm-tabscroll {
  display: flex; flex: 1; align-items: center; gap: 10px; min-width: 0;
  overflow-x: auto; overflow-y: hidden; scrollbar-width: none;
}
.bm-tabscroll::-webkit-scrollbar { display: none; }
.bm-tab {
  position: relative; display: flex; flex: 0 1 auto; align-items: center; gap: 0;
  min-width: 80px; max-width: 170px; height: 28px; padding: 0 26px 0 10px;
  border-radius: var(--dsw-radius-sm); color: var(--dsw-alias-label-secondary);
  font-size: 13px; line-height: 1; white-space: nowrap; cursor: pointer; user-select: none;
}
.bm-tab + .bm-tab::before {
  content: ''; position: absolute; left: -5px; top: 7px; width: 0.5px; height: 14px;
  background: var(--dsw-alias-border-l4);
}
.bm-tab.is-on::before, .bm-tab.is-on + .bm-tab::before { background: transparent; }
.bm-tab:hover { background: var(--dsw-alias-interactive-bg-hover); }
.bm-tab.is-on { color: var(--dsw-alias-label-primary); background: var(--dsw-alias-markdown-tag, var(--dsw-alias-bg-layer-3)); }
.bm-tab-title { display: flex; flex: 1; align-items: center; gap: 5px; min-width: 0; overflow: hidden; line-height: 1.4; }
.bm-tab-text { min-width: 0; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
.bm-tab-dot {
  width: 6px; height: 6px; border-radius: 50%; flex: none;
  background: var(--dsw-alias-state-business-primary);
}
.bm-tab-close {
  position: absolute; top: 4px; right: 4px; width: 20px; height: 20px; padding: 0;
  display: flex; align-items: center; justify-content: center;
  border: 0; border-radius: var(--dsw-radius-sm); background: transparent;
  color: var(--dsw-alias-label-tertiary); font: inherit; line-height: 1; cursor: pointer;
  opacity: 0; pointer-events: none;
}
.bm-tab:hover .bm-tab-close, .bm-tab:focus-within .bm-tab-close, .bm-tab.is-on .bm-tab-close {
  opacity: 1; pointer-events: auto;
}
.bm-tab-close:hover { color: var(--dsw-alias-label-primary); background: var(--dsw-alias-interactive-bg-hover); }
.bm-tab-panels { flex: 1; min-height: 0; position: relative; }
.bm-tab-panel { position: absolute; inset: 0; display: flex; flex-direction: column; min-height: 0; }
.bm-tab-panel[hidden] { display: none; }
.bm-detail-empty {
  flex: 1; display: flex; align-items: center; justify-content: center;
  color: var(--dsw-alias-label-tertiary); font-size: 13px; line-height: 20px;
}
.bm-detail { display: flex; flex-direction: column; height: 100%; min-height: 0; }
.bm-detail-bar, .bm-detail-foot { flex: none; display: flex; align-items: center; gap: 8px; padding: 12px 16px; }
.bm-detail-bar { justify-content: flex-end; }
.bm-detail-foot { justify-content: space-between; border-top: 0.5px solid var(--dsw-alias-border-l3); }
.bm-detail-body { flex: 1; min-height: 0; overflow: auto; padding: 0 16px 24px; display: flex; flex-direction: column; gap: 14px; }
.bm-read-title { margin: 0; font-size: 18px; line-height: 26px; font-weight: 500; }
.bm-read-body { margin: 0; white-space: pre-wrap; font-size: 14px; line-height: 22px; }
.bm-field { display: flex; flex-direction: column; gap: 6px; font-size: 13px; }
.bm-field input { height: 40px; padding: 0 12px; }
.bm-field textarea { min-height: 140px; padding: 10px 12px; resize: vertical; line-height: 20px; }
.bm-field select { height: 40px; padding: 0 12px; }
.bm-images { display: flex; flex-wrap: wrap; gap: 8px; }
.bm-shot { position: relative; width: 88px; height: 88px; border-radius: var(--dsw-radius-md); overflow: hidden; background: var(--dsw-alias-bg-layer-3); }
button.bm-shot { display: block; padding: 0; border: 0; color: inherit; font: inherit; cursor: pointer; }
.bm-shot button { position: absolute; top: 4px; right: 4px; width: 22px; height: 22px; border-radius: var(--dsw-radius-sm, 4px); background: var(--dsw-alias-bg-layer-1); }
.bm-progress { position: absolute; left: 0; right: 0; bottom: 0; height: 3px; background: var(--dsw-alias-bg-layer-2); }
.bm-progress > span { display: block; height: 100%; background: var(--dsw-alias-state-business-primary); }
.bm-drop { padding: 10px; border: 0.5px dashed var(--dsw-alias-border-l4); border-radius: var(--dsw-radius-lg); }
.bm-drop.is-over { border-color: var(--dsw-alias-state-business-primary); }
.bm-actions { display: flex; justify-content: flex-end; gap: 8px; }
.bm-btn {
  height: 32px; padding: 0 12px; border-radius: var(--dsw-radius-md);
  border: 0.5px solid var(--dsw-alias-border-l4); background: var(--dsw-alias-bg-layer-3);
  color: var(--dsw-alias-label-primary); font: inherit; font-size: 13px; cursor: pointer;
}
.bm-btn:hover { background: var(--dsw-alias-interactive-bg-hover); }
.bm-btn:disabled { opacity: 0.45; cursor: default; }
.bm-btn-primary { background: var(--dsw-alias-label-primary); border-color: var(--dsw-alias-label-primary); color: var(--dsw-alias-bg-layer-1); }
.bm-btn-primary:hover { background: var(--dsw-alias-label-primary); }
.bm-btn-danger { color: var(--dsw-alias-state-error-primary); border-color: color-mix(in srgb, var(--dsw-alias-state-error-primary) 35%, transparent); background: transparent; }
.bm-btn-ghost { border-color: transparent; background: transparent; color: var(--dsw-alias-label-secondary); }
.bm-raw { border: 0; background: transparent; padding: 0; color: var(--dsw-alias-state-business-primary); font: inherit; font-size: 13px; cursor: pointer; text-align: left; }
.bm-raw-body { margin: 8px 0 0; white-space: pre-wrap; font-size: 13px; line-height: 20px; color: var(--dsw-alias-label-secondary); }
.bm-ext-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 10px; }
.bm-ext-item { padding-top: 10px; border-top: 0.5px solid var(--dsw-alias-border-l3); }
.bm-ext-meta { display: flex; justify-content: space-between; gap: 8px; font-size: 12px; line-height: 18px; color: var(--dsw-alias-label-tertiary); }
.bm-block-title { margin: 8px 0 0; font-size: 14px; line-height: 22px; font-weight: 500; }
.bm-compose { display: flex; flex-direction: column; gap: 8px; }
.bm-compose textarea {
  width: 100%; min-height: 88px; padding: 10px 12px; resize: vertical;
  border: 0.5px solid var(--dsw-alias-border-l4); border-radius: var(--dsw-radius-md);
  background: var(--dsw-alias-bg-layer-3); color: var(--dsw-alias-label-primary);
  font: inherit; font-size: 13px; line-height: 20px; outline: none;
}
.bm-compose textarea:focus {
  border-color: var(--dsw-alias-state-business-primary);
  box-shadow: inset 0 0 0 0.5px var(--dsw-alias-state-business-primary);
}
.bm-dialog-mask, .bm-light {
  position: absolute; inset: 0; z-index: 6; display: flex; align-items: center; justify-content: center;
  background: color-mix(in srgb, var(--dsw-alias-label-primary) 40%, transparent); padding: 24px;
}
.bm-light { z-index: 7; }
.bm-dialog {
  width: min(400px, 100%); padding: 20px; border-radius: var(--dsw-radius-xl);
  background: var(--dsw-alias-bg-layer-1); border: 0.5px solid var(--dsw-alias-border-l3);
  box-shadow: var(--dsw-shadow-l2, 0 0 0 transparent);
}
.bm-dialog p { margin: 0; font-size: 14px; line-height: 22px; }
.bm-light img { width: auto; height: auto; max-width: min(920px, 100%); max-height: calc(100% - 48px); object-fit: contain; background: var(--dsw-alias-bg-layer-1); }
.bm-light-nav { position: absolute; bottom: 20px; display: flex; gap: 8px; }
.bm-sr { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0, 0, 0, 0); border: 0; }
.bm-side { flex-direction: column; }
.bm-side .bm-list-pane { flex: 1; width: auto; }
.bm-side .bm-head { padding-top: 16px; }
.bm-side > .bm-detail { flex: 1; min-height: 0; }
.bm-tool {
  margin: 4px 0; padding: 10px 12px; display: flex; flex-direction: column; gap: 8px;
  border: 0.5px solid var(--dsw-alias-border-l3); border-radius: var(--dsw-radius-lg);
  background: var(--dsw-alias-bg-layer-2);
}
.bm-tool-line { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; }
.bm-tool-main { min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.bm-tool-title { font-size: 13px; line-height: 20px; color: var(--dsw-alias-label-primary); }
.bm-tool-meta { margin: 0; font-size: 12px; line-height: 18px; color: var(--dsw-alias-label-tertiary); }
.bm-tool-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
.bm-tool .bm-btn { flex: none; }
.bm-tool .bm-summary { margin: 0; }
`

    function uuid() {
      if (globalThis.crypto && typeof crypto.randomUUID === 'function') return crypto.randomUUID()
      return 'req-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2)
    }

    function readJson(response) {
      return response.text().then((text) => {
        let body = null
        if (text) {
          try { body = JSON.parse(text) } catch { body = null }
        }
        if (!response.ok) {
          const message = body && (body.message || body.error) ? (body.message || body.error) : ('HTTP ' + response.status)
          const error = new Error(message)
          error.code = body && body.code
          throw error
        }
        return body
      })
    }

    function postCommand(command, input) {
      return fetch(COMMANDS_ROUTE, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ command, input }),
      }).then(readJson).then((body) => {
        if (!body || body.ok !== true) {
          const error = new Error((body && body.message) || '没有完成')
          error.code = body && body.code
          throw error
        }
        return body.record
      })
    }

    function uploadImage(file, requestId, onProgress) {
      return new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest()
        const name = encodeURIComponent(file.name || 'image')
        xhr.open('POST', 'api/bluemanta/attachments?requestId=' + encodeURIComponent(requestId) + '&name=' + name)
        xhr.setRequestHeader('Content-Type', file.type || 'application/octet-stream')
        xhr.upload.onprogress = (event) => {
          if (event.lengthComputable && event.total > 0) onProgress(event.loaded / event.total)
        }
        xhr.onload = () => {
          let body = null
          try { body = JSON.parse(xhr.responseText) } catch { body = null }
          if (xhr.status >= 200 && xhr.status < 300 && body && body.ok === true && body.record) resolve(body.record)
          else reject(new Error((body && body.message) || '上传失败'))
        }
        xhr.onerror = () => reject(new Error('上传失败'))
        xhr.send(file)
      })
    }

    function attachmentUrl(id) {
      return 'api/bluemanta/attachment?id=' + encodeURIComponent(id)
    }

    function previewOf(file) {
      return URL.createObjectURL(file)
    }

    function revokeImages(images) {
      for (const image of images || []) {
        if (typeof image.preview === 'string' && image.preview.indexOf('blob:') === 0) URL.revokeObjectURL(image.preview)
      }
    }

    function patchImage(images, key, patch) {
      return images.map((image) => image.key === key ? Object.assign({}, image, patch) : image)
    }

    function excerptOf(card) {
      if (typeof card.excerpt === 'string' && card.excerpt) return card.excerpt
      const body = String(card.body || '').replace(/\s+/g, ' ').trim()
      const chars = Array.from(body)
      if (chars.length <= 120) return body
      return chars.slice(0, 120).join('') + '…'
    }

    function byCreatedDesc(a, b) {
      return String(b.createdAt).localeCompare(String(a.createdAt))
    }

    function visibleCards(cards, scope, category, day) {
      return cards.filter((card) => {
        if (scope === 'starred' && !card.starred) return false
        if (category !== 'all' && !(card.fields && card.fields.category === category)) return false
        if (day && dayKey(Date.parse(card.createdAt)) !== day) return false
        return true
      }).sort(byCreatedDesc)
    }

    function weekColumns(width) {
      const fit = Math.floor((width + 3) / 14)
      if (!Number.isFinite(fit) || fit < 1) return 26
      return Math.max(1, Math.min(26, fit))
    }

    function heatBackground(count) {
      if (!count) return 'transparent'
      const opacity = count === 1 ? 35 : count <= 3 ? 55 : count <= 6 ? 75 : 100
      return 'color-mix(in srgb, var(--dsw-alias-state-business-primary) ' + opacity + '%, transparent)'
    }

    /**
     * 灵感台分栏与多 tab 的纯函数。client.js 内嵌同一份文本（测试会核对）。
     * 只处理界面偏好和 tab 开关，不读写业务数据。
     */

    const LIST_WIDTH_DEFAULT = 380;

    const LIST_WIDTH_MIN = 280;

    const LIST_WIDTH_RATIO = 0.6;

    const LIST_WIDTH_KEY = 'bluemanta.ideas.listWidth';

    const TAB_LIMIT = 8;

    const CREATE_TAB_ID = 'create';

    const TAB_LIMIT_MESSAGE = '已打开 8 个详情，且都有未保存的修改。请先保存或关闭其中一个。';

    function clampListWidth(preferred, appWidth) {
      const width = Number.isFinite(preferred) ? preferred : LIST_WIDTH_DEFAULT;
      const span = Number(appWidth);
      const max = Math.max(LIST_WIDTH_MIN, Math.floor((Number.isFinite(span) ? span : 0) * LIST_WIDTH_RATIO));
      return Math.min(max, Math.max(LIST_WIDTH_MIN, Math.round(width)));
    }

    function readStoredListWidth(storage) {
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

    function writeStoredListWidth(storage, width) {
      try {
        if (!storage || typeof storage.setItem !== 'function') return;
        storage.setItem(LIST_WIDTH_KEY, String(Math.round(width)));
      } catch {
        // 隐私模式或禁用存储时，宽度只留在本次会话。
      }
    }

    function planOpenTab(tabs, request) {
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

    function planCloseTab(tabs, activeId, id) {
      const index = tabs.findIndex((tab) => tab.id === id);
      if (index < 0) return { tabs, activeId };
      const next = tabs.filter((tab) => tab.id !== id);
      if (activeId !== id) return { tabs: next, activeId };
      const neighbor = next[index] || next[index - 1] || null;
      return { tabs: next, activeId: neighbor ? neighbor.id : null };
    }

    function planReplaceCreate(tabs, activeId, cardId) {
      const index = tabs.findIndex((tab) => tab.id === CREATE_TAB_ID);
      if (index < 0) return { tabs, activeId };
      const next = tabs.map((tab) => (tab.id === CREATE_TAB_ID
        ? { id: cardId, kind: 'detail', dirty: false, openedAt: tab.openedAt, generation: 0 }
        : tab));
      return { tabs: next, activeId: activeId === CREATE_TAB_ID ? cardId : activeId };
    }

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

    function editDraft(card) {
      return {
        title: card.title || '',
        body: card.body || '',
        category: (card.fields && card.fields.category) || 'other',
        images: (card.attachmentIds || []).map((id) => ({
          key: id,
          id,
          file: null,
          preview: attachmentUrl(id),
          status: 'ready',
          progress: 1,
          message: '',
          requestId: id,
        })),
        requestId: uuid(),
      }
    }

    function editIsDirty(card, draft) {
      if (!card || !draft) return false
      if (draft.title !== (card.title || '')) return true
      if (draft.body !== (card.body || '')) return true
      if (draft.category !== ((card.fields && card.fields.category) || 'other')) return true
      const current = (card.attachmentIds || []).join('\n')
      const next = draft.images.map((image) => image.id || '').join('\n')
      if (current !== next) return true
      return draft.images.some((image) => image.status !== 'ready')
    }

    function filesFromClipboard(event) {
      const items = event.clipboardData && event.clipboardData.items
      if (!items) return []
      const files = []
      for (const item of items) {
        if (item.kind === 'file') {
          const file = item.getAsFile()
          if (file) files.push(file)
        }
      }
      return files
    }

    function readInitialWidth() {
      try { return readStoredListWidth(globalThis.localStorage) } catch { return LIST_WIDTH_DEFAULT }
    }

    function storeWidth(width) {
      try { writeStoredListWidth(globalThis.localStorage, width) } catch { /* 本次会话内仍然生效 */ }
    }

    function AttachmentEditor({ images, onChange, addRef }) {
      const fileRef = React.useRef(null)
      const imagesRef = React.useRef(images)
      imagesRef.current = images
      const alive = React.useRef(true)
      const [dragOver, setDragOver] = React.useState(false)
      React.useEffect(() => () => { alive.current = false }, [])

      function patch(key, next) {
        if (!alive.current) return
        onChange((prev) => patchImage(prev, key, next))
      }

      function begin(image) {
        patch(image.key, { status: 'uploading', progress: 0, message: '' })
        uploadImage(image.file, image.requestId, (progress) => {
          patch(image.key, { progress })
        }).then((record) => {
          patch(image.key, { status: 'ready', id: record.id, progress: 1, message: '' })
        }).catch((error) => {
          patch(image.key, { status: 'error', message: String(error.message || error) })
        })
      }

      function addFiles(fileList) {
        const room = 4 - imagesRef.current.length
        if (room <= 0) return
        const created = Array.from(fileList).filter(Boolean).slice(0, room).map((file) => ({
          key: uuid(),
          id: null,
          file,
          preview: previewOf(file),
          status: 'uploading',
          progress: 0,
          message: '',
          requestId: uuid(),
        }))
        onChange((prev) => prev.concat(created).slice(0, 4))
        for (const image of created) begin(image)
      }

      if (addRef) addRef.current = addFiles

      function removeImage(image) {
        if (typeof image.preview === 'string' && image.preview.indexOf('blob:') === 0) URL.revokeObjectURL(image.preview)
        onChange((prev) => prev.filter((item) => item.key !== image.key))
      }

      return h('div', {
        className: 'bm-drop' + (dragOver ? ' is-over' : ''),
        onDragOver: (event) => { event.preventDefault(); setDragOver(true) },
        onDragLeave: () => setDragOver(false),
        onDrop: (event) => {
          event.preventDefault()
          setDragOver(false)
          addFiles(event.dataTransfer.files)
        },
      },
      h('div', { className: 'bm-images' },
        images.map((image) => h('div', { key: image.key, className: 'bm-shot' },
          h('img', { src: image.preview, alt: '' }),
          image.status === 'uploading' ? h('div', { className: 'bm-progress' }, h('span', { style: { width: Math.round((image.progress || 0) * 100) + '%' } })) : null,
          h('button', { type: 'button', 'aria-label': '移除图片', onClick: () => removeImage(image) }, '×'),
          image.status === 'error' ? h('button', {
            type: 'button', className: 'bm-btn', style: { position: 'absolute', left: 4, bottom: 4, height: 22, padding: '0 6px' },
            onClick: () => begin(image),
          }, '重试') : null)),
        images.length < 4 ? h('button', {
          type: 'button', className: 'bm-btn', onClick: () => { if (fileRef.current) fileRef.current.click() },
        }, '添加图片') : null),
      h('p', { className: 'bm-meta' }, images.some((image) => image.message) ? images.map((image) => image.message).filter(Boolean).join(' ') : '最多 4 张，可以点选、拖入或粘贴。'),
      h('input', {
        ref: fileRef, className: 'bm-sr', type: 'file', multiple: true,
        accept: 'image/jpeg,image/png,image/gif,image/webp',
        onChange: (event) => {
          addFiles(event.target.files)
          event.target.value = ''
        },
      }))
    }

    function saveDisabled(title, body, images, saving, extra) {
      const blocked = images.some((image) => image.status !== 'ready')
      const ready = images.some((image) => image.status === 'ready' && image.id)
      const hasContent = title.trim() !== '' || body.trim() !== '' || ready
      return !hasContent || blocked || saving || extra
    }

    // 新增表单自包含，不读取灵感台的分栏或 tab。保存成功后由调用方把这个 tab 换成详情。
    function IdeaCreate({ onClose, onCancel, onCreated, onDirty }) {
      const [title, setTitle] = React.useState('')
      const [body, setBody] = React.useState('')
      const [images, setImages] = React.useState([])
      const [error, setError] = React.useState('')
      const [saving, setSaving] = React.useState(false)
      const requestId = React.useRef(uuid())
      const savingRef = React.useRef(false)
      const addRef = React.useRef(null)
      const imagesRef = React.useRef(images)
      const stateRef = React.useRef({})
      imagesRef.current = images
      stateRef.current = { title, body, images, saving }
      const dirty = title.trim() !== '' || body.trim() !== '' || images.length > 0
      const onDirtyRef = React.useRef(onDirty)
      onDirtyRef.current = onDirty
      React.useEffect(() => { onDirtyRef.current(dirty) }, [dirty])
      React.useEffect(() => () => { revokeImages(imagesRef.current) }, [])

      function save() {
        const state = stateRef.current
        if (savingRef.current || saveDisabled(state.title, state.body, state.images, false, false)) return
        const ids = state.images.filter((image) => image.status === 'ready' && image.id).map((image) => image.id)
        const input = { requestId: requestId.current, cardType: 'idea' }
        if (state.title.trim()) input.title = state.title.trim()
        if (state.body.trim()) input.body = state.body
        if (ids.length) input.attachmentIds = ids
        savingRef.current = true
        setSaving(true)
        setError('')
        postCommand('card.create', input).then((record) => {
          onCreated(record)
        }).catch((failure) => {
          savingRef.current = false
          setSaving(false)
          setError(String(failure.message || failure))
        })
      }

      return h('div', {
        className: 'bm-detail',
        'aria-label': '新增灵感',
        onPaste: (event) => {
          const files = filesFromClipboard(event)
          if (!files.length || !addRef.current) return
          event.preventDefault()
          addRef.current(files)
        },
      },
      h('div', { className: 'bm-detail-bar' },
        h('h2', { className: 'bm-read-title', style: { marginRight: 'auto' } }, '新增灵感'),
        h('button', { type: 'button', className: 'bm-btn', onClick: onClose }, '关闭')),
      h('div', { className: 'bm-detail-body' },
        h('label', { className: 'bm-field' }, '标题',
          h('input', { value: title, placeholder: '一句话概括…', onChange: (event) => setTitle(event.target.value) })),
        h('label', { className: 'bm-field' }, '正文',
          h('textarea', { value: body, placeholder: '把闪过的念头写下来…', onChange: (event) => setBody(event.target.value) })),
        h(AttachmentEditor, { images, onChange: setImages, addRef }),
        error ? h('p', { className: 'bm-error' }, error) : null,
        h('div', { className: 'bm-actions' },
          h('button', { type: 'button', className: 'bm-btn', onClick: onCancel }, '取消'),
          h('button', {
            type: 'button', className: 'bm-btn bm-btn-primary',
            disabled: saveDisabled(title, body, images, saving, false),
            onClick: save,
          }, '保存'))))
    }


    /**
     * 详情里是否显示原文。client.js 内嵌同一份文本（测试会核对）。
     * 比较时忽略首尾空白和连续空白的差异。
     */

    function foldSpace(value) {
      return String(value || '').replace(/\s+/g, ' ').trim();
    }

    function shouldShowRaw(body, rawInput) {
      if (!rawInput || rawInput.status === 'legacy') return false;
      const raw = foldSpace(rawInput.text);
      if (raw === '') return false;
      const folded = foldSpace(body);
      if (folded === raw) return false;
      if (folded.includes(raw)) return false;
      return true;
    }
    // 详情内容自包含：不读取灵感台的分栏、tab 或页面滚动。T8 可以把 IdeaDetail 放进 dsh 右侧栏。
    function rememberedDraft(card, rememberDraft) {
      if (!rememberDraft || !card) return null
      const stored = ideaDrafts.get(card.id)
      if (!stored || !editIsDirty(card, stored)) return null
      return stored
    }

    function IdeaDetail({ card, now, onClose, onCard, onTrashed, onDirty, onPreview, onConfirm, onLibrary, onMissing, rememberDraft }) {
      const remembered = rememberedDraft(card, rememberDraft)
      const [extensionText, setExtensionText] = React.useState('')
      const [extensionError, setExtensionError] = React.useState('')
      const [editing, setEditing] = React.useState(!!remembered)
      const [draft, setDraft] = React.useState(remembered)
      const [error, setError] = React.useState('')
      const [conflict, setConflict] = React.useState(false)
      const [saving, setSaving] = React.useState(false)
      const [actionError, setActionError] = React.useState('')
      const extensionRequestId = React.useRef(uuid())
      const savingRef = React.useRef(false)
      const addRef = React.useRef(null)
      const cardRef = React.useRef(card)
      const draftRef = React.useRef(draft)
      const imagesRef = React.useRef([])
      cardRef.current = card
      draftRef.current = draft
      imagesRef.current = draft ? draft.images : []
      const dirty = !!(card && editing && editIsDirty(card, draft))
      const dirtyRef = React.useRef(dirty)
      dirtyRef.current = dirty
      const onDirtyRef = React.useRef(onDirty)
      onDirtyRef.current = onDirty
      React.useEffect(() => { onDirtyRef.current(dirty) }, [dirty])
      React.useEffect(() => {
        if (!rememberDraft || !cardRef.current) return
        if (dirty && draftRef.current) ideaDrafts.set(cardRef.current.id, draftRef.current)
        else ideaDrafts.delete(cardRef.current.id)
      }, [dirty, draft, rememberDraft])
      React.useEffect(() => () => {
        const current = cardRef.current
        if (rememberDraft && current && ideaDrafts.has(current.id)) return
        revokeImages(imagesRef.current)
      }, [rememberDraft])

      function setDraftImages(recipe) {
        setDraft((prev) => {
          if (!prev) return prev
          const next = typeof recipe === 'function' ? recipe(prev.images) : recipe
          return { ...prev, images: next }
        })
      }

      function cancelEdit() {
        if (cardRef.current) ideaDrafts.delete(cardRef.current.id)
        revokeImages(draftRef.current && draftRef.current.images)
        setEditing(false)
        setDraft(null)
        setError('')
        setConflict(false)
      }

      function saveEdit() {
        const current = cardRef.current
        const pending = draftRef.current
        if (!current || !pending || savingRef.current || conflict) return
        if (saveDisabled(pending.title, pending.body, pending.images, false, !editIsDirty(current, pending))) return
        const input = { requestId: pending.requestId, id: current.id, rev: current.rev }
        if (pending.title !== (current.title || '')) input.title = pending.title
        if (pending.body !== (current.body || '')) input.body = pending.body
        if (pending.category !== ((current.fields && current.fields.category) || 'other')) input.fields = { category: pending.category }
        const ids = pending.images.map((image) => image.id)
        if (ids.join('\n') !== (current.attachmentIds || []).join('\n')) input.attachmentIds = ids
        savingRef.current = true
        setSaving(true)
        setError('')
        postCommand('card.update', input).then((record) => {
          ideaDrafts.delete(current.id)
          revokeImages(pending.images)
          savingRef.current = false
          setSaving(false)
          setEditing(false)
          setDraft(null)
          setConflict(false)
          setActionError('')
          onCard(record)
        }).catch((failure) => {
          savingRef.current = false
          setSaving(false)
          if (failure.code === 'version_conflict') {
            setConflict(true)
            setError('')
            return
          }
          setError(String(failure.message || failure))
        })
      }

      function reloadConflict() {
        const id = cardRef.current && cardRef.current.id
        fetch(CARDS_ROUTE).then(readJson).then((body) => {
          const cards = Array.isArray(body.cards) ? body.cards : []
          onLibrary(cards)
          const found = cards.find((item) => item.id === id)
          if (!found) {
            onMissing()
            return
          }
          revokeImages(draftRef.current && draftRef.current.images)
          setEditing(false)
          setDraft(null)
          setConflict(false)
          setError('')
          setSaving(false)
        }).catch((failure) => {
          setError(String(failure.message || failure))
        })
      }

      function toggleStar() {
        const current = cardRef.current
        if (!current) return
        postCommand('card.setStar', {
          requestId: uuid(),
          id: current.id,
          rev: current.rev,
          starred: !current.starred,
        }).then((record) => {
          setActionError('')
          onCard(record)
        }).catch((failure) => setActionError(String(failure.message || failure)))
      }

      function addExtension() {
        const current = cardRef.current
        const text = extensionText.trim()
        if (!current || !text) return
        postCommand('card.addExtension', {
          requestId: extensionRequestId.current,
          id: current.id,
          rev: current.rev,
          body: text,
        }).then((record) => {
          setExtensionText('')
          setExtensionError('')
          extensionRequestId.current = uuid()
          onCard(record)
        }).catch((failure) => setExtensionError(String(failure.message || failure)))
      }

      function deleteExtension(extension) {
        onConfirm('确定删除这条延展？', '删除', () => {
          const current = cardRef.current
          if (!current) return
          postCommand('card.deleteExtension', {
            requestId: uuid(),
            id: current.id,
            rev: current.rev,
            extensionId: extension.id,
          }).then((record) => {
            setExtensionError('')
            onCard(record)
          }).catch((failure) => setExtensionError(String(failure.message || failure)))
        })
      }

      function moveToTrash() {
        const run = () => {
          const current = cardRef.current
          if (!current) return
          postCommand('card.delete', { requestId: uuid(), id: current.id, rev: current.rev }).then(() => {
            onTrashed()
          }).catch((failure) => setActionError(String(failure.message || failure)))
        }
        if (dirtyRef.current) {
          onConfirm('有未保存的修改。确定离开？', '离开', run)
          return
        }
        run()
      }

      if (!card) return h('div', { className: 'bm-detail' })
      const extensions = (card.extensions || []).slice().sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)))
      const pending = draft || { title: '', body: '', category: 'other', images: [] }
      const showRaw = shouldShowRaw(card.body, card.rawInput)
      return h('div', {
        className: 'bm-detail',
        'aria-label': '灵感详情',
        onPaste: (event) => {
          if (!editing) return
          const files = filesFromClipboard(event)
          if (!files.length || !addRef.current) return
          event.preventDefault()
          addRef.current(files)
        },
      },
      h('div', { className: 'bm-detail-bar' },
        h('button', {
          type: 'button',
          className: 'bm-star' + (card.starred ? ' is-on' : ''),
          'aria-label': card.starred ? '取消收藏' : '收藏',
          onClick: toggleStar,
        }, h(StarIcon, { filled: !!card.starred })),
        !editing ? h('button', {
          type: 'button', className: 'bm-btn',
          onClick: () => {
            setEditing(true)
            setDraft(editDraft(card))
            setError('')
            setConflict(false)
          },
        }, '编辑') : null,
        h('button', { type: 'button', className: 'bm-btn', onClick: onClose }, '关闭')),
      h('div', { className: 'bm-detail-body' },
        editing ? h(React.Fragment, null,
          h('label', { className: 'bm-field' }, '标题',
            h('input', {
              value: pending.title,
              placeholder: '一句话概括…',
              onChange: (event) => {
                const value = event.target.value
                setDraft((prev) => prev ? { ...prev, title: value } : prev)
              },
            })),
          h('label', { className: 'bm-field' }, '正文',
            h('textarea', {
              value: pending.body,
              placeholder: '把闪过的念头写下来…',
              onChange: (event) => {
                const value = event.target.value
                setDraft((prev) => prev ? { ...prev, body: value } : prev)
              },
            })),
          h('label', { className: 'bm-field' }, '分类',
            h('select', {
              value: pending.category,
              onChange: (event) => {
                const value = event.target.value
                setDraft((prev) => prev ? { ...prev, category: value } : prev)
              },
            }, CATEGORIES.map((id) => h('option', { key: id, value: id }, CATEGORY[id])))),
          h(AttachmentEditor, { images: pending.images, onChange: setDraftImages, addRef }),
          error ? h('p', { className: 'bm-error' }, error) : null,
          conflict ? h('div', null,
            h('p', { className: 'bm-error' }, '这条灵感已在别处更新'),
            h('button', { type: 'button', className: 'bm-btn', onClick: reloadConflict }, '重新载入')) : null,
          h('div', { className: 'bm-actions' },
            h('button', { type: 'button', className: 'bm-btn', onClick: cancelEdit }, '取消'),
            h('button', {
              type: 'button', className: 'bm-btn bm-btn-primary',
              disabled: saveDisabled(pending.title, pending.body, pending.images, saving, conflict || !editIsDirty(card, draft)),
              onClick: saveEdit,
            }, '保存'))) : h(React.Fragment, null,
          h('h2', { className: 'bm-read-title' }, card.title || '未命名灵感'),
          h('div', null, h('span', { className: 'bm-tag' }, CATEGORY[card.fields && card.fields.category] || '其他')),
          card.body ? h('p', { className: 'bm-read-body' }, card.body) : null,
          (card.attachmentIds || []).length ? h('div', { className: 'bm-images' }, card.attachmentIds.map((id, index) => h('button', {
            type: 'button', key: id, className: 'bm-shot', 'aria-label': '查看大图',
            onClick: () => onPreview(card.attachmentIds, index),
          }, h('img', { src: attachmentUrl(id), alt: '' })))) : null,
          showRaw ? h('div', null,
            h('h3', { className: 'bm-block-title' }, '原文'),
            h('p', { className: 'bm-raw-body' }, String(card.rawInput.text || ''))) : null),
        h('h3', { className: 'bm-block-title' }, '延展'),
        extensions.length ? h('ul', { className: 'bm-ext-list' }, extensions.map((extension) => h('li', { key: extension.id, className: 'bm-ext-item' },
          h('div', { className: 'bm-ext-meta' },
            h('span', null, relativeTime(extension.createdAt, now)),
            h('button', { type: 'button', className: 'bm-btn bm-btn-ghost', onClick: () => deleteExtension(extension) }, '删除')),
          h('p', { className: 'bm-read-body' }, extension.body)))) : h('p', { className: 'bm-meta' }, '还没有延展。'),
        h('div', { className: 'bm-compose' },
          h('textarea', {
            value: extensionText,
            placeholder: '写下理解、续写或补充…',
            onChange: (event) => setExtensionText(event.target.value),
          }),
          extensionError ? h('p', { className: 'bm-error' }, extensionError) : null,
          h('div', { className: 'bm-actions' },
            h('button', {
              type: 'button', className: 'bm-btn bm-btn-primary',
              disabled: extensionText.trim() === '',
              onClick: addExtension,
            }, '追加延展'))),
        actionError ? h('p', { className: 'bm-error' }, actionError) : null),
      h('div', { className: 'bm-detail-foot' },
        h('button', { type: 'button', className: 'bm-btn bm-btn-danger', onClick: moveToTrash }, '移入回收站'),
        h('span')))
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

    function StarIcon({ filled }) {
      return h('svg', { width: 16, height: 16, viewBox: '0 0 24 24', 'aria-hidden': true },
        h('path', {
          d: 'M12 3.2l2.4 5.6 6 .6-4.5 3.9 1.4 5.9L12 16.8 6.7 19.2l1.4-5.9L3.6 9.4l6-.6L12 3.2z',
          fill: filled ? 'currentColor' : 'none',
          stroke: 'currentColor',
          strokeWidth: 1.6,
          strokeLinejoin: 'round',
        }))
    }

    function ChoiceGroup({ label, value, options, onChange }) {
      return h('div', { className: 'bm-filter' },
        h('span', { className: 'bm-filter-label' }, label),
        h('div', { role: 'radiogroup', 'aria-label': label, className: 'bm-choices' },
          options.map((option) => h('button', {
            type: 'button',
            key: option.value,
            role: 'radio',
            'aria-checked': value === option.value ? 'true' : 'false',
            className: 'bm-choice' + (value === option.value ? ' is-on' : ''),
            onClick: () => onChange(option.value),
          }, option.label))))
    }

    function IdeasPage() {
      const rootRef = React.useRef(null)
      const listPaneRef = React.useRef(null)
      const scrollRef = React.useRef(null)
      const listScrollRef = React.useRef(0)
      const orderRef = React.useRef(0)
      const dragRef = React.useRef(null)
      const [narrow, setNarrow] = React.useState(false)
      const [narrowPage, setNarrowPage] = React.useState(false)
      const [appWidth, setAppWidth] = React.useState(1200)
      const [preferredWidth, setPreferredWidth] = React.useState(readInitialWidth)
      const [contentWidth, setContentWidth] = React.useState(640)
      const [section, setSection] = React.useState('list')
      const [libraryTick, setLibraryTick] = React.useState(0)
      const [library, setLibrary] = React.useState({ status: 'loading', cards: [], message: '' })
      const [trash, setTrash] = React.useState({ status: 'idle', cards: [], message: '' })
      const [trashTick, setTrashTick] = React.useState(0)
      const [query, setQuery] = React.useState('')
      const [search, setSearch] = React.useState(null)
      const [scope, setScope] = React.useState('all')
      const [category, setCategory] = React.useState('all')
      const [day, setDay] = React.useState(null)
      const [tabs, setTabs] = React.useState([])
      const [activeId, setActiveId] = React.useState(null)
      const [lightbox, setLightbox] = React.useState(null)
      const [confirm, setConfirm] = React.useState(null)
      const [notice, setNotice] = React.useState('')
      const [now, setNow] = React.useState(() => Date.now())
      const tabsRef = React.useRef(tabs)
      const activeIdRef = React.useRef(activeId)
      const narrowRef = React.useRef(narrow)
      const narrowPageRef = React.useRef(narrowPage)
      const sectionRef = React.useRef(section)
      const appWidthRef = React.useRef(appWidth)
      const actionRef = React.useRef({})
      tabsRef.current = tabs
      activeIdRef.current = activeId
      narrowRef.current = narrow
      narrowPageRef.current = narrowPage
      sectionRef.current = section
      appWidthRef.current = appWidth
      const listWidth = clampListWidth(preferredWidth, appWidth)

      React.useEffect(() => {
        let alive = true
        fetch(CARDS_ROUTE).then(readJson).then((body) => {
          if (!alive) return
          setLibrary({ status: 'ready', cards: Array.isArray(body.cards) ? body.cards : [], message: '' })
        }).catch((error) => {
          if (!alive) return
          setLibrary({ status: 'error', cards: [], message: String(error.message || error) })
        })
        return () => { alive = false }
      }, [libraryTick])

      React.useEffect(() => {
        function onPanelClick(event) {
          const target = event.target
          if (!target || typeof target.closest !== 'function') return
          const button = target.closest('button[aria-label="灵感台"]')
          if (!button || button.getAttribute('aria-current') !== 'page') return
          setLibraryTick((value) => value + 1)
        }
        document.addEventListener('click', onPanelClick)
        return () => document.removeEventListener('click', onPanelClick)
      }, [])

      React.useEffect(() => {
        if (section !== 'trash') return undefined
        let alive = true
        setTrash((prev) => ({ status: 'loading', cards: prev.cards, message: '' }))
        fetch(TRASH_ROUTE).then(readJson).then((body) => {
          if (!alive) return
          setTrash({ status: 'ready', cards: Array.isArray(body.cards) ? body.cards : [], message: '' })
        }).catch((error) => {
          if (!alive) return
          setTrash({ status: 'error', cards: [], message: String(error.message || error) })
        })
        return () => { alive = false }
      }, [section, trashTick])

      React.useEffect(() => {
        const q = query.trim()
        if (!q) { setSearch(null); return undefined }
        let alive = true
        setSearch({ status: 'loading', cards: [], message: '', q })
        const timer = setTimeout(() => {
          fetch(CARDS_ROUTE + '&q=' + encodeURIComponent(q)).then(readJson).then((body) => {
            if (!alive) return
            setSearch({ status: 'ready', cards: Array.isArray(body.cards) ? body.cards : [], message: '', q })
          }).catch((error) => {
            if (!alive) return
            setSearch({ status: 'error', cards: [], message: String(error.message || error), q })
          })
        }, 200)
        return () => { alive = false; clearTimeout(timer) }
      }, [query, libraryTick])

      React.useEffect(() => {
        const timer = setInterval(() => setNow(Date.now()), 60000)
        return () => clearInterval(timer)
      }, [])

      React.useEffect(() => {
        const node = rootRef.current
        if (!node || typeof ResizeObserver === 'undefined') return undefined
        const observer = new ResizeObserver((entries) => {
          const width = entries[0] && entries[0].contentRect.width
          if (!width) return
          setAppWidth(width)
          setNarrow(width <= 820)
        })
        observer.observe(node)
        return () => observer.disconnect()
      }, [])

      React.useEffect(() => {
        const node = scrollRef.current
        if (!node || section === 'list' || typeof ResizeObserver === 'undefined') return undefined
        const observer = new ResizeObserver((entries) => {
          const width = entries[0] && entries[0].contentRect.width
          if (width) setContentWidth(width)
        })
        observer.observe(node)
        return () => observer.disconnect()
      }, [section, narrow])

      React.useEffect(() => {
        const node = listPaneRef.current
        if (!node || section !== 'list' || (narrow && narrowPage)) return undefined
        node.scrollTop = listScrollRef.current
        return undefined
      }, [narrow, narrowPage, section])

      React.useEffect(() => {
        if (!activeId) return undefined
        if (tabs.some((item) => item.id === activeId)) return undefined
        const nextActive = tabs.length ? tabs[tabs.length - 1].id : null
        setActiveId(nextActive)
        if (!nextActive) setNarrowPage(false)
        return undefined
      }, [tabs, activeId])

      React.useEffect(() => {
        function onKey(event) {
          if (event.key !== 'Escape') return
          const actions = actionRef.current
          if (actions.lightbox) { actions.closeLightbox(); return }
          if (actions.confirm) { actions.closeConfirm(); return }
          if (actions.narrow && actions.narrowPage) { actions.requestBack(); return }
          if (actions.activeId) actions.requestClose()
        }
        window.addEventListener('keydown', onKey)
        return () => window.removeEventListener('keydown', onKey)
      }, [])

      function findCard(id) {
        return library.cards.find((item) => item.id === id)
          || (search && search.cards.find((item) => item.id === id))
          || null
      }

      function syncCard(record) {
        setLibrary((prev) => ({
          status: 'ready',
          message: '',
          cards: prev.cards.some((item) => item.id === record.id)
            ? prev.cards.map((item) => item.id === record.id ? record : item)
            : [record].concat(prev.cards),
        }))
        setSearch((prev) => {
          if (!prev) return prev
          return {
            ...prev,
            cards: prev.cards.map((item) => item.id === record.id ? Object.assign({}, item, record) : item),
          }
        })
      }

      function forgetCard(id) {
        setLibrary((prev) => ({ ...prev, cards: prev.cards.filter((item) => item.id !== id) }))
        setSearch((prev) => prev ? { ...prev, cards: prev.cards.filter((item) => item.id !== id) } : prev)
      }

      function setTabDirty(id, dirty) {
        setTabs((prev) => {
          const found = prev.find((item) => item.id === id)
          if (!found || found.dirty === dirty) return prev
          return prev.map((item) => item.id === id ? { ...item, dirty } : item)
        })
      }

      function nextOrder() {
        orderRef.current += 1
        return orderRef.current
      }

      function rememberScroll() {
        const node = listPaneRef.current
        if (node) listScrollRef.current = node.scrollTop
      }

      function forceCloseTab(id) {
        const plan = planCloseTab(tabsRef.current, activeIdRef.current, id)
        setTabs(plan.tabs)
        setActiveId(plan.activeId)
        if (narrowRef.current && id === activeIdRef.current) setNarrowPage(false)
      }

      function discardTab(id) {
        const current = tabsRef.current
        const tab = current.find((item) => item.id === id)
        if (!tab || !tab.dirty) return
        if (tab.kind === 'create') {
          forceCloseTab(id)
          return
        }
        setTabs(current.map((item) => item.id === id ? { ...item, dirty: false, generation: item.generation + 1 } : item))
      }

      function discardAllDirty() {
        const current = tabsRef.current
        let active = activeIdRef.current
        let next = current.filter((item) => !(item.kind === 'create' && item.dirty))
        next = next.map((item) => item.dirty ? { ...item, dirty: false, generation: item.generation + 1 } : item)
        if (!next.some((item) => item.id === active)) active = next.length ? next[next.length - 1].id : null
        setTabs(next)
        setActiveId(active)
      }

      function requestCloseTab(id) {
        const tab = tabsRef.current.find((item) => item.id === id)
        if (!tab) return
        if (!tab.dirty) {
          forceCloseTab(id)
          return
        }
        setConfirm({
          message: '有未保存的修改。确定离开？',
          confirmLabel: '离开',
          action: () => {
            setConfirm(null)
            forceCloseTab(id)
          },
        })
      }

      function requestBack() {
        const tab = tabsRef.current.find((item) => item.id === activeIdRef.current)
        if (tab && tab.dirty) {
          setConfirm({
            message: '有未保存的修改。确定离开？',
            confirmLabel: '离开',
            action: () => {
              setConfirm(null)
              discardTab(tab.id)
              setNarrowPage(false)
            },
          })
          return
        }
        setNarrowPage(false)
      }

      function confirmLeave(action) {
        if (!tabsRef.current.some((item) => item.dirty)) {
          action()
          return
        }
        setConfirm({
          message: '有未保存的修改。确定离开？',
          confirmLabel: '离开',
          action: () => {
            setConfirm(null)
            discardAllDirty()
            action()
          },
        })
      }

      function go(next) {
        if (next === sectionRef.current) return
        confirmLeave(() => {
          setSection(next)
          if (next === 'list' || next === 'stats') setLibraryTick((value) => value + 1)
        })
      }

      function showDetailPage() {
        if (!narrowRef.current) return
        rememberScroll()
        setNarrowPage(true)
      }

      function openSomething(request) {
        const plan = planOpenTab(tabsRef.current, request)
        if (plan.blocked) {
          setNotice(TAB_LIMIT_MESSAGE)
          return false
        }
        setNotice('')
        setTabs(plan.tabs)
        setActiveId(plan.activeId)
        return true
      }

      function openCreate() {
        if (!openSomething({ id: CREATE_TAB_ID, kind: 'create', openedAt: nextOrder() })) return
        showDetailPage()
      }

      function openCard(card) {
        if (!openSomething({ id: card.id, kind: 'detail', openedAt: nextOrder() })) return
        showDetailPage()
      }

      function handleCreated(record) {
        const plan = planReplaceCreate(tabsRef.current, activeIdRef.current, record.id)
        setQuery('')
        setScope('all')
        setCategory('all')
        setDay(null)
        setSearch(null)
        setSection('list')
        syncCard(record)
        setTabs(plan.tabs)
        setActiveId(plan.activeId)
        setNotice('')
      }

      function toggleStar(card) {
        postCommand('card.setStar', {
          requestId: uuid(),
          id: card.id,
          rev: card.rev,
          starred: !card.starred,
        }).then((record) => {
          setNotice('')
          syncCard(record)
        }).catch((error) => setNotice(String(error.message || error)))
      }

      function restoreCard(card) {
        postCommand('card.restore', { requestId: uuid(), id: card.id, rev: card.rev }).then((record) => {
          syncCard(record)
          setTrash((prev) => ({ ...prev, cards: prev.cards.filter((item) => item.id !== card.id) }))
          setNotice('')
        }).catch((error) => setNotice(String(error.message || error)))
      }

      function purgeCard(card) {
        setConfirm({
          message: '彻底删除后无法恢复。确定删除这条灵感？图片和延展会一并移除。',
          confirmLabel: '彻底删除',
          action: () => {
            setConfirm(null)
            postCommand('card.purge', { requestId: uuid(), id: card.id, rev: card.rev }).then(() => {
              setTrash((prev) => ({ ...prev, cards: prev.cards.filter((item) => item.id !== card.id) }))
              forceCloseTab(card.id)
              setNotice('')
            }).catch((error) => setNotice(String(error.message || error)))
          },
        })
      }

      function onSplitterDown(event) {
        if (event.button !== 0) return
        event.preventDefault()
        event.currentTarget.setPointerCapture(event.pointerId)
        dragRef.current = { startX: event.clientX, startW: listWidth, width: listWidth }
      }

      function onSplitterMove(event) {
        if (!dragRef.current) return
        const next = clampListWidth(dragRef.current.startW + (event.clientX - dragRef.current.startX), appWidthRef.current)
        dragRef.current.width = next
        setPreferredWidth(next)
      }

      function onSplitterUp() {
        if (!dragRef.current) return
        const moved = dragRef.current.width !== dragRef.current.startW
        const width = dragRef.current.width
        dragRef.current = null
        if (moved) storeWidth(width)
      }

      function nudgeWidth(delta) {
        const next = clampListWidth(listWidth + delta, appWidthRef.current)
        setPreferredWidth(next)
        storeWidth(next)
      }

      function resetWidth() {
        const next = clampListWidth(LIST_WIDTH_DEFAULT, appWidthRef.current)
        setPreferredWidth(next)
        storeWidth(next)
      }

      actionRef.current = {
        lightbox,
        confirm,
        narrow,
        narrowPage,
        activeId,
        closeLightbox: () => setLightbox(null),
        closeConfirm: () => setConfirm(null),
        requestBack,
        requestClose: () => { if (activeIdRef.current) requestCloseTab(activeIdRef.current) },
      }

      const platform = document.documentElement.dataset.platform || ''
      const searching = query.trim() !== ''
      const source = searching ? search : library
      const sourceCards = source && source.status === 'ready' ? source.cards : []
      const shown = visibleCards(sourceCards, scope, category, day)
      const libraryEmpty = library.status === 'ready' && library.cards.length === 0
      const columns = weekColumns(Math.max(120, contentWidth - 48))
      const summary = summarizeCounts(library.cards, now)

      const listBody = h(React.Fragment, null,
        h('div', { className: 'bm-head' },
          h('h1', { className: 'bm-title' }, '灵感清单'),
          h('button', { type: 'button', className: 'bm-btn bm-btn-primary', onClick: openCreate }, '新增')),
        h('div', { className: 'bm-toolbar' },
          h('div', { className: 'bm-search' },
            h('input', {
              value: query,
              placeholder: '搜索标题、正文、原文或分类',
              'aria-label': '搜索标题、正文、原文或分类',
              onChange: (event) => setQuery(event.target.value),
            }),
            query ? h('button', { type: 'button', className: 'bm-icon-btn', 'aria-label': '清空', onClick: () => setQuery('') }, '×') : null),
          h(ChoiceGroup, {
            label: '范围', value: scope,
            options: [{ value: 'all', label: '全部' }, { value: 'starred', label: '收藏' }],
            onChange: setScope,
          }),
          h(ChoiceGroup, {
            label: '分类', value: category,
            options: [{ value: 'all', label: '全部' }].concat(CATEGORIES.map((id) => ({ value: id, label: CATEGORY[id] }))),
            onChange: setCategory,
          }),
          day ? h('div', null, h('span', { className: 'bm-chip' },
            formatDayLabel(day, now),
            h('button', { type: 'button', className: 'bm-icon-btn', 'aria-label': '清除日期', onClick: () => setDay(null) }, '×'))) : null),
        notice ? h('p', { className: 'bm-error' }, notice) : null,
        !source || source.status === 'loading' ? h('p', { className: 'bm-status' }, '正在读取灵感…') : null,
        source && source.status === 'error' ? h('p', { className: 'bm-error' }, '读取失败：' + source.message) : null,
        source && source.status === 'ready' && shown.length === 0
          ? h('p', { className: 'bm-status' }, libraryEmpty ? '还没有记下灵感。点右上角「新增」，可以只写文字、只贴图，或两者一起记下。' : '没有匹配的灵感。')
          : null,
        shown.length ? h('ul', { className: 'bm-list' }, shown.map((card) => {
          const extensions = card.extensions || []
          const bits = [relativeTime(card.createdAt, now)]
          if (card.updatedAt && card.updatedAt !== card.createdAt) bits.push('已改写')
          if (card.field && MATCH[card.field]) bits.push(MATCH[card.field])
          const thumb = (card.attachmentIds || [])[0]
          const active = activeId === card.id && tabs.some((item) => item.kind === 'detail' && item.id === card.id)
          return h('li', { key: card.id, className: 'bm-row' + (active ? ' is-active' : '') },
            h('button', { type: 'button', className: 'bm-row-main', onClick: () => openCard(card) },
              h('div', { className: 'bm-row-title' },
                h('span', { className: 'bm-name' }, card.title || '未命名灵感'),
                h('span', { className: 'bm-tag' }, CATEGORY[card.fields && card.fields.category] || ''),
                extensions.length ? h('span', { className: 'bm-ext' }, '延展 ' + extensions.length) : null),
              excerptOf(card) ? h('p', { className: 'bm-summary' }, excerptOf(card)) : null,
              h('div', { className: 'bm-meta' }, bits.filter(Boolean).join(' · '))),
            thumb ? h('button', {
              type: 'button', className: 'bm-thumb', 'aria-label': '查看大图',
              onClick: (event) => { event.stopPropagation(); setLightbox({ ids: card.attachmentIds, index: 0 }) },
            }, h('img', { src: attachmentUrl(thumb), alt: '' })) : null,
            h('button', {
              type: 'button',
              className: 'bm-star' + (card.starred ? ' is-on' : ''),
              'aria-label': card.starred ? '取消收藏' : '收藏',
              onClick: (event) => { event.stopPropagation(); toggleStar(card) },
            }, h(StarIcon, { filled: !!card.starred })))
        })) : null)

      const tabStrip = tabs.length ? h('div', { className: 'bm-tabstrip', role: 'tablist', 'aria-label': '已打开的灵感' },
        h('div', { className: 'bm-tabscroll' }, tabs.map((tab) => {
          const label = tab.kind === 'create' ? '新增灵感' : ((findCard(tab.id) || {}).title || '未命名灵感')
          const on = tab.id === activeId
          return h('div', {
            key: tab.id,
            role: 'tab',
            'aria-selected': on ? 'true' : 'false',
            'aria-label': tab.dirty ? label + '，未保存' : label,
            tabIndex: 0,
            title: tab.dirty ? label + '（未保存）' : label,
            className: 'bm-tab' + (on ? ' is-on' : ''),
            onClick: () => setActiveId(tab.id),
            onKeyDown: (event) => {
              if (event.key !== 'Enter' && event.key !== ' ') return
              event.preventDefault()
              setActiveId(tab.id)
            },
          },
          h('span', { className: 'bm-tab-title' },
            tab.dirty ? h('span', { className: 'bm-tab-dot', 'aria-hidden': true }) : null,
            h('span', { className: 'bm-tab-text' }, label)),
          h('button', {
            type: 'button',
            className: 'bm-tab-close',
            'aria-label': '关闭',
            onClick: (event) => {
              event.stopPropagation()
              requestCloseTab(tab.id)
            },
          }, '×'))
        }))) : null

      const panels = tabs.length
        ? h('div', { className: 'bm-tab-panels' }, tabs.map((tab) => h('div', {
          key: tab.id + ':' + tab.generation,
          className: 'bm-tab-panel',
          hidden: tab.id !== activeId,
          role: 'tabpanel',
        }, tab.kind === 'create'
          ? h(IdeaCreate, {
            onClose: () => requestCloseTab(tab.id),
            onCancel: () => forceCloseTab(tab.id),
            onCreated: handleCreated,
            onDirty: (dirty) => setTabDirty(tab.id, dirty),
          })
          : h(IdeaDetail, {
            card: findCard(tab.id),
            now,
            onClose: () => requestCloseTab(tab.id),
            onCard: syncCard,
            onTrashed: () => {
              forgetCard(tab.id)
              setTrashTick((value) => value + 1)
              forceCloseTab(tab.id)
            },
            onDirty: (dirty) => setTabDirty(tab.id, dirty),
            onPreview: (ids, index) => setLightbox({ ids, index }),
            onConfirm: (message, confirmLabel, action) => setConfirm({
              message,
              confirmLabel,
              action: () => { setConfirm(null); action() },
            }),
            onLibrary: (cards) => setLibrary({ status: 'ready', cards, message: '' }),
            onMissing: () => forceCloseTab(tab.id),
          }))))
        : h('div', { className: 'bm-detail-empty' }, '选一条灵感查看')

      let aside = null
      if (section === 'stats') {
        const weeks = library.status === 'ready' && library.cards.length ? heatmapWeeks(library.cards, columns, now) : []
        aside = h('div', { className: 'bm-column' },
          h('div', { className: 'bm-head' },
            h('div', null,
              h('h1', { className: 'bm-title' }, '数据统计'),
              h('p', { className: 'bm-intro' }, '灵感频率按记下日期本地计数，上海时区。'))),
          library.status === 'loading' ? h('p', { className: 'bm-status' }, '正在读取灵感…') : null,
          library.status === 'error' ? h('p', { className: 'bm-error' }, '读取失败：' + library.message) : null,
          library.status === 'ready' ? h('div', { className: 'bm-metrics' },
            [['全部', summary.all], ['本周', summary.week], ['本月', summary.month], ['收藏', summary.starred]].map((item) => h('div', { key: item[0], className: 'bm-metric' },
              h('span', null, item[0]), h('b', null, String(item[1]))))) : null,
          library.status === 'ready' && library.cards.length === 0 ? h('p', { className: 'bm-status' }, '还没有记下灵感，热力图先空着。') : null,
          weeks.length ? h('div', {
            className: 'bm-heat',
            style: { gridTemplateColumns: 'repeat(' + weeks.length + ', minmax(0, 1fr))' },
          }, weeks.flatMap((week) => week.map((cell) => {
            const label = formatDayLabel(cell.key, now) + ' · ' + cell.count + ' 条'
            return h('button', {
              type: 'button',
              key: cell.key,
              className: 'bm-cell',
              disabled: cell.future,
              title: cell.future ? undefined : label,
              'aria-label': cell.future ? undefined : label,
              style: { background: heatBackground(cell.count) },
              onClick: () => {
                if (cell.future) return
                confirmLeave(() => { setDay(cell.key); setQuery(''); setSection('list') })
              },
            })
          }))) : null)
      } else if (section === 'trash') {
        const rows = trash.status === 'ready'
          ? trash.cards.slice().sort((a, b) => String(b.deletedAt || '').localeCompare(String(a.deletedAt || '')))
          : []
        aside = h('div', { className: 'bm-column' },
          h('div', { className: 'bm-head' }, h('h1', { className: 'bm-title' }, '回收站')),
          trash.status === 'loading' ? h('p', { className: 'bm-status' }, '正在读取灵感…') : null,
          trash.status === 'error' ? h('p', { className: 'bm-error' }, '读取失败：' + trash.message) : null,
          trash.status === 'ready' && rows.length === 0 ? h('p', { className: 'bm-status' }, '回收站是空的。') : null,
          rows.length ? h('ul', { className: 'bm-list' }, rows.map((card) => h('li', { key: card.id, className: 'bm-row' },
            h('div', { className: 'bm-row-main', style: { cursor: 'default' } },
              h('div', { className: 'bm-row-title' }, h('span', { className: 'bm-name' }, card.title || '未命名灵感')),
              h('div', { className: 'bm-meta' }, '移入于 ' + relativeTime(card.deletedAt, now))),
            h('button', { type: 'button', className: 'bm-btn', onClick: () => restoreCard(card) }, '恢复'),
            h('button', { type: 'button', className: 'bm-btn bm-btn-danger', onClick: () => purgeCard(card) }, '彻底删除')))) : null)
      }

      const lightIds = lightbox ? lightbox.ids || [] : []
      const lightIndex = lightbox ? Math.min(lightbox.index, Math.max(lightIds.length - 1, 0)) : 0
      const maxWidth = Math.max(LIST_WIDTH_MIN, Math.floor(appWidth * LIST_WIDTH_RATIO))

      return h('div', {
        ref: rootRef,
        className: 'bm-app',
        'data-bluemanta-panel': PANEL_ID,
        'data-narrow': narrow ? 'true' : 'false',
        'data-page': narrow && narrowPage ? 'detail' : 'list',
        'data-platform': platform,
      },
      h('style', null, CSS),
      h('nav', { className: 'bm-nav', 'aria-label': '灵感台' },
        NAV.map((item) => h('button', {
          type: 'button',
          key: item.id,
          className: 'bm-nav-btn' + (section === item.id ? ' is-on' : ''),
          'aria-current': section === item.id ? 'page' : undefined,
          onClick: () => go(item.id),
        }, item.label))),
      h('div', { className: 'bm-stage', hidden: section !== 'list' },
        h('div', { className: 'bm-split' },
          h('div', {
            className: 'bm-list-pane',
            ref: listPaneRef,
            style: narrow ? undefined : { width: listWidth },
            onScroll: (event) => {
              const node = event.currentTarget
              if (!node.offsetParent) return
              listScrollRef.current = node.scrollTop
            },
          }, listBody),
          h('div', {
            className: 'bm-splitter',
            role: 'separator',
            tabIndex: 0,
            'aria-orientation': 'vertical',
            'aria-label': '调整列表宽度',
            'aria-valuemin': LIST_WIDTH_MIN,
            'aria-valuemax': maxWidth,
            'aria-valuenow': listWidth,
            onPointerDown: onSplitterDown,
            onPointerMove: onSplitterMove,
            onPointerUp: onSplitterUp,
            onDoubleClick: resetWidth,
            onKeyDown: (event) => {
              if (event.key === 'ArrowLeft') { event.preventDefault(); nudgeWidth(-10) }
              if (event.key === 'ArrowRight') { event.preventDefault(); nudgeWidth(10) }
            },
          }),
          h('div', { className: 'bm-detail-pane' },
            h('button', { type: 'button', className: 'bm-back', onClick: requestBack }, '← 返回'),
            tabStrip,
            panels))),
      section !== 'list' ? h('div', { className: 'bm-stage bm-scroll', ref: scrollRef }, aside) : null,
      confirm ? h('div', { className: 'bm-dialog-mask' },
        h('div', { className: 'bm-dialog', role: 'alertdialog', 'aria-modal': 'true' },
          h('p', null, confirm.message),
          h('div', { className: 'bm-actions', style: { marginTop: 16 } },
            h('button', { type: 'button', className: 'bm-btn', onClick: () => setConfirm(null) }, '取消'),
            h('button', { type: 'button', className: 'bm-btn bm-btn-primary', onClick: confirm.action }, confirm.confirmLabel || '确定')))) : null,
      lightbox && lightIds[lightIndex] ? h('div', { className: 'bm-light', onClick: () => setLightbox(null) },
        h('img', {
          src: attachmentUrl(lightIds[lightIndex]), alt: '大图',
          onClick: (event) => event.stopPropagation(),
        }),
        lightIds.length > 1 ? h('div', { className: 'bm-light-nav' },
          h('button', {
            type: 'button', className: 'bm-btn',
            onClick: (event) => { event.stopPropagation(); setLightbox({ ids: lightIds, index: (lightIndex + lightIds.length - 1) % lightIds.length }) },
          }, '上一张'),
          h('button', {
            type: 'button', className: 'bm-btn',
            onClick: (event) => { event.stopPropagation(); setLightbox({ ids: lightIds, index: (lightIndex + 1) % lightIds.length }) },
          }, '下一张')) : null) : null)
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

    function OpenIdeaButton({ id, title }) {
      const open = useSidebarOpen()
      if (!open || !id) return null
      return h('button', {
        type: 'button',
        className: 'bm-btn',
        onClick: () => { openTrackedIdea(shell.sidebarRight, { id, title }) },
      }, '打开')
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
      if (model.kind === 'pending') {
        body = h('p', { className: 'bm-tool-meta' }, model.label)
      } else if (model.kind === 'error') {
        body = h('p', { className: 'bm-tool-meta' }, model.message)
      } else if (model.kind === 'capture') {
        body = h('div', { className: 'bm-tool-line' },
          h('div', { className: 'bm-tool-title' }, '已记录灵感：' + model.title + ' · ' + model.category),
          h(OpenIdeaButton, { id: model.id, title: model.title }))
      } else if (model.kind === 'search') {
        body = model.empty
          ? h('p', { className: 'bm-tool-meta' }, '没有找到')
          : h('ul', { className: 'bm-tool-list' }, model.items.map((item) => h('li', { key: item.id, className: 'bm-tool-line' },
            h('div', { className: 'bm-tool-main' },
              h('div', { className: 'bm-tool-title' }, item.title || '未命名灵感'),
              h('div', { className: 'bm-tool-meta' }, [item.category, item.date].filter(Boolean).join(' · '))),
            h(OpenIdeaButton, { id: item.id, title: item.title }))))
      } else if (model.kind === 'get') {
        body = h('div', { className: 'bm-tool-line' },
          h('div', { className: 'bm-tool-main' },
            h('div', { className: 'bm-tool-title' }, model.title),
            model.excerpt ? h('p', { className: 'bm-summary' }, model.excerpt) : null),
          h(OpenIdeaButton, { id: model.id, title: model.title }))
      }
      return h('div', { className: 'bm-tool', 'data-bluemanta-tool': toolName },
        h('style', null, CSS),
        body)
    }

    function IdeaTabTitle(props) {
      const info = props.useTabInfo()
      const params = ideaParams(info && info.tab && info.tab.navigation)
      const [, bump] = React.useState(0)
      React.useEffect(() => titleBus.subscribe(() => bump((value) => value + 1)), [])
      if (!params.id) return '灵感台'
      return titleBus.get(params.id) || params.title || '灵感'
    }

    function openRailIdea(actions, card) {
      if (!card || !card.id) return
      const sidebarRight = shell.sidebarRight
      const sessionId = sessionIdOf(sidebarRight)
      const known = sessionId ? (railIndex.ideas.get(railIdeaKey(sessionId, card.id)) || '') : ''
      const plan = sessionId ? planRailOpen(known, snapshotTabs(sidebarRight), sessionId) : { action: 'open' }
      if (plan.action === 'focus') {
        focusRailTab(sidebarRight, plan.tabId)
        return
      }
      if (!actions || typeof actions.openTab !== 'function') return
      const title = card.title || '未命名灵感'
      try {
        actions.openTab(IDEA_TAB_KIND, { params: { id: card.id, title } })
      } catch {
        // 当前对话没有右侧栏时，打开失败也不抛到页面。
      }
    }

    function IdeaRailList({ actions }) {
      const [query, setQuery] = React.useState('')
      const [library, setLibrary] = React.useState({ status: 'loading', cards: [], message: '' })
      const [search, setSearch] = React.useState(null)
      const [now, setNow] = React.useState(() => Date.now())

      React.useEffect(() => {
        let alive = true
        fetch(CARDS_ROUTE).then(readJson).then((body) => {
          if (!alive) return
          setLibrary({ status: 'ready', cards: Array.isArray(body.cards) ? body.cards : [], message: '' })
        }).catch((error) => {
          if (!alive) return
          setLibrary({ status: 'error', cards: [], message: String(error.message || error) })
        })
        return () => { alive = false }
      }, [])

      React.useEffect(() => {
        const q = query.trim()
        if (!q) { setSearch(null); return undefined }
        let alive = true
        setSearch({ status: 'loading', cards: [], message: '' })
        const timer = setTimeout(() => {
          fetch(CARDS_ROUTE + '&q=' + encodeURIComponent(q)).then(readJson).then((body) => {
            if (!alive) return
            setSearch({ status: 'ready', cards: Array.isArray(body.cards) ? body.cards : [], message: '' })
          }).catch((error) => {
            if (!alive) return
            setSearch({ status: 'error', cards: [], message: String(error.message || error) })
          })
        }, 200)
        return () => { alive = false; clearTimeout(timer) }
      }, [query])

      React.useEffect(() => {
        const timer = setInterval(() => setNow(Date.now()), 60000)
        return () => clearInterval(timer)
      }, [])

      const searching = query.trim() !== ''
      const source = searching ? search : library
      const cards = source && source.status === 'ready' ? source.cards.slice().sort(byCreatedDesc) : []
      return h('div', { className: 'bm-list-pane' },
        h('div', { className: 'bm-head' },
          h('h1', { className: 'bm-title' }, '灵感台')),
        h('div', { className: 'bm-toolbar' },
          h('div', { className: 'bm-search' },
            h('input', {
              value: query,
              placeholder: '搜索标题、正文、原文或分类',
              'aria-label': '搜索标题、正文、原文或分类',
              onChange: (event) => setQuery(event.target.value),
            }),
            query ? h('button', { type: 'button', className: 'bm-icon-btn', 'aria-label': '清空', onClick: () => setQuery('') }, '×') : null)),
        !source || source.status === 'loading' ? h('p', { className: 'bm-status' }, '正在读取灵感…') : null,
        source && source.status === 'error' ? h('p', { className: 'bm-error' }, '读取失败：' + source.message) : null,
        source && source.status === 'ready' && cards.length === 0
          ? h('p', { className: 'bm-status' }, searching || library.cards.length ? '没有匹配的灵感。' : '还没有记下灵感。')
          : null,
        cards.length ? h('ul', { className: 'bm-list' }, cards.map((card) => h('li', { key: card.id, className: 'bm-row' },
          h('button', { type: 'button', className: 'bm-row-main', onClick: () => openRailIdea(actions, card) },
            h('div', { className: 'bm-row-title' },
              h('span', { className: 'bm-name' }, card.title || '未命名灵感'),
              h('span', { className: 'bm-tag' }, CATEGORY[card.fields && card.fields.category] || '')),
            h('div', { className: 'bm-meta' }, relativeTime(card.createdAt, now)))))) : null)
    }

    function IdeaRailDetail({ id, actions, revision, tabId }) {
      const [state, setState] = React.useState({ status: 'loading', card: null, message: '' })
      const [now, setNow] = React.useState(() => Date.now())
      const [confirm, setConfirm] = React.useState(null)
      const [lightbox, setLightbox] = React.useState(null)
      const [dirty, setDirty] = React.useState(false)
      const dirtyRef = React.useRef(false)
      dirtyRef.current = dirty
      const cardIdRef = React.useRef(id)
      cardIdRef.current = state.card ? state.card.id : id

      React.useEffect(() => {
        let alive = true
        setState((prev) => ({ status: 'loading', card: prev.card && prev.card.id === id ? prev.card : null, message: '' }))
        fetch(CARDS_ROUTE).then(readJson).then((body) => {
          const cards = Array.isArray(body.cards) ? body.cards : []
          const found = cards.find((item) => item.id === id)
          if (found) return found
          return fetch(TRASH_ROUTE).then(readJson).then((trash) => {
            const rows = Array.isArray(trash.cards) ? trash.cards : []
            return rows.find((item) => item.id === id) || null
          })
        }).then((card) => {
          if (!alive) return
          if (!card) {
            setState({ status: 'missing', card: null, message: '没有找到这条灵感' })
            return
          }
          titleBus.set(card.id, card.title || '未命名灵感')
          setState({ status: 'ready', card, message: '' })
        }).catch((error) => {
          if (!alive) return
          setState({ status: 'error', card: null, message: String(error.message || error) })
        })
        return () => { alive = false }
      }, [id, revision])

      React.useEffect(() => {
        const timer = setInterval(() => setNow(Date.now()), 60000)
        return () => clearInterval(timer)
      }, [])

      function closeTab() {
        if (actions && typeof actions.close === 'function') {
          try { actions.close() } catch { /* 标签已经关掉时不再抛出 */ }
        }
      }

      function discardAndClose() {
        const cardId = cardIdRef.current
        if (cardId) ideaDrafts.delete(cardId)
        dirtyRef.current = false
        setDirty(false)
        railClose.permit(tabId)
        closeTab()
      }

      function askLeave(after) {
        setConfirm({
          message: '有未保存的修改。确定离开？',
          confirmLabel: '离开',
          action: () => {
            setConfirm(null)
            if (after) after()
            else discardAndClose()
          },
        })
      }

      function requestClose() {
        if (!dirtyRef.current) {
          railClose.permit(tabId)
          closeTab()
          return
        }
        askLeave()
      }

      React.useEffect(() => {
        function onAsk(asked) {
          if (asked !== tabId) return
          railClose.pending.delete(tabId)
          askLeave()
        }
        railClose.listeners.add(onAsk)
        if (railClose.pending.has(tabId)) onAsk(tabId)
        return () => { railClose.listeners.delete(onAsk) }
      }, [tabId])

      const lightIds = lightbox ? lightbox.ids || [] : []
      const lightIndex = lightbox ? Math.min(lightbox.index, Math.max(lightIds.length - 1, 0)) : 0
      let content = null
      if (state.status === 'loading' && !state.card) content = h('p', { className: 'bm-status' }, '正在读取灵感…')
      else if (state.status === 'error') content = h('p', { className: 'bm-error' }, '读取失败：' + state.message)
      else if (state.status === 'missing' || !state.card) content = h('p', { className: 'bm-status' }, state.message || '没有找到这条灵感')
      else content = h(IdeaDetail, {
        card: state.card,
        now,
        rememberDraft: true,
        onClose: requestClose,
        onCard: (record) => {
          titleBus.set(record.id, record.title || '未命名灵感')
          setState({ status: 'ready', card: record, message: '' })
        },
        onTrashed: () => { discardAndClose() },
        onDirty: (value) => {
          setDirty(value)
          railClose.mark(tabId, value)
        },
        onPreview: (ids, index) => setLightbox({ ids, index }),
        onConfirm: (message, confirmLabel, action) => setConfirm({
          message,
          confirmLabel,
          action: () => { setConfirm(null); action() },
        }),
        onLibrary: (cards) => {
          const found = cards.find((item) => item.id === id)
          if (!found) return
          titleBus.set(found.id, found.title || '未命名灵感')
          setState({ status: 'ready', card: found, message: '' })
        },
        onMissing: () => {
          dirtyRef.current = false
          railClose.permit(tabId)
          closeTab()
        },
      })

      return h(React.Fragment, null,
        content,
        confirm ? h('div', { className: 'bm-dialog-mask' },
          h('div', { className: 'bm-dialog', role: 'alertdialog', 'aria-modal': 'true' },
            h('p', null, confirm.message),
            h('div', { className: 'bm-actions', style: { marginTop: 16 } },
              h('button', { type: 'button', className: 'bm-btn', onClick: () => setConfirm(null) }, '取消'),
              h('button', { type: 'button', className: 'bm-btn bm-btn-primary', onClick: confirm.action }, confirm.confirmLabel || '确定')))) : null,
        lightbox && lightIds[lightIndex] ? h('div', { className: 'bm-light', onClick: () => setLightbox(null) },
          h('img', {
            src: attachmentUrl(lightIds[lightIndex]), alt: '大图',
            onClick: (event) => event.stopPropagation(),
          }),
          lightIds.length > 1 ? h('div', { className: 'bm-light-nav' },
            h('button', {
              type: 'button', className: 'bm-btn',
              onClick: (event) => { event.stopPropagation(); setLightbox({ ids: lightIds, index: (lightIndex + lightIds.length - 1) % lightIds.length }) },
            }, '上一张'),
            h('button', {
              type: 'button', className: 'bm-btn',
              onClick: (event) => { event.stopPropagation(); setLightbox({ ids: lightIds, index: (lightIndex + 1) % lightIds.length }) },
            }, '下一张')) : null) : null)
    }

    function IdeaSidebarTab(props) {
      const info = props.useTabInfo()
      const navigation = info && info.tab ? info.tab.navigation : null
      const params = ideaParams(navigation)
      const actions = info && info.tab ? info.tab.actions : null
      const tabId = info && info.tab ? info.tab.id : ''
      const revision = navigation && navigation.revision
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
            // 重复标签关不掉时留在原地，避免把已有的那个也关掉。
          }
          focusRailTab(shell.sidebarRight, plan.tabId)
          return undefined
        }
        if (params.id) railIndex.ideas.set(railIdeaKey(sessionId, params.id), tabId)
        else railIndex.lists.set(sessionId, tabId)
        return undefined
      }, [tabId, params.id])
      return h('div', { className: 'bm-app bm-side', 'data-bluemanta-sidebar': 'idea' },
        h('style', null, CSS),
        params.id
          ? h(IdeaRailDetail, { key: params.id, id: params.id, actions, revision, tabId })
          : h(IdeaRailList, { actions }))
    }

    function registerIdeaSidebar(ctx) {
      // 工具卡片的「打开」只在 ctx.sidebarRight.mounted 有会话时调用 openTab。
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
          description: () => '搜索并打开一条灵感',
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

    return {
      inject: ['slots', 'sidebarRightTabs', 'sidebarRight'],
      apply(ctx) {
        ctx.slots.inject('main', () => ctx.slots.register({ name: 'main', key: PANEL_ID }, IdeasPage))
        ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
          name: 'sidebar.panellist', id: PANEL_ID, order: 10, label: '灵感台',
        }, IdeasIcon))
        registerIdeaSidebar(ctx)
      },
    }
  },
})
