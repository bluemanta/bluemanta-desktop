import { forwardRef, type CSSProperties } from 'react';
import { Icon } from '../../ui/Icon';
import { displayTitle } from '../model/listing';
import { IdeaDetailView } from './IdeaDetailView';
import styles from './DetailPanel.module.css';

type DetailPanelProps = {
  tabs: string[];
  activeId: string | null;
  titles: ReadonlyMap<string, string>;
  width: number | null;
  onSelect: (id: string) => void;
  onClose: (id: string) => void;
};

/** 右侧详情卡片：多标签（最多 6 个）+ 当前标签的只读详情。 */
export const DetailPanel = forwardRef<HTMLElement, DetailPanelProps>(function DetailPanel(
  { tabs, activeId, titles, width, onSelect, onClose },
  ref,
) {
  const style = width === null ? undefined : ({ '--detail-width': `${width}px` } as CSSProperties);
  const panelId = 'idea-detail-panel';
  return (
    <aside ref={ref} className={styles.panel} style={style} aria-label="详情">
      {tabs.length > 0 ? (
        <div className={styles.tabs} role="tablist" aria-label="打开的灵感">
          {tabs.map((id) => {
            const title = displayTitle(titles.get(id) ?? '');
            const selected = id === activeId;
            return (
              <div key={id} className={styles.tab} data-selected={selected} title={title}>
                <button
                  type="button"
                  role="tab"
                  className={styles.tabLabel}
                  aria-selected={selected}
                  aria-controls={panelId}
                  tabIndex={selected || activeId === null ? 0 : -1}
                  onClick={() => onSelect(id)}
                >
                  {title}
                </button>
                <button
                  type="button"
                  className={styles.close}
                  aria-label={`关闭「${title}」`}
                  onClick={() => onClose(id)}
                >
                  <Icon name="close" />
                </button>
              </div>
            );
          })}
        </div>
      ) : null}
      <div className={styles.scroll} id={panelId} role={activeId ? 'tabpanel' : undefined}>
        {activeId ? (
          <IdeaDetailView key={activeId} id={activeId} />
        ) : (
          <p className={styles.placeholder}>
            在左边选一条灵感，详情会在这里打开。
            <br />
            可以同时打开多条，用上方的标签切换。
          </p>
        )}
      </div>
    </aside>
  );
});
