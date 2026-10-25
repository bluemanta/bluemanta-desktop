/**
 * `/api/v1` 返回给网页的数据形状。网页（packages/web）直接引用这些类型。
 * 灵感接口不含本机路径、数据目录和口令。Skill 台是本机模块，路径仅用于显示且 home 缩写为 `~`。
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

export type SkillInstallStatus = 'ok' | 'broken' | 'missing' | 'not-link' | 'pending' | 'external' | 'unmanaged' | 'disabled';

export type SkillTarget = {
  tool: string;
  path: string;
  status: SkillInstallStatus;
  reason?: string;
  expectedSource?: string;
  actualTarget?: string;
};

export type SkillContentIssue = {
  code: 'source-missing' | 'skill-file-missing' | 'frontmatter' | 'name-mismatch';
  message: string;
  path: string;
  line?: number;
};

export type SkillFrontmatter = {
  name: string;
  description: string;
  whenToUse?: string;
  metadata?: unknown;
  disableModelInvocation: boolean;
  userInvocable: boolean;
  raw: Readonly<Record<string, unknown>>;
};

export type SkillSummary = {
  name: string;
  managed: boolean;
  source: string | null;
  displayName?: string;
  visibility?: string;
  lifecycle?: string;
  scope?: string;
  targets: readonly SkillTarget[];
  contentIssues: readonly SkillContentIssue[];
  frontmatter?: SkillFrontmatter;
  hasContentIssues: boolean;
};

export type DshSkill = {
  name: string;
  path: string;
  root: string;
  source: 'custom' | 'user-dsh' | 'user-agents';
  rank: number;
  frontmatter: SkillFrontmatter;
};

export type DshView = {
  loaded: readonly DshSkill[];
  overrides: readonly { name: string; winner: DshSkill; overridden: readonly DshSkill[] }[];
  issues: readonly SkillContentIssue[];
};

export type SkillListResponse = {
  ok: true;
  manifestPath: string;
  checkedAt: string;
  count: number;
  skills: readonly SkillSummary[];
  unmanaged: readonly SkillSummary[];
  dsh: DshView;
};

export type SkillDetailResponse = {
  ok: true;
  checkedAt: string;
  skill: SkillSummary & {
    notes: readonly string[];
    body: string;
    skillFile: string;
    files: readonly string[];
  };
};

export type SkillIssueItem = {
  kind: 'installation' | 'content' | 'dsh-override' | 'dsh-content';
  code: SkillInstallStatus | SkillContentIssue['code'] | 'overridden';
  message: string;
  skill: string;
  path?: string;
  tool?: string;
  line?: number;
  suggestion: string;
  command?: string;
};

export type SkillIssueGroup = {
  code: SkillIssueItem['code'];
  count: number;
  issues: readonly SkillIssueItem[];
};

export type SkillIssuesResponse = {
  ok: true;
  checkedAt: string;
  count: number;
  groups: readonly SkillIssueGroup[];
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
  | 'skill_manifest_missing'
  | 'skill_manifest_parse_error'
  | 'skill_manifest_invalid'
  | 'skill_read_error'
  | 'internal';

export type ApiFailure = {
  ok: false;
  code: ApiErrorCode;
  message: string;
  /** Skill 读取错误才有；路径中的 home 已缩写为 `~`。 */
  path?: string;
  reason?: string;
  line?: number;
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
