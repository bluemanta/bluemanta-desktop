import { useEffect } from 'react';
import { useAppNavigate, useLaunch } from '../app/context';
import { Button } from '../ui/Button';
import { Icon } from '../ui/Icon';
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
  const canGoBack = embed !== 'sidebar';

  const back = () => {
    if (cameFromList()) window.history.back();
    else navigate('/ideas', { replace: true });
  };

  useEffect(() => {
    if (!canGoBack) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      if (document.querySelector('[data-lightbox]')) return;
      back();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  });

  return (
    <div className={styles.page}>
      {canGoBack ? (
        <div className={styles.toolbar}>
          <Button variant="ghost" size="sm" onClick={back}>
            <Icon name="back" />
            返回
          </Button>
        </div>
      ) : null}
      <div className={styles.scroll}>
        <IdeaDetailView id={id} />
      </div>
    </div>
  );
}
