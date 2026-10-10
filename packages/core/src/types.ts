export type SourceKind = 'human' | 'agent';

export type Source = {
  kind: SourceKind;
  name: string;
};

/** 每条记录都带的元字段。见对象模型第 2 节。 */
export type Envelope = {
  id: string;
  module: string;
  rev: number;
  createdAt: string;
  updatedAt: string;
  createdBy: Source;
  updatedBy: Source;
  deletedAt: string | null;
};

export type Area = {
  id: string;
  name: string;
  role: string;
  description: string;
};

export type ProjectStatus = 'active' | 'paused' | 'done' | 'archived';

export type ProjectLocation = {
  label?: string;
  path?: string;
  url?: string;
};

export type Project = Envelope & {
  title: string;
  area: string;
  status: ProjectStatus;
  background: string;
  positioning: string;
  pinned: boolean;
  locations: ProjectLocation[];
};

export type TaskStatus = 'todo' | 'doing' | 'done' | 'canceled';

export type TaskPriority = 'high' | 'normal' | 'low';

export type TaskOrigin = {
  module: string;
  objectId: string;
};

export type Task = Envelope & {
  title: string;
  status: TaskStatus;
  blocked: boolean;
  blockedReason: string | null;
  projectId: string | null;
  due: string | null;
  priority: TaskPriority | null;
  origin: TaskOrigin | null;
  notes: string;
  ext: Record<string, unknown>;
};

export type CardType = 'idea' | 'scene' | 'note';

export type TitleOrigin = 'user' | 'fallback';

export type IdeaCategory = 'product' | 'learning' | 'work' | 'life' | 'other';

export type CategorySource = 'auto' | 'user';

export type IdeaFields = {
  category: IdeaCategory;
  categorySource: CategorySource;
  captureGroupId: string | null;
};

export type RawInput =
  | { status: 'present'; channel: 'web' | 'bot' | 'agent'; text: string }
  | { status: 'legacy' };

export type CardExtension = {
  id: string;
  body: string;
  createdAt: string;
};

type CardBase = Envelope & {
  title: string;
  titleOrigin: TitleOrigin;
  body: string;
  rawInput: RawInput;
  starred: boolean;
  tags: string[];
  attachmentIds: string[];
  extensions: CardExtension[];
  projectId: string | null;
};

export type IdeaCard = CardBase & {
  cardType: 'idea';
  fields: IdeaFields;
};

export type SceneCard = CardBase & {
  cardType: 'scene';
  fields: Record<string, never>;
};

export type NoteCard = CardBase & {
  cardType: 'note';
  fields: Record<string, never>;
};

export type Card = IdeaCard | SceneCard | NoteCard;

/** 附件只有元数据。本任务不提供写入命令，文件本体不进库。 */
export type Attachment = Envelope & {
  mime: string;
  byteSize: number;
  width: number | null;
  height: number | null;
  sha256: string;
  path: string;
};

export type Link = Envelope & {
  from: string;
  to: string;
  rel: string;
};

export type PurgedRecord = {
  id: string;
};

/** 彻底删除卡片时带回附件 id，供调用方清理文件。文件本身不在 core 里删。 */
export type PurgedCard = {
  id: string;
  attachmentIds: string[];
};

export type CardSearchField = 'title' | 'body' | 'rawInput' | 'category';

export type CardSearchHit = {
  card: Card;
  field: CardSearchField;
  excerpt: string;
};

export type CardSearchOptions = {
  cardType?: CardType;
  /** 默认 `active`，不含回收站。 */
  deleted?: DeletedFilter;
};

export type HistoryEntry = {
  requestId: string;
  command: string;
  source: Source;
  objectId: string | null;
  revBefore: number | null;
  revAfter: number | null;
  at: string;
};

export type DeletedFilter = 'active' | 'trash' | 'all';

export type ProjectListQuery = {
  area?: string;
  status?: ProjectStatus;
  deleted?: DeletedFilter;
};

export type TaskListQuery = {
  projectId?: string | null;
  status?: TaskStatus;
  deleted?: DeletedFilter;
};

export type CardListQuery = {
  cardType?: CardType;
  projectId?: string | null;
  starred?: boolean;
  category?: IdeaCategory;
  deleted?: DeletedFilter;
};

export type LinkListQuery = {
  from?: string;
  to?: string;
  rel?: string;
  deleted?: DeletedFilter;
};

export type AttachmentListQuery = {
  deleted?: DeletedFilter;
};

export type HistoryListQuery = {
  objectId?: string;
};
