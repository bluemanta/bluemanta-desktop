/**
 * 消息桥的纯函数。client.js 内嵌同一份文本（测试会核对）。
 * 只判断来源和拼地址、引用文字，不碰 dsh。
 */

export function messageOrigin(baseUrl) {
  if (typeof baseUrl !== 'string' || baseUrl === '') return '';
  try {
    const url = new URL(baseUrl);
    return url.origin && url.origin !== 'null' ? url.origin : '';
  } catch {
    return '';
  }
}

/** 只接受自己放进去的 iframe，且 origin 等于网页的 baseUrl。 */
export function isOwnFrameMessage(frames, event, baseUrl) {
  const origin = messageOrigin(baseUrl);
  if (!origin || !event || event.origin !== origin || !event.source) return false;
  if (!frames || typeof frames[Symbol.iterator] !== 'function') return false;
  for (const frame of frames) {
    if (frame && frame.contentWindow === event.source) return true;
  }
  return false;
}

export function embedFrameUrl(baseUrl, token, parentOrigin, embed, id) {
  const origin = messageOrigin(baseUrl);
  if (!origin) return '';
  const path = id ? '/ideas/' + encodeURIComponent(id) : '/ideas';
  const mode = embed === 'sidebar' ? 'sidebar' : 'main';
  const hash = 'token=' + encodeURIComponent(String(token ?? '')) + '&parent=' + encodeURIComponent(String(parentOrigin ?? ''));
  return origin + path + '?embed=' + mode + '#' + hash;
}

export function quoteText(id, title) {
  return '【灵感】' + title + '（bluemanta 灵感 id：' + id + '）';
}

export function appendQuote(draft, text) {
  const source = typeof draft === 'string' ? draft : '';
  if (source.trim() === '') return text + ' ';
  return source.replace(/\s+$/, '') + ' ' + text + ' ';
}
