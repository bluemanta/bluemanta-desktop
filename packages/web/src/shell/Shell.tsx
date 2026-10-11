import type { ReactNode } from 'react';
import { useLaunch, useViewport } from '../app/context';
import { Header, type Section } from './Header';
import { Sidebar } from './Sidebar';
import styles from './Shell.module.css';

type ShellProps = {
  section: Section;
  /** 窄屏整页详情覆盖整列，不显示页头。 */
  header?: boolean;
  children: ReactNode;
};

/** 侧栏 + 主列（设计规范第 5 节）。嵌在 dsh 里或窄屏时没有侧栏。 */
export function Shell({ section, header = true, children }: ShellProps) {
  const viewport = useViewport();
  const { embed } = useLaunch();
  const showSidebar = embed === null && viewport !== 'narrow';
  return (
    <div className={styles.app} data-viewport={viewport} data-embed={embed ?? 'none'}>
      {showSidebar ? <Sidebar viewport={viewport} /> : null}
      <main className={styles.main}>
        {header ? <Header section={section} /> : null}
        {children}
      </main>
    </div>
  );
}
