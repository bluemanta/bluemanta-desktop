import { ApiError, describeError } from '../../api/client';
import { useIdea } from '../../api/queries';
import { Banner } from '../../ui/Banner';
import { Button } from '../../ui/Button';
import { EmptyState } from '../../ui/EmptyState';
import { formatClock } from '../model/time';
import { IdeaDetail } from './IdeaDetail';
import styles from './IdeaDetailView.module.css';

/** 按 id 读取一条灵感并处理读取中、读取失败、不存在和已在回收站的情况。 */
export function IdeaDetailView({ id }: { id: string }) {
  const query = useIdea(id);

  if (query.data && query.data.deletedAt !== null) {
    return (
      <EmptyState icon="idea" title="这条灵感在回收站里">
        回收站里的灵感不在详情里打开。
      </EmptyState>
    );
  }

  if (query.data) {
    return (
      <>
        {query.isError ? (
          <div className={styles.banner}>
            <Banner onRetry={() => void query.refetch()} retrying={query.isFetching}>
              {query.isPlaceholderData
                ? '读取详情失败，显示的是清单里的内容。'
                : `读取失败，显示的是 ${formatClock(query.dataUpdatedAt)} 的内容。`}
              {describeError(query.error)}
            </Banner>
          </div>
        ) : null}
        <IdeaDetail record={query.data} />
      </>
    );
  }

  if (query.isError) {
    if (query.error instanceof ApiError && query.error.status === 404) {
      return (
        <EmptyState icon="idea" title="这条灵感不存在">
          可能已被彻底删除。
        </EmptyState>
      );
    }
    return (
      <EmptyState
        icon="alert"
        tone="danger"
        title="读取失败"
        action={
          <Button size="sm" onClick={() => void query.refetch()} disabled={query.isFetching}>
            重试
          </Button>
        }
      >
        {describeError(query.error)}
      </EmptyState>
    );
  }

  return (
    <div className={styles.skeleton} aria-busy="true" aria-label="正在读取详情">
      <span data-size="title" />
      <span data-size="meta" />
      <span data-size="line" />
      <span data-size="line" />
      <span data-size="short" />
    </div>
  );
}
