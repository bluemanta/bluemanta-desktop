import { useCallback, useState } from 'react';

/** 与 tokens.css 的 `--bm-detail` 一致；拖动范围见设计规范第 5 节。 */
export const DETAIL_DEFAULT = 420;
export const DETAIL_MIN = 320;
export const DETAIL_MAX = 720;
export const DETAIL_STEP = 16;
export const DETAIL_WIDTH_KEY = 'bluemanta.detailWidth';

export function clampDetailWidth(value: number): number {
  return Math.round(Math.min(DETAIL_MAX, Math.max(DETAIL_MIN, value)));
}

export function parseStoredWidth(value: string | null): number | null {
  if (value === null) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? clampDetailWidth(parsed) : null;
}

function readStored(): number | null {
  try {
    return parseStoredWidth(window.localStorage.getItem(DETAIL_WIDTH_KEY));
  } catch {
    return null;
  }
}

/** 详情宽度只是界面偏好，存在 localStorage；`null` 表示默认宽度。 */
export function useDetailWidth(): [number | null, (next: number | null) => void] {
  const [width, setWidthState] = useState<number | null>(readStored);
  const setWidth = useCallback((next: number | null) => {
    const value = next === null ? null : clampDetailWidth(next);
    setWidthState(value);
    try {
      if (value === null) window.localStorage.removeItem(DETAIL_WIDTH_KEY);
      else window.localStorage.setItem(DETAIL_WIDTH_KEY, String(value));
    } catch {
      // 存储不可用时只在本次打开期间生效。
    }
  }, []);
  return [width, setWidth];
}
