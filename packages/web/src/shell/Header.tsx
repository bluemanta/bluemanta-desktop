import { useEffect, useRef, type CSSProperties, type ReactNode } from 'react';
import { useLeadingClearance } from '../app/chrome';
import { useLaunch, useViewport } from '../app/context';
import { useOpenCapture } from '../ideas/capture/openCapture';
import { useCommandPalette } from '../ideas/CommandPalette';
import { useGoToSection } from '../ideas/goToSection';
import { useIdeasState } from '../ideas/IdeasState';
import { headerPaletteButton, showHeaderPaletteButton } from '../ideas/paletteAccess';
import { Button } from '../ui/Button';
import { Icon } from '../ui/Icon';
import { Tooltip } from '../ui/Tooltip';
import styles from './Header.module.css';
import { IDEAS_MODULE, type WorkbenchModule } from './modules';

export type Section = 'list' | 'stats' | 'trash';

function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName);
}

export function Header({ module, section, onSection, children, actions }: { module: WorkbenchModule; section: string; onSection: (id: string) => void; children?: ReactNode; actions?: ReactNode }) {
  const palette = useCommandPalette();
  const { embed } = useLaunch();
  const leadingClearance = useLeadingClearance();
  const viewport = useViewport();
  const paletteButton = headerPaletteButton(() => palette.open());
  const style: CSSProperties | undefined =
    embed === 'main' && leadingClearance > 0
      ? ({ '--bm-leading-clearance': `${leadingClearance}px` } as CSSProperties)
      : undefined;
  return (
    <header className={styles.head} style={style}>
      <h1 className={styles.title}>{module.name}</h1>
      <div className={styles.seg} role="group" aria-label={`${module.name}页面`}>
        {module.sections.map((item) => (
          <button key={item.id} type="button" aria-pressed={section === item.id} onClick={() => onSection(item.id)}>
            {item.label}
          </button>
        ))}
      </div>
      {children}
      {showHeaderPaletteButton(embed, viewport) ? (
        <Tooltip label={paletteButton.tooltip}>
          <Button
            variant="ghost"
            className={styles.palette}
            aria-label={paletteButton.label}
            onClick={paletteButton.onClick}
          >
            <Icon name="search" />
            <kbd>{paletteButton.kbd}</kbd>
          </Button>
        </Tooltip>
      ) : null}
      {actions}
    </header>
  );
}

export function IdeasHeader({ section }: { section: Section }) {
  const { query, setQuery, capture, sessions } = useIdeasState();
  const openCapture = useOpenCapture();
  const goTo = useGoToSection();
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== '/' || event.metaKey || event.ctrlKey || event.altKey || isTyping(event.target)) return;
      event.preventDefault();
      searchRef.current?.focus();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  const onSearch = (value: string) => {
    setQuery(value);
    if (section !== 'list' && value.trim() !== '') goTo('list');
  };

  return (
    <Header
      module={IDEAS_MODULE}
      section={section}
      onSection={(id) => goTo(id as Section)}
      actions={
        <Button variant="primary" className={styles.new} onClick={openCapture}>
          <span>＋ 记一条</span>
          <kbd>N</kbd>
        </Button>
      }
    >
      <label className={styles.search}>
        <Icon name="search" />
        <input
          ref={searchRef}
          type="search"
          value={query}
          placeholder="搜索标题、正文、原文或分类"
          aria-label="搜索灵感"
          onChange={(event) => onSearch(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== 'Escape') return;
            // 快速记录和编辑先退出，搜索框排在它们后面。
            if (capture || Object.keys(sessions).length > 0) return;
            event.preventDefault();
            if (query !== '') setQuery('');
            else event.currentTarget.blur();
          }}
        />
        {query !== '' ? (
          <button
            type="button"
            className={styles.clear}
            aria-label="清空搜索"
            onClick={() => {
              setQuery('');
              searchRef.current?.focus();
            }}
          >
            <Icon name="close" />
          </button>
        ) : null}
      </label>
    </Header>
  );
}
