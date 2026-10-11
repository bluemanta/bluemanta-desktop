import type { IdeaListItem } from '@bluemanta/server/api-types';
import { useState } from 'react';
import { describeError } from '../api/client';
import { useTrashList } from '../api/queries';
import { Shell } from '../shell/Shell';
import { Button } from '../ui/Button';
import { EmptyState } from '../ui/EmptyState';
import { useConfirm } from '../ui/ConfirmDialog';
import { CategoryTag } from './CategoryTag';
import { useIdeaCommands } from './commands';
import { displayTitle, excerptOf } from './model/listing';
import { formatListTime } from './model/time';
import styles from './TrashPage.module.css';

function useNow(): number {
  const [now] = useState(() => Date.now());
  return now;
}

export function TrashPage() {
  return (
    <Shell section="trash">
      <TrashList />
    </Shell>
  );
}

function TrashList() {
  const query = useTrashList();
  const now = useNow();
  const items = query.data?.items ?? [];

  if (query.isPending && !query.data) {
    return <p className={styles.status}>正在读取回收站…</p>;
  }
  if (!query.data) {
    return (
      <EmptyState
        icon="alert"
        tone="danger"
        title="读取失败"
        action={
          <Button size="sm" onClick={() => void query.refetch()}>
            重试
          </Button>
        }
      >
        {describeError(query.error)}
      </EmptyState>
    );
  }
  if (items.length === 0) {
    return (
      <EmptyState icon="idea" title="回收站是空的">
        移入回收站的灵感会保留在这里，直到你彻底删除。
      </EmptyState>
    );
  }

  return (
    <div className={styles.list} role="list" aria-label="回收站">
      <div className={styles.group}>
        <span>回收站</span>
        <span className={styles.count}>{items.length}</span>
        <span className={styles.note}>· 彻底删除前会一直保留</span>
      </div>
      {query.isError ? (
        <p className={styles.error} role="alert">
          读取失败，显示的是已有内容。{describeError(query.error)}
        </p>
      ) : null}
      {items.map((item) => (
        <TrashRow key={item.id} item={item} nowMs={now} />
      ))}
    </div>
  );
}

function TrashRow({ item, nowMs }: { item: IdeaListItem; nowMs: number }) {
  const { restore, purge } = useIdeaCommands();
  const confirm = useConfirm();
  const [error, setError] = useState<string | null>(null);
  const title = displayTitle(item.title);
  const when = item.deletedAt ?? item.updatedAt;

  const onPurge = async () => {
    const ok = await confirm({
      title: '彻底删除这条灵感？',
      description: `「${title}」将被永久删除，图片和延展会一并删除，无法恢复。`,
      confirmLabel: '彻底删除',
      cancelLabel: '取消',
      danger: true,
    });
    if (!ok) return;
    setError(await purge(item));
  };

  return (
    <div className={styles.row} role="listitem">
      <span className={styles.title} title={title}>
        {title}
      </span>
      <span className={styles.excerpt}>{excerptOf(item)}</span>
      <CategoryTag category={item.category} />
      <time dateTime={when}>{formatListTime(when, nowMs)}</time>
      <Button size="sm" onClick={() => void restore(item).then(setError)}>
        恢复
      </Button>
      <Button size="sm" variant="danger" onClick={() => void onPurge()}>
        彻底删除
      </Button>
      {error ? (
        <p className={styles.error} role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
