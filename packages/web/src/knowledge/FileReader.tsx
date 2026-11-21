import { useEffect, useMemo, useRef } from 'react';
import { describeError } from '../api/client';
import { Banner } from '../ui/Banner';
import { EmptyState } from '../ui/EmptyState';
import { Icon } from '../ui/Icon';
import { useKnowledgeFile } from './api';
import { Markdown, outline, scrollToHeading } from './Markdown';
import { categoryName, formatDate, formatSize, useCopyPath } from './shared';
import styles from './Knowledge.module.css';

type FileReaderProps = {
  library: string;
  path: string;
  /** Heading text to scroll to (the last heading of a search hit). */
  heading?: string | null;
  onOpen: (path: string, anchor?: string) => void;
  onTopic?: (topicPath: string) => void;
};

/** Reader for one library file (knowledge-ui §4): breadcrumbs, copy path, outline, Markdown or file facts. */
export function FileReader({ library, path, heading = null, onOpen, onTopic }: FileReaderProps) {
  const file = useKnowledgeFile(library, path);
  const copyPath = useCopyPath();
  const root = useRef<HTMLDivElement>(null);
  const data = file.data;
  const content = data?.file.kind === 'markdown' ? data.file.content ?? null : null;
  const headings = useMemo(() => (content === null ? [] : outline(content)), [content]);

  useEffect(() => {
    if (content === null || heading === null || !root.current) return;
    scrollToHeading(root.current, heading);
  }, [content, heading]);

  if (file.isPending) return <p className={styles.none}>正在读取…</p>;
  const error = file.isError ? (
    <div className={styles.notice}><Banner onRetry={() => void file.refetch()} retrying={file.isFetching}>
      读不到这个文件：{describeError(file.error)}{data ? `。以下是 ${new Date(file.dataUpdatedAt).toLocaleTimeString()} 读取的旧数据。` : ''}
    </Banner></div>
  ) : null;
  if (!data) {
    return <div className={styles.banner}>{error}</div>;
  }

  const segments = path.split('/');
  const personalOs = library === 'personalos';
  const domainName = segments[0] === '领域' ? segments[1] : segments[0] === '我' ? '我' : null;
  const domainPath = domainName ? `${segments[0] === '领域' ? `领域/${domainName}` : '我'}/状态.md` : null;
  const icloud = 'availability' in data.file && data.file.availability === 'icloud';
  const topicPath = segments.length >= 3 && /^\d{2}_/.test(segments[0] ?? '') ? `${segments[0]}/${segments[1]}` : null;

  return (
    <div ref={root} data-testid={personalOs ? 'personalos-reader' : 'knowledge-reader'}>
      {error}
      <nav className={styles.crumbs} aria-label="位置">
        <span>{data.library.name}</span>
        {personalOs ? (
          <>
            {domainName && domainPath ? <><span aria-hidden="true">/</span><button type="button" className={styles.linkButton} onClick={() => onOpen(domainPath)}>{domainName}</button></> : segments.length > 1 ? <><span aria-hidden="true">/</span><span>{segments[0]}</span></> : null}
            <span aria-hidden="true">/</span><span>{data.file.name}</span>
          </>
        ) : segments.length > 1 ? (
          <>
            <span aria-hidden="true">/</span>
            <span>{categoryName(segments[0] ?? '')}</span>
          </>
        ) : null}
        {!personalOs && topicPath && onTopic ? (
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
        {icloud ? null : <span>{formatSize(data.file.size)}</span>}
        {data.file.modifiedAt ? <span>修改于 {formatDate(data.file.modifiedAt)}</span> : null}
        {data.library.writable ? null : <span className={styles.tag}>只读</span>}
      </div>
      {icloud ? (
        <EmptyState icon="file" title="尚未从 iCloud 下载">
          请在访达中下载这个文件，再<button type="button" className={styles.linkButton} onClick={() => void file.refetch()}>重新读取</button>。
        </EmptyState>
      ) : data.file.kind === 'markdown' && content !== null ? (
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
                        scrollToHeading(root.current, item.id);
                      }}
                    >
                      {item.text}
                    </a>
                  </li>
                ))}
              </ol>
            </details>
          ) : null}
          <Markdown source={content} basePath={path} onOpen={onOpen} highlightTerms={personalOs ? ['待补充', '（推断）', '未核验'] : undefined} />
        </>
      ) : (
        <EmptyState icon="file" title="这个文件不能在网页里预览">
          用「复制路径」在访达里打开：{data.displayPath}
        </EmptyState>
      )}
    </div>
  );
}
