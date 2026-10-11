import type { IdeaListResponse, IdeaRecord, IdeaResponse } from '@bluemanta/server/api-types';
import { focusManager, keepPreviousData, QueryClient, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError, apiJson } from './client';

/** 外部写入（Grok Bot、MCP、agent）最多 30 秒内出现（idea-ui 第 11 节）。 */
export const REFRESH_MS = 30_000;

export const ideaKeys = {
  list: ['ideas', 'active'] as const,
  search: (query: string) => ['ideas', 'search', query] as const,
  detail: (id: string) => ['idea', id] as const,
};

export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 5_000,
        refetchOnWindowFocus: true,
        // 4xx 不重试；网络错误和 5xx 重试一次，尽快把失败说出来。
        retry: (count, error) => !(error instanceof ApiError && error.status >= 400 && error.status < 500) && count < 1,
        retryDelay: 600,
      },
    },
  });
}

/** TanStack Query 默认只听 visibilitychange；规格要求窗口重新获得焦点时也刷新。 */
export function listenWindowFocus(): void {
  focusManager.setEventListener((handleFocus) => {
    const onFocus = () => handleFocus(true);
    const onVisibility = () => handleFocus(document.visibilityState === 'visible');
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  });
}

export function useIdeaList() {
  return useQuery({
    queryKey: ideaKeys.list,
    queryFn: ({ signal }) => apiJson<IdeaListResponse>('/api/v1/ideas', { signal }),
    refetchInterval: REFRESH_MS,
  });
}

export function useIdeaSearch(query: string) {
  return useQuery({
    queryKey: ideaKeys.search(query),
    queryFn: ({ signal }) => apiJson<IdeaListResponse>(`/api/v1/ideas?q=${encodeURIComponent(query)}`, { signal }),
    enabled: query !== '',
    placeholderData: keepPreviousData,
    refetchInterval: REFRESH_MS,
  });
}

export function useIdea(id: string | null) {
  const client = useQueryClient();
  return useQuery<IdeaRecord>({
    queryKey: ideaKeys.detail(id ?? ''),
    queryFn: async ({ signal }) =>
      (await apiJson<IdeaResponse>(`/api/v1/ideas/${encodeURIComponent(id ?? '')}`, { signal })).record,
    enabled: id !== null,
    placeholderData: () =>
      id === null ? undefined : client.getQueryData<IdeaListResponse>(ideaKeys.list)?.items.find((item) => item.id === id),
    refetchInterval: REFRESH_MS,
  });
}
