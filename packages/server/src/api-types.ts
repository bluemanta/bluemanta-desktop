/**
 * `/api/v1` 返回给网页的数据形状。网页（packages/web）直接引用这些类型。
 * 不含本机路径、数据目录和口令。
 */

export const API_VERSION = 1;

export type ApiSource = {
  kind: 'human' | 'agent';
  name: string;
};

export type IdeaCategory = 'product' | 'learning' | 'work' | 'life' | 'other';

export type IdeaSearchField = 'title' | 'body' | 'rawInput' | 'category';

export type IdeaRawInput =
  | { status: 'present'; channel: 'web' | 'bot' | 'agent'; text: string }
  | { status: 'legacy' };

/** 附件元数据。图片本体经 `url` 读取。 */
export type AttachmentMeta = {
  id: string;
  mime: string;
  byteSize: number;
  width: number | null;
  height: number | null;
  sha256: string;
  createdAt: string;
  /** 形如 `/api/v1/attachments/<id>`，同源请求，要带口令。 */
  url: string;
};

/** 延展（core 里叫追记 extensions）。 */
export type IdeaExtension = {
  id: string;
  text: string;
  createdAt: string;
};

export type IdeaRecord = {
  id: string;
  rev: number;
  createdAt: string;
  updatedAt: string;
  createdBy: ApiSource;
  updatedBy: ApiSource;
  /** 不在回收站时为 null。 */
  deletedAt: string | null;
  title: string;
  titleOrigin: 'user' | 'fallback';
  body: string;
  rawInput: IdeaRawInput;
  /** 详情里是否显示原文（idea-ui.md 第 3 节）。 */
  showRaw: boolean;
  starred: boolean;
  tags: string[];
  category: IdeaCategory;
  categorySource: 'auto' | 'user';
  captureGroupId: string | null;
  extensions: IdeaExtension[];
  attachmentIds: string[];
  /** 按 attachmentIds 的顺序；已不存在的附件不列出。 */
  attachments: AttachmentMeta[];
  /**
   * 人或 agent 改过标题、正文、分类或图片（操作历史里有 `card.update`）。
   * 收藏、延展、移入回收站和恢复不算。
   */
  edited: boolean;
};

export type IdeaMatch = {
  field: IdeaSearchField;
  excerpt: string;
};

export type IdeaListItem = IdeaRecord & {
  /** 只在带 `q` 搜索时出现。 */
  match?: IdeaMatch;
};

export type IdeaScope = 'active' | 'trash';

export type HealthResponse = {
  service: 'bluemanta';
  apiVersion: typeof API_VERSION;
  version: string;
};

export type IdeaListResponse = {
  ok: true;
  count: number;
  items: IdeaListItem[];
};

export type IdeaResponse = {
  ok: true;
  record: IdeaRecord;
};

/** 写入成功。`duplicate` 只在同一 requestId 重放时出现，此时没有重复写入，返回首次的结果。 */
export type IdeaWriteResponse = {
  ok: true;
  record: IdeaRecord;
  duplicate?: true;
};

export type PurgedIdea = {
  id: string;
};

/** 彻底删除后记录已不存在，`record` 只剩 id。 */
export type IdeaPurgeResponse = {
  ok: true;
  record: PurgedIdea;
  duplicate?: true;
};

export type AttachmentUploadResponse = {
  ok: true;
  record: AttachmentMeta;
  duplicate?: true;
};

export type ApiErrorCode =
  | 'invalid_input'
  | 'not_found'
  | 'version_conflict'
  | 'duplicate_request_mismatch'
  | 'forbidden_source'
  | 'unauthorized'
  | 'forbidden_host'
  | 'method_not_allowed'
  | 'internal';

export type ApiFailure = {
  ok: false;
  code: ApiErrorCode;
  message: string;
};

export type IdeaCreateRequest = {
  requestId: string;
  title?: string;
  body?: string;
  category?: IdeaCategory;
  attachmentIds?: string[];
};

export type IdeaUpdateRequest = {
  requestId: string;
  rev: number;
  title?: string;
  body?: string;
  category?: IdeaCategory;
  attachmentIds?: string[];
};

export type IdeaStarRequest = {
  requestId: string;
  rev: number;
  starred: boolean;
};

export type IdeaRevRequest = {
  requestId: string;
  rev: number;
};

export type ExtensionAddRequest = {
  requestId: string;
  rev: number;
  text: string;
};
