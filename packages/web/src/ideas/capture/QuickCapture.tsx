import { useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useAppNavigate } from '../../app/context';
import { describeError } from '../../api/client';
import { createIdea } from '../../api/writes';
import { Button } from '../../ui/Button';
import { useToast } from '../../ui/Toast';
import { CategoryPicker } from '../CategoryPicker';
import { useIdeasState } from '../IdeasState';
import { filesFromPaste, ImageSlots, type ImageSlotsHandle } from '../images/ImageSlots';
import { readyAttachmentIds } from '../model/draft';
import { passesFilters } from '../model/listing';
import styles from './QuickCapture.module.css';

/** 列表顶部的快速记录。requestId 在打开时生成，失败重试沿用同一个。 */
export function QuickCapture() {
  const { capture, setCapture, closeCapture, setQuery, clearFilters, filters, captureActions } = useIdeasState();
  const client = useQueryClient();
  const navigate = useAppNavigate();
  const toast = useToast();
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const images = useRef<ImageSlotsHandle>(null);
  const saving = useRef(false);

  useEffect(() => {
    bodyRef.current?.focus();
  }, []);

  const save = async () => {
    if (!capture || saving.current) return;
    const title = capture.title.trim();
    const body = capture.body.trim();
    if (capture.slots.some((slot) => slot.phase === 'uploading')) {
      setCapture((current) => (current ? { ...current, error: '图片还在上传' } : current));
      return;
    }
    const attachmentIds = readyAttachmentIds(capture.slots);
    if (title === '' && body === '' && attachmentIds.length === 0) {
      toast.show('标题和正文至少写一项');
      return;
    }
    saving.current = true;
    setCapture((current) => (current ? { ...current, error: null } : current));
    try {
      const record = await createIdea(client, {
        requestId: capture.requestId,
        ...(title === '' ? {} : { title }),
        ...(body === '' ? {} : { body }),
        ...(capture.category ? { category: capture.category } : {}),
        ...(attachmentIds.length > 0 ? { attachmentIds } : {}),
      });
      closeCapture();
      setQuery('');
      navigate(`/ideas/${encodeURIComponent(record.id)}`);
      const hidden = !passesFilters(record, filters);
      if (hidden) {
        toast.show('已记下（当前筛选下不显示）', {
          label: '清除筛选',
          onClick: () => {
            clearFilters();
            setQuery('');
          },
        });
      } else {
        toast.show('已记下');
      }
    } catch (error) {
      setCapture((current) => (current ? { ...current, error: describeError(error) } : current));
    } finally {
      saving.current = false;
    }
  };

  const cancel = () => closeCapture();

  useEffect(() => {
    captureActions.current = { save: () => void save(), cancel };
    return () => {
      if (captureActions.current?.cancel === cancel) captureActions.current = null;
    };
  });

  if (!capture) return null;

  return (
    <form
      className={styles.card}
      data-capture=""
      aria-label="快速记录"
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
      onPaste={(event) => {
        const files = filesFromPaste(event.clipboardData);
        if (files.length === 0) return;
        event.preventDefault();
        images.current?.addFiles(files);
      }}
    >
      <input
        className={styles.title}
        value={capture.title}
        aria-label="标题"
        placeholder="标题（可留空，按正文自动生成）"
        onChange={(event) => setCapture((current) => (current ? { ...current, title: event.target.value } : current))}
      />
      <textarea
        ref={bodyRef}
        className={styles.body}
        value={capture.body}
        aria-label="正文"
        placeholder="想到了什么…"
        rows={2}
        onChange={(event) => setCapture((current) => (current ? { ...current, body: event.target.value } : current))}
      />
      <ImageSlots ref={images} slots={capture.slots} onChange={(slots) => setCapture((current) => (current ? { ...current, slots } : current))} />
      {capture.error ? (
        <p className={styles.error} role="alert">
          {capture.error}
        </p>
      ) : null}
      <div className={styles.bar}>
        <CategoryPicker
          allowEmpty
          value={capture.category}
          onChange={(category) => setCapture((current) => (current ? { ...current, category } : current))}
        />
        <p className={styles.hint}>不选分类会自动判断 · ⌘↵ 保存 · esc 取消</p>
        <Button size="sm" variant="ghost" onClick={cancel}>
          取消
        </Button>
        <Button size="sm" variant="primary" onClick={() => void save()}>
          记下
        </Button>
      </div>
    </form>
  );
}
