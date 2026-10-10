/**
 * S1 浏览器端：左侧栏「灵感清单」入口，加上它在主区打开的只读页面。
 * 纯 JS，不经构建；React 来自 dsh 的浏览器模块表。
 */
window.__ModuleLoader__.load({
  id: '@bluemanta/spike-s1-panel',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const PANEL_ID = 'bluemanta.ideas'
    const ROUTE = 'api/bluemanta/s1/ideas'
    const CATEGORY = { product: '产品想法', learning: '学习备忘', work: '工作事务', life: '生活随想', other: '其他' }

    function IdeasIcon({ size }) {
      return h('svg', {
        width: size, height: size, viewBox: '0 0 24 24', fill: 'none',
        stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true,
      },
      h('path', { d: 'M9 18h6' }),
      h('path', { d: 'M10 21h4' }),
      h('path', { d: 'M12 3a6 6 0 0 0-3.6 10.8c.4.3.6.8.6 1.3V16h6v-.9c0-.5.2-1 .6-1.3A6 6 0 0 0 12 3z' }))
    }

    function formatDate(iso) {
      const d = new Date(iso)
      return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('zh-CN')
    }

    function IdeasPage() {
      const [state, setState] = React.useState({ status: 'loading' })
      React.useEffect(() => {
        let alive = true
        fetch(ROUTE)
          .then(r => r.json().then(body => (r.ok ? body : Promise.reject(new Error(body.error || `HTTP ${r.status}`)))))
          .then(data => { if (alive) setState({ status: 'ok', data }) })
          .catch(error => { if (alive) setState({ status: 'error', message: String(error.message || error) }) })
        return () => { alive = false }
      }, [])

      const darwin = document.documentElement.dataset.platform === 'darwin'
      const inner = { width: '100%', maxWidth: 960 }
      const secondary = { color: 'var(--dsw-alias-label-secondary)', fontSize: 13, lineHeight: '20px' }

      let body
      if (state.status === 'loading') body = h('p', { style: secondary }, '读取中…')
      else if (state.status === 'error') body = h('p', { style: { ...secondary, color: 'var(--dsw-alias-state-error-primary)' } }, `读取失败：${state.message}`)
      else body = h('ul', { style: { listStyle: 'none', margin: 0, padding: 0 } },
        state.data.ideas.map(idea => h('li', {
          key: idea.id,
          style: {
            display: 'flex', alignItems: 'baseline', gap: 12, padding: '12px 0',
            borderBottom: '1px solid var(--dsw-alias-border-l3)',
          },
        },
        h('span', { style: { flex: 1, minWidth: 0, fontSize: 14, lineHeight: '22px' } }, (idea.starred ? '★ ' : '') + (idea.title || '（无标题）')),
        h('span', { style: { ...secondary, color: 'var(--dsw-alias-label-tertiary)', whiteSpace: 'nowrap' } }, CATEGORY[idea.category] || idea.category || ''),
        h('span', { style: { ...secondary, color: 'var(--dsw-alias-label-tertiary)', whiteSpace: 'nowrap' } }, formatDate(idea.createdAt)))))

      return h('div', {
        'data-bluemanta-panel': PANEL_ID,
        style: {
          display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 24,
          boxSizing: 'border-box', height: '100%', overflow: 'auto',
          padding: '0 clamp(24px, 4vw, 48px) 48px', color: 'var(--dsw-alias-label-primary)',
        },
      },
      h('div', { style: { ...inner, paddingTop: darwin ? 'calc(28px + var(--dsh-frame-top-clearance, 0px))' : 28 } },
        h('h1', { style: { margin: 0, fontSize: 20, fontWeight: 500, lineHeight: '28px' } }, '灵感清单'),
        h('p', { style: { ...secondary, margin: '4px 0 0' } },
          state.status === 'ok' ? `${state.data.count} 条 · 来源：${state.data.source}` : 'S1 技术验证 · 只读')),
      h('div', { style: inner }, body))
    }

    return {
      inject: ['slots'],
      apply(ctx) {
        ctx.slots.inject('main', () => ctx.slots.register({ name: 'main', key: PANEL_ID }, IdeasPage))
        ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
          name: 'sidebar.panellist', id: PANEL_ID, order: 10, label: '灵感清单',
        }, IdeasIcon))
      },
    }
  },
})
