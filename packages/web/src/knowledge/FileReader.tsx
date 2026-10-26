import { useEffect, useMemo, useRef } from 'react';
import { describeError } from '../api/client';
import { Banner } from '../ui/Banner';
import { EmptyState } from '../ui/EmptyState';
import { Icon } from '../ui/Icon';
import { useKnowledgeFile } from './api';
import { Markdown, outline } from './Markdown';
import { categoryName, formatDate, formatSize, useCopyPath } from './shared';
import styles from './Knowledge.module.css';

type FileReaderProps = {
  library: string;
  path: string;
  /** Heading text to scroll to (the last heading of a search hit). */
  heading?: string | null;
  onOpen: (path: string) => void;
  onTopic?: (topicPath: string) => void;
};

/** Reader for one library file (knowledge-ui §4): breadcrumbs, copy path, outline, Markdown or file facts. */
export function FileReader({ library, path, heading = null, onOpen, onTopic }: FileReaderProps) {
  const file = useKnowledgeFile(library, path);
  const copyPath = useCopyPath();
  const root = useRef<HTMLDivElement>(null);
  const data = file.data;
  const content = data?.file.kind === 'markdown' ? data.file.content : null;
  const headings = useMemo(() => (content === null ? [] : outline(content)), [content]);

  useEffect(() => {
    if (content === null || heading === null || !root.current) return;
    const target = [...root.current.querySelectorAll<HTMLElement>('[data-heading]')].find((element) => element.dataset.heading === heading);
    if (!target) return;
    target.scrollIntoView({ block: 'start' });
    target.dataset.flash = 'true';
    const timer = window.setTimeout(() => delete target.dataset.flash, 1600);
    return () => window.clearTimeout(timer);
  }, [content, heading]);

  if (file.isPending) return <p className={styles.none}>正在读取…</p>;
  if (file.isError || !data) {
    return (
      <div className={styles.banner}>
        <Banner onRetry={() => void file.refetch()} retrying={file.isFetching}>
          读不到这个文件：{describeError(file.error)}
        </Banner>
      </div>
    );
  }

  const segments = path.split('/');
  const topicPath = segments.length >= 3 && /^\d{2}_/.test(segments[0] ?? '') ? `${segments[0]}/${segments[1]}` : null;

  return (
    <div ref={root} data-testid="knowledge-reader">
      <nav className={styles.crumbs} aria-label="位置">
        <span>{data.library.name}</span>
        {segments.length > 1 ? (
          <>
            <span aria-hidden="true">/</span>
            <span>{categoryName(segments[0] ?? '')}</span>
          </>
        ) : null}
        {topicPath && onTopic ? (
          <>
            <span aria-hidden="true">/</span>
            <button type="button" className={styles.linkButton} onClick={() => onTopic(topicPath)}>
              {segments[1]}
            </button>
          </>
        ) : null}
      </nav>
      <div className={styles.readerHead}>
        <h2 className={styles.detailTitle}>{data.file.name}</h2>
        <button type="button" className={styles.iconButton} onClick={() => copyPath(data.displayPath)} title={data.displayPath}>
          <Icon name="copy" />
          复制路径
        </button>
      </div>
      <div className={styles.meta}>
        <span>{formatSize(data.file.size)}</span>
        <span>修改于 {formatDate(data.file.modifiedAt)}</span>
        {data.library.writable ? null : <span className={styles.tag}>只读</span>}
      </div>
      {data.file.kind === 'markdown' ? (
        <>
          {data.file.truncated ? <p className={styles.notice}>文件超过 1 MB，只显示了前面一部分。</p> : null}
          {headings.length >= 4 ? (
            <details className={styles.outline}>
              <summary>目录（{headings.length}）</summary>
              <ol>
                {headings.map((item) => (
                  <li key={item.id} data-level={item.level}>
                    <a
                      href={`#${item.id}`}
                      onClick={(event) => {
                        event.preventDefault();
                        root.current?.querySelector(`#${item.id}`)?.scrollIntoView({ block: 'start' });
                      }}
                    >
                      {item.text}
                    </a>
                  </li>
                ))}
              </ol>
            </details>
          ) : null}
          <Markdown source={data.file.content} basePath={path} onOpen={onOpen} />
        </>
      ) : (
        <EmptyState icon="file" title="这个文件不能在网页里预览">
          用「复制路径」在访达里打开：{data.displayPath}
        </EmptyState>
      )}
    </div>
  );
}
