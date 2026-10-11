import './silence-sqlite.js';

export {
  UNREFERENCED_ATTACHMENT_TTL_MS,
  unreferencedAttachmentCutoff,
} from './attachment-gc.js';
export { cleanupStaleAttachments, discardPurgedAttachments } from './attachment-files.js';
export type { AttachmentCleanupGateway, PurgedAttachmentGateway } from './attachment-files.js';
export { DEFAULT_AREAS } from './areas.js';
export { readLimitedBody } from './body.js';
export { DESKTOP_SOURCE, statusForCommandCode } from './desktop.js';
export { checkImageBytes, readImageUpload } from './image-upload.js';
export type { CheckedImageUpload, ImageUploadMeta, RejectedImageUpload } from './image-upload.js';
export { imageWithinLimits, parseImage } from './images.js';
export type { ParsedImage } from './images.js';
export { readStoredFile, removeStoredFile, resolveStoredFile, writeStoredFile } from './media.js';
export { foldSpace, shouldShowRaw } from './raw-text.js';
export { Core } from './core.js';
export { UnsupportedSchemaError } from './errors.js';
export type { CommandErrorCode, CommandFailure, CommandResult, CommandSuccess } from './errors.js';
export { readImportLedger, WORKBENCH_SOURCE_SYSTEM } from './import-sources.js';
export type { ImportSourceRecord, ImportSourceType } from './import-sources.js';
export {
  validateImportAttachment,
  validateImportEntry,
  validateImportIdea,
  validateImportProject,
  workbenchImportRequestId,
} from './importer.js';
export type { ImportAttachmentInput, ImportEntryInput, ImportIdeaInput, ImportProjectInput } from './importer.js';
export { SCHEMA_VERSION } from './migrate.js';
export { defaultDataDir, openCore } from './open.js';
export type { OpenCoreOptions } from './open.js';
export { fallbackTitleFromBody } from './titles.js';
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
export {
  IMAGE_EXTENSION,
  IMAGE_MIME,
  MAX_IMAGE_BYTES,
  MAX_IMAGE_EDGE,
} from './commands/attachment.js';
export type { AttachmentCreateInput, ImageMime } from './commands/attachment.js';
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
