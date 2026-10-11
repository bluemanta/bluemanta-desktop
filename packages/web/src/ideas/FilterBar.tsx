import { hasFilters } from './model/listing';
import { CATEGORIES } from './model/categories';
import { CategoryDot } from './CategoryTag';
import { useIdeasState } from './IdeasState';
import styles from './FilterBar.module.css';

/** 筛选条（32px）：全部、收藏、五个分类，可组合；右侧计数与当前筛选和搜索一致。 */
export function FilterBar({ count }: { count: number | null }) {
  const { filters, toggleStarred, toggleCategory, clearFilters } = useIdeasState();
  return (
    <div className={styles.bar} role="toolbar" aria-label="筛选">
      <button type="button" className={styles.chip} aria-pressed={!hasFilters(filters)} onClick={clearFilters}>
        全部
      </button>
      <button type="button" className={styles.chip} aria-pressed={filters.starredOnly} onClick={toggleStarred}>
        ★ 收藏
      </button>
      <span className={styles.sep} aria-hidden="true" />
      {CATEGORIES.map((category) => (
        <button
          key={category.id}
          type="button"
          className={styles.chip}
          aria-pressed={filters.categories.has(category.id)}
          onClick={() => toggleCategory(category.id)}
        >
          <CategoryDot category={category.id} />
          {category.label}
        </button>
      ))}
      <span className={styles.count} aria-live="polite" data-testid="idea-count">
        {count === null ? '' : `${count} 条`}
      </span>
    </div>
  );
}
