import type { IdeaCategory } from '@bluemanta/server/api-types';
import { categoryColor, categoryLabel } from './model/categories';
import styles from './CategoryTag.module.css';

export function CategoryDot({ category }: { category: IdeaCategory }) {
  return <i className={styles.dot} style={{ background: categoryColor(category) }} aria-hidden="true" />;
}

export function CategoryTag({ category, className }: { category: IdeaCategory; className?: string }) {
  return (
    <span className={[styles.tag, className ?? ''].join(' ')}>
      <CategoryDot category={category} />
      {categoryLabel(category)}
    </span>
  );
}
