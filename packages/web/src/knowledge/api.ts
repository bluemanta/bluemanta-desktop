import type {
  KnowledgeFileResponse,
  PersonalOsOverviewResponse,
  PersonalOsTodayResponse,
  PersonalOsDomainResponse,
  PersonalOsFileResponse,
  PersonalOsRegistryResponse,
  PersonalOsLogResponse,
  KnowledgeInboxResponse,
  KnowledgeIndexResponse,
  KnowledgeLibrariesResponse,
  KnowledgeSearchResponse,
  KnowledgeTopicResponse,
} from '@bluemanta/server/api-types';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { apiJson } from '../api/client';
import { DEFAULT_LIBRARY, encodePath } from './paths';

/** Knowledge files change by hand, not every few seconds; refetch on focus and after 30 s. */
const STALE_MS = 30_000;

export const knowledgeKeys = {
  libraries: ['knowledge', 'libraries'] as const,
  index: (library: string) => ['knowledge', 'index', library] as const,
  topic: (library: string, path: string) => ['knowledge', 'topic', library, path] as const,
  file: (library: string, path: string) => ['knowledge', 'file', library, path] as const,
  inbox: (library: string) => ['knowledge', 'inbox', library] as const,
  search: (query: string) => ['knowledge', 'search', query] as const,
};

const lib = (library: string) => `/api/v1/knowledge/libraries/${encodeURIComponent(library)}`;

export function useKnowledgeLibraries() {
  return useQuery({
    queryKey: knowledgeKeys.libraries,
    queryFn: ({ signal }) => apiJson<KnowledgeLibrariesResponse>('/api/v1/knowledge/libraries', { signal }),
    staleTime: STALE_MS,
  });
}

/** Sidebar count: files waiting in the personal library's `_Inbox`. */
export function useKnowledgeInboxCount(): number | undefined {
  const count = useKnowledgeLibraries().data?.libraries.find((item) => item.id === DEFAULT_LIBRARY)?.inboxCount;
  return count === 0 ? undefined : count;
}

export function useKnowledgeIndex(library: string) {
  return useQuery({
    queryKey: knowledgeKeys.index(library),
    queryFn: ({ signal }) => apiJson<KnowledgeIndexResponse>(lib(library), { signal }),
    staleTime: STALE_MS,
    placeholderData: keepPreviousData,
  });
}

export function useKnowledgeTopic(library: string, path: string | null) {
  return useQuery({
    queryKey: knowledgeKeys.topic(library, path ?? ''),
    queryFn: ({ signal }) => apiJson<KnowledgeTopicResponse>(`${lib(library)}/topics/${encodePath(path ?? '')}`, { signal }),
    enabled: path !== null && path !== '',
    staleTime: STALE_MS,
  });
}

export function useKnowledgeFile(library: string, path: string | null) {
  return useQuery({
    queryKey: knowledgeKeys.file(library, path ?? ''),
    queryFn: ({ signal }) => apiJson<KnowledgeFileResponse | PersonalOsFileResponse>(library === 'personalos' ? `/api/v1/personalos/files/${encodePath(path ?? '')}` : `${lib(library)}/files/${encodePath(path ?? '')}`, { signal }),
    enabled: path !== null && path !== '',
    staleTime: STALE_MS,
  });
}

export function useKnowledgeInbox(library: string = DEFAULT_LIBRARY) {
  return useQuery({
    queryKey: knowledgeKeys.inbox(library),
    queryFn: ({ signal }) => apiJson<KnowledgeInboxResponse>(`${lib(library)}/inbox`, { signal }),
    staleTime: STALE_MS,
  });
}

export function useKnowledgeSearch(query: string) {
  const trimmed = query.trim();
  return useQuery({
    queryKey: knowledgeKeys.search(trimmed),
    queryFn: ({ signal }) => apiJson<KnowledgeSearchResponse>(`/api/v1/knowledge/search?q=${encodeURIComponent(trimmed)}&limit=50&library=personalos&library=arsenal&ideas=1`, { signal }),
    enabled: trimmed !== '',
    staleTime: 10_000,
    placeholderData: keepPreviousData,
  });
}


export const personalOsKeys = {
  overview: ['personalos', 'overview'] as const,
  today: ['personalos', 'today'] as const,
  domain: (id: string) => ['personalos', 'domain', id] as const,
  registry: ['personalos', 'registry'] as const,
  log: (domains: readonly string[], before: string | null, includeUnassigned = false) => ['personalos', 'log', [...domains].sort(), before, includeUnassigned] as const,
};

export function usePersonalOsOverview() {
  return useQuery({
    queryKey: personalOsKeys.overview,
    queryFn: ({ signal }) => apiJson<PersonalOsOverviewResponse>('/api/v1/personalos', { signal }),
    staleTime: STALE_MS,
  });
}

export function usePersonalOsToday() {
  return useQuery({
    queryKey: personalOsKeys.today,
    queryFn: ({ signal }) => apiJson<PersonalOsTodayResponse>('/api/v1/personalos/today', { signal }),
    staleTime: STALE_MS,
  });
}

export function usePersonalOsDomain(id: string | null) {
  return useQuery({
    queryKey: personalOsKeys.domain(id ?? ''),
    queryFn: ({ signal }) => apiJson<PersonalOsDomainResponse>(`/api/v1/personalos/domains/${encodeURIComponent(id ?? '')}`, { signal }),
    enabled: id !== null && id !== '',
    staleTime: STALE_MS,
  });
}

export function usePersonalOsFile(path: string | null) {
  return useQuery({
    queryKey: knowledgeKeys.file('personalos', path ?? ''),
    queryFn: ({ signal }) => apiJson<PersonalOsFileResponse>(`/api/v1/personalos/files/${encodePath(path ?? '')}`, { signal }),
    enabled: path !== null && path !== '',
    staleTime: STALE_MS,
  });
}

export function usePersonalOsDueCount(): number | undefined {
  const data = usePersonalOsToday().data;
  const count = data ? data.overdue.length + data.dueToday.length : undefined;
  return count === 0 ? undefined : count;
}

export function usePersonalOsRegistry() {
  return useQuery({
    queryKey: personalOsKeys.registry,
    queryFn: ({ signal }) => apiJson<PersonalOsRegistryResponse>('/api/v1/personalos/registry', { signal }),
    staleTime: STALE_MS,
  });
}

export function usePersonalOsLog(domains: readonly string[], before?: string | null, includeUnassigned = false) {
  const params = new URLSearchParams({ days: '30' });
  for (const domain of [...domains].sort()) params.append('domain', domain);
  if (before) params.set('before', before);
  if (includeUnassigned) params.set('unassigned', '1');
  return useQuery({
    queryKey: personalOsKeys.log(domains, before ?? null, includeUnassigned),
    queryFn: ({ signal }) => apiJson<PersonalOsLogResponse>(`/api/v1/personalos/log?${params}`, { signal }),
    staleTime: STALE_MS,
  });
}
