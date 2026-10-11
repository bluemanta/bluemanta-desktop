import type { IdeaListItem, IdeaListResponse, IdeaRecord } from '@bluemanta/server/api-types';
import type { QueryClient } from '@tanstack/react-query';
import { ideaKeys } from './queries';

function insert(items: IdeaListItem[], record: IdeaRecord, scope: 'active' | 'trash'): IdeaListItem[] {
  const key = (item: { id: string; createdAt: string; deletedAt: string | null }) =>
    scope === 'trash' ? (item.deletedAt ?? '') : item.createdAt;
  const next = items.filter((item) => item.id !== record.id);
  const rank = key(record);
  const index = next.findIndex((item) => {
    const other = key(item);
    if (other !== rank) return other < rank;
    return item.id < record.id;
  });
  const prev = items.find((item) => item.id === record.id);
  const merged: IdeaListItem = prev?.match ? { ...record, match: prev.match } : record;
  if (index === -1) next.push(merged);
  else next.splice(index, 0, merged);
  return next;
}

function writeList(current: IdeaListResponse | undefined, record: IdeaRecord, scope: 'active' | 'trash'): IdeaListResponse | undefined {
  if (!current) return current;
  const belongs = scope === 'trash' ? record.deletedAt !== null : record.deletedAt === null;
  const items = belongs ? insert(current.items, record, scope) : current.items.filter((item) => item.id !== record.id);
  return { ok: true, count: items.length, items };
}

function dropId(current: IdeaListResponse | undefined, id: string): IdeaListResponse | undefined {
  if (!current) return current;
  const items = current.items.filter((item) => item.id !== id);
  return { ok: true, count: items.length, items };
}

/** 用写入返回的记录更新详情、清单、回收站和已打开的搜索缓存，不整表重载。 */
export async function applyIdeaRecord(client: QueryClient, record: IdeaRecord): Promise<void> {
  await client.cancelQueries({ queryKey: ['ideas'] });
  await client.cancelQueries({ queryKey: ideaKeys.detail(record.id) });
  client.setQueryData(ideaKeys.detail(record.id), record);
  client.setQueryData<IdeaListResponse>(ideaKeys.list, (current) => writeList(current, record, 'active'));
  client.setQueryData<IdeaListResponse>(ideaKeys.trash, (current) => writeList(current, record, 'trash'));
  client.setQueriesData<IdeaListResponse>({ queryKey: ['ideas', 'search'] }, (current) => {
    if (!current) return current;
    if (record.deletedAt !== null) return dropId(current, record.id);
    const items = current.items.map((item) => (item.id === record.id ? { ...record, match: item.match } : item));
    return { ...current, items };
  });
}

export async function applyPurged(client: QueryClient, id: string): Promise<void> {
  await client.cancelQueries({ queryKey: ['ideas'] });
  client.removeQueries({ queryKey: ideaKeys.detail(id) });
  client.setQueryData<IdeaListResponse>(ideaKeys.list, (current) => dropId(current, id));
  client.setQueryData<IdeaListResponse>(ideaKeys.trash, (current) => dropId(current, id));
  client.setQueriesData<IdeaListResponse>({ queryKey: ['ideas', 'search'] }, (current) => dropId(current, id));
}
