import { useEffect, useState, useSyncExternalStore } from 'react';
import { startBridge } from './bridge';

export type Theme = 'light' | 'dark';
export type ThemePreference = 'system' | 'light' | 'dark';

export const THEME_KEY = 'bluemanta.colorScheme';

const DARK_QUERY = '(prefers-color-scheme: dark)';
const ORDER: readonly ThemePreference[] = ['system', 'light', 'dark'];

export const THEME_PREFERENCE_LABEL: Record<ThemePreference, string> = {
  system: '跟随系统',
  light: '浅色',
  dark: '深色',
};

function readPreference(): ThemePreference {
  try {
    const value = localStorage.getItem(THEME_KEY);
    if (value === 'light' || value === 'dark' || value === 'system') return value;
  } catch {
    // 隐私模式读不到存储时跟随系统。
  }
  return 'system';
}

let preference: ThemePreference | null = null;
const listeners = new Set<() => void>();

function currentPreference(): ThemePreference {
  preference ??= readPreference();
  return preference;
}

export function getThemePreference(): ThemePreference {
  return currentPreference();
}

export function subscribeThemePreference(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** 跟随系统 → 浅色 → 深色 → 跟随系统。嵌入模式下调用了也不影响画面。 */
export function cycleThemePreference(): ThemePreference {
  const current = currentPreference();
  const next = ORDER[(ORDER.indexOf(current) + 1) % ORDER.length] ?? 'system';
  preference = next;
  try {
    localStorage.setItem(THEME_KEY, next);
  } catch {
    // 存不下时这一次会话里仍然切换。
  }
  for (const listener of listeners) listener();
  return next;
}

export function themeFromPreference(choice: ThemePreference, systemDark: boolean): Theme {
  if (choice === 'light' || choice === 'dark') return choice;
  return systemDark ? 'dark' : 'light';
}

/** 首屏在 React 挂载前调用，避免闪一下。嵌入模式不读本地偏好。 */
export function initialTheme(embedded: boolean): Theme {
  const systemDark = window.matchMedia(DARK_QUERY).matches;
  if (embedded) return systemDark ? 'dark' : 'light';
  return themeFromPreference(readPreference(), systemDark);
}

/**
 * 根元素的 `data-theme`。
 * 独立打开：本地偏好（跟随系统 / 浅色 / 深色）；嵌入：只听 dsh 的 `bm:theme`，没有消息时跟随系统。
 */
export function useTheme(
  parentOrigin: string | null,
  embedded: boolean,
  onChrome?: (leadingClearance: number) => void,
): Theme {
  const choice = useSyncExternalStore(subscribeThemePreference, getThemePreference, () => 'system' as ThemePreference);
  const [system, setSystem] = useState<Theme>(() => (window.matchMedia(DARK_QUERY).matches ? 'dark' : 'light'));
  const [fromParent, setFromParent] = useState<Theme | null>(null);

  useEffect(() => {
    const media = window.matchMedia(DARK_QUERY);
    const onChange = () => setSystem(media.matches ? 'dark' : 'light');
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, []);

  useEffect(
    () =>
      startBridge(window, {
        parentOrigin: embedded ? parentOrigin : null,
        onTheme: (dark) => setFromParent(dark ? 'dark' : 'light'),
        onChrome: embedded ? onChrome : undefined,
      }),
    [embedded, parentOrigin, onChrome],
  );

  const theme = embedded ? (fromParent ?? system) : themeFromPreference(choice, system === 'dark');
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);
  return theme;
}
