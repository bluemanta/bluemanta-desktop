import { useEffect, useState } from 'react';
import { startBridge } from './bridge';

export type Theme = 'light' | 'dark';

const DARK_QUERY = '(prefers-color-scheme: dark)';

/**
 * 根元素的 `data-theme`：独立打开跟随系统；dsh 发来 `bm:theme` 后只听 dsh 的。
 */
export function useTheme(parentOrigin: string | null): Theme {
  const [system, setSystem] = useState<Theme>(() => (window.matchMedia(DARK_QUERY).matches ? 'dark' : 'light'));
  const [fromParent, setFromParent] = useState<Theme | null>(null);

  useEffect(() => {
    const media = window.matchMedia(DARK_QUERY);
    const onChange = () => setSystem(media.matches ? 'dark' : 'light');
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, []);

  useEffect(
    () => startBridge(window, { parentOrigin, onTheme: (dark) => setFromParent(dark ? 'dark' : 'light') }),
    [parentOrigin],
  );

  const theme = fromParent ?? system;
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);
  return theme;
}
