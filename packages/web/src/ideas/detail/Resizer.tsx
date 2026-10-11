import { useRef } from 'react';
import { clampDetailWidth, DETAIL_DEFAULT, DETAIL_MAX, DETAIL_MIN, DETAIL_STEP } from './detailWidth';
import styles from './Resizer.module.css';

type ResizerProps = {
  width: number | null;
  /** 拖动开始时详情的实际宽度（可能被列表最小宽度压窄）。 */
  measure: () => number;
  onChange: (next: number | null) => void;
};

/** 详情左边的拖动条：拖动改宽度，双击恢复默认，获得焦点时 ← → 微调。 */
export function Resizer({ width, measure, onChange }: ResizerProps) {
  const drag = useRef<{ x: number; width: number } | null>(null);
  const current = width ?? DETAIL_DEFAULT;

  return (
    <div
      className={styles.resizer}
      role="separator"
      aria-orientation="vertical"
      aria-label="调整详情宽度"
      aria-valuemin={DETAIL_MIN}
      aria-valuemax={DETAIL_MAX}
      aria-valuenow={current}
      tabIndex={0}
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        event.preventDefault();
        drag.current = { x: event.clientX, width: measure() };
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerMove={(event) => {
        const start = drag.current;
        if (!start) return;
        onChange(clampDetailWidth(start.width + start.x - event.clientX));
      }}
      onPointerUp={() => {
        drag.current = null;
      }}
      onPointerCancel={() => {
        drag.current = null;
      }}
      onDoubleClick={() => onChange(null)}
      onKeyDown={(event) => {
        if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
          event.preventDefault();
          const delta = event.key === 'ArrowLeft' ? DETAIL_STEP : -DETAIL_STEP;
          onChange(clampDetailWidth(measure() + delta));
        } else if (event.key === 'Home' || event.key === 'End') {
          event.preventDefault();
          onChange(event.key === 'Home' ? DETAIL_MIN : DETAIL_MAX);
        }
      }}
    />
  );
}
