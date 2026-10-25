import type { IdeaListResponse, IdeaRecord } from '@bluemanta/server/api-types';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { useLocation } from 'wouter';
import { ideaKeys } from '../api/queries';
import { useAppNavigate } from '../app/context';
import { useOpenCapture } from './capture/openCapture';
import { useIdeaCommands } from './commands';
import { useIdeasState } from './IdeasState';
import { ideaIdFromPath, sectionOf } from './model/paths';
import { sessionFrom } from './model/session';

function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName);
}

function blocked(target: EventTarget | null): boolean {
  if (isTyping(target)) return true;
  if (!(target instanceof Element)) return false;
  return Boolean(target.closest('[data-capture], [data-editor], [data-composer], [role="alertdialog"], [data-lightbox], button, a'));
}

function overlayOpen(): boolean {
  return Boolean(document.querySelector('[role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"]'));
}

function listRows(): HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>('[role="listbox"][aria-label="灵感清单"] [role="option"][data-id]')];
}

function recordOf(client: ReturnType<typeof useQueryClient>, id: string): IdeaRecord | undefined {
  const detail = client.getQueryData<IdeaRecord>(ideaKeys.detail(id));
  if (detail && detail.deletedAt === null) return detail;
  const list = client.getQueryData<IdeaListResponse>(ideaKeys.list);
  return list?.items.find((item) => item.id === id);
}

export function ideasHotkeysEnabled(path: string): boolean {
  return path === '/ideas' || path.startsWith('/ideas/');
}

/** N、S、E、⌫ / Delete、⌘↵、esc。焦点在输入框里时单字母快捷键不生效。 */
export function IdeaHotkeys() {
  const client = useQueryClient();
  const [location] = useLocation();
  const { capture, sessions, editorActions, captureActions, setSession, rowFocus } = useIdeasState();
  const { star, trash } = useIdeaCommands();
  const openCapture = useOpenCapture();
  const navigate = useAppNavigate();
  const id = ideaIdFromPath(location);

  useEffect(() => {
    const move = (delta: number) => {
      const options = listRows();
      if (options.length === 0) return;
      const current = options.findIndex((row) => row.dataset.id === id);
      const start = current === -1 ? (delta > 0 ? -1 : options.length) : current;
      const next = options[Math.min(options.length - 1, Math.max(0, start + delta))];
      const nextId = next?.dataset.id;
      if (!nextId) return;
      if (nextId === id) {
        next.focus();
        next.scrollIntoView({ block: 'nearest' });
        return;
      }
      rowFocus.current = nextId;
      navigate(`/ideas/${encodeURIComponent(nextId)}`);
    };

    const onKey = (event: KeyboardEvent) => {
      if (!ideasHotkeysEnabled(location)) return;
      if (event.defaultPrevented || event.isComposing) return;
      if (overlayOpen()) return;
      const meta = event.metaKey || event.ctrlKey;
      if (meta && event.key === 'Enter') {
        event.preventDefault();
        if (capture) captureActions.current?.save();
        else if (id && sessions[id]) editorActions.current.get(id)?.save();
        return;
      }
      if (event.key === 'Escape') {
        if (capture) {
          event.preventDefault();
          event.stopImmediatePropagation();
          captureActions.current?.cancel();
          return;
        }
        if (id && sessions[id]) {
          event.preventDefault();
          event.stopImmediatePropagation();
          editorActions.current.get(id)?.cancel();
          return;
        }
        return;
      }
      const key = event.key.toLowerCase();
      const moveKey = key === 'j' || key === 'k' || event.key === 'ArrowDown' || event.key === 'ArrowUp';
      if (moveKey && !isTyping(event.target) && !meta && !event.altKey && sectionOf(location) === 'list') {
        event.preventDefault();
        move(key === 'k' || event.key === 'ArrowUp' ? -1 : 1);
        return;
      }
      if (blocked(event.target) || meta || event.altKey) return;
      if (key === 'n') {
        event.preventDefault();
        openCapture();
        return;
      }
      if (sectionOf(location) !== 'list' || !id) return;
      const record = recordOf(client, id);
      if (!record) return;
      if (key === 's') {
        event.preventDefault();
        void star(record);
        return;
      }
      if (key === 'e') {
        event.preventDefault();
        if (!sessions[id]) setSession(id, sessionFrom(record));
        return;
      }
      if (event.key === 'Backspace' || event.key === 'Delete') {
        event.preventDefault();
        void trash(record);
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [capture, client, editorActions, captureActions, id, location, navigate, openCapture, rowFocus, sessions, setSession, star, trash]);

  return null;
}
