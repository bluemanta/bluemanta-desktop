import { Command } from 'cmdk';
import * as Dialog from '@radix-ui/react-dialog';
import { createContext, useContext, useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from 'react';
import { useAppNavigate, useLaunch } from '../app/context';
import { cycleThemePreference, getThemePreference, subscribeThemePreference, THEME_PREFERENCE_LABEL } from '../app/theme';
import { useIdeaSearch } from '../api/queries';
import { commandShortcut } from '../ui/keys';
import { CategoryDot } from './CategoryTag';
import { Highlight } from './Highlight';
import { useIdeasState, SEARCH_DEBOUNCE_MS } from './IdeasState';
import { useOpenCapture } from './capture/openCapture';
import { useGoToSection } from './goToSection';
import { displayTitle } from './model/listing';
import { shouldTogglePalette } from './paletteAccess';
import styles from './CommandPalette.module.css';

type PaletteApi = { open: () => void };

const PaletteContext = createContext<PaletteApi>({ open: () => {} });

export function useCommandPalette(): PaletteApi {
  return useContext(PaletteContext);
}

const RESULT_LIMIT = 6;

/** ⌘K / Ctrl+K、单键 P，以及侧栏或页头入口。嵌入模式不提供「切换深浅色」。 */
export function CommandPaletteProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const api = useMemo<PaletteApi>(() => ({ open: () => setOpen(true) }), []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() !== 'k' || (!event.metaKey && !event.ctrlKey) || event.altKey || event.shiftKey) return;
      event.preventDefault();
      if (document.querySelector('[role="alertdialog"][data-state="open"]')) return;
      setOpen((current) => !current);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    // 单键 P。不要在网页里设置 window.name，否则嵌入框的 frame 名对不上，dsh 收不到快捷键。
    const onKey = (event: KeyboardEvent) => {
      if (!shouldTogglePalette(event, event.target, document)) return;
      event.preventDefault();
      setOpen((current) => !current);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  return (
    <PaletteContext.Provider value={api}>
      {children}
      <PaletteDialog open={open} onOpenChange={setOpen} />
    </PaletteContext.Provider>
  );
}

function PaletteDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { embed } = useLaunch();
  const navigate = useAppNavigate();
  const goTo = useGoToSection();
  const openCapture = useOpenCapture();
  const { setQuery: setPageQuery, clearFilters, setStarredOnly } = useIdeasState();
  const [input, setInput] = useState('');
  const [query, setQuery] = useState('');
  const preference = usePreference();
  const search = useIdeaSearch(query);

  useEffect(() => {
    if (!open) return;
    setInput('');
    setQuery('');
  }, [open]);

  useEffect(() => {
    const trimmed = input.trim();
    if (trimmed === '') {
      setQuery('');
      return;
    }
    const timer = window.setTimeout(() => setQuery(trimmed), SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [input]);

  const closeThen = (run: () => void) => {
    onOpenChange(false);
    run();
  };

  const commands: PaletteCommand[] = [
    { id: 'capture', label: '＋ 记一条灵感', kbd: 'N', run: () => closeThen(openCapture) },
    { id: 'list', label: '切换到清单', run: () => closeThen(() => goTo('list')) },
    { id: 'stats', label: '切换到统计', run: () => closeThen(() => goTo('stats')) },
    { id: 'trash', label: '打开回收站', run: () => closeThen(() => goTo('trash')) },
    {
      id: 'starred',
      label: '只看收藏',
      run: () =>
        closeThen(() => {
          setStarredOnly(true);
          goTo('list');
        }),
    },
    {
      id: 'clear',
      label: '清除筛选',
      run: () =>
        closeThen(() => {
          setPageQuery('');
          clearFilters();
          goTo('list');
        }),
    },
    ...(embed
      ? []
      : [
          {
            id: 'theme',
            label: '切换深浅色',
            hint: THEME_PREFERENCE_LABEL[preference],
            run: () => closeThen(() => cycleThemePreference()),
          },
        ]),
  ].filter((command) => input.trim() === '' || command.label.includes(input.trim()) || command.hint?.includes(input.trim()));

  const hits = query !== '' && search.data && !search.isPlaceholderData ? search.data.items.slice(0, RESULT_LIMIT) : [];
  const searching = query !== '' && search.isFetching && search.isPlaceholderData;
  const empty = commands.length === 0 && hits.length === 0 && !searching;

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className={styles.scrim} />
        <Dialog.Content
          className={styles.palette}
          aria-describedby={undefined}
          data-palette=""
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            const content = event.currentTarget;
            if (content instanceof HTMLElement) content.querySelector('input')?.focus();
          }}
          onCloseAutoFocus={(event) => event.preventDefault()}
        >
          <Dialog.Title className="visually-hidden">命令面板</Dialog.Title>
          <Command label="命令面板" shouldFilter={false} vimBindings={false} loop>
            <Command.Input
              autoFocus
              value={input}
              onValueChange={setInput}
              placeholder="搜索灵感、跳转、执行命令…"
              aria-label="命令"
            />
            <Command.List label="命令与搜索结果">
              {commands.length > 0 ? (
                <Command.Group heading="命令">
                  {commands.map((command) => (
                    <Command.Item key={command.id} value={command.id} onSelect={command.run}>
                      <span>{command.label}</span>
                      {command.hint ? <span className={styles.hint}>{command.hint}</span> : null}
                      {command.kbd ? <kbd>{command.kbd}</kbd> : null}
                    </Command.Item>
                  ))}
                </Command.Group>
              ) : null}
              {query !== '' ? (
                <Command.Group heading="灵感">
                  {searching ? <div className={styles.status}>搜索中…</div> : null}
                  {hits.map((item) => (
                    <Command.Item
                      key={item.id}
                      value={`idea-${item.id}`}
                      onSelect={() => closeThen(() => navigate(`/ideas/${encodeURIComponent(item.id)}`))}
                    >
                      <CategoryDot category={item.category} />
                      <span className={styles.hitTitle}>
                        <Highlight text={displayTitle(item.title)} query={query} />
                      </span>
                    </Command.Item>
                  ))}
                  {!searching && hits.length === 0 ? <div className={styles.status}>没有匹配的灵感</div> : null}
                </Command.Group>
              ) : null}
              {empty ? <div className={styles.status}>没有匹配的结果</div> : null}
            </Command.List>
          </Command>
          <div className={styles.foot}>
            <span>
              <kbd>↑</kbd>
              <kbd>↓</kbd> 选择
            </span>
            <span>
              <kbd>↵</kbd> 执行
            </span>
            <span>
              <kbd>esc</kbd> 关闭
            </span>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function usePreference() {
  return useSyncExternalStore(subscribeThemePreference, getThemePreference, () => 'system' as const);
}

type PaletteCommand = {
  id: string;
  label: string;
  kbd?: string;
  hint?: string;
  run: () => void;
};
