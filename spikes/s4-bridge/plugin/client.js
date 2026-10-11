/**
 * S4 浏览器端：验证「在对话中引用」。
 * 右侧栏页类型 bluemanta.s4（开始页入口「S4 引用」），正文是一个 srcdoc iframe，
 * 点按钮发 bm:quote → 插件找到右侧栏所在会话的输入框，把引用文字追加到草稿末尾并把焦点还给输入框。
 * 也可在控制台调用 window.__bmS4.quote({ id, title }) 直接测。
 */
window.__ModuleLoader__.load({
  id: '@bluemanta/spike-s4-bridge',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const TAB_ID = 'bluemanta.s4.tab'
    const TAB_KIND = 'bluemanta.s4'
    const shell = { ctx: null }
    const log = []

    function quoteText({ id, title }) {
      return `【灵感】${title}（bluemanta 灵感 id：${id}）`
    }

    function quote(msg) {
      const ctx = shell.ctx
      const mounted = ctx.sidebarRight.mounted
      const sessionId = mounted && typeof mounted.getSnapshot === 'function' ? mounted.getSnapshot() : undefined
      if (!sessionId) return { ok: false, reason: '当前不在对话里' }
      const actx = ctx.sessions.scope(sessionId)
      if (!actx) return { ok: false, reason: '找不到会话作用域' }
      const conversation = actx.get('conversation')
      if (!conversation) return { ok: false, reason: '对话服务不可用' }
      const input = conversation.input.for(actx)
      const draft = input.state.getSnapshot().draft
      const text = quoteText(msg)
      input.setDraft(draft ? `${draft.replace(/\s+$/, '')} ${text} ` : `${text} `)
      input.focus()
      return { ok: true, sessionId, before: draft, after: input.state.getSnapshot().draft }
    }

    window.addEventListener('message', event => {
      const msg = event.data || {}
      if (msg.type !== 'bm:quote') return
      let result
      try { result = quote(msg) } catch (error) { result = { ok: false, reason: String(error && error.message || error) } }
      log.push({ at: new Date().toISOString(), msg, result })
      event.source && event.source.postMessage({ type: 'bm:result', action: '在对话中引用', ...result }, '*')
    })

    const FRAME_HTML = `<!doctype html><meta charset="utf-8"><body style="font:13px system-ui;padding:12px">
      <p>虚构灵感：<b>周末试一下新咖啡豆</b></p>
      <button id="q">在对话中引用</button><pre id="r"></pre>
      <script>
        document.getElementById('q').onclick = () => parent.postMessage({ type: 'bm:quote', id: 'card_S4FAKE', title: '周末试一下新咖啡豆' }, '*')
        addEventListener('message', e => { if (e.data && e.data.type === 'bm:result') document.getElementById('r').textContent = JSON.stringify(e.data) })
      <\/script></body>`

    function Icon({ size }) {
      return h('svg', { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.6, 'aria-hidden': true },
        h('path', { d: 'M7 7h4v4H7zM13 7h4v4h-4zM7 11c0 3-1 4-2 5M13 11c0 3-1 4-2 5' }))
    }

    function TabBody() {
      return h('iframe', { srcDoc: FRAME_HTML, title: 'S4 引用', 'data-bluemanta-s4': 'frame', style: { width: '100%', height: '100%', border: 0 } })
    }

    return {
      inject: ['slots', 'sidebarRightTabs', 'sidebarRight', 'sessions'],
      apply(ctx) {
        shell.ctx = ctx
        window.__bmS4 = { quote, log }
        ctx.effect(() => ctx.sidebarRightTabs.register({
          id: TAB_ID, kind: TAB_KIND, title: () => 'S4 引用',
          guide: [{ id: 's4', order: 60, title: () => 'S4 引用', description: () => '验证在对话中引用', icon: Icon }],
        }), 's4: tab type')
        ctx.effect(() => ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register({
          name: 'sidebar.right.pane.tab', key: TAB_ID,
        }, TabBody)), 's4: tab body')
      },
    }
  },
})
