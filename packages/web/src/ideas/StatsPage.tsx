import { useEffect, useMemo, useRef, useState } from 'react';
import { useAppNavigate } from '../app/context';
import { describeError } from '../api/client';
import { useIdeaList } from '../api/queries';
import { Banner } from '../ui/Banner';
import { Button } from '../ui/Button';
import { EmptyState } from '../ui/EmptyState';
import { CategoryDot } from './CategoryTag';
import { useIdeasState } from './IdeasState';
import { categoryColor } from './model/categories';
import { heatColumns, HEAT_ROWS, HEAT_WEEKS, summarize, visibleDays } from './model/stats';
import { formatClock } from './model/time';
import styles from './StatsPage.module.css';

function useNow(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);
  return now;
}

/** 统计页：指标、热力图、分类分布。数字在网页端按清单计算。 */
export function StatsPage() {
  const list = useIdeaList();
  const now = useNow();
  const navigate = useAppNavigate();
  const { setDay } = useIdeasState();
  const heatRef = useRef<HTMLDivElement>(null);
  const [columns, setColumns] = useState(HEAT_WEEKS);
  const summary = useMemo(() => (list.data ? summarize(list.data.items, now) : null), [list.data, now]);

  useEffect(() => {
    const node = heatRef.current;
    if (!node) return;
    const measure = () => {
      const style = getComputedStyle(node);
      const minCell = Number.parseFloat(style.getPropertyValue('--heat-min'));
      const gap = Number.parseFloat(style.columnGap);
      setColumns(heatColumns(node.clientWidth, Number.isFinite(minCell) ? minCell : 8, Number.isFinite(gap) ? gap : 4));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, [summary?.total]);

  if (list.isPending && !list.data) {
    return (
      <section className={styles.page} aria-busy="true" aria-label="数据统计">
        <p className={styles.note}>正在统计…</p>
      </section>
    );
  }

  if (!list.data || !summary) {
    return (
      <section className={styles.page} aria-label="数据统计">
        <EmptyState
          icon="alert"
          tone="danger"
          title="读取失败"
          action={
            <Button size="sm" onClick={() => void list.refetch()} disabled={list.isFetching}>
              {list.isFetching ? '重试中…' : '重试'}
            </Button>
          }
        >
          {describeError(list.error)}，还没有可以统计的内容。
        </EmptyState>
      </section>
    );
  }

  const days = visibleDays(summary.days, columns);
  const maxCategory = Math.max(1, ...summary.categories.map((category) => category.count));
  const kpis = [
    { id: 'total', label: '全部灵感', value: summary.total },
    { id: 'week', label: '近 7 天', value: summary.week },
    { id: 'month', label: '近 30 天', value: summary.month },
    { id: 'starred', label: '收藏', value: summary.starred },
  ];

  return (
    <section className={styles.page} aria-label="数据统计">
      {list.isError ? (
        <div className={styles.banner}>
          <Banner onRetry={() => void list.refetch()} retrying={list.isFetching}>
            读取失败，显示的是 {formatClock(list.dataUpdatedAt)} 的内容。{describeError(list.error)}
          </Banner>
        </div>
      ) : null}
      <div className={styles.kpis}>
        {kpis.map((kpi) => (
          <div key={kpi.id} className={styles.kpi} data-kpi={kpi.id}>
            <strong>{kpi.value}</strong>
            <span>{kpi.label}</span>
          </div>
        ))}
      </div>
      <section className={styles.card} aria-labelledby="heat-title">
        <h2 id="heat-title">近半年记录频率</h2>
        {summary.total === 0 ? (
          <p className={styles.empty}>还没有记下灵感，热力图先空着。</p>
        ) : (
          <div ref={heatRef} className={styles.heat} data-columns={columns} style={{ gridTemplateRows: `repeat(${HEAT_ROWS}, auto)` }}>
            {days.map((cell) => (
              <button
                key={cell.day}
                type="button"
                className={styles.cell}
                data-level={cell.level}
                data-count={cell.count}
                aria-label={`${cell.label} · ${cell.count} 条`}
                title={`${cell.label} · ${cell.count} 条`}
                onClick={() => {
                  setDay(cell.day);
                  navigate('/ideas');
                }}
              />
            ))}
          </div>
        )}
      </section>
      <section className={styles.card} aria-labelledby="cat-title">
        <h2 id="cat-title">分类分布</h2>
        <div className={styles.bars}>
          {summary.categories.map((category) => (
            <div key={category.id} className={styles.bar} data-category={category.id}>
              <span className={styles.name}>
                <CategoryDot category={category.id} />
                {category.label}
              </span>
              <span className={styles.track} aria-hidden="true">
                <i style={{ width: `${(category.count / maxCategory) * 100}%`, background: categoryColor(category.id) }} />
              </span>
              <span className={styles.count}>{category.count}</span>
            </div>
          ))}
        </div>
      </section>
      <p className={styles.note}>按记下日期统计，上海时区。</p>
    </section>
  );
}
