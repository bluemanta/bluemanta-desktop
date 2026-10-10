import type { DatabaseSync, SQLInputValue } from 'node:sqlite';
import { getRow, getRows, run, runOne } from './sql.js';
import type {
  Attachment,
  AttachmentListQuery,
  Card,
  CardExtension,
  CardListQuery,
  DeletedFilter,
  Envelope,
  HistoryEntry,
  HistoryListQuery,
  IdeaFields,
  Link,
  LinkListQuery,
  Project,
  ProjectListQuery,
  ProjectLocation,
  RawInput,
  Source,
  Task,
  TaskListQuery,
  TaskOrigin,
} from './types.js';

type EnvelopeRow = {
  id: string;
  module: string;
  rev: number;
  created_at: string;
  updated_at: string;
  created_by: string;
  updated_by: string;
  deleted_at: string | null;
};

type ProjectRow = EnvelopeRow & {
  title: string;
  area: string;
  status: Project['status'];
  pinned: number;
  data: string;
};

type TaskRow = EnvelopeRow & {
  title: string;
  status: Task['status'];
  project_id: string | null;
  priority: Task['priority'];
  due: string | null;
  blocked: number;
  data: string;
};

type CardRow = EnvelopeRow & {
  card_type: Card['cardType'];
  title: string;
  starred: number;
  project_id: string | null;
  data: string;
};

type LinkRow = EnvelopeRow & {
  from_id: string;
  to_id: string;
  rel: string;
};

type AttachmentRow = EnvelopeRow & {
  mime: string;
  byte_size: number;
  width: number | null;
  height: number | null;
  sha256: string;
  path: string;
};

type HistoryRow = {
  request_id: string;
  command: string;
  source: string;
  object_id: string;
  rev_before: number | null;
  rev_after: number | null;
  at: string;
};

type ProjectData = {
  background: string;
  positioning: string;
  locations: ProjectLocation[];
};

type TaskData = {
  blockedReason: string | null;
  origin: TaskOrigin | null;
  notes: string;
  ext: Record<string, unknown>;
};

type CardData = {
  body: string;
  rawInput: RawInput;
  tags: string[];
  attachmentIds: string[];
  extensions: CardExtension[];
  fields: IdeaFields | Record<string, never>;
};

function parseJson<T>(text: string): T {
  return JSON.parse(text) as T;
}

function toEnvelope(row: EnvelopeRow): Envelope {
  return {
    id: row.id,
    module: row.module,
    rev: row.rev,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    createdBy: parseJson<Source>(row.created_by),
    updatedBy: parseJson<Source>(row.updated_by),
    deletedAt: row.deleted_at,
  };
}

function appendDeleted(clauses: string[], deleted: DeletedFilter | undefined): void {
  const mode = deleted ?? 'active';
  if (mode === 'active') clauses.push('deleted_at IS NULL');
  else if (mode === 'trash') clauses.push('deleted_at IS NOT NULL');
  else if (mode !== 'all') throw new Error(`未知 deleted 筛选: ${String(deleted)}`);
}

function appendEquals(clauses: string[], params: SQLInputValue[], column: string, value: string | undefined): void {
  if (value === undefined) return;
  clauses.push(`${column} = ?`);
  params.push(value);
}

function appendNullableId(
  clauses: string[],
  params: SQLInputValue[],
  column: string,
  value: string | null | undefined,
): void {
  if (value === undefined) return;
  if (value === null) {
    clauses.push(`${column} IS NULL`);
    return;
  }
  clauses.push(`${column} = ?`);
  params.push(value);
}

function whereSql(clauses: string[]): string {
  return clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
}

function toProject(row: ProjectRow): Project {
  const data = parseJson<ProjectData>(row.data);
  return {
    ...toEnvelope(row),
    title: row.title,
    area: row.area,
    status: row.status,
    background: data.background,
    positioning: data.positioning,
    pinned: row.pinned === 1,
    locations: data.locations,
  };
}

function toTask(row: TaskRow): Task {
  const data = parseJson<TaskData>(row.data);
  return {
    ...toEnvelope(row),
    title: row.title,
    status: row.status,
    blocked: row.blocked === 1,
    blockedReason: data.blockedReason,
    projectId: row.project_id,
    due: row.due,
    priority: row.priority,
    origin: data.origin,
    notes: data.notes,
    ext: data.ext,
  };
}

function toCard(row: CardRow): Card {
  const data = parseJson<CardData>(row.data);
  const base = {
    ...toEnvelope(row),
    title: row.title,
    body: data.body,
    rawInput: data.rawInput,
    starred: row.starred === 1,
    tags: data.tags,
    attachmentIds: data.attachmentIds,
    extensions: data.extensions,
    projectId: row.project_id,
  };
  if (row.card_type === 'idea') return { ...base, cardType: 'idea', fields: data.fields as IdeaFields };
  if (row.card_type === 'scene') return { ...base, cardType: 'scene', fields: {} };
  if (row.card_type === 'note') return { ...base, cardType: 'note', fields: {} };
  throw new Error(`未知卡片类型: ${row.card_type}`);
}

function toAttachment(row: AttachmentRow): Attachment {
  return {
    ...toEnvelope(row),
    mime: row.mime,
    byteSize: row.byte_size,
    width: row.width,
    height: row.height,
    sha256: row.sha256,
    path: row.path,
  };
}

function toLink(row: LinkRow): Link {
  return {
    ...toEnvelope(row),
    from: row.from_id,
    to: row.to_id,
    rel: row.rel,
  };
}

function projectValues(project: Project): SQLInputValue[] {
  return [
    project.id,
    project.module,
    project.rev,
    project.createdAt,
    project.updatedAt,
    JSON.stringify(project.createdBy),
    JSON.stringify(project.updatedBy),
    project.deletedAt,
    project.title,
    project.area,
    project.status,
    project.pinned ? 1 : 0,
    JSON.stringify({
      background: project.background,
      positioning: project.positioning,
      locations: project.locations,
    }),
  ];
}

function taskValues(task: Task): SQLInputValue[] {
  return [
    task.id,
    task.module,
    task.rev,
    task.createdAt,
    task.updatedAt,
    JSON.stringify(task.createdBy),
    JSON.stringify(task.updatedBy),
    task.deletedAt,
    task.title,
    task.status,
    task.projectId,
    task.priority,
    task.due,
    task.blocked ? 1 : 0,
    JSON.stringify({
      blockedReason: task.blockedReason,
      origin: task.origin,
      notes: task.notes,
      ext: task.ext,
    }),
  ];
}

function cardValues(card: Card): SQLInputValue[] {
  return [
    card.id,
    card.module,
    card.rev,
    card.createdAt,
    card.updatedAt,
    JSON.stringify(card.createdBy),
    JSON.stringify(card.updatedBy),
    card.deletedAt,
    card.cardType,
    card.title,
    card.starred ? 1 : 0,
    card.projectId,
    JSON.stringify({
      body: card.body,
      rawInput: card.rawInput,
      tags: card.tags,
      attachmentIds: card.attachmentIds,
      extensions: card.extensions,
      fields: card.fields,
    }),
  ];
}

function linkValues(link: Link): SQLInputValue[] {
  return [
    link.id,
    link.module,
    link.rev,
    link.createdAt,
    link.updatedAt,
    JSON.stringify(link.createdBy),
    JSON.stringify(link.updatedBy),
    link.deletedAt,
    link.from,
    link.to,
    link.rel,
  ];
}

const PROJECT_COLUMNS = `id, module, rev, created_at, updated_at, created_by, updated_by, deleted_at, title, area, status, pinned, data`;
const TASK_COLUMNS = `id, module, rev, created_at, updated_at, created_by, updated_by, deleted_at, title, status, project_id, priority, due, blocked, data`;
const CARD_COLUMNS = `id, module, rev, created_at, updated_at, created_by, updated_by, deleted_at, card_type, title, starred, project_id, data`;
const LINK_COLUMNS = `id, module, rev, created_at, updated_at, created_by, updated_by, deleted_at, from_id, to_id, rel`;

export function getProject(db: DatabaseSync, id: string): Project | null {
  const row = getRow<ProjectRow>(db, 'SELECT * FROM projects WHERE id = ?', [id]);
  return row ? toProject(row) : null;
}

export function listProjects(db: DatabaseSync, query: ProjectListQuery = {}): Project[] {
  const clauses: string[] = [];
  const params: SQLInputValue[] = [];
  appendDeleted(clauses, query.deleted);
  appendEquals(clauses, params, 'area', query.area);
  appendEquals(clauses, params, 'status', query.status);
  const rows = getRows<ProjectRow>(
    db,
    `SELECT * FROM projects ${whereSql(clauses)} ORDER BY created_at ASC, id ASC`,
    params,
  );
  return rows.map((row) => toProject(row));
}

export function insertProject(db: DatabaseSync, project: Project): void {
  runOne(db, `INSERT INTO projects (${PROJECT_COLUMNS}) VALUES (${placeholders(13)})`, projectValues(project));
}

export function saveProject(db: DatabaseSync, project: Project): void {
  const values = projectValues(project);
  const id = values.shift();
  runOne(
    db,
    `UPDATE projects SET
      module = ?, rev = ?, created_at = ?, updated_at = ?, created_by = ?, updated_by = ?, deleted_at = ?,
      title = ?, area = ?, status = ?, pinned = ?, data = ?
     WHERE id = ?`,
    [...values, id ?? null],
  );
}

export function getTask(db: DatabaseSync, id: string): Task | null {
  const row = getRow<TaskRow>(db, 'SELECT * FROM tasks WHERE id = ?', [id]);
  return row ? toTask(row) : null;
}

export function listTasks(db: DatabaseSync, query: TaskListQuery = {}): Task[] {
  const clauses: string[] = [];
  const params: SQLInputValue[] = [];
  appendDeleted(clauses, query.deleted);
  appendNullableId(clauses, params, 'project_id', query.projectId);
  appendEquals(clauses, params, 'status', query.status);
  const rows = getRows<TaskRow>(
    db,
    `SELECT * FROM tasks ${whereSql(clauses)} ORDER BY created_at ASC, id ASC`,
    params,
  );
  return rows.map((row) => toTask(row));
}

export function insertTask(db: DatabaseSync, task: Task): void {
  runOne(db, `INSERT INTO tasks (${TASK_COLUMNS}) VALUES (${placeholders(15)})`, taskValues(task));
}

export function saveTask(db: DatabaseSync, task: Task): void {
  const values = taskValues(task);
  const id = values.shift();
  runOne(
    db,
    `UPDATE tasks SET
      module = ?, rev = ?, created_at = ?, updated_at = ?, created_by = ?, updated_by = ?, deleted_at = ?,
      title = ?, status = ?, project_id = ?, priority = ?, due = ?, blocked = ?, data = ?
     WHERE id = ?`,
    [...values, id ?? null],
  );
}

export function deleteTaskRow(db: DatabaseSync, id: string): void {
  runOne(db, 'DELETE FROM tasks WHERE id = ?', [id]);
}

export function getCard(db: DatabaseSync, id: string): Card | null {
  const row = getRow<CardRow>(db, 'SELECT * FROM cards WHERE id = ?', [id]);
  return row ? toCard(row) : null;
}

export function listCards(db: DatabaseSync, query: CardListQuery = {}): Card[] {
  const clauses: string[] = [];
  const params: SQLInputValue[] = [];
  appendDeleted(clauses, query.deleted);
  appendEquals(clauses, params, 'card_type', query.cardType);
  appendNullableId(clauses, params, 'project_id', query.projectId);
  if (query.starred !== undefined) {
    clauses.push('starred = ?');
    params.push(query.starred ? 1 : 0);
  }
  if (query.category !== undefined) {
    clauses.push(`json_extract(data, '$.fields.category') = ?`);
    params.push(query.category);
  }
  const rows = getRows<CardRow>(
    db,
    `SELECT * FROM cards ${whereSql(clauses)} ORDER BY created_at ASC, id ASC`,
    params,
  );
  return rows.map((row) => toCard(row));
}

export function insertCard(db: DatabaseSync, card: Card): void {
  runOne(db, `INSERT INTO cards (${CARD_COLUMNS}) VALUES (${placeholders(13)})`, cardValues(card));
}

export function saveCard(db: DatabaseSync, card: Card): void {
  const values = cardValues(card);
  const id = values.shift();
  runOne(
    db,
    `UPDATE cards SET
      module = ?, rev = ?, created_at = ?, updated_at = ?, created_by = ?, updated_by = ?, deleted_at = ?,
      card_type = ?, title = ?, starred = ?, project_id = ?, data = ?
     WHERE id = ?`,
    [...values, id ?? null],
  );
}

export function deleteCardRow(db: DatabaseSync, id: string): void {
  runOne(db, 'DELETE FROM cards WHERE id = ?', [id]);
}

export function getLink(db: DatabaseSync, id: string): Link | null {
  const row = getRow<LinkRow>(db, 'SELECT * FROM links WHERE id = ?', [id]);
  return row ? toLink(row) : null;
}

export function listLinks(db: DatabaseSync, query: LinkListQuery = {}): Link[] {
  const clauses: string[] = [];
  const params: SQLInputValue[] = [];
  appendDeleted(clauses, query.deleted);
  appendEquals(clauses, params, 'from_id', query.from);
  appendEquals(clauses, params, 'to_id', query.to);
  appendEquals(clauses, params, 'rel', query.rel);
  const rows = getRows<LinkRow>(
    db,
    `SELECT * FROM links ${whereSql(clauses)} ORDER BY created_at ASC, id ASC`,
    params,
  );
  return rows.map((row) => toLink(row));
}

export function insertLink(db: DatabaseSync, link: Link): void {
  runOne(db, `INSERT INTO links (${LINK_COLUMNS}) VALUES (${placeholders(11)})`, linkValues(link));
}

export function saveLink(db: DatabaseSync, link: Link): void {
  const values = linkValues(link);
  const id = values.shift();
  runOne(
    db,
    `UPDATE links SET
      module = ?, rev = ?, created_at = ?, updated_at = ?, created_by = ?, updated_by = ?, deleted_at = ?,
      from_id = ?, to_id = ?, rel = ?
     WHERE id = ?`,
    [...values, id ?? null],
  );
}

export function getAttachment(db: DatabaseSync, id: string): Attachment | null {
  const row = getRow<AttachmentRow>(db, 'SELECT * FROM attachments WHERE id = ?', [id]);
  return row ? toAttachment(row) : null;
}

export function listAttachments(db: DatabaseSync, query: AttachmentListQuery = {}): Attachment[] {
  const clauses: string[] = [];
  appendDeleted(clauses, query.deleted);
  const rows = getRows<AttachmentRow>(
    db,
    `SELECT * FROM attachments ${whereSql(clauses)} ORDER BY created_at ASC, id ASC`,
  );
  return rows.map((row) => toAttachment(row));
}

export function deleteLinksOf(db: DatabaseSync, objectId: string): void {
  run(db, 'DELETE FROM links WHERE from_id = ? OR to_id = ?', [objectId, objectId]);
}

export function listHistory(db: DatabaseSync, query: HistoryListQuery = {}): HistoryEntry[] {
  const params: SQLInputValue[] = [];
  const clauses: string[] = [];
  appendEquals(clauses, params, 'object_id', query.objectId);
  const rows = getRows<HistoryRow>(
    db,
    `SELECT request_id, command, source, object_id, rev_before, rev_after, at
     FROM history ${whereSql(clauses)} ORDER BY id ASC`,
    params,
  );
  return rows.map((row) => ({
    requestId: row.request_id,
    command: row.command,
    source: parseJson<Source>(row.source),
    objectId: row.object_id,
    revBefore: row.rev_before,
    revAfter: row.rev_after,
    at: row.at,
  }));
}

function placeholders(count: number): string {
  return Array.from({ length: count }, () => '?').join(', ');
}
