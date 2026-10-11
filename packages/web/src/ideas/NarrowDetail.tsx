import { useEffect } from 'react';
import { useAppNavigate, useLaunch } from '../app/context';
import { Button } from '../ui/Button';
import { DISCARD_CONFIRM, useConfirm } from '../ui/ConfirmDialog';
import { Icon } from '../ui/Icon';
import { useIdeasState } from './IdeasState';
import { IdeaDetailView } from './detail/IdeaDetailView';
import styles from './NarrowDetail.module.css';

function cameFromList(): boolean {
  const state: unknown = window.history.state;
  return typeof state === 'object' && state !== null && (state as Record<string, unknown>).bmFromList === true;
}

/**
 * 窄屏整页详情（idea-ui 第 9 节）。从列表进来时「← 返回」走浏览器后退，列表恢复滚动位置；
 * 直接打开链接时回到清单。dsh 右侧栏（`embed=sidebar`）里没有返回。
 */
export function NarrowDetail({ id }: { id: string }) {
  const navigate = useAppNavigate();
  const { embed } = useLaunch();
  const { dirtyIds, discardSessions, ignoreNextPop } = useIdeasState();
  const confirm = useConfirm();
  const canGoBack = embed !== 'sidebar';

  const back = () => {
    const run = () => {
      if (cameFromList()) window.history.back();
      else navigate('/ideas', { replace: true });
    };
    if (!dirtyIds.has(id)) {
      if (cameFromList()) ignoreNextPop.current = true;
      run();
      return;
    }
    void confirm(DISCARD_CONFIRM).then((ok) => {
      if (!ok) return;
      discardSessions([id]);
      if (cameFromList()) ignoreNextPop.current = true;
      run();
    });
  };

  useEffect(() => {
    if (!canGoBack) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      if (document.querySelector('[role="alertdialog"], [data-lightbox], [data-editor], [data-capture]')) return;
      back();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  });

  const leading = canGoBack ? (
    <Button variant="ghost" size="sm" onClick={back}>
      <Icon name="back" />
      返回
    </Button>
  ) : null;

  return (
    <div className={styles.page}>
      <div className={styles.scroll}>
        <IdeaDetailView id={id} leading={leading} />
      </div>
    </div>
  );
}
