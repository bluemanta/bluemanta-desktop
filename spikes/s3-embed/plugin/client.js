/**
 * S3 浏览器端：dsh 里只放"装网页的框"。
 * - 左侧栏入口「S3 嵌入」→ 主区 iframe，可切换来源 A（独立本地服务）/ B（dsh 鉴权路由）；
 * - 右侧栏页类型 bluemanta.s3（开始页入口「S3 网页」），正文同样是 iframe，参数 { id, source }；
 * - 消息桥：iframe 发 bm:ready → 回主题；发 bm:openSidebar → 由 dsh 在右侧栏打开该灵感。
 */
window.__ModuleLoader__.load({
  id: '@bluemanta/spike-s3-embed',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const PANEL_ID = 'bluemanta.s3'
    const TAB_ID = 'bluemanta.s3.tab'
    const TAB_KIND = 'bluemanta.s3'
    const THEME_VARS = {
      '--label-primary': '--dsw-alias-label-primary',
      '--label-secondary': '--dsw-alias-label-secondary',
      '--label-tertiary': '--dsw-alias-label-tertiary',
      '--bg': '--dsw-alias-bg-layer-1',
      '--bg-2': '--dsw-alias-bg-layer-2',
      '--border': '--dsw-alias-border-l3',
      '--accent': '--dsw-alias-state-business-primary',
      '--error': '--dsw-alias-state-error-primary',
    }
    const shell = { sidebarRight: null }
    const frames = new Set()
    const bridgeLog = []

    function themeMessage() {
      const style = getComputedStyle(document.body)
      const vars = {}
      for (const [local, dsw] of Object.entries(THEME_VARS)) vars[local] = style.getPropertyValue(dsw).trim()
      return { type: 'bm:theme', dark: document.body.hasAttribute('data-ds-dark-theme'), vars }
    }

    function postTheme(frame) {
      try { frame.contentWindow && frame.contentWindow.postMessage(themeMessage(), '*') } catch { /* 跨源失败时忽略 */ }
    }

    // 深浅色切换时，给所有框重发主题
    new MutationObserver(() => { frames.forEach(postTheme) })
      .observe(document.body, { attributes: true, attributeFilter: ['data-ds-dark-theme', 'class', 'style'] })

    window.addEventListener('message', event => {
      const frame = [...frames].find(f => f.contentWindow === event.source)
      if (!frame) return // 只接受我们自己放进去的框
      const msg = event.data || {}
      bridgeLog.push({ at: new Date().toISOString(), origin: event.origin, type: msg.type })
      window.__bmS3Bridge = bridgeLog
      if (msg.type === 'bm:ready') postTheme(frame)
      if (msg.type === 'bm:openSidebar') {
        const reply = r => event.source.postMessage({ type: 'bm:result', action: '在右侧栏打开', ...r }, '*')
        const right = shell.sidebarRight
        const mounted = right && right.mounted && typeof right.mounted.getSnapshot === 'function' && right.mounted.getSnapshot()
        if (!mounted) return reply({ ok: false, reason: '当前不在对话里，没有右侧栏' })
        try {
          right.openTab(TAB_KIND, { params: { id: String(msg.id || ''), source: frame.dataset.source || 'B', title: String(msg.title || '') } })
          reply({ ok: true })
        } catch (error) {
          reply({ ok: false, reason: String(error && error.message || error) })
        }
      }
    })

    function useConfig() {
      const [config, setConfig] = React.useState(null)
      React.useEffect(() => {
        let alive = true
        fetch('api/bluemanta/s3/config', { cache: 'no-store' }).then(r => r.json()).then(c => { if (alive) setConfig(c) })
          .catch(e => { if (alive) setConfig({ error: String(e) }) })
        return () => { alive = false }
      }, [])
      return config
    }

    function srcFor(source, config, id) {
      const extra = id ? `id=${encodeURIComponent(id)}` : ''
      if (source === 'A') {
        if (!config || !config.aUrl) return ''
        return config.aUrl + (extra ? `&${extra}` : '')
      }
      // 相对路径：web 版解析到 http://127.0.0.1:<port>/api/…，Desktop 解析到 dsh-app://app/api/…
      return new URL('api/bluemanta/s3/app' + (extra ? `?${extra}` : ''), document.baseURI).href
    }

    function Frame({ source, id, config }) {
      const ref = React.useRef(null)
      React.useEffect(() => {
        const frame = ref.current
        if (!frame) return undefined
        frames.add(frame)
        return () => { frames.delete(frame) }
      }, [])
      const src = srcFor(source, config, id)
      if (!src) return h('p', { style: { padding: 24, color: 'var(--dsw-alias-label-secondary)' } }, '等待本地服务地址…')
      return h('iframe', {
        ref, src, title: `S3 网页（来源 ${source}）`, 'data-source': source, 'data-bluemanta-s3': 'frame',
        style: { flex: 1, width: '100%', border: 0, background: 'transparent' },
      })
    }

    function Icon({ size }) {
      return h('svg', { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.6, 'aria-hidden': true },
        h('rect', { x: 3, y: 4, width: 18, height: 16, rx: 2 }), h('path', { d: 'M3 9h18' }))
    }

    function MainPage() {
      const config = useConfig()
      const [source, setSource] = React.useState('B')
      const darwin = document.documentElement.dataset.platform === 'darwin'
      const button = s => h('button', {
        type: 'button', onClick: () => setSource(s), 'data-s3-source': s,
        style: {
          padding: '2px 10px', borderRadius: 6, border: '1px solid var(--dsw-alias-border-l3)', cursor: 'pointer',
          background: source === s ? 'var(--dsw-alias-interactive-bg-hover)' : 'transparent', color: 'var(--dsw-alias-label-primary)',
        },
      }, s === 'A' ? 'A 独立服务' : 'B dsh 路由')
      return h('div', { style: { display: 'flex', flexDirection: 'column', height: '100%' } },
        h('div', {
          style: {
            display: 'flex', gap: 8, alignItems: 'center', fontSize: 12, color: 'var(--dsw-alias-label-secondary)',
            padding: darwin ? 'calc(12px + var(--dsh-frame-top-clearance, 0px)) 16px 8px' : '12px 16px 8px',
          },
        }, 'S3 嵌入验证 · 来源：', button('A'), button('B'),
        config && config.status ? ` · 本地服务 ${config.status.a}` : ''),
        h(Frame, { key: source, source, config }))
    }

    function TabBody(props) {
      const info = props.useTabInfo()
      const nav = info && info.tab ? info.tab.navigation : null
      const params = (nav && (nav.params || (nav.current && nav.current.params))) || {}
      const config = useConfig()
      return h('div', { style: { display: 'flex', flexDirection: 'column', height: '100%' } },
        h(Frame, { key: `${params.source}-${params.id}`, source: params.source === 'A' ? 'A' : 'B', id: params.id || '', config }))
    }

    return {
      inject: ['slots', 'sidebarRightTabs', 'sidebarRight'],
      apply(ctx) {
        shell.sidebarRight = ctx.sidebarRight
        ctx.slots.inject('main', () => ctx.slots.register({ name: 'main', key: PANEL_ID }, MainPage))
        ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
          name: 'sidebar.panellist', id: PANEL_ID, order: 20, label: 'S3 嵌入',
        }, Icon))
        ctx.effect(() => ctx.sidebarRightTabs.register({
          id: TAB_ID, kind: TAB_KIND, multiple: true, title: () => 'S3 网页',
          guide: [{ id: 's3', order: 50, title: () => 'S3 网页', description: () => '嵌入的网页版灵感台', icon: Icon }],
        }), 's3: tab type')
        ctx.effect(() => ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register({
          name: 'sidebar.right.pane.tab', key: TAB_ID,
        }, TabBody)), 's3: tab body')
      },
    }
  },
})
