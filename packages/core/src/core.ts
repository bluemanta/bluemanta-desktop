import type { DatabaseSync } from 'node:sqlite';
import { listAreas } from './areas.js';
import {
  addCardExtension,
  createCard,
  deleteCard,
  deleteCardExtension,
  purgeCard,
  restoreCard,
  setCardStar,
  updateCard,
  type CardAddExtensionInput,
  type CardCreateInput,
  type CardDeleteExtensionInput,
  type CardRevInput,
  type CardSetStarInput,
  type CardUpdateInput,
} from './commands/card.js';
import {
  createLink,
  deleteLink,
  type LinkCreateInput,
  type LinkDeleteInput,
} from './commands/link.js';
import {
  createProject,
  setProjectStatus,
  updateProject,
  type ProjectCreateInput,
  type ProjectSetStatusInput,
  type ProjectUpdateInput,
} from './commands/project.js';
import {
  createTask,
  deleteTask,
  purgeTask,
  restoreTask,
  setTaskStatus,
  updateTask,
  type TaskCreateInput,
  type TaskRevInput,
  type TaskSetStatusInput,
  type TaskUpdateInput,
} from './commands/task.js';
import {
  getAttachment,
  getCard,
  getLink,
  getProject,
  getTask,
  listAttachments,
  listCards,
  listHistory,
  listLinks,
  listProjects,
  listTasks,
} from './rows.js';
import { searchCardRecords } from './search.js';
import type {
  Area,
  Attachment,
  AttachmentListQuery,
  Card,
  CardListQuery,
  CardSearchHit,
  CardSearchOptions,
  HistoryEntry,
  HistoryListQuery,
  Link,
  LinkListQuery,
  Project,
  ProjectListQuery,
  PurgedCard,
  Task,
  TaskListQuery,
} from './types.js';
import type { CommandResult } from './errors.js';
import { getRow } from './sql.js';

export class Core {
  readonly project: {
    create: (input: ProjectCreateInput) => CommandResult<Project>;
    update: (input: ProjectUpdateInput) => CommandResult<Project>;
    setStatus: (input: ProjectSetStatusInput) => CommandResult<Project>;
  };

  readonly task: {
    create: (input: TaskCreateInput) => CommandResult<Task>;
    update: (input: TaskUpdateInput) => CommandResult<Task>;
    setStatus: (input: TaskSetStatusInput) => CommandResult<Task>;
    delete: (input: TaskRevInput) => CommandResult<Task>;
    restore: (input: TaskRevInput) => CommandResult<Task>;
    purge: (input: TaskRevInput) => CommandResult<{ id: string }>;
  };

  readonly card: {
    create: (input: CardCreateInput) => CommandResult<Card>;
    update: (input: CardUpdateInput) => CommandResult<Card>;
    delete: (input: CardRevInput) => CommandResult<Card>;
    restore: (input: CardRevInput) => CommandResult<Card>;
    purge: (input: CardRevInput) => CommandResult<PurgedCard>;
    setStar: (input: CardSetStarInput) => CommandResult<Card>;
    addExtension: (input: CardAddExtensionInput) => CommandResult<Card>;
    deleteExtension: (input: CardDeleteExtensionInput) => CommandResult<Card>;
  };

  readonly link: {
    create: (input: LinkCreateInput) => CommandResult<Link>;
    delete: (input: LinkDeleteInput) => CommandResult<Link>;
  };

  constructor(
    private readonly db: DatabaseSync,
    readonly dataDir: string,
    readonly dbPath: string,
  ) {
    this.project = {
      create: (input) => createProject(this.db, input),
      update: (input) => updateProject(this.db, input),
      setStatus: (input) => setProjectStatus(this.db, input),
    };
    this.task = {
      create: (input) => createTask(this.db, input),
      update: (input) => updateTask(this.db, input),
      setStatus: (input) => setTaskStatus(this.db, input),
      delete: (input) => deleteTask(this.db, input),
      restore: (input) => restoreTask(this.db, input),
      purge: (input) => purgeTask(this.db, input),
    };
    this.card = {
      create: (input) => createCard(this.db, input),
      update: (input) => updateCard(this.db, input),
      delete: (input) => deleteCard(this.db, input),
      restore: (input) => restoreCard(this.db, input),
      purge: (input) => purgeCard(this.db, input),
      setStar: (input) => setCardStar(this.db, input),
      addExtension: (input) => addCardExtension(this.db, input),
      deleteExtension: (input) => deleteCardExtension(this.db, input),
    };
    this.link = {
      create: (input) => createLink(this.db, input),
      delete: (input) => deleteLink(this.db, input),
    };
  }

  close(): void {
    this.db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
    this.db.close();
  }

  get schemaVersion(): number {
    const row = getRow<{ version: number }>(this.db, 'SELECT version FROM schema_meta WHERE id = 1');
    if (!row) throw new Error('数据库缺少 schema 版本');
    return Number(row.version);
  }

  listAreas(): Area[] {
    return listAreas(this.db);
  }

  getProject(id: string): Project | null {
    return getProject(this.db, id);
  }

  listProjects(query?: ProjectListQuery): Project[] {
    return listProjects(this.db, query);
  }

  getTask(id: string): Task | null {
    return getTask(this.db, id);
  }

  listTasks(query?: TaskListQuery): Task[] {
    return listTasks(this.db, query);
  }

  getCard(id: string): Card | null {
    return getCard(this.db, id);
  }

  listCards(query?: CardListQuery): Card[] {
    return listCards(this.db, query);
  }

  searchCards(query: string, options: CardSearchOptions = {}): CardSearchHit[] {
    const cards = listCards(this.db, {
      ...(options.cardType === undefined ? {} : { cardType: options.cardType }),
      deleted: options.deleted ?? 'active',
    });
    return searchCardRecords(cards, query);
  }

  getLink(id: string): Link | null {
    return getLink(this.db, id);
  }

  getAttachment(id: string): Attachment | null {
    return getAttachment(this.db, id);
  }

  listAttachments(query?: AttachmentListQuery): Attachment[] {
    return listAttachments(this.db, query);
  }

  listLinks(query?: LinkListQuery): Link[] {
    return listLinks(this.db, query);
  }

  listHistory(query?: HistoryListQuery): HistoryEntry[] {
    return listHistory(this.db, query);
  }
}
