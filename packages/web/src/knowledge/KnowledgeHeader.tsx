import { useEffect, useRef, useState } from 'react';
import { useAppNavigate } from '../app/context';
import { Header } from '../shell/Header';
import { Icon } from '../ui/Icon';
import headerStyles from '../shell/Header.module.css';
import { KNOWLEDGE_MODULE } from './module';
import { searchPath } from './paths';

export type KnowledgeSection = 'topics' | 'search' | 'inbox';

function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName);
}

/** 页头：模块名、分段控件、搜索框（`/` 聚焦，回车进入搜索页）。 */
export function KnowledgeHeader({ section, query = '' }: { section: KnowledgeSection; query?: string }) {
  const navigate = useAppNavigate();
  const [value, setValue] = useState(query);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => setValue(query), [query]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== '/' || event.metaKey || event.ctrlKey || event.altKey || isTyping(event.target)) return;
      event.preventDefault();
      input.current?.focus();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  return (
    <Header
      module={KNOWLEDGE_MODULE}
      section={section}
      onSection={(id) => {
        const target = KNOWLEDGE_MODULE.sections.find((item) => item.id === id);
        if (target) navigate(target.path);
      }}
    >
      <form
        className={headerStyles.search}
        role="search"
        onSubmit={(event) => {
          event.preventDefault();
          navigate(searchPath(value));
        }}
      >
        <Icon name="search" />
        <input
          ref={input}
          type="search"
          value={value}
          placeholder="搜索知识和灵感"
          aria-label="搜索知识和灵感"
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== 'Escape') return;
            event.preventDefault();
            if (value !== '') setValue('');
            else event.currentTarget.blur();
          }}
        />
        {value !== '' ? (
          <button
            type="button"
            className={headerStyles.clear}
            aria-label="清空搜索"
            onClick={() => {
              setValue('');
              input.current?.focus();
            }}
          >
            <Icon name="close" />
          </button>
        ) : null}
      </form>
    </Header>
  );
}
