import type { IdeaListItem } from '@bluemanta/server/api-types';
import { useEffect, useId, useRef } from 'react';
import { Icon } from '../ui/Icon';
import { CategoryTag } from './CategoryTag';
import { Highlight } from './Highlight';
import { displayTitle, excerptOf, matchLabel, type ListSection } from './model/listing';
import { sourceLabel } from './model/sources';
import { formatListTime } from './model/time';
import styles from './IdeaList.module.css';

type IdeaListProps = {
  sections: ListSection[];
  query: string;
  selectedId: string | null;
  nowMs: number;
  onOpen: (id: string, scrollTop: number) => void;
  /** 进入时恢复的滚动位置（窄屏从整页详情返回）。 */
  restoreScroll: number | null;
  onRestored: () => void;
};

export function IdeaList({ sections, query, selectedId, nowMs, onOpen, restoreScroll, onRestored }: IdeaListProps) {
  const scroller = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (restoreScroll === null || sections.length === 0 || !scroller.current) return;
    scroller.current.scrollTop = restoreScroll;
    onRestored();
  }, [restoreScroll, sections.length, onRestored]);

  const open = (id: string) => onOpen(id, scroller.current?.scrollTop ?? 0);

  return (
    <div ref={scroller} className={styles.list} role="listbox" aria-label="灵感清单">
      {sections.map((section) => (
        <Section key={section.key} section={section} query={query} selectedId={selectedId} nowMs={nowMs} onOpen={open} />
      ))}
    </div>
  );
}

function Section({
  section,
  query,
  selectedId,
  nowMs,
  onOpen,
}: {
  section: ListSection;
  query: string;
  selectedId: string | null;
  nowMs: number;
  onOpen: (id: string) => void;
}) {
  const headingId = useId();
  return (
    <div role="group" aria-labelledby={headingId} data-section={section.key}>
      <div className={styles.group} role="presentation">
        <span id={headingId}>{section.label}</span>
        <span className={styles.groupCount}>{section.items.length}</span>
      </div>
      {section.items.map((item) => (
        <IdeaRow key={item.id} item={item} query={query} selected={item.id === selectedId} nowMs={nowMs} onOpen={onOpen} />
      ))}
    </div>
  );
}

function IdeaRow({
  item,
  query,
  selected,
  nowMs,
  onOpen,
}: {
  item: IdeaListItem;
  query: string;
  selected: boolean;
  nowMs: number;
  onOpen: (id: string) => void;
}) {
  const title = displayTitle(item.title);
  const hit = query ? matchLabel(item) : null;
  const images = item.attachments.length;
  const extensions = item.extensions.length;
  return (
    <div
      className={styles.row}
      role="option"
      aria-selected={selected}
      tabIndex={0}
      data-id={item.id}
      onClick={() => onOpen(item.id)}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          onOpen(item.id);
        }
      }}
    >
      <span
        className={styles.star}
        data-on={item.starred}
        role="img"
        aria-label={item.starred ? '已收藏' : '未收藏'}
      >
        {item.starred ? '★' : '☆'}
      </span>
      <span className={styles.title} title={title}>
        <Highlight text={title} query={query} />
      </span>
      {images > 0 ? (
        <span className={styles.count} aria-label={`${images} 张图片`}>
          <Icon name="image" />
          {images}
        </span>
      ) : null}
      {extensions > 0 ? (
        <span className={styles.count} aria-label={`${extensions} 条延展`}>
          <Icon name="extension" />
          {extensions}
        </span>
      ) : null}
      <span className={styles.excerpt}>
        <Highlight text={excerptOf(item)} query={query} />
      </span>
      {hit ? <span className={styles.hit}>{hit}</span> : null}
      <CategoryTag category={item.category} className={styles.category} />
      <span className={styles.source}>{sourceLabel(item.createdBy)}</span>
      <time className={styles.time} dateTime={item.createdAt}>
        {formatListTime(item.createdAt, nowMs)}
      </time>
    </div>
  );
}

export function IdeaListSkeleton() {
  return (
    <div className={styles.list} aria-busy="true" aria-label="正在读取灵感">
      <div className={styles.group} role="presentation">
        <span className={styles.skeletonBar} data-size="group" />
      </div>
      {Array.from({ length: 8 }, (_, index) => (
        <div key={index} className={styles.row} data-skeleton="true">
          <span className={styles.skeletonBar} data-size="star" />
          <span className={styles.skeletonBar} data-size={index % 2 === 0 ? 'title' : 'title-short'} />
          <span className={styles.skeletonBar} data-size="excerpt" />
          <span className={styles.skeletonBar} data-size="time" />
        </div>
      ))}
    </div>
  );
}
