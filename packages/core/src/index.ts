import './silence-sqlite.js';

export { Core } from './core.js';
export { UnsupportedSchemaError } from './errors.js';
export type { CommandErrorCode, CommandFailure, CommandResult, CommandSuccess } from './errors.js';
export { SCHEMA_VERSION } from './migrate.js';
export { defaultDataDir, openCore } from './open.js';
export type { OpenCoreOptions } from './open.js';
export type {
  Area,
  Attachment,
  AttachmentListQuery,
  Card,
  CardExtension,
  CardListQuery,
  CardSearchField,
  CardSearchHit,
  CardSearchOptions,
  CardType,
  CategorySource,
  DeletedFilter,
  Envelope,
  HistoryEntry,
  HistoryListQuery,
  IdeaCard,
  IdeaCategory,
  IdeaFields,
  Link,
  LinkListQuery,
  NoteCard,
  Project,
  ProjectListQuery,
  ProjectLocation,
  ProjectStatus,
  PurgedCard,
  PurgedRecord,
  RawInput,
  SceneCard,
  Source,
  SourceKind,
  Task,
  TaskListQuery,
  TaskOrigin,
  TaskPriority,
  TaskStatus,
  TitleOrigin,
} from './types.js';
export type {
  CardAddExtensionInput,
  CardCreateInput,
  CardDeleteExtensionInput,
  CardRevInput,
  CardSetStarInput,
  CardUpdateInput,
} from './commands/card.js';
export type { LinkCreateInput, LinkDeleteInput } from './commands/link.js';
export type { ProjectCreateInput, ProjectSetStatusInput, ProjectUpdateInput } from './commands/project.js';
export type { TaskCreateInput, TaskRevInput, TaskSetStatusInput, TaskUpdateInput } from './commands/task.js';
