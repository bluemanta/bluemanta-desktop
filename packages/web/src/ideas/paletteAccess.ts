import type { EmbedMode } from '../app/launch';
import type { Viewport } from '../app/context';

/** 命令面板单键。按钮、侧栏和走查都用这一处。 */
export const PALETTE_KEY_LABEL = 'P';

const BLOCKED_TARGET = '[data-capture], [data-editor], [data-composer], [role="alertdialog"], [data-lightbox], button, a';

export type PaletteKeyEvent = {
  key: string;
  metaKey?: boolean;
  ctrlKey?: boolean;
  altKey?: boolean;
  shiftKey?: boolean;
  defaultPrevented?: boolean;
  isComposing?: boolean;
};

type OverlayDoc = {
  querySelector(selector: string): unknown;
};

/**
 * 单键 P 是否开关命令面板。
 * 和 N 一样：焦点在输入框或可编辑区域、落在按钮/链接/确认框等、或其他浮层开着时不触发。
 * 修饰键（⌘ / Ctrl / Alt / Shift）不触发。命令面板自己不算「其他浮层」，这样焦点不在输入框时可以再按 P 关上。
 * ⌘K / Ctrl+K 不走这里。
 */
export function shouldTogglePalette(event: PaletteKeyEvent, target: EventTarget | null, doc: OverlayDoc): boolean {
  if (event.defaultPrevented || event.isComposing) return false;
  if (event.key.toLowerCase() !== 'p') return false;
  if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return false;
  if (isTypingTarget(target) || isBlockedPaletteTarget(target) || hasOtherOverlay(doc)) return false;
  return true;
}

/** 关掉则打开，开着且允许切换则关上。 */
export function paletteOpenAfterKey(open: boolean, event: PaletteKeyEvent, target: EventTarget | null, doc: OverlayDoc): boolean {
  return shouldTogglePalette(event, target, doc) ? !open : open;
}

/** 侧栏不在时才在页头放入口：嵌入（main / sidebar），以及独立打开的窄屏。 */
export function showHeaderPaletteButton(embed: EmbedMode, viewport: Viewport): boolean {
  return embed === 'main' || embed === 'sidebar' || viewport === 'narrow';
}

/** 页头幽灵按钮：打开命令面板，提示键是 P。 */
export function headerPaletteButton(open: () => void): {
  label: '搜索或执行';
  kbd: string;
  tooltip: string;
  onClick: () => void;
} {
  return {
    label: '搜索或执行',
    kbd: PALETTE_KEY_LABEL,
    tooltip: `搜索或执行 ${PALETTE_KEY_LABEL}`,
    onClick: () => open(),
  };
}

export function isTypingTarget(target: EventTarget | null): boolean {
  const el = asElement(target);
  if (!el) return false;
  return el.isContentEditable === true || (typeof el.tagName === 'string' && /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName));
}

export function isBlockedPaletteTarget(target: EventTarget | null): boolean {
  const el = asElement(target);
  if (!el || typeof el.closest !== 'function') return false;
  return Boolean(el.closest(BLOCKED_TARGET));
}

/** 确认框、灯箱等。命令面板（data-palette）除外。 */
export function hasOtherOverlay(doc: OverlayDoc): boolean {
  if (doc.querySelector('[role="alertdialog"][data-state="open"]')) return true;
  return Boolean(doc.querySelector('[role="dialog"][data-state="open"]:not([data-palette])'));
}

type ElementLike = {
  tagName?: string;
  isContentEditable?: boolean;
  closest?: (selector: string) => unknown;
};

function asElement(target: EventTarget | null): ElementLike | null {
  if (target === null || typeof target !== 'object') return null;
  if (typeof HTMLElement !== 'undefined') {
    if (!(target instanceof HTMLElement)) return null;
    return target;
  }
  return target as ElementLike;
}
