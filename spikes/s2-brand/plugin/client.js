/**
 * S2 浏览器端：占位 logo + 「bluemanta」名称，填进侧栏和新会话首屏的品牌位。
 * 纯 JS，不经构建；React 来自 dsh 的浏览器模块表。
 */
window.__ModuleLoader__.load({
  id: '@bluemanta/spike-s2-brand',
  factory(require) {
    const React = require('react')
    const h = React.createElement

    // 占位：蓝底白字的 b。用固定色：主题主色在深色下是白色，会吃掉白字。
    function PlaceholderMark({ size = 24, className }) {
      return h('svg', {
        width: size, height: size, viewBox: '0 0 24 24', className,
        'aria-label': 'bluemanta', 'data-bluemanta-brand': 'mark',
      },
      h('rect', { x: 1, y: 1, width: 22, height: 22, rx: 6, fill: '#1f6feb' }),
      h('text', {
        x: 12, y: 16.5, textAnchor: 'middle', fontSize: 14, fontWeight: 700,
        fontFamily: 'system-ui, sans-serif', fill: '#fff',
      }, 'b'))
    }

    function BrandName() {
      return h('span', {
        'data-bluemanta-brand': 'name',
        style: { fontSize: 18, fontWeight: 600, letterSpacing: '-0.01em', color: 'var(--dsw-alias-label-primary)' },
      }, 'bluemanta')
    }

    return {
      inject: ['slots'],
      apply(ctx) {
        ctx.slots.inject('sidebar.brand.mark', () =>
          ctx.slots.inject('sidebar.brand.name', function* () {
            yield ctx.slots.register({ name: 'sidebar.brand.mark' }, PlaceholderMark)
            yield ctx.slots.register({ name: 'sidebar.brand.name' }, BrandName)
          }))
        ctx.slots.inject('conversation.hero.brand.mark', () =>
          ctx.slots.register({ name: 'conversation.hero.brand.mark' }, PlaceholderMark))
      },
    }
  },
})
