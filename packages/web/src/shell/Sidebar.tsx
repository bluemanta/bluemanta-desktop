import type { Viewport } from '../app/context';
import { useAppNavigate } from '../app/context';
import { useIdeaList } from '../api/queries';
import { Icon } from '../ui/Icon';
import { useToast } from '../ui/Toast';
import { Tooltip } from '../ui/Tooltip';
import styles from './Sidebar.module.css';

/** 侧栏只列已上线的模块（idea-ui 第 1 节）；阶段 1.5 只有灵感台，不放占位项和设置。 */
export function Sidebar({ viewport }: { viewport: Exclude<Viewport, 'narrow'> }) {
  const mini = viewport === 'mid';
  const navigate = useAppNavigate();
  const toast = useToast();
  const list = useIdeaList();

  return (
    <nav className={styles.side} data-mini={mini} aria-label="模块">
      <div className={styles.brand}>
        <span className={styles.mark} aria-hidden="true">
          b
        </span>
        <span className={styles.label}>bluemanta</span>
      </div>
      <Tooltip label="搜索或执行… ⌘K" side="right" enabled={mini}>
        <button
          type="button"
          className={styles.command}
          aria-label="命令面板（即将上线）"
          onClick={() => toast.show('命令面板即将上线')}
        >
          <Icon name="search" />
          <span className={styles.label}>搜索或执行…</span>
          <kbd className={styles.label}>⌘K</kbd>
        </button>
      </Tooltip>
      <Tooltip label="灵感台" side="right" enabled={mini}>
        <button type="button" className={styles.nav} aria-current="page" aria-label="灵感台" onClick={() => navigate('/ideas')}>
          <Icon name="idea" />
          <span className={styles.label}>灵感台</span>
          {list.data ? <span className={`${styles.count} ${styles.label}`}>{list.data.count}</span> : null}
        </button>
      </Tooltip>
    </nav>
  );
}
