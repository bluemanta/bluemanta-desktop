import type { ReactNode } from 'react';
import { Icon, type IconName } from './Icon';
import styles from './EmptyState.module.css';

type EmptyStateProps = {
  icon: IconName;
  title: string;
  children?: ReactNode;
  action?: ReactNode;
  tone?: 'default' | 'danger';
};

export function EmptyState({ icon, title, children, action, tone = 'default' }: EmptyStateProps) {
  return (
    <div className={styles.empty} data-tone={tone}>
      <div className={styles.icon}>
        <Icon name={icon} />
      </div>
      <h3 className={styles.title}>{title}</h3>
      {children ? <p className={styles.text}>{children}</p> : null}
      {action ? <div className={styles.action}>{action}</div> : null}
    </div>
  );
}
