/**
 * 浏览器端：左侧栏「灵感台」，以及主区里的清单、统计和回收站。
 * 输出格式与 spikes/s1-panel/plugin/client.js 相同。React 来自 dsh 的浏览器模块表。
 * 请求用相对路径、开头不带 /，以兼容 Desktop 的 dsh-app:// 挂载。
 * 上海时区的日期函数与 src/shanghai.js 保持同一份文本（测试会核对）。
 */
window.__ModuleLoader__.load({
  id: '@bluemanta/dsh-plugin',
  factory(require) {
    const React = require('react')
    const h = React.createElement
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
  position: relative; display: flex; height: 100%; min-height: 0;
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
.bm-main { position: relative; flex: 1; min-width: 0; overflow: auto; padding: 0 clamp(24px, 4vw, 48px) 48px; }
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
.bm-cell:focus-visible, .bm-choice:focus-visible, .bm-btn:focus-visible, .bm-row-main:focus-visible {
  outline: var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary));
  outline-offset: 1px;
}
.bm-mask { position: absolute; inset: 0; z-index: 2; border: 0; padding: 0;
  background: color-mix(in srgb, var(--dsw-alias-label-primary) 28%, transparent); cursor: pointer; }
.bm-drawer {
  position: absolute; top: 0; right: 0; bottom: 0; z-index: 3; width: min(440px, 100%);
  display: flex; flex-direction: column; background: var(--dsw-alias-bg-layer-1);
  border-left: 0.5px solid var(--dsw-alias-border-l3); box-shadow: var(--dsw-shadow-l2, 0 0 0 transparent);
}
.bm-drawer-bar, .bm-drawer-foot { display: flex; align-items: center; gap: 8px; padding: 12px 16px; }
.bm-drawer-bar { justify-content: flex-end; }
.bm-drawer-foot { justify-content: space-between; border-top: 0.5px solid var(--dsw-alias-border-l3); }
.bm-drawer-body { flex: 1; overflow: auto; padding: 0 16px 24px; display: flex; flex-direction: column; gap: 14px; }
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
.bm-light img { width: auto; height: auto; max-width: min(920px, 100%); max-height: 86vh; object-fit: contain; background: var(--dsw-alias-bg-layer-1); }
.bm-light-nav { position: absolute; bottom: 20px; display: flex; gap: 8px; }
.bm-sr { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0, 0, 0, 0); border: 0; }
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

    function detailState(card) {
      return {
        kind: 'detail',
        session: uuid(),
        card,
        rawOpen: false,
        extensionText: '',
        extensionError: '',
        extensionRequestId: uuid(),
        editing: false,
        draft: null,
        error: '',
        conflict: false,
        saving: false,
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

    function drawerImages(state) {
      if (!state) return []
      if (state.kind === 'create') return state.images
      if (state.draft) return state.draft.images
      return []
    }

    function isDirty(state) {
      if (!state) return false
      if (state.kind === 'create') {
        return state.title.trim() !== '' || state.body.trim() !== '' || state.images.length > 0
      }
      if (state.kind === 'detail' && state.editing && state.draft) {
        const card = state.card
        const draft = state.draft
        if (draft.title !== (card.title || '')) return true
        if (draft.body !== (card.body || '')) return true
        if (draft.category !== ((card.fields && card.fields.category) || 'other')) return true
        const current = (card.attachmentIds || []).join('\n')
        const next = draft.images.map((image) => image.id || '').join('\n')
        if (current !== next) return true
        if (draft.images.some((image) => image.status !== 'ready')) return true
      }
      return false
    }

    function IdeasIcon({ size }) {
      return h('svg', {
        width: size, height: size, viewBox: '0 0 24 24', fill: 'none',
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
      const fileRef = React.useRef(null)
      const [narrow, setNarrow] = React.useState(false)
      const [contentWidth, setContentWidth] = React.useState(640)
      const [section, setSection] = React.useState('list')
      const [library, setLibrary] = React.useState({ status: 'loading', cards: [], message: '' })
      const [trash, setTrash] = React.useState({ status: 'idle', cards: [], message: '' })
      const [trashTick, setTrashTick] = React.useState(0)
      const [query, setQuery] = React.useState('')
      const [search, setSearch] = React.useState(null)
      const [scope, setScope] = React.useState('all')
      const [category, setCategory] = React.useState('all')
      const [day, setDay] = React.useState(null)
      const [drawer, setDrawer] = React.useState(null)
      const [lightbox, setLightbox] = React.useState(null)
      const [confirm, setConfirm] = React.useState(null)
      const [notice, setNotice] = React.useState('')
      const [now, setNow] = React.useState(() => Date.now())
      const [dragOver, setDragOver] = React.useState(false)
      const drawerRef = React.useRef(drawer)
      drawerRef.current = drawer

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
      }, [query])

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
          setNarrow(width <= 820)
        })
        observer.observe(node)
        return () => observer.disconnect()
      }, [])

      React.useEffect(() => {
        const node = rootRef.current && rootRef.current.querySelector('.bm-main')
        if (!node || typeof ResizeObserver === 'undefined') return undefined
        const observer = new ResizeObserver((entries) => {
          const width = entries[0] && entries[0].contentRect.width
          if (width) setContentWidth(width)
        })
        observer.observe(node)
        return () => observer.disconnect()
      }, [section, narrow])

      function syncCard(record, extra) {
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
        setDrawer((prev) => {
          if (!prev || prev.kind !== 'detail' || prev.card.id !== record.id) return prev
          return Object.assign({}, prev, { card: record }, extra || {})
        })
      }

      function forgetCard(id) {
        setLibrary((prev) => ({ ...prev, cards: prev.cards.filter((item) => item.id !== id) }))
        setSearch((prev) => prev ? { ...prev, cards: prev.cards.filter((item) => item.id !== id) } : prev)
      }

      function updateImages(session, recipe) {
        setDrawer((prev) => {
          if (!prev || prev.session !== session) return prev
          if (prev.kind === 'create') return { ...prev, images: recipe(prev.images) }
          if (prev.draft) return { ...prev, draft: { ...prev.draft, images: recipe(prev.draft.images) } }
          return prev
        })
      }

      function beginUpload(session, image) {
        updateImages(session, (images) => patchImage(images, image.key, { status: 'uploading', progress: 0, message: '' }))
        uploadImage(image.file, image.requestId, (progress) => {
          updateImages(session, (images) => patchImage(images, image.key, { progress }))
        }).then((record) => {
          updateImages(session, (images) => patchImage(images, image.key, {
            status: 'ready', id: record.id, progress: 1, message: '',
          }))
        }).catch((error) => {
          updateImages(session, (images) => patchImage(images, image.key, {
            status: 'error', message: String(error.message || error),
          }))
        })
      }

      function addFiles(fileList) {
        const state = drawerRef.current
        if (!state || (state.kind === 'detail' && !state.editing)) return
        const current = drawerImages(state)
        const room = 4 - current.length
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
        updateImages(state.session, (images) => images.concat(created).slice(0, 4))
        for (const image of created) beginUpload(state.session, image)
      }

      function removeImage(image) {
        const state = drawerRef.current
        if (!state) return
        if (typeof image.preview === 'string' && image.preview.indexOf('blob:') === 0) URL.revokeObjectURL(image.preview)
        updateImages(state.session, (images) => images.filter((item) => item.key !== image.key))
      }

      function closeDrawer() {
        const state = drawerRef.current
        revokeImages(drawerImages(state))
        setDrawer(null)
        setDragOver(false)
      }

      function requestClose() {
        if (!isDirty(drawerRef.current)) {
          setDrawer(null)
          return
        }
        setConfirm({
          message: '有未保存的修改。确定离开？',
          confirmLabel: '离开',
          action: () => {
            setConfirm(null)
            closeDrawer()
          },
        })
      }

      function leave(action) {
        if (!isDirty(drawerRef.current)) {
          setDrawer(null)
          action()
          return
        }
        setConfirm({
          message: '有未保存的修改。确定离开？',
          confirmLabel: '离开',
          action: () => {
            setConfirm(null)
            closeDrawer()
            action()
          },
        })
      }

      function go(next) {
        if (next === section) return
        leave(() => setSection(next))
      }

      function openCreate() {
        leave(() => {
          setSection('list')
          setDrawer({
            kind: 'create',
            session: uuid(),
            title: '',
            body: '',
            images: [],
            error: '',
            saving: false,
            requestId: uuid(),
          })
        })
      }

      function openCard(card) {
        leave(() => setDrawer(detailState(card)))
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

      function saveCreate() {
        const state = drawerRef.current
        if (!state || state.kind !== 'create' || state.saving) return
        const ids = state.images.filter((image) => image.status === 'ready' && image.id).map((image) => image.id)
        const input = { requestId: state.requestId, cardType: 'idea' }
        if (state.title.trim()) input.title = state.title.trim()
        if (state.body.trim()) input.body = state.body
        if (ids.length) input.attachmentIds = ids
        setDrawer({ ...state, saving: true, error: '' })
        postCommand('card.create', input).then((record) => {
          revokeImages(state.images)
          setQuery('')
          setScope('all')
          setCategory('all')
          setDay(null)
          setSearch(null)
          setSection('list')
          setDrawer(null)
          setNotice('')
          syncCard(record)
        }).catch((error) => {
          setDrawer((prev) => prev && prev.session === state.session ? { ...prev, saving: false, error: String(error.message || error) } : prev)
        })
      }

      function saveEdit() {
        const state = drawerRef.current
        if (!state || state.kind !== 'detail' || !state.draft || state.saving || state.conflict) return
        const draft = state.draft
        const card = state.card
        const input = { requestId: draft.requestId, id: card.id, rev: card.rev }
        if (draft.title !== (card.title || '')) input.title = draft.title
        if (draft.body !== (card.body || '')) input.body = draft.body
        if (draft.category !== ((card.fields && card.fields.category) || 'other')) input.fields = { category: draft.category }
        const ids = draft.images.map((image) => image.id)
        if (ids.join('\n') !== (card.attachmentIds || []).join('\n')) input.attachmentIds = ids
        setDrawer({ ...state, saving: true, error: '' })
        postCommand('card.update', input).then((record) => {
          revokeImages(draft.images)
          setNotice('')
          setDrawer(detailState(record))
          syncCard(record)
        }).catch((error) => {
          setDrawer((prev) => {
            if (!prev || prev.session !== state.session) return prev
            if (error.code === 'version_conflict') return { ...prev, saving: false, conflict: true, error: '' }
            return { ...prev, saving: false, error: String(error.message || error) }
          })
        })
      }

      function reloadConflict() {
        const state = drawerRef.current
        if (!state || state.kind !== 'detail') return
        fetch(CARDS_ROUTE).then(readJson).then((body) => {
          const cards = Array.isArray(body.cards) ? body.cards : []
          setLibrary({ status: 'ready', cards, message: '' })
          const found = cards.find((item) => item.id === state.card.id)
          if (!found) {
            setDrawer((prev) => prev && prev.session === state.session ? { ...prev, conflict: false, error: '这条灵感已不在清单中' } : prev)
            return
          }
          revokeImages(drawerImages(state))
          setDrawer(detailState(found))
        }).catch((error) => {
          setDrawer((prev) => prev && prev.session === state.session ? { ...prev, error: String(error.message || error) } : prev)
        })
      }

      function addExtension() {
        const state = drawerRef.current
        if (!state || state.kind !== 'detail') return
        const text = state.extensionText.trim()
        if (!text) return
        postCommand('card.addExtension', {
          requestId: state.extensionRequestId,
          id: state.card.id,
          rev: state.card.rev,
          body: text,
        }).then((record) => {
          setNotice('')
          syncCard(record, { extensionText: '', extensionError: '', extensionRequestId: uuid() })
        }).catch((error) => {
          setDrawer((prev) => prev && prev.session === state.session ? { ...prev, extensionError: String(error.message || error) } : prev)
        })
      }

      function deleteExtension(extension) {
        const state = drawerRef.current
        if (!state || state.kind !== 'detail') return
        setConfirm({
          message: '确定删除这条延展？',
          confirmLabel: '删除',
          action: () => {
            setConfirm(null)
            postCommand('card.deleteExtension', {
              requestId: uuid(),
              id: state.card.id,
              rev: state.card.rev,
              extensionId: extension.id,
            }).then((record) => syncCard(record, { extensionError: '' })).catch((error) => {
              setDrawer((prev) => prev && prev.kind === 'detail' ? { ...prev, extensionError: String(error.message || error) } : prev)
            })
          },
        })
      }

      function moveToTrash(card) {
        postCommand('card.delete', { requestId: uuid(), id: card.id, rev: card.rev }).then(() => {
          forgetCard(card.id)
          setTrashTick((value) => value + 1)
          setDrawer(null)
          setNotice('')
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
              setNotice('')
            }).catch((error) => setNotice(String(error.message || error)))
          },
        })
      }

      React.useEffect(() => {
        function onKey(event) {
          if (event.key !== 'Escape') return
          if (lightbox) { setLightbox(null); return }
          if (confirm) { setConfirm(null); return }
          if (drawerRef.current) requestClose()
        }
        window.addEventListener('keydown', onKey)
        return () => window.removeEventListener('keydown', onKey)
      }, [lightbox, confirm])

      const platform = document.documentElement.dataset.platform || ''
      const searching = query.trim() !== ''
      const source = searching ? search : library
      const sourceCards = source && source.status === 'ready' ? source.cards : []
      const shown = visibleCards(sourceCards, scope, category, day)
      const libraryEmpty = library.status === 'ready' && library.cards.length === 0
      const columns = weekColumns(Math.max(120, contentWidth - 48))
      const summary = summarizeCounts(library.cards, now)

      function renderImages(images, editable) {
        return h('div', {
          className: 'bm-drop' + (dragOver ? ' is-over' : ''),
          onDragOver: (event) => { event.preventDefault(); setDragOver(true) },
          onDragLeave: () => setDragOver(false),
          onDrop: (event) => {
            event.preventDefault()
            setDragOver(false)
            if (editable) addFiles(event.dataTransfer.files)
          },
        },
        h('div', { className: 'bm-images' },
          images.map((image) => h('div', { key: image.key, className: 'bm-shot' },
            h('img', { src: image.preview, alt: '' }),
            image.status === 'uploading' ? h('div', { className: 'bm-progress' }, h('span', { style: { width: Math.round((image.progress || 0) * 100) + '%' } })) : null,
            editable ? h('button', { type: 'button', 'aria-label': '移除图片', onClick: () => removeImage(image) }, '×') : null,
            image.status === 'error' ? h('button', {
              type: 'button', className: 'bm-btn', style: { position: 'absolute', left: 4, bottom: 4, height: 22, padding: '0 6px' },
              onClick: () => beginUpload(drawer.session, image),
            }, '重试') : null)),
          editable && images.length < 4 ? h('button', {
            type: 'button', className: 'bm-btn', onClick: () => { if (fileRef.current) fileRef.current.click() },
          }, '添加图片') : null),
        editable ? h('p', { className: 'bm-meta' }, images.some((image) => image.message) ? images.map((image) => image.message).filter(Boolean).join(' ') : '最多 4 张，可以点选、拖入或粘贴。') : null)
      }

      function renderEditor(state) {
        const draft = state.kind === 'create' ? state : state.draft
        const images = state.kind === 'create' ? state.images : draft.images
        const blocked = images.some((image) => image.status !== 'ready')
        const readyCount = images.filter((image) => image.status === 'ready' && image.id).length
        const hasContent = (draft.title || '').trim() !== '' || (draft.body || '').trim() !== '' || readyCount > 0
        const canSave = state.kind === 'create'
          ? hasContent && !blocked && !state.saving
          : isDirty(state) && hasContent && !blocked && !state.saving && !state.conflict
        return h(React.Fragment, null,
          h('label', { className: 'bm-field' }, '标题',
            h('input', {
              value: draft.title,
              placeholder: '一句话概括…',
              onChange: (event) => {
                const value = event.target.value
                setDrawer((prev) => {
                  if (!prev || prev.session !== state.session) return prev
                  if (prev.kind === 'create') return { ...prev, title: value }
                  return { ...prev, draft: { ...prev.draft, title: value } }
                })
              },
            })),
          h('label', { className: 'bm-field' }, '正文',
            h('textarea', {
              value: draft.body,
              placeholder: '把闪过的念头写下来…',
              onChange: (event) => {
                const value = event.target.value
                setDrawer((prev) => {
                  if (!prev || prev.session !== state.session) return prev
                  if (prev.kind === 'create') return { ...prev, body: value }
                  return { ...prev, draft: { ...prev.draft, body: value } }
                })
              },
            })),
          state.kind === 'detail' ? h('label', { className: 'bm-field' }, '分类',
            h('select', {
              value: draft.category,
              onChange: (event) => {
                const value = event.target.value
                setDrawer((prev) => prev && prev.session === state.session && prev.draft ? { ...prev, draft: { ...prev.draft, category: value } } : prev)
              },
            }, CATEGORIES.map((id) => h('option', { key: id, value: id }, CATEGORY[id])))) : null,
          renderImages(images, true),
          h('input', {
            ref: fileRef, className: 'bm-sr', type: 'file', multiple: true,
            accept: 'image/jpeg,image/png,image/gif,image/webp',
            onChange: (event) => {
              addFiles(event.target.files)
              event.target.value = ''
            },
          }),
          state.error ? h('p', { className: 'bm-error' }, state.error) : null,
          state.conflict ? h('div', null,
            h('p', { className: 'bm-error' }, '这条灵感已在别处更新'),
            h('button', { type: 'button', className: 'bm-btn', onClick: reloadConflict }, '重新载入')) : null,
          h('div', { className: 'bm-actions' },
            h('button', {
              type: 'button', className: 'bm-btn',
              onClick: () => {
                if (state.kind === 'create') closeDrawer()
                else {
                  revokeImages(state.draft && state.draft.images)
                  setDrawer((prev) => prev && prev.session === state.session ? { ...prev, editing: false, draft: null, error: '', conflict: false } : prev)
                }
              },
            }, '取消'),
            h('button', { type: 'button', className: 'bm-btn bm-btn-primary', disabled: !canSave, onClick: state.kind === 'create' ? saveCreate : saveEdit }, '保存')))
      }

      function renderDetail(state) {
        const card = state.card
        const extensions = (card.extensions || []).slice().sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)))
        const legacy = !card.rawInput || card.rawInput.status === 'legacy'
        return h(React.Fragment, null,
          h('div', { className: 'bm-drawer-bar' },
            h('button', {
              type: 'button',
              className: 'bm-star' + (card.starred ? ' is-on' : ''),
              'aria-label': card.starred ? '取消收藏' : '收藏',
              onClick: () => toggleStar(card),
            }, h(StarIcon, { filled: !!card.starred })),
            !state.editing ? h('button', {
              type: 'button', className: 'bm-btn',
              onClick: () => setDrawer((prev) => prev && prev.session === state.session ? { ...prev, editing: true, draft: editDraft(card), error: '', conflict: false } : prev),
            }, '编辑') : null,
            h('button', { type: 'button', className: 'bm-btn', onClick: requestClose }, '关闭')),
          h('div', { className: 'bm-drawer-body' },
            state.editing ? renderEditor(state) : h(React.Fragment, null,
              h('h2', { className: 'bm-read-title' }, card.title || '未命名灵感'),
              h('div', null, h('span', { className: 'bm-tag' }, CATEGORY[card.fields && card.fields.category] || '其他')),
              card.body ? h('p', { className: 'bm-read-body' }, card.body) : null,
              (card.attachmentIds || []).length ? h('div', { className: 'bm-images' }, card.attachmentIds.map((id, index) => h('button', {
                type: 'button', key: id, className: 'bm-shot', 'aria-label': '查看大图',
                onClick: () => setLightbox({ ids: card.attachmentIds, index }),
              }, h('img', { src: attachmentUrl(id), alt: '' })))) : null,
              h('div', null,
                h('button', {
                  type: 'button', className: 'bm-raw', 'aria-expanded': state.rawOpen ? 'true' : 'false',
                  onClick: () => setDrawer((prev) => prev && prev.session === state.session ? { ...prev, rawOpen: !prev.rawOpen } : prev),
                }, '查看原文'),
                state.rawOpen ? h('p', { className: 'bm-raw-body' }, legacy ? '历史数据，无原文' : String(card.rawInput.text || '')) : null)),
            h('h3', { className: 'bm-block-title' }, '延展'),
            extensions.length ? h('ul', { className: 'bm-ext-list' }, extensions.map((extension) => h('li', { key: extension.id, className: 'bm-ext-item' },
              h('div', { className: 'bm-ext-meta' },
                h('span', null, relativeTime(extension.createdAt, now)),
                h('button', { type: 'button', className: 'bm-btn bm-btn-ghost', onClick: () => deleteExtension(extension) }, '删除')),
              h('p', { className: 'bm-read-body' }, extension.body)))) : h('p', { className: 'bm-meta' }, '还没有延展。'),
            h('div', { className: 'bm-compose' },
              h('textarea', {
                value: state.extensionText,
                placeholder: '写下理解、续写或补充…',
                onChange: (event) => {
                  const value = event.target.value
                  setDrawer((prev) => prev && prev.session === state.session ? { ...prev, extensionText: value } : prev)
                },
              }),
              state.extensionError ? h('p', { className: 'bm-error' }, state.extensionError) : null,
              h('div', { className: 'bm-actions' },
                h('button', {
                  type: 'button', className: 'bm-btn bm-btn-primary',
                  disabled: state.extensionText.trim() === '',
                  onClick: addExtension,
                }, '追加延展')))),
          h('div', { className: 'bm-drawer-foot' },
            h('button', {
              type: 'button', className: 'bm-btn bm-btn-danger',
              onClick: () => leave(() => moveToTrash(card)),
            }, '移入回收站'),
            h('span')))
      }

      function renderCreate(state) {
        return h(React.Fragment, null,
          h('div', { className: 'bm-drawer-bar' },
            h('h2', { className: 'bm-read-title', style: { marginRight: 'auto' } }, '新增灵感'),
            h('button', { type: 'button', className: 'bm-btn', onClick: requestClose }, '关闭')),
          h('div', { className: 'bm-drawer-body' }, renderEditor(state)))
      }

      let page
      if (section === 'stats') {
        const weeks = library.status === 'ready' && library.cards.length ? heatmapWeeks(library.cards, columns, now) : []
        page = h('div', { className: 'bm-column' },
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
                leave(() => { setDay(cell.key); setQuery(''); setSection('list') })
              },
            })
          }))) : null)
      } else if (section === 'trash') {
        const rows = trash.status === 'ready'
          ? trash.cards.slice().sort((a, b) => String(b.deletedAt || '').localeCompare(String(a.deletedAt || '')))
          : []
        page = h('div', { className: 'bm-column' },
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
      } else {
        page = h('div', { className: 'bm-column' },
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
            return h('li', { key: card.id, className: 'bm-row' },
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
      }

      const lightIds = lightbox ? lightbox.ids || [] : []
      const lightIndex = lightbox ? Math.min(lightbox.index, Math.max(lightIds.length - 1, 0)) : 0

      return h('div', {
        ref: rootRef,
        className: 'bm-app',
        'data-bluemanta-panel': PANEL_ID,
        'data-narrow': narrow ? 'true' : 'false',
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
      h('div', { className: 'bm-main' },
        page,
        drawer ? h('button', { type: 'button', className: 'bm-mask', 'aria-label': '关闭', onClick: requestClose }) : null,
        drawer ? h('aside', {
          className: 'bm-drawer', role: 'dialog', 'aria-modal': 'true',
          'aria-label': drawer.kind === 'create' ? '新增灵感' : '灵感详情',
          onPaste: (event) => {
            const items = event.clipboardData && event.clipboardData.items
            if (!items) return
            const files = []
            for (const item of items) {
              if (item.kind === 'file') {
                const file = item.getAsFile()
                if (file) files.push(file)
              }
            }
            if (!files.length) return
            event.preventDefault()
            addFiles(files)
          },
        }, drawer.kind === 'create' ? renderCreate(drawer) : renderDetail(drawer)) : null),
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

    return {
      inject: ['slots'],
      apply(ctx) {
        ctx.slots.inject('main', () => ctx.slots.register({ name: 'main', key: PANEL_ID }, IdeasPage))
        ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
          name: 'sidebar.panellist', id: PANEL_ID, order: 10, label: '灵感台',
        }, IdeasIcon))
      },
    }
  },
})
