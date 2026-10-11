import type { IdeaCategory } from '@bluemanta/server/api-types';
import { CategoryDot } from './CategoryTag';
import { CATEGORIES } from './model/categories';
import styles from './CategoryPicker.module.css';

type CategoryPickerProps = {
  value: IdeaCategory | null;
  onChange: (value: IdeaCategory | null) => void;
  /** 快速记录可以不选；再点一次已选的分类会取消。 */
  allowEmpty?: boolean;
};

export function CategoryPicker({ value, onChange, allowEmpty = false }: CategoryPickerProps) {
  return (
    <div className={styles.row} role="group" aria-label="分类">
      {CATEGORIES.map((category) => {
        const selected = value === category.id;
        return (
          <button
            key={category.id}
            type="button"
            className={styles.chip}
            aria-pressed={selected}
            onClick={() => onChange(allowEmpty && selected ? null : category.id)}
          >
            <CategoryDot category={category.id} />
            {category.label}
          </button>
        );
      })}
    </div>
  );
}
