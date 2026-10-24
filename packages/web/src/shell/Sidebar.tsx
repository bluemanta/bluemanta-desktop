import type { Viewport } from '../app/context';
import { useAppNavigate } from '../app/context';
import { useLocation } from 'wouter';
import { useCommandPalette } from '../ideas/CommandPalette';
import { PALETTE_KEY_LABEL } from '../ideas/paletteAccess';
import { Icon } from '../ui/Icon';
import { commandShortcut } from '../ui/keys';
import { Tooltip } from '../ui/Tooltip';
import styles from './Sidebar.module.css';
import { moduleForPath, type WorkbenchModule } from './modules';

function ModuleCount({ module }: { module: WorkbenchModule }) {
  const count = module.useCount?.();
  if (count === undefined) return null;
  return <span className={`${styles.count} ${styles.label}`}>{count}</span>;
}

/** 侧栏只列已上线的模块（idea-ui 第 1 节）；阶段 1.5 只有灵感台，不放占位项和设置。 */
export function Sidebar({ viewport, modules }: { viewport: Exclude<Viewport, 'narrow'>; modules?: readonly WorkbenchModule[] }) {
  const mini = viewport === 'mid';
  const navigate = useAppNavigate();
  const palette = useCommandPalette();
  const registeredModules = modules ?? palette.modules;
  const [location] = useLocation();
  const active = moduleForPath(location, registeredModules);
  const shortcut = commandShortcut();

  return (
    <nav className={styles.side} data-mini={mini} aria-label="模块">
      <div className={styles.brand}>
        <span className={styles.mark} aria-hidden="true">
          b
        </span>
        <span className={styles.label}>bluemanta</span>
      </div>
      <Tooltip label={`搜索或执行… ${shortcut} · ${PALETTE_KEY_LABEL}`} side="right" enabled={mini}>
        <button type="button" className={styles.command} aria-label="搜索或执行" onClick={() => palette.open()}>
          <Icon name="search" />
          <span className={styles.label}>搜索或执行…</span>
          <kbd className={styles.label}>{shortcut}</kbd>
          <kbd className={styles.label}>{PALETTE_KEY_LABEL}</kbd>
        </button>
      </Tooltip>
      {registeredModules.map((module) => (
        <Tooltip key={module.id} label={module.name} side="right" enabled={mini}>
          <button type="button" className={styles.nav} aria-current={active?.id === module.id ? 'page' : undefined} aria-label={module.name} onClick={() => navigate(module.rootPath)}>
            <Icon name={module.icon} />
            <span className={styles.label}>{module.name}</span>
            <ModuleCount module={module} />
          </button>
        </Tooltip>
      ))}
    </nav>
  );
}
