import type { AttachmentMeta } from '@bluemanta/server/api-types';
import * as Dialog from '@radix-ui/react-dialog';
import { AuthImage } from '../../ui/AuthImage';
import { Icon } from '../../ui/Icon';
import styles from './Lightbox.module.css';

type LightboxProps = {
  images: AttachmentMeta[];
  index: number | null;
  onIndexChange: (index: number | null) => void;
};

/** 大图浏览：esc 关闭，← → 切换（idea-ui 第 3 节）。 */
export function Lightbox({ images, index, onIndexChange }: LightboxProps) {
  const open = index !== null && images[index] !== undefined;
  const total = images.length;
  const current = open ? images[index] : undefined;
  const step = (delta: number) => {
    if (index === null || total === 0) return;
    onIndexChange((index + delta + total) % total);
  };

  return (
    <Dialog.Root open={open} onOpenChange={(next) => (next ? undefined : onIndexChange(null))}>
      <Dialog.Portal>
        <Dialog.Overlay className={styles.scrim} />
        <Dialog.Content
          className={styles.content}
          aria-describedby={undefined}
          data-lightbox=""
          onKeyDown={(event) => {
            if (event.key === 'ArrowLeft') {
              event.preventDefault();
              step(-1);
            } else if (event.key === 'ArrowRight') {
              event.preventDefault();
              step(1);
            }
          }}
        >
          <Dialog.Title className="visually-hidden">
            图片 {index === null ? 0 : index + 1} / {total}
          </Dialog.Title>
          <div className={styles.bar}>
            <span className={styles.counter} data-testid="lightbox-counter">
              {index === null ? 0 : index + 1} / {total}
            </span>
            <Dialog.Close className={styles.iconButton} aria-label="关闭大图">
              <Icon name="close" />
            </Dialog.Close>
          </div>
          <div className={styles.stage}>
            {total > 1 ? (
              <button type="button" className={styles.nav} aria-label="上一张" onClick={() => step(-1)}>
                <Icon name="left" />
              </button>
            ) : null}
            {current ? (
              <AuthImage
                key={current.id}
                src={current.url}
                alt={`图片 ${(index ?? 0) + 1}`}
                className={styles.image}
              />
            ) : null}
            {total > 1 ? (
              <button type="button" className={styles.nav} aria-label="下一张" onClick={() => step(1)}>
                <Icon name="right" />
              </button>
            ) : null}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
