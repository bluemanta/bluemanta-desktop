import type { IdeaRecord } from '@bluemanta/server/api-types';
import { useState } from 'react';
import { AuthImage } from '../../ui/AuthImage';
import { CategoryTag } from '../CategoryTag';
import { displayTitle } from '../model/listing';
import { sourceLabel } from '../model/sources';
import { formatFullTime } from '../model/time';
import { Lightbox } from './Lightbox';
import styles from './IdeaDetail.module.css';

/**
 * 只读详情，顺序：标题 → 元信息 → 正文 → 图片 → 原文 → 延展（idea-ui 第 3 节）。
 * 工具条与写操作在 T13、T15 加入。
 */
export function IdeaDetail({ record }: { record: IdeaRecord }) {
  const [viewing, setViewing] = useState<number | null>(null);
  const images = record.attachments;
  const raw = record.showRaw && record.rawInput.status === 'present' ? record.rawInput.text : null;

  return (
    <article className={styles.detail} aria-label={displayTitle(record.title)}>
      <h2 className={styles.title}>{displayTitle(record.title)}</h2>
      <div className={styles.meta}>
        <CategoryTag category={record.category} />
        <span>来源 {sourceLabel(record.createdBy)}</span>
        <time dateTime={record.createdAt}>{formatFullTime(record.createdAt)}</time>
      </div>

      {record.body.trim() !== '' ? <p className={styles.body}>{record.body}</p> : null}

      {images.length > 0 ? (
        <ul className={styles.images} aria-label={`图片 ${images.length} 张`}>
          {images.map((image, index) => (
            <li key={image.id}>
              <button
                type="button"
                className={styles.thumb}
                aria-label={`查看图片 ${index + 1}`}
                onClick={() => setViewing(index)}
              >
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

      <section aria-labelledby={`ext-${record.id}`}>
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
              </li>
            ))}
          </ol>
        )}
      </section>

      <Lightbox images={images} index={viewing} onIndexChange={setViewing} />
    </article>
  );
}
