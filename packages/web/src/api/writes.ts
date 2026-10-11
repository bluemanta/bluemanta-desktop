import type {
  AttachmentMeta,
  AttachmentUploadResponse,
  IdeaCreateRequest,
  IdeaPurgeResponse,
  IdeaRecord,
  IdeaResponse,
  IdeaRevRequest,
  IdeaStarRequest,
  IdeaUpdateRequest,
  IdeaWriteResponse,
} from '@bluemanta/server/api-types';
import type { QueryClient } from '@tanstack/react-query';
import { ApiError, apiJson, auth } from './client';
import { applyIdeaRecord, applyPurged } from './cache';

const remembered = new Map<string, { hash: string; id: string }>();

/** 同一内容和版本的失败重试沿用同一个 requestId；内容变了就换新的。 */
export function idempotencyId(scope: string, hash: string): string {
  const current = remembered.get(scope);
  if (current?.hash === hash) return current.id;
  const id = crypto.randomUUID();
  remembered.set(scope, { hash, id });
  return id;
}

export function clearIdempotency(scope: string): void {
  remembered.delete(scope);
}

async function send<T>(path: string, method: string, body: unknown): Promise<T> {
  return apiJson<T>(path, {
    method,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

type BeforeApply = (record: IdeaRecord) => void;

async function written(
  client: QueryClient,
  path: string,
  method: string,
  body: unknown,
  scope: string,
  beforeApply?: BeforeApply,
): Promise<IdeaRecord> {
  const response = await send<IdeaWriteResponse>(path, method, body);
  clearIdempotency(scope);
  // 先推进编辑中的 baseRev，再写入缓存，避免自己的写入被当成外部冲突。
  beforeApply?.(response.record);
  await applyIdeaRecord(client, response.record);
  return response.record;
}

export async function createIdea(client: QueryClient, input: IdeaCreateRequest): Promise<IdeaRecord> {
  const response = await send<IdeaWriteResponse>('/api/v1/ideas', 'POST', input);
  await applyIdeaRecord(client, response.record);
  return response.record;
}

export async function updateIdea(client: QueryClient, id: string, input: IdeaUpdateRequest): Promise<IdeaRecord> {
  return written(client, `/api/v1/ideas/${encodeURIComponent(id)}`, 'PATCH', input, `update:${id}`);
}

export async function starIdea(client: QueryClient, id: string, input: IdeaStarRequest, beforeApply?: BeforeApply): Promise<IdeaRecord> {
  return written(client, `/api/v1/ideas/${encodeURIComponent(id)}/star`, 'PUT', input, `star:${id}`, beforeApply);
}

export async function trashIdea(client: QueryClient, id: string, input: IdeaRevRequest): Promise<IdeaRecord> {
  return written(client, `/api/v1/ideas/${encodeURIComponent(id)}/trash`, 'POST', input, `trash:${id}`);
}

export async function restoreIdea(client: QueryClient, id: string, input: IdeaRevRequest): Promise<IdeaRecord> {
  return written(client, `/api/v1/ideas/${encodeURIComponent(id)}/restore`, 'POST', input, `restore:${id}`);
}

export async function purgeIdea(client: QueryClient, id: string, input: IdeaRevRequest): Promise<void> {
  await send<IdeaPurgeResponse>(`/api/v1/ideas/${encodeURIComponent(id)}/purge`, 'POST', input);
  clearIdempotency(`purge:${id}`);
  await applyPurged(client, id);
}

export async function addExtension(
  client: QueryClient,
  id: string,
  input: IdeaRevRequest & { text: string },
  beforeApply?: BeforeApply,
): Promise<IdeaRecord> {
  return written(client, `/api/v1/ideas/${encodeURIComponent(id)}/extensions`, 'POST', input, `ext:${id}`, beforeApply);
}

export async function deleteExtension(
  client: QueryClient,
  id: string,
  extensionId: string,
  input: IdeaRevRequest,
  beforeApply?: BeforeApply,
): Promise<IdeaRecord> {
  return written(
    client,
    `/api/v1/ideas/${encodeURIComponent(id)}/extensions/${encodeURIComponent(extensionId)}`,
    'DELETE',
    input,
    `ext-del:${id}:${extensionId}`,
    beforeApply,
  );
}

export async function reloadIdea(client: QueryClient, id: string): Promise<IdeaRecord> {
  const response = await apiJson<IdeaResponse>(`/api/v1/ideas/${encodeURIComponent(id)}`);
  await applyIdeaRecord(client, response.record);
  return response.record;
}

export function isVersionConflict(error: unknown): boolean {
  return error instanceof ApiError && error.status === 409 && error.code === 'version_conflict';
}

type UploadHandlers = {
  onProgress: (ratio: number) => void;
};

/** 带上传进度。失败重试时沿用调用方传入的 requestId。 */
export function uploadAttachment(file: File, requestId: string, handlers: UploadHandlers): Promise<AttachmentMeta> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const name = file.name.trim() === '' ? 'image.png' : file.name;
    const url = `/api/v1/attachments?requestId=${encodeURIComponent(requestId)}&name=${encodeURIComponent(name)}`;
    xhr.open('POST', url);
    const token = auth.getToken();
    if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`);
    if (file.type) xhr.setRequestHeader('Content-Type', file.type);
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable && event.total > 0) handlers.onProgress(event.loaded / event.total);
    };
    xhr.onerror = () => reject(new ApiError(0, 'network', '本地服务没有响应'));
    xhr.onabort = () => reject(new DOMException('上传已取消', 'AbortError'));
    xhr.onload = () => {
      let payload: Partial<AttachmentUploadResponse> & { message?: string; code?: ApiError['code'] } = {};
      try {
        payload = JSON.parse(xhr.responseText) as typeof payload;
      } catch {
        // 非 JSON 时用状态码。
      }
      if (xhr.status >= 200 && xhr.status < 300 && payload.record) {
        resolve(payload.record);
        return;
      }
      if (xhr.status === 401) auth.reject();
      reject(new ApiError(xhr.status, payload.code ?? 'bad_response', payload.message || `服务返回 ${xhr.status}`));
    };
    xhr.send(file);
  });
}
