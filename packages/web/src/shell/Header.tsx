import { useEffect, useRef } from 'react';
import { useAppNavigate } from '../app/context';
import { useOpenCapture } from '../ideas/capture/openCapture';
import { useIdeasState } from '../ideas/IdeasState';
import { Button } from '../ui/Button';
import { DISCARD_CONFIRM, useConfirm } from '../ui/ConfirmDialog';
import { Icon } from '../ui/Icon';
import styles from './Header.module.css';

export type Section = 'list' | 'stats' | 'trash';

const SECTIONS: readonly { id: Section; label: string; path: string }[] = [
  { id: 'list', label: '清单', path: '/ideas' },
  { id: 'stats', label: '统计', path: '/ideas/stats' },
  { id: 'trash', label: '回收站', path: '/ideas/trash' },
];

function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName);
}

export function Header({ section }: { section: Section }) {
  const navigate = useAppNavigate();
  const { query, setQuery, tabs, lastActive, dirtyIds, discardSessions, capture, sessions } = useIdeasState();
  const confirm = useConfirm();
  const openCapture = useOpenCapture();
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

  const goTo = (target: Section) => {
    const run = () => {
      if (target === 'list') {
        const last = lastActive.current;
        navigate(last && tabs.includes(last) ? `/ideas/${encodeURIComponent(last)}` : '/ideas');
        return;
      }
      navigate(SECTIONS.find((item) => item.id === target)?.path ?? '/ideas');
    };
    if (target !== 'list' && target !== section && dirtyIds.size > 0) {
      void confirm(DISCARD_CONFIRM).then((ok) => {
        if (!ok) return;
        discardSessions();
        run();
      });
      return;
    }
    run();
  };

  const onSearch = (value: string) => {
    setQuery(value);
    if (section !== 'list' && value.trim() !== '') goTo('list');
  };

  return (
    <header className={styles.head}>
      <h1 className={styles.title}>灵感台</h1>
      <div className={styles.seg} role="group" aria-label="灵感台页面">
        {SECTIONS.map((item) => (
          <button
            key={item.id}
            type="button"
            aria-pressed={section === item.id}
            onClick={() => goTo(item.id)}
          >
            {item.label}
          </button>
        ))}
      </div>
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
      <Button variant="primary" className={styles.new} onClick={openCapture}>
        <span>＋ 记一条</span>
        <kbd>N</kbd>
      </Button>
    </header>
  );
}
