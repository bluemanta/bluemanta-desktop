import { useRef, type CSSProperties, type ReactNode } from 'react';
import { useLaunch } from '../app/context';
import { useDetailWidth } from '../ideas/detail/detailWidth';
import { Resizer } from '../ideas/detail/Resizer';
import panelStyles from '../ideas/detail/DetailPanel.module.css';
import { Button } from '../ui/Button';
import { Icon } from '../ui/Icon';
import styles from './Knowledge.module.css';

/** Shared knowledge detail card; narrow screens and the dsh right sidebar show only its contents. */
export function DetailArea({ full, onClose, children }: { full: boolean; onClose: () => void; children: ReactNode }) {
  const [width, setWidth] = useDetailWidth();
  const panel = useRef<HTMLElement>(null);
  const { embed } = useLaunch();
  if (full) return (
    <div className={styles.full}>
      {embed === 'sidebar' ? null : <Button variant="ghost" size="sm" className={styles.back} onClick={onClose}><Icon name="back" /> 返回</Button>}
      {children}
    </div>
  );
  const style = width === null ? undefined : ({ '--detail-width': `${width}px` } as CSSProperties);
  return <>
    <Resizer width={width} measure={() => panel.current?.getBoundingClientRect().width ?? 420} onChange={setWidth} />
    <aside ref={panel} className={panelStyles.panel} style={style} aria-label="详情">
      <div className={panelStyles.scroll}>
        <Button variant="ghost" size="sm" className={styles.back} onClick={onClose} aria-label="关闭详情"><Icon name="close" /> 关闭</Button>
        {children}
      </div>
    </aside>
  </>;
}
