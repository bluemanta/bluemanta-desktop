import { useEffect, useRef } from 'react';
import { useAppNavigate } from '../app/context';
import { useIdeasState } from '../ideas/IdeasState';
import { Button } from '../ui/Button';
import { Icon } from '../ui/Icon';
import { Tooltip } from '../ui/Tooltip';
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
  const { query, setQuery, tabs, lastActive } = useIdeasState();
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
    if (target === 'list') {
      const last = lastActive.current;
      navigate(last && tabs.includes(last) ? `/ideas/${encodeURIComponent(last)}` : '/ideas');
      return;
    }
    navigate(SECTIONS.find((item) => item.id === target)?.path ?? '/ideas');
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
      <Tooltip label="快速记录在 T13 上线">
        <Button variant="primary" aria-disabled="true" aria-label="记一条（T13 上线）" className={styles.new}>
          <span>＋ 记一条</span>
          <kbd>N</kbd>
        </Button>
      </Tooltip>
    </header>
  );
}
