import type { ApiErrorCode, ApiFailure } from '@bluemanta/server/api-types';

/** 接口只走同源相对路径，端口由托管网页的本地服务决定。 */
export const API_BASE = '/api/v1';

export class ApiError extends Error {
  readonly status: number;
  readonly code: ApiErrorCode | 'network' | 'bad_response';

  constructor(status: number, code: ApiError['code'], message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }

  get unauthorized(): boolean {
    return this.status === 401;
  }
}

type AuthListener = () => void;

/** 口令只在内存和 localStorage 里；401 后标记失效，整页显示「需要重新打开」。 */
class AuthState {
  private token: string | null = null;
  private rejected = false;
  private readonly listeners = new Set<AuthListener>();

  setToken(token: string | null): void {
    this.token = token;
    this.rejected = false;
    this.emit();
  }

  getToken(): string | null {
    return this.token;
  }

  isRejected(): boolean {
    return this.rejected;
  }

  reject(): void {
    if (this.rejected) return;
    this.rejected = true;
    this.emit();
  }

  subscribe(listener: AuthListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(): void {
    for (const listener of this.listeners) listener();
  }
}

export const auth = new AuthState();

function authHeaders(): HeadersInit {
  const token = auth.getToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function failureFrom(response: Response): Promise<ApiError> {
  let message = `服务返回 ${response.status}`;
  let code: ApiError['code'] = 'bad_response';
  try {
    const body = (await response.json()) as Partial<ApiFailure>;
    if (typeof body.message === 'string' && body.message !== '') message = body.message;
    if (typeof body.code === 'string') code = body.code;
  } catch {
    // 返回体不是 JSON 时保留状态码说明。
  }
  return new ApiError(response.status, code, message);
}

/** 带口令请求接口，返回原始 Response；失败时抛 ApiError。 */
export async function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  let response: Response;
  try {
    response = await fetch(path.startsWith('/') ? path : `${API_BASE}/${path}`, {
      ...init,
      headers: { ...authHeaders(), ...init.headers },
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    throw new ApiError(0, 'network', '本地服务没有响应');
  }
  if (!response.ok) {
    const failure = await failureFrom(response);
    if (failure.unauthorized) auth.reject();
    throw failure;
  }
  return response;
}

export async function apiJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await apiFetch(path, init);
  try {
    return (await response.json()) as T;
  } catch {
    throw new ApiError(response.status, 'bad_response', '服务返回的内容无法解析');
  }
}

export function describeError(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  if (error instanceof Error && error.message !== '') return error.message;
  return '未知错误';
}
