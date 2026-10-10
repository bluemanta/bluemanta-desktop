import type { TitleOrigin } from './types.js';

export const FALLBACK_TITLE = '未命名灵感';
export const TITLE_MAX_CHARS = 80;

/** 连续空白折叠成一个空格，并去掉首尾空白。 */
export function collapseWhitespace(value: string): string {
  return value.replace(/\s+/gu, ' ').trim();
}

/**
 * 用户没给标题时，用正文生成兜底标题。
 * 正文折叠后为空，标题为「未命名灵感」。
 */
export function fallbackTitleFromBody(body: string): string {
  const collapsed = collapseWhitespace(body);
  if (collapsed === '') return FALLBACK_TITLE;
  const chars = Array.from(collapsed);
  if (chars.length <= TITLE_MAX_CHARS) return collapsed;
  return chars.slice(0, TITLE_MAX_CHARS).join('');
}

/**
 * `title` 缺省或空字符串时自动生成，并记 `fallback`。
 * 非空标题原样保留，记 `user`。超长由调用方的 schema 拒绝，这里不截断用户标题。
 */
export function resolveIdeaTitle(
  title: string | undefined,
  body: string,
): { title: string; titleOrigin: TitleOrigin } {
  if (title === undefined || title === '') {
    return { title: fallbackTitleFromBody(body), titleOrigin: 'fallback' };
  }
  return { title, titleOrigin: 'user' };
}

/** 标题、正文、附件至少有一项非空。兜底标题生成后再检查。 */
export function hasCardContent(title: string, body: string, attachmentIds: readonly string[]): boolean {
  return title !== '' || body !== '' || attachmentIds.length > 0;
}
