import type { ReactNode } from 'react';
import { useLaunch, useViewport } from '../app/context';
import { Header, IdeasHeader, type Section } from './Header';
import { Sidebar } from './Sidebar';
import styles from './Shell.module.css';
import { IDEAS_MODULE, type WorkbenchModule } from './modules';

type ShellProps = {
  section: string;
  module?: WorkbenchModule;
  onSection?: (id: string) => void;
  /** 窄屏整页详情覆盖整列，不显示页头。 */
  header?: boolean;
  children: ReactNode;
};

/** 侧栏 + 主列（设计规范第 5 节）。嵌在 dsh 里或窄屏时没有侧栏。 */
export function Shell({ section, module = IDEAS_MODULE, onSection = () => {}, header = true, children }: ShellProps) {
  const viewport = useViewport();
  const { embed } = useLaunch();
  const showSidebar = embed === null && viewport !== 'narrow';
  return (
    <div className={styles.app} data-viewport={viewport} data-embed={embed ?? 'none'}>
      {showSidebar ? <Sidebar viewport={viewport} /> : null}
      <main className={styles.main}>
        {header ? (module.id === IDEAS_MODULE.id ? <IdeasHeader section={section as Section} /> : <Header module={module} section={section} onSection={onSection} />) : null}
        {children}
      </main>
    </div>
  );
}
