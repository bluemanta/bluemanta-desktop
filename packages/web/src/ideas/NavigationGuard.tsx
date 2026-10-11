import { useEffect, useRef } from 'react';
import { useLocation } from 'wouter';
import { useAppNavigate } from '../app/context';
import { DISCARD_CONFIRM, useConfirm } from '../ui/ConfirmDialog';
import { useIdeasState } from './IdeasState';
import { backWouldDiscard, ideaIdFromPath, pathnameOf, sectionOf } from './model/paths';

/**
 * wouter 在渲染时就订阅 popstate，并且会在事件里同步重绘。
 * 这个监听要更早挂上，后退标记才能在那次重绘的 effect 里被看到。
 */
let popped = false;
if (typeof window !== 'undefined') {
  window.addEventListener('popstate', () => {
    popped = true;
  });
}

/** 浏览器后退时确认；刷新或关闭标签用 beforeunload。 */
export function NavigationGuard() {
  const [location] = useLocation();
  const navigate = useAppNavigate();
  const confirm = useConfirm();
  const { dirtyIds, discardSessions, ignoreNextPop } = useIdeasState();
  const pathRef = useRef(location);
  const skip = useRef(false);
  const dirtyRef = useRef(dirtyIds);
  dirtyRef.current = dirtyIds;

  useEffect(() => {
    if (dirtyIds.size === 0) return;
    const onBefore = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', onBefore);
    return () => window.removeEventListener('beforeunload', onBefore);
  }, [dirtyIds.size]);

  useEffect(() => {
    const from = pathRef.current;
    const wasPop = popped;
    popped = false;
    if (skip.current || ignoreNextPop.current) {
      skip.current = false;
      ignoreNextPop.current = false;
      pathRef.current = location;
      return;
    }
    if (wasPop && backWouldDiscard(from, location, dirtyRef.current)) {
      const dest = location;
      skip.current = true;
      pathRef.current = from;
      navigate(pathnameOf(from));
      void confirm(DISCARD_CONFIRM).then((ok) => {
        if (!ok) return;
        const fromId = ideaIdFromPath(from);
        if (sectionOf(dest) !== 'list') discardSessions();
        else if (fromId) discardSessions([fromId]);
        skip.current = true;
        navigate(pathnameOf(dest));
      });
      return;
    }
    pathRef.current = location;
  }, [location, navigate, confirm, discardSessions]);

  return null;
}
