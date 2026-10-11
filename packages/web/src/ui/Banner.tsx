import type { ReactNode } from 'react';
import { Button } from './Button';
import { Icon } from './Icon';
import styles from './Banner.module.css';

/** 持续可见的提示条（设计规范第 7 节）：写明发生了什么、影响、能做什么。 */
export function Banner({ children, onRetry, retrying }: { children: ReactNode; onRetry?: () => void; retrying?: boolean }) {
  return (
    <div className={styles.banner} role="alert">
      <Icon name="alert" className={styles.icon} />
      <span className={styles.text}>{children}</span>
      {onRetry ? (
        <Button size="sm" onClick={onRetry} disabled={retrying}>
          {retrying ? '重试中…' : '重试'}
        </Button>
      ) : null}
    </div>
  );
}
