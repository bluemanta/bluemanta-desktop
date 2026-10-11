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
export function htmlPreviewFrameName(embed, tabId) {
  if (embed !== 'sidebar') return MAIN_FRAME_NAME
  return SIDEBAR_FRAME_PREFIX + normalizeFrameToken(tabId)
}

/** 空字符串属性即可匹配 [data-html-preview]。 */
export function htmlPreviewFrameAttrs(embed, tabId) {
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
