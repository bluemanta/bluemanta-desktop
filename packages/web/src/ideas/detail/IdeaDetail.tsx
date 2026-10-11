import type { IdeaRecord } from '@bluemanta/server/api-types';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { requestParent } from '../../app/bridge';
import { useLaunch } from '../../app/context';
import { describeError } from '../../api/client';
import { addExtension, deleteExtension, idempotencyId, isVersionConflict, reloadIdea, updateIdea } from '../../api/writes';
import { Button } from '../../ui/Button';
import { useToast } from '../../ui/Toast';
import { Tooltip } from '../../ui/Tooltip';
import { DISCARD_CONFIRM, useConfirm } from '../../ui/ConfirmDialog';
import { AuthImage } from '../../ui/AuthImage';
import { CategoryTag } from '../CategoryTag';
import { CategoryPicker } from '../CategoryPicker';
import { useIdeaCommands } from '../commands';
import { useIdeasState } from '../IdeasState';
import { filesFromPaste, ImageSlots, type ImageSlotsHandle } from '../images/ImageSlots';
import { draftCopy, readyAttachmentIds } from '../model/draft';
import { displayTitle } from '../model/listing';
import { sessionFrom, withDirty } from '../model/session';
import { sourceLabel } from '../model/sources';
import { formatFullTime } from '../model/time';
import { Lightbox } from './Lightbox';
import styles from './IdeaDetail.module.css';

type IdeaDetailProps = {
  record: IdeaRecord;
  /** 窄屏工具条最左侧的「← 返回」。 */
  leading?: ReactNode;
};

/** 嵌入 dsh 时的两个动作。宽一点时用短文案加 tooltip；窄到放不下时收进「更多」。 */
function EmbedActions({ onQuote, onOpen }: { onQuote: () => void; onOpen: () => void }) {
  const [open, setOpen] = useState(false);
  const more = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => {
      if (!more.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
    };
    document.addEventListener('pointerdown', onPointer);
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('pointerdown', onPointer);
      document.removeEventListener('keydown', onKey, true);
    };
  }, [open]);

  return (
    <>
      <div className={styles.embedInline}>
        <Tooltip label="在对话中引用">
          <Button size="sm" onClick={onQuote}>
            引用到对话
          </Button>
        </Tooltip>
        <Tooltip label="在右侧栏打开">
          <Button size="sm" onClick={onOpen}>
            侧栏打开
          </Button>
        </Tooltip>
      </div>
      <div className={styles.embedMore}>
        <div className={styles.more} ref={more}>
          <Button size="sm" aria-expanded={open} aria-haspopup="menu" onClick={() => setOpen((value) => !value)}>
            更多
          </Button>
          {open ? (
            <div className={styles.menu} role="menu">
              <button
                type="button"
                role="menuitem"
                className={styles.menuItem}
                onClick={() => {
                  setOpen(false);
                  onQuote();
                }}
              >
                在对话中引用
              </button>
              <button
                type="button"
                role="menuitem"
                className={styles.menuItem}
                onClick={() => {
                  setOpen(false);
                  onOpen();
                }}
              >
                在右侧栏打开
              </button>
            </div>
          ) : null}
        </div>
      </div>
    </>
  );
}

export function IdeaDetail({ record, leading }: IdeaDetailProps) {
  const { sessions, setSession, editSession, editorActions, bumpBaseRev } = useIdeasState();
  const session = sessions[record.id] ?? null;
  const confirm = useConfirm();
  const toast = useToast();
  const { parentOrigin, embed } = useLaunch();
  const client = useQueryClient();
  const { star, trash } = useIdeaCommands();
  const [viewing, setViewing] = useState<number | null>(null);
  const [starError, setStarError] = useState<string | null>(null);
  const [trashError, setTrashError] = useState<string | null>(null);
  const [extText, setExtText] = useState('');
  const [extError, setExtError] = useState<string | null>(null);
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const images = useRef<ImageSlotsHandle>(null);
  const saving = useRef(false);
  const raw = record.showRaw && record.rawInput.status === 'present' ? record.rawInput.text : null;

  useEffect(() => {
    if (!session || session.conflict || session.baseRev >= record.rev) return;
    editSession(record.id, (current) => (current.baseRev >= record.rev || current.conflict ? current : { ...current, conflict: true }));
  }, [record.rev, record.id, session?.baseRev, session?.conflict, editSession, session]);

  const save = async () => {
    const current = sessions[record.id];
    if (!current || saving.current) return;
    if (current.slots.some((slot) => slot.phase === 'uploading')) {
      editSession(record.id, (session) => ({ ...session, error: '图片还在上传' }));
      return;
    }
    const attachmentIds = readyAttachmentIds(current.slots);
    const hash = JSON.stringify({
      rev: current.baseRev,
      title: current.title,
      body: current.body,
      category: current.category,
      attachmentIds,
    });
    const requestId = current.saveRequest?.hash === hash ? current.saveRequest.id : crypto.randomUUID();
    editSession(record.id, (session) => ({ ...session, saveRequest: { hash, id: requestId }, error: null }));
    saving.current = true;
    try {
      await updateIdea(client, record.id, {
        requestId,
        rev: current.baseRev,
        title: current.title,
        body: current.body,
        category: current.category,
        attachmentIds,
      });
      setSession(record.id, null);
    } catch (error) {
      if (isVersionConflict(error)) {
        editSession(record.id, (session) => ({ ...session, conflict: true, error: null }));
        return;
      }
      editSession(record.id, (session) => ({ ...session, error: describeError(error) }));
    } finally {
      saving.current = false;
    }
  };

  const cancel = async () => {
    const current = sessions[record.id];
    if (current?.dirty) {
      const ok = await confirm(DISCARD_CONFIRM);
      if (!ok) return;
    }
    setSession(record.id, null);
  };

  useEffect(() => {
    if (!session) {
      editorActions.current.delete(record.id);
      return;
    }
    editorActions.current.set(record.id, { save: () => void save(), cancel: () => void cancel() });
    return () => {
      editorActions.current.delete(record.id);
    };
  });

  useEffect(() => {
    const node = bodyRef.current;
    if (!session || !node) return;
    node.focus();
    const end = node.value.length;
    node.setSelectionRange(end, end);
    node.scrollTop = node.scrollHeight;
  }, [session === null]);

  const startEdit = () => {
    if (sessions[record.id]) return;
    setSession(record.id, sessionFrom(record));
  };

  const reload = async () => {
    const current = sessions[record.id];
    if (!current) return;
    const text = draftCopy(current, readyAttachmentIds(current.slots).length);
    try {
      const fresh = await reloadIdea(client, record.id);
      setSession(record.id, {
        ...sessionFrom(fresh),
        conflict: true,
        keptDraft: text,
      });
    } catch (error) {
      editSession(record.id, (session) => ({ ...session, error: describeError(error) }));
    }
  };

  const changeField = (patch: Partial<Pick<typeof record, 'title' | 'body' | 'category'>>) => {
    editSession(record.id, (current) => withDirty({ ...current, ...patch }, record));
  };

  const submitExtension = async () => {
    const text = extText.trim();
    if (text === '') return;
    const scope = `ext:${record.id}`;
    const requestId = idempotencyId(scope, JSON.stringify({ rev: record.rev, text }));
    try {
      await addExtension(client, record.id, { requestId, rev: record.rev, text }, (updated) => {
        bumpBaseRev(updated.id, updated.rev);
      });
      setExtText('');
      setExtError(null);
    } catch (error) {
      setExtError(describeError(error));
    }
  };

  const removeExtension = async (extensionId: string) => {
    const ok = await confirm({
      title: '删除这条延展？',
      description: '删除后无法恢复。',
      confirmLabel: '删除',
      cancelLabel: '取消',
      danger: true,
    });
    if (!ok) return;
    const scope = `ext-del:${record.id}:${extensionId}`;
    const requestId = idempotencyId(scope, JSON.stringify({ rev: record.rev }));
    try {
      await deleteExtension(client, record.id, extensionId, { requestId, rev: record.rev }, (updated) => {
        bumpBaseRev(updated.id, updated.rev);
      });
      setExtError(null);
    } catch (error) {
      setExtError(describeError(error));
    }
  };

  const copyText = session ? (session.keptDraft ?? draftCopy(session, readyAttachmentIds(session.slots).length)) : '';
  const askParent = (type: 'bm:quote' | 'bm:openSidebar', okText: string) => {
    void requestParent(window, parentOrigin, { type, id: record.id, title: displayTitle(record.title) }).then((result) => {
      toast.show(result.ok ? okText : result.reason || '没有完成');
    });
  };

  return (
    <article className={styles.detail} aria-label={displayTitle(record.title)}>
      <div className={styles.toolbar} role="toolbar" aria-label="操作">
        {leading}
        {session ? (
          <>
            <Button size="sm" variant="ghost" onClick={() => void cancel()}>
              取消
            </Button>
            <Button size="sm" variant="primary" onClick={() => void save()}>
              保存 <kbd>⌘↵</kbd>
            </Button>
          </>
        ) : (
          <>
            <Button
              size="sm"
              aria-pressed={record.starred}
              onClick={() => void star(record).then(setStarError)}
            >
              {record.starred ? '★ 已收藏' : '☆ 收藏'}
            </Button>
            <Button size="sm" onClick={startEdit}>
              编辑 <kbd>E</kbd>
            </Button>
            {embed !== null ? (
              <EmbedActions
                onQuote={() => askParent('bm:quote', '已写入输入框')}
                onOpen={() => askParent('bm:openSidebar', '已在右侧栏打开')}
              />
            ) : null}
            <span className={styles.spacer} />
            <Button size="sm" variant="ghost" onClick={() => void trash(record).then(setTrashError)}>
              移入回收站
            </Button>
          </>
        )}
      </div>
      {starError ? (
        <p className={styles.error} role="alert">
          {starError}
        </p>
      ) : null}
      {trashError ? (
        <p className={styles.error} role="alert">
          {trashError}
        </p>
      ) : null}

      {session ? (
        <div data-editor="">
          {session.conflict ? (
            <div className={styles.conflict} role="alert">
              <p>这条灵感已在别处更新</p>
              <Button size="sm" onClick={() => void reload()}>
                重新载入
              </Button>
              <label className={styles.kept}>
                未保存的草稿
                <textarea readOnly value={copyText} aria-label="未保存的草稿" />
              </label>
            </div>
          ) : null}
          {session.error ? (
            <p className={styles.error} role="alert">
              {session.error}
            </p>
          ) : null}
          <input
            className={styles.input}
            aria-label="标题"
            value={session.title}
            placeholder="标题"
            onChange={(event) => changeField({ title: event.target.value })}
          />
          <textarea
            ref={bodyRef}
            className={styles.textarea}
            aria-label="正文"
            value={session.body}
            placeholder="正文"
            rows={6}
            onChange={(event) => changeField({ body: event.target.value })}
          />
          <CategoryPicker value={session.category} onChange={(category) => category && changeField({ category })} />
          <div
            onPaste={(event) => {
              const files = filesFromPaste(event.clipboardData);
              if (files.length === 0) return;
              event.preventDefault();
              images.current?.addFiles(files);
            }}
          >
            <ImageSlots
              ref={images}
              slots={session.slots}
              onChange={(slots) => editSession(record.id, (current) => withDirty({ ...current, slots }, record))}
            />
          </div>
        </div>
      ) : (
        <>
          <h2 className={styles.title}>{displayTitle(record.title)}</h2>
          <div className={styles.meta}>
            <CategoryTag category={record.category} />
            <span>来源 {sourceLabel(record.createdBy)}</span>
            <time dateTime={record.createdAt}>{formatFullTime(record.createdAt)}</time>
            {record.edited ? <span>已改写</span> : null}
          </div>
          {record.body.trim() !== '' ? <p className={styles.body}>{record.body}</p> : null}
          {record.attachments.length > 0 ? (
            <ul className={styles.images} aria-label={`图片 ${record.attachments.length} 张`}>
              {record.attachments.map((image, index) => (
                <li key={image.id}>
                  <button type="button" className={styles.thumb} aria-label={`查看图片 ${index + 1}`} onClick={() => setViewing(index)}>
                    <AuthImage src={image.url} alt={`图片 ${index + 1}`} className={styles.thumbImage} />
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
          {raw !== null ? (
            <section aria-labelledby={`raw-${record.id}`}>
              <h3 id={`raw-${record.id}`} className={styles.section}>
                原文
              </h3>
              <div className={styles.raw}>{raw}</div>
            </section>
          ) : null}
        </>
      )}

      <section aria-labelledby={`ext-${record.id}`} data-composer="">
        <h3 id={`ext-${record.id}`} className={styles.section}>
          延展 <span className={styles.sectionCount}>{record.extensions.length}</span>
        </h3>
        {record.extensions.length === 0 ? (
          <p className={styles.none}>还没有延展。</p>
        ) : (
          <ol className={styles.extensions}>
            {record.extensions.map((extension) => (
              <li key={extension.id} className={styles.extension}>
                <p>{extension.text}</p>
                <time dateTime={extension.createdAt}>{formatFullTime(extension.createdAt)}</time>
                <Button size="sm" variant="ghost" onClick={() => void removeExtension(extension.id)}>
                  删除
                </Button>
              </li>
            ))}
          </ol>
        )}
        <div className={styles.composer}>
          <textarea
            value={extText}
            aria-label="追加延展"
            placeholder="写下理解、续写或补充…"
            rows={2}
            onChange={(event) => setExtText(event.target.value)}
          />
          <Button size="sm" disabled={extText.trim() === ''} onClick={() => void submitExtension()}>
            追加延展
          </Button>
        </div>
        {extError ? (
          <p className={styles.error} role="alert">
            {extError}
          </p>
        ) : null}
      </section>

      <Lightbox images={record.attachments} index={viewing} onIndexChange={setViewing} />
    </article>
  );
}
