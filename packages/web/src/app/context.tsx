import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { useLocation } from 'wouter';
import type { Launch } from './launch';

export const LaunchContext = createContext<Launch>({ token: null, parentOrigin: null, embed: null });

export function useLaunch(): Launch {
  return useContext(LaunchContext);
}

/** 设计规范第 5 节的宽度档：≥1280 宽屏，1024–1279 中屏，<1024 窄屏。 */
export type Viewport = 'wide' | 'mid' | 'narrow';

const WIDE = '(min-width: 1280px)';
const MID = '(min-width: 1024px)';

function currentViewport(): Viewport {
  if (window.matchMedia(WIDE).matches) return 'wide';
  if (window.matchMedia(MID).matches) return 'mid';
  return 'narrow';
}

export function useViewport(): Viewport {
  const [viewport, setViewport] = useState<Viewport>(currentViewport);
  useEffect(() => {
    const queries = [window.matchMedia(WIDE), window.matchMedia(MID)];
    const onChange = () => setViewport(currentViewport());
    for (const query of queries) query.addEventListener('change', onChange);
    return () => {
      for (const query of queries) query.removeEventListener('change', onChange);
    };
  }, []);
  return viewport;
}

export type NavigateOptions = { replace?: boolean; state?: unknown };

/** 站内跳转，保留 `?embed=`，刷新后仍是嵌入模式。 */
export function useAppNavigate(): (path: string, options?: NavigateOptions) => void {
  const [, navigate] = useLocation();
  const { embed } = useLaunch();
  return useCallback(
    (path: string, options?: NavigateOptions) => navigate(embed ? `${path}?embed=${embed}` : path, options),
    [navigate, embed],
  );
}
