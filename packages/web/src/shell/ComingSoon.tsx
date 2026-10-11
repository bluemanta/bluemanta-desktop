import { EmptyState } from '../ui/EmptyState';
import styles from './ComingSoon.module.css';

export function ComingSoon({ title, text }: { title: string; text: string }) {
  return (
    <section className={styles.page} aria-label={title}>
      <EmptyState icon="idea" title={title}>
        {text}
      </EmptyState>
    </section>
  );
}
