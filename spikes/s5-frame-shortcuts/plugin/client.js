/**
 * S5 浏览器端：左侧栏「S5 快捷键」→ 主区并排两个跨源（sandbox 不透明 origin）iframe：
 * - A：和现在的灵感台一样，不带标记；
 * - B：带 data-html-preview 和 name，看 Desktop 是否把 ⌘K/⌘N/⌘B/⌘W 交给 dsh 执行。
 * 框内记录自己收到的 keydown，用来判断按键有没有到网页。
 */
window.__ModuleLoader__.load({
  id: '@bluemanta/spike-s5-frame-shortcuts',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const PANEL_ID = 'bluemanta.s5'
    const PAGE = (label) => `<!doctype html><meta charset="utf-8"><body style="font:13px -apple-system;margin:12px">
<b>${label}</b><p>点这里让焦点进框，然后按键。框内收到的 keydown：</p><ol id="log"></ol>
<script>
addEventListener('keydown', (e) => {
  const k = [e.metaKey && '⌘', e.ctrlKey && '⌃', e.altKey && '⌥', e.shiftKey && '⇧', e.code].filter(Boolean).join('')
  const li = document.createElement('li'); li.textContent = k + '  ' + new Date().toLocaleTimeString()
  document.getElementById('log').prepend(li)
})
</script>`

    function MainPage() {
      const frame = { flex: '1 1 0', border: '1px solid var(--dsw-alias-border-l3)', borderRadius: 6, minWidth: 0, height: '100%' }
      return h('div', { style: { display: 'flex', flexDirection: 'column', height: '100%', padding: 'calc(12px + var(--dsh-frame-top-clearance, 0px)) 16px 16px', gap: 8 } },
        h('div', { style: { fontSize: 12, color: 'var(--dsw-alias-label-secondary)' } }, 'S5：焦点在框内时按 ⌘B / ⌘K / ⇧⌘K / ⌘N / ⌘W'),
        h('div', { style: { display: 'flex', gap: 12, flex: '1 1 auto', minHeight: 0 } },
          h('iframe', { title: 'S5 A', sandbox: 'allow-scripts', srcDoc: PAGE('A：无标记（同现在的灵感台）'), style: frame }),
          h('iframe', { title: 'S5 B', name: 'bluemanta-s5-b', 'data-html-preview': '', sandbox: 'allow-scripts', srcDoc: PAGE('B：data-html-preview + name'), style: frame })))
    }

    function Icon({ size }) {
      const px = size || 16
      return h('svg', { width: px, height: px, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.6 },
        h('rect', { x: 3, y: 6, width: 18, height: 12, rx: 2 }), h('path', { d: 'M7 10h2M11 10h2M15 10h2M8 14h8' }))
    }

    return {
      inject: ['slots'],
      apply(ctx) {
        ctx.slots.inject('main', () => ctx.slots.register({ name: 'main', key: PANEL_ID }, MainPage))
        ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
          name: 'sidebar.panellist', id: PANEL_ID, order: 30, label: 'S5 快捷键',
        }, Icon))
      },
    }
  },
})
