import { forwardRef, useImperativeHandle, useRef, useState } from 'react';
import { describeError } from '../../api/client';
import { uploadAttachment } from '../../api/writes';
import { AuthImage } from '../../ui/AuthImage';
import { Icon } from '../../ui/Icon';
import { isImageFile, MAX_IMAGES, type ImageSlot } from './slots';
import styles from './ImageSlots.module.css';

type ImageSlotsProps = {
  slots: ImageSlot[];
  onChange: (slots: ImageSlot[]) => void;
  label?: string;
};

export type ImageSlotsHandle = { addFiles: (files: File[]) => void };

function patch(slots: ImageSlot[], key: string, next: Partial<ImageSlot>): ImageSlot[] {
  return slots.map((slot) => (slot.key === key ? { ...slot, ...next } : slot));
}

export const ImageSlots = forwardRef<ImageSlotsHandle, ImageSlotsProps>(function ImageSlots({ slots, onChange, label = '图片' }, ref) {
  const input = useRef<HTMLInputElement>(null);
  const slotsRef = useRef(slots);
  slotsRef.current = slots;
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const [hint, setHint] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);

  const commit = (next: ImageSlot[]) => {
    slotsRef.current = next;
    onChangeRef.current(next);
  };

  const startUpload = (slot: ImageSlot) => {
    const file = slot.file;
    if (!file) return;
    void uploadAttachment(file, slot.requestId, {
      onProgress: (ratio) => commit(patch(slotsRef.current, slot.key, { phase: 'uploading', progress: ratio, message: null })),
    })
      .then((attachment) => {
        commit(
          patch(slotsRef.current, slot.key, {
            phase: 'ready',
            progress: 1,
            message: null,
            attachmentId: attachment.id,
            remoteUrl: attachment.url,
            file: null,
          }),
        );
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === 'AbortError') return;
        commit(patch(slotsRef.current, slot.key, { phase: 'failed', message: describeError(error), progress: 0 }));
      });
  };

  const addFiles = (files: File[]) => {
    const images = files.filter(isImageFile);
    const rejected = files.length - images.length;
    const room = MAX_IMAGES - slotsRef.current.length;
    const accepted = images.slice(0, Math.max(0, room));
    const notes: string[] = [];
    if (rejected > 0) notes.push('只接受 jpeg、png、gif、webp');
    if (images.length > accepted.length) notes.push('最多 4 张图片');
    setHint(notes.length > 0 ? notes.join('，') : null);
    if (accepted.length === 0) return;
    const added: ImageSlot[] = accepted.map((file) => ({
      key: crypto.randomUUID(),
      requestId: crypto.randomUUID(),
      phase: 'uploading',
      progress: 0,
      message: null,
      file,
      attachmentId: null,
      previewUrl: URL.createObjectURL(file),
      remoteUrl: null,
    }));
    commit([...slotsRef.current, ...added]);
    for (const slot of added) startUpload(slot);
  };

  const remove = (slot: ImageSlot) => {
    if (slot.previewUrl) URL.revokeObjectURL(slot.previewUrl);
    commit(slotsRef.current.filter((item) => item.key !== slot.key));
  };

  useImperativeHandle(ref, () => ({ addFiles }));

  const retry = (slot: ImageSlot) => {
    commit(patch(slotsRef.current, slot.key, { phase: 'uploading', progress: 0, message: null }));
    startUpload({ ...slot, phase: 'uploading', progress: 0, message: null });
  };

  return (
    <div
      className={styles.wrap}
      data-drag={dragOver}
      onDragOver={(event) => {
        if (![...event.dataTransfer.types].includes('Files')) return;
        event.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(event) => {
        event.preventDefault();
        setDragOver(false);
        addFiles([...event.dataTransfer.files]);
      }}
    >
      {slots.length > 0 ? (
        <ul className={styles.list} aria-label={label}>
          {slots.map((slot, index) => (
            <li key={slot.key} className={styles.slot} data-phase={slot.phase}>
              {slot.previewUrl ? (
                <img src={slot.previewUrl} alt={`图片 ${index + 1}`} />
              ) : slot.remoteUrl ? (
                <AuthImage src={slot.remoteUrl} alt={`图片 ${index + 1}`} />
              ) : (
                <span className={styles.placeholder}>图片</span>
              )}
              {slot.phase === 'uploading' ? (
                <span className={styles.progress} role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(slot.progress * 100)} aria-label={`图片 ${index + 1} 上传中`}>
                  <span style={{ width: `${Math.round(slot.progress * 100)}%` }} />
                </span>
              ) : null}
              {slot.phase === 'failed' ? (
                <span className={styles.failed}>
                  <button type="button" onClick={() => retry(slot)}>
                    重试
                  </button>
                  <button type="button" onClick={() => remove(slot)}>
                    移除
                  </button>
                </span>
              ) : (
                <button type="button" className={styles.remove} aria-label={`移除图片 ${index + 1}`} onClick={() => remove(slot)}>
                  <Icon name="close" />
                </button>
              )}
            </li>
          ))}
        </ul>
      ) : null}
      <button type="button" className={styles.add} onClick={() => input.current?.click()} disabled={slots.length >= MAX_IMAGES}>
        添加图片
      </button>
      <input
        ref={input}
        className={styles.file}
        type="file"
        accept="image/jpeg,image/png,image/gif,image/webp"
        multiple
        aria-label="选择图片"
        onChange={(event) => {
          addFiles([...(event.target.files ?? [])]);
          event.target.value = '';
        }}
      />
      {hint ? (
        <p className={styles.hint} role="alert">
          {hint}
        </p>
      ) : null}
      {slots.some((slot) => slot.phase === 'failed') ? (
        <p className={styles.hint} role="alert">
          {slots.find((slot) => slot.phase === 'failed')?.message ?? '上传失败'}
        </p>
      ) : null}
    </div>
  );
});

export function filesFromPaste(data: DataTransfer | null): File[] {
  if (!data) return [];
  return [...data.files];
}
