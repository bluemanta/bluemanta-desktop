import * as AlertDialog from '@radix-ui/react-alert-dialog';
import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import type { PersonalOsCompleteResponse, PersonalOsInboxResolveResponse, PersonalOsInboxUndoResponse, PersonalOsQuickNoteResponse, PersonalOsTodayResponse } from '@bluemanta/server/api-types';
import { ApiError, apiJson, describeError } from '../api/client';
import { Button } from '../ui/Button';
import { Icon } from '../ui/Icon';
import { useToast } from '../ui/Toast';
import dialog from '../ui/ConfirmDialog.module.css';
import styles from './PersonalOsWrite.module.css';

type Todo = PersonalOsTodayResponse['overdue'][number];
type InboxEntry = PersonalOsTodayResponse['inbox'][number];
const UNDO_MS = 10_000;

/** Everything a PersonalOS write can change: board data, its files, commits, and search. */
export function refreshPersonalOs(client: QueryClient): Promise<void> {
  return client.invalidateQueries({ predicate: ({ queryKey: [scope, type, id] }) =>
    scope === 'personalos' || scope === 'pos-git' || scope === 'pos-version'
    || (scope === 'knowledge' && (type === 'search' || (type === 'file' && id === 'personalos'))) });
}

function post<T>(path: string, body: unknown): Promise<T> {
  return apiJson<T>(`/api/v1/personalos/${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
}

const CONFLICT = '文件刚被改过，已刷新，请再试一次';

/** Why a write did not commit, in the words of spec 13.3; empty when it did. */
function uncommitted(result: { committed?: boolean; reason?: string }): string {
  if (result.committed) return '';
  if (result.reason === 'dirty') return '未提交：文件里还有别的未存档改动，晨间存档会带上';
  if (result.reason === 'no_repo') return '未提交：PersonalOS 没有 Git 记录';
  return '未提交：Git 提交失败，晨间存档会带上';
}

function resultText(result: PersonalOsCompleteResponse, kind: TodoAction, text: string): string {
  const note = uncommitted(result);
  if (kind === 'drop') return note ? `已不做：${text}；${note}` : `已不做：${text}，已提交`;
  return note ? `已完成，${note}` : '已完成并提交';
}

/** Checkbox for one open todo. The click only opens the preview; nothing is written until「完成」. */
export function TodoCheck({ todo, onComplete }: { todo: Todo; onComplete: (todo: Todo) => void }) {
  return <button type="button" role="checkbox" aria-checked={false} aria-label={`完成：${todo.text}`} title="完成这件事" data-testid="personalos-todo-check"
    className={styles.check} onClick={(event) => { event.stopPropagation(); onComplete(todo); }} onKeyDown={(event) => event.stopPropagation()} />;
}

/** ✕ on an open todo row (spec 16.4). Like the checkbox, it only opens the preview. */
export function DropButton({ todo, onDrop }: { todo: Todo; onDrop: (todo: Todo) => void }) {
  return <button type="button" className={styles.rowAction} aria-label={`不做了：${todo.text}`} title="不做了" data-testid="personalos-todo-drop"
    onClick={(event) => { event.stopPropagation(); onDrop(todo); }} onKeyDown={(event) => event.stopPropagation()}><Icon name="close" /></button>;
}

type TodoAction = 'complete' | 'drop';

/** Preview → confirm → write for completing a todo (spec 13.3). Render `dialog` once on the page. */
export function useCompleteTodo(): { start: (todo: Todo) => void; dialog: ReactNode } { return useTodoAction('complete'); }

/** Preview → confirm → write for 不做了 (spec 16.3). No undo; the confirm is the safeguard. */
export function useDropTodo(): { start: (todo: Todo) => void; dialog: ReactNode } { return useTodoAction('drop'); }

function useTodoAction(kind: TodoAction): { start: (todo: Todo) => void; dialog: ReactNode } {
  const path = kind === 'drop' ? 'todos/drop' : 'todos/complete';
  const verb = kind === 'drop' ? '没有改动' : '没有完成';
  const client = useQueryClient(); const toast = useToast();
  const [state, setState] = useState<{ todo: Todo; preview: PersonalOsCompleteResponse } | null>(null);
  const [busy, setBusy] = useState(false);
  const cancelRef = useRef<HTMLButtonElement>(null);

  const fail = useCallback((error: unknown) => {
    const conflict = error instanceof ApiError && error.code === 'conflict';
    toast.show(conflict ? CONFLICT : `${verb}：${describeError(error)}`);
    if (conflict) void refreshPersonalOs(client);
  }, [client, toast, verb]);

  const body = (todo: Todo, dryRun: boolean) => ({ domain: todo.domain, line: todo.line, raw: todo.raw, hash: todo.hash, dryRun });

  const start = useCallback((todo: Todo) => {
    if (busy) return;
    setBusy(true);
    post<PersonalOsCompleteResponse>(path, body(todo, true))
      .then((preview) => setState({ todo, preview }), fail)
      .finally(() => setBusy(false));
  }, [busy, fail, path]);

  const confirm = () => {
    if (!state || busy) return;
    setBusy(true);
    const text = state.todo.text;
    post<PersonalOsCompleteResponse>(path, body(state.todo, false))
      .then((result) => { setState(null); toast.show(resultText(result, kind, text)); }, (error: unknown) => { setState(null); fail(error); })
      .finally(() => { setBusy(false); void refreshPersonalOs(client); });
  };

  const preview = state?.preview;
  const node = <AlertDialog.Root open={state !== null} onOpenChange={(open) => { if (!open && !busy) setState(null); }}>
    <AlertDialog.Portal>
      <AlertDialog.Overlay className={dialog.scrim} />
      <AlertDialog.Content className={`${dialog.dialog} ${styles.dialog}`} data-testid={kind === 'drop' ? 'personalos-drop-dialog' : 'personalos-complete-dialog'}
        onOpenAutoFocus={(event) => { event.preventDefault(); cancelRef.current?.focus(); }}>
        <AlertDialog.Title className={dialog.title}>{kind === 'drop' ? '不做这件事了？' : '完成这件事？'}</AlertDialog.Title>
        <AlertDialog.Description className={styles.todo}>{state?.todo.text}</AlertDialog.Description>
        {kind === 'drop' && state?.todo.every ? <p className={styles.warning}>这是周期事项，删掉后以后不再出现；只想跳过这一次，请用「完成」。</p> : null}
        {preview ? <dl className={styles.facts}>
          <dt>会改的文件</dt><dd>{preview.files.map((file) => <code key={file.path}>{file.path}</code>)}</dd>
          <dt>提交说明</dt><dd><code>{preview.message}</code></dd>
        </dl> : null}
        {preview?.warnings.length ? <p className={styles.warning}>{preview.warnings.map((warning) => warning.message).join('；')}</p> : null}
        {preview ? <details className={styles.diff}><summary>查看改动</summary>
          {preview.files.map((file) => <div key={file.path}><p className={styles.diffPath}>{file.path}</p><pre>{file.lines.map((line, index) =>
            <span key={index} data-kind={line.startsWith('+') ? 'add' : line.startsWith('-') ? 'del' : line.startsWith('@@') ? 'hunk' : ''}>{line}{'\n'}</span>)}</pre></div>)}
        </details> : null}
        <div className={dialog.actions}>
          <AlertDialog.Cancel asChild><Button ref={cancelRef} disabled={busy}>取消</Button></AlertDialog.Cancel>
          <Button variant={kind === 'drop' ? 'dangerFill' : 'primary'} disabled={busy} onClick={confirm}>{busy ? '正在写入…' : kind === 'drop' ? '不做了' : '完成'}</Button>
        </div>
      </AlertDialog.Content>
    </AlertDialog.Portal>
  </AlertDialog.Root>;
  return { start, dialog: node };
}

/** One-line capture into 收件箱.md (spec 13.2). The grey line underneath is the preview; Enter confirms. */
export function QuickNote({ today, focus = false }: { today: string; focus?: boolean }) {
  const client = useQueryClient(); const toast = useToast();
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => { if (focus) inputRef.current?.focus(); }, [focus]);
  const [text, setText] = useState(''); const [busy, setBusy] = useState(false);
  const trimmed = text.trim();
  const submit = () => {
    if (!trimmed || busy) return;
    setBusy(true);
    post<PersonalOsQuickNoteResponse>('inbox', { text: trimmed })
      .then(() => { setText(''); toast.show('已记到收件箱'); }, (error: unknown) => toast.show(`没有记下：${describeError(error)}`))
      .finally(() => { setBusy(false); void refreshPersonalOs(client); });
  };
  return <div className={styles.quick} data-testid="personalos-quick-note">
    <input ref={inputRef} className={styles.quickInput} value={text} maxLength={500} disabled={busy} aria-label="速记"
      placeholder="速记：一句话，回车记下" data-quick-note
      onChange={(event) => setText(event.target.value.replace(/[\r\n]+/g, ' '))}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === 'Enter' && !event.nativeEvent.isComposing) { event.preventDefault(); submit(); }
        if (event.key === 'Escape') { setText(''); event.currentTarget.blur(); }
      }} />
    {trimmed ? <p className={styles.quickPreview} data-testid="personalos-quick-preview">将追加到收件箱：<code>- {today} {trimmed}</code></p> : null}
  </div>;
}

/**
 * 完成 / 不跟踪 for inbox entries (spec 16.1, 16.2): written at once, with「撤销」on the toast for 10 seconds.
 * `hidden` keeps a resolved row out of the list until the refreshed data no longer has it.
 */
export function useInboxResolve(inboxHash: string | null): { resolve: (entry: InboxEntry, action: 'done' | 'drop') => void; hidden: ReadonlySet<string> } {
  const client = useQueryClient(); const toast = useToast();
  const [hidden, setHidden] = useState<ReadonlySet<string>>(new Set());
  const busy = useRef(false);
  useEffect(() => { setHidden(new Set()); }, [inboxHash]);
  const fail = useCallback((error: unknown, what: string) => {
    const conflict = error instanceof ApiError && error.code === 'conflict';
    toast.show(conflict ? '收件箱刚被改过，已刷新，请再试一次' : `${what}：${describeError(error)}`);
    void refreshPersonalOs(client);
  }, [client, toast]);

  const undo = useCallback((result: PersonalOsInboxResolveResponse) => {
    post<PersonalOsInboxUndoResponse>('inbox/undo', { ...result.undo, hash: result.hash, logHash: result.logHash })
      .then((undone) => {
        const notes = [...undone.warnings.map((warning) => warning.message), uncommitted(undone)].filter(Boolean);
        toast.show(notes.length ? `已撤销；${notes.join('；')}` : '已撤销');
      }, (error: unknown) => fail(error, '没有撤销'))
      .finally(() => { setHidden(new Set()); void refreshPersonalOs(client); });
  }, [client, fail, toast]);

  const resolve = useCallback((entry: InboxEntry, action: 'done' | 'drop') => {
    if (busy.current || inboxHash === null) return;
    busy.current = true;
    setHidden((current) => new Set(current).add(entry.raw));
    const label = action === 'done' ? '已完成' : '已不跟踪';
    post<PersonalOsInboxResolveResponse>('inbox/resolve', { line: entry.line, raw: entry.raw, hash: inboxHash, action })
      .then((result) => {
        const note = uncommitted(result);
        toast.show(`${label}：${entry.text}${note ? `；${note}` : ''}`, { label: '撤销', onClick: () => undo(result) }, UNDO_MS);
      }, (error: unknown) => {
        setHidden((current) => { const next = new Set(current); next.delete(entry.raw); return next; });
        fail(error, action === 'done' ? '没有完成' : '没有改动');
      })
      .finally(() => { busy.current = false; void refreshPersonalOs(client); });
  }, [client, fail, inboxHash, toast, undo]);

  return { resolve, hidden };
}

/** One inbox entry: ✓ / ✕ on hover or focus; `x` completes, Delete / Backspace stops tracking. */
export function InboxRow({ entry, onResolve }: { entry: InboxEntry; onResolve: (entry: InboxEntry, action: 'done' | 'drop') => void }) {
  return <div role="option" aria-selected={false} tabIndex={0} data-pos-focus data-testid="personalos-inbox-entry" className={styles.inboxRow} title={entry.text}
    onKeyDown={(event) => {
      if (event.target !== event.currentTarget || event.metaKey || event.ctrlKey || event.altKey) return;
      if (event.key === 'x') { event.preventDefault(); onResolve(entry, 'done'); }
      if (event.key === 'Delete' || event.key === 'Backspace') { event.preventDefault(); onResolve(entry, 'drop'); }
    }}>
    <time>{entry.date}</time>
    <span className={styles.inboxText}>{entry.text}</span>
    <span className={styles.rowActions}>
      <button type="button" className={styles.rowAction} aria-label={`完成：${entry.text}`} title="完成" data-testid="personalos-inbox-done"
        onClick={() => onResolve(entry, 'done')} onKeyDown={(event) => event.stopPropagation()}><Icon name="check" /></button>
      <button type="button" className={styles.rowAction} aria-label={`不跟踪：${entry.text}`} title="不跟踪" data-testid="personalos-inbox-drop"
        onClick={() => onResolve(entry, 'drop')} onKeyDown={(event) => event.stopPropagation()}><Icon name="close" /></button>
    </span>
  </div>;
}
