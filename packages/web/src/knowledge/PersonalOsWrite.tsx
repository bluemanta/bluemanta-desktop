import * as AlertDialog from '@radix-ui/react-alert-dialog';
import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import type { PersonalOsCompleteResponse, PersonalOsQuickNoteResponse, PersonalOsTodayResponse } from '@bluemanta/server/api-types';
import { ApiError, apiJson, describeError } from '../api/client';
import { Button } from '../ui/Button';
import { useToast } from '../ui/Toast';
import dialog from '../ui/ConfirmDialog.module.css';
import styles from './PersonalOsWrite.module.css';

type Todo = PersonalOsTodayResponse['overdue'][number];

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

function resultText(result: PersonalOsCompleteResponse): string {
  if (result.committed) return '已完成并提交';
  if (result.reason === 'dirty') return '已完成，未提交：文件里还有别的未存档改动，晨间存档会带上';
  if (result.reason === 'no_repo') return '已完成，未提交：PersonalOS 没有 Git 记录';
  return '已完成，未提交：Git 提交失败，晨间存档会带上';
}

/** Checkbox for one open todo. The click only opens the preview; nothing is written until「完成」. */
export function TodoCheck({ todo, onComplete }: { todo: Todo; onComplete: (todo: Todo) => void }) {
  return <button type="button" role="checkbox" aria-checked={false} aria-label={`完成：${todo.text}`} title="完成这件事" data-testid="personalos-todo-check"
    className={styles.check} onClick={(event) => { event.stopPropagation(); onComplete(todo); }} onKeyDown={(event) => event.stopPropagation()} />;
}

/** Preview → confirm → write for completing a todo (spec 13.3). Render `dialog` once on the page. */
export function useCompleteTodo(): { start: (todo: Todo) => void; dialog: ReactNode } {
  const client = useQueryClient(); const toast = useToast();
  const [state, setState] = useState<{ todo: Todo; preview: PersonalOsCompleteResponse } | null>(null);
  const [busy, setBusy] = useState(false);
  const cancelRef = useRef<HTMLButtonElement>(null);

  const fail = useCallback((error: unknown) => {
    const conflict = error instanceof ApiError && error.code === 'conflict';
    toast.show(conflict ? CONFLICT : `没有完成：${describeError(error)}`);
    if (conflict) void refreshPersonalOs(client);
  }, [client, toast]);

  const body = (todo: Todo, dryRun: boolean) => ({ domain: todo.domain, line: todo.line, raw: todo.raw, hash: todo.hash, dryRun });

  const start = useCallback((todo: Todo) => {
    if (busy) return;
    setBusy(true);
    post<PersonalOsCompleteResponse>('todos/complete', body(todo, true))
      .then((preview) => setState({ todo, preview }), fail)
      .finally(() => setBusy(false));
  }, [busy, fail]);

  const confirm = () => {
    if (!state || busy) return;
    setBusy(true);
    post<PersonalOsCompleteResponse>('todos/complete', body(state.todo, false))
      .then((result) => { setState(null); toast.show(resultText(result)); }, (error: unknown) => { setState(null); fail(error); })
      .finally(() => { setBusy(false); void refreshPersonalOs(client); });
  };

  const preview = state?.preview;
  const node = <AlertDialog.Root open={state !== null} onOpenChange={(open) => { if (!open && !busy) setState(null); }}>
    <AlertDialog.Portal>
      <AlertDialog.Overlay className={dialog.scrim} />
      <AlertDialog.Content className={`${dialog.dialog} ${styles.dialog}`} data-testid="personalos-complete-dialog"
        onOpenAutoFocus={(event) => { event.preventDefault(); cancelRef.current?.focus(); }}>
        <AlertDialog.Title className={dialog.title}>完成这件事？</AlertDialog.Title>
        <AlertDialog.Description className={styles.todo}>{state?.todo.text}</AlertDialog.Description>
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
          <Button variant="primary" disabled={busy} onClick={confirm}>{busy ? '正在写入…' : '完成'}</Button>
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
