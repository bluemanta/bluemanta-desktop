import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { isAbsolute, join, resolve, sep } from 'node:path';
import { fallbackTitleFromBody, type ImportAttachmentInput, type ImportEntryInput, type ImportIdeaInput, type ImportProjectInput, type Source } from '@bluemanta/core';

export type ProjectAreaConfig = {
  projectArea: Record<string, string>;
};

export type WorkbenchStore = {
  projects: Record<string, unknown>[];
  entries: Record<string, unknown>[];
  ideas: Record<string, unknown>[];
};

export type ReadyProject = {
  kind: 'ready';
  sourceId: string;
  reportTitle: string;
  updatedAt: string;
  input: ImportProjectInput;
};

export type ReadyEntry = {
  kind: 'ready';
  sourceId: string;
  reportTitle: string;
  updatedAt: string;
  projectSourceId: string;
  input: Omit<ImportEntryInput, 'projectId'>;
};

export type ReadyIdea = {
  kind: 'ready';
  sourceId: string;
  reportTitle: string;
  updatedAt: string;
  input: Omit<ImportIdeaInput, 'attachmentIds'>;
  attachments: unknown[];
};

export type Mapped<T> = T | { kind: 'demo'; sourceId: string; reportTitle: string } | InvalidRecord;

export type InvalidRecord = {
  kind: 'invalid';
  sourceId: string;
  reportTitle: string;
  reason: string;
};

export type PlannedAttachment = {
  sourceId: string;
  reportTitle: string;
  input: ImportAttachmentInput;
  sourceFile: string;
};

const LEGACY_SOURCE: Source = { kind: 'human', name: 'legacy_unknown' };
const MEDIA_PARTS = ['media', 'inspiration-desk', 'inspiration_desk'] as const;

export function loadConfig(text: string): ProjectAreaConfig {
  const parsed = JSON.parse(text) as unknown;
  if (!isRecord(parsed)) throw new Error('配置文件必须是 JSON 对象');
  const extra = Object.keys(parsed).filter((key) => key !== 'projectArea');
  if (extra.length > 0) throw new Error(`配置含未知字段：${extra.join('、')}`);
  const projectArea: Record<string, string> = {};
  const rawMap = parsed.projectArea;
  if (rawMap === undefined) return { projectArea };
  if (!isRecord(rawMap)) throw new Error('projectArea 必须是对象');
  for (const [key, value] of Object.entries(rawMap)) {
    if (key.length === 0 || typeof value !== 'string' || value.length === 0) {
      throw new Error('projectArea 的键和值都必须是非空字符串');
    }
    projectArea[key] = value;
  }
  return { projectArea };
}

export function parseWorkbench(text: string): WorkbenchStore {
  const parsed = JSON.parse(text) as unknown;
  if (!isRecord(parsed)) throw new Error('store.json 必须是 JSON 对象');
  const desk = readPath(parsed, ['module_data', 'inspiration-desk', 'inspiration_desk']);
  if (!isRecord(desk)) throw new Error('缺少 module_data.inspiration-desk.inspiration_desk');
  if (desk.schema_version !== 6) throw new Error('仅支持 inspiration desk schema 6');
  const data = isRecord(desk.data) ? desk.data : null;
  if (!data || !Array.isArray(data.ideas)) throw new Error('缺少 data.ideas');
  return {
    projects: expectRecords(parsed.projects, 'projects'),
    entries: expectRecords(parsed.entries, 'entries'),
    ideas: expectRecords(data.ideas, 'ideas'),
  };
}

export function reportTitle(value: unknown): string {
  if (typeof value !== 'string') return '（无标题）';
  const collapsed = value.replace(/\s+/gu, ' ').trim();
  if (collapsed === '') return '（无标题）';
  const chars = Array.from(collapsed);
  return chars.length <= 80 ? collapsed : chars.slice(0, 80).join('');
}

export function mapProject(
  value: Record<string, unknown>,
  config: ProjectAreaConfig,
  areaIds: ReadonlySet<string>,
): Mapped<ReadyProject> {
  const sourceId = readId(value);
  const title = reportTitle(value.title);
  if (!sourceId) return invalid('（缺少 id）', title, '缺少 id');
  if (value.demo === true) return { kind: 'demo', sourceId, reportTitle: title };
  const times = readSnakeTimes(value);
  if (!times.ok) return invalid(sourceId, title, times.reason);
  const actor = readActor(value.source, LEGACY_SOURCE);
  if (!actor.ok) return invalid(sourceId, title, actor.reason);
  const area = resolveArea(sourceId, value.category, config, areaIds);
  if (typeof area !== 'string') return invalid(sourceId, title, area.reason);
  if (typeof value.title !== 'string' || value.title.length === 0) return invalid(sourceId, title, '标题为空');
  const input: ImportProjectInput = {
    sourceId,
    sourceUpdatedAt: times.updatedAt,
    raw: value,
    createdAt: times.createdAt,
    updatedAt: times.updatedAt,
    createdBy: actor.source,
    updatedBy: actor.source,
    title: value.title,
    area,
    status: value.archived === true ? 'archived' : 'active',
    background: typeof value.background === 'string' ? value.background : '',
    positioning: buildPositioning(value),
    pinned: value.pinned === true,
  };
  return { kind: 'ready', sourceId, reportTitle: title, updatedAt: times.updatedAt, input };
}

export function mapEntry(value: Record<string, unknown>): Mapped<ReadyEntry> {
  const sourceId = readId(value);
  const title = reportTitle(value.title);
  if (!sourceId) return invalid('（缺少 id）', title, '缺少 id');
  if (value.demo === true) return { kind: 'demo', sourceId, reportTitle: title };
  const projectSourceId = typeof value.project_id === 'string' ? value.project_id : '';
  if (!projectSourceId) return invalid(sourceId, title, '缺少 project_id');
  const times = readSnakeTimes(value);
  if (!times.ok) return invalid(sourceId, title, times.reason);
  const actor = readActor(value.source, LEGACY_SOURCE);
  if (!actor.ok) return invalid(sourceId, title, actor.reason);
  if (value.body !== undefined && typeof value.body !== 'string') return invalid(sourceId, title, '正文格式不正确');
  const body = typeof value.body === 'string' ? value.body : '';
  const storedTitle =
    typeof value.title === 'string' && value.title !== ''
      ? { title: value.title, titleOrigin: 'user' as const }
      : { title: fallbackTitleFromBody(body), titleOrigin: 'fallback' as const };
  const input: Omit<ImportEntryInput, 'projectId'> = {
    sourceId,
    sourceUpdatedAt: times.updatedAt,
    raw: value,
    createdAt: times.createdAt,
    updatedAt: times.updatedAt,
    createdBy: actor.source,
    updatedBy: actor.source,
    title: storedTitle.title,
    titleOrigin: storedTitle.titleOrigin,
    body,
  };
  return { kind: 'ready', sourceId, reportTitle: title, updatedAt: times.updatedAt, projectSourceId, input };
}

export function mapIdea(value: Record<string, unknown>): Mapped<ReadyIdea> {
  const sourceId = readId(value);
  const title = reportTitle(value.title);
  if (!sourceId) return invalid('（缺少 id）', title, '缺少 id');
  const createdAt = readIsoField(value.createdAt, 'createdAt');
  if (!createdAt.ok) return invalid(sourceId, title, createdAt.reason);
  const updatedAt = readIsoField(value.updatedAt, 'updatedAt');
  if (!updatedAt.ok) return invalid(sourceId, title, updatedAt.reason);
  const createdBy = readActor(value.createdSource, LEGACY_SOURCE);
  if (!createdBy.ok) return invalid(sourceId, title, createdBy.reason);
  const updatedBy = readActor(value.updatedSource ?? value.createdSource, createdBy.source);
  if (!updatedBy.ok) return invalid(sourceId, title, updatedBy.reason);
  if (value.title !== undefined && typeof value.title !== 'string') return invalid(sourceId, title, '标题格式不正确');
  if (value.text !== undefined && typeof value.text !== 'string') return invalid(sourceId, title, '正文格式不正确');
  const storedTitle = typeof value.title === 'string' ? value.title : '';
  const titleOrigin = readTitleOrigin(value.titleOrigin, storedTitle);
  if (!titleOrigin.ok) return invalid(sourceId, title, titleOrigin.reason);
  const rawInput = mapRawInput(value.rawInput);
  if (!rawInput.ok) return invalid(sourceId, title, rawInput.reason);
  const category = readEnum(value.category, ['product', 'learning', 'work', 'life', 'other'] as const, '分类');
  if (!category.ok) return invalid(sourceId, title, category.reason);
  const categorySource = readEnum(value.categorySource, ['auto', 'user'] as const, '分类来源');
  if (!categorySource.ok) return invalid(sourceId, title, categorySource.reason);
  const captureGroupId = readCaptureGroup(value.captureGroupId);
  if (!captureGroupId.ok) return invalid(sourceId, title, captureGroupId.reason);
  const deletedAt = readDeletedAt(value.deletedAt);
  if (!deletedAt.ok) return invalid(sourceId, title, deletedAt.reason);
  const extensions = readExtensions(value.extensions);
  if (!extensions.ok) return invalid(sourceId, title, extensions.reason);
  if (value.attachments !== undefined && !Array.isArray(value.attachments)) {
    return invalid(sourceId, title, '附件格式不正确');
  }
  const input: Omit<ImportIdeaInput, 'attachmentIds'> = {
    sourceId,
    sourceUpdatedAt: updatedAt.value,
    raw: value,
    createdAt: createdAt.value,
    updatedAt: updatedAt.value,
    createdBy: createdBy.source,
    updatedBy: updatedBy.source,
    title: storedTitle,
    titleOrigin: titleOrigin.value,
    body: typeof value.text === 'string' ? value.text : '',
    rawInput: rawInput.value,
    category: category.value,
    categorySource: categorySource.value,
    captureGroupId: captureGroupId.value,
    starred: value.starred === true,
    deletedAt: deletedAt.value,
    extensions: extensions.value,
  };
  return {
    kind: 'ready',
    sourceId,
    reportTitle: title,
    updatedAt: updatedAt.value,
    input,
    attachments: Array.isArray(value.attachments) ? value.attachments : [],
  };
}

export function planAttachment(
  storeDir: string,
  value: unknown,
  times: { createdAt: string; updatedAt: string; sourceUpdatedAt: string },
  actors: { createdBy: Source; updatedBy: Source },
): { ok: true; plan: PlannedAttachment } | { ok: false; sourceId: string; reportTitle: string; reason: string } {
  if (!isRecord(value)) return { ok: false, sourceId: '（缺少 id）', reportTitle: '（无标题）', reason: '附件格式不正确' };
  const sourceId = readId(value);
  const label = sourceId ?? '（缺少 id）';
  if (!sourceId) return { ok: false, sourceId: label, reportTitle: label, reason: '缺少附件 id' };
  if (!/^[A-Za-z0-9_-]+$/.test(sourceId)) {
    return { ok: false, sourceId, reportTitle: sourceId, reason: '附件 id 不正确' };
  }
  if (typeof value.path !== 'string' || value.path.length === 0) {
    return { ok: false, sourceId, reportTitle: sourceId, reason: '缺少附件路径' };
  }
  const sourceFile = resolveInside(storeDir, value.path);
  if (!sourceFile) return { ok: false, sourceId, reportTitle: sourceId, reason: '附件路径无效' };
  let fileBytes: Buffer;
  try {
    fileBytes = readFileSync(sourceFile);
  } catch {
    return { ok: false, sourceId, reportTitle: sourceId, reason: '附件文件缺失' };
  }
  const expected = readSidecarSha256(storeDir, sourceId);
  if (!expected) return { ok: false, sourceId, reportTitle: sourceId, reason: '缺少 sha256 元数据' };
  const actual = createHash('sha256').update(fileBytes).digest('hex');
  if (actual.toLowerCase() !== expected.toLowerCase()) {
    return { ok: false, sourceId, reportTitle: sourceId, reason: 'sha256 不一致' };
  }
  if (typeof value.byteSize !== 'number' || !Number.isInteger(value.byteSize) || value.byteSize !== fileBytes.length) {
    return { ok: false, sourceId, reportTitle: sourceId, reason: 'byteSize 与文件不一致' };
  }
  const width = readDimension(value.width, 'width');
  if (!width.ok) return { ok: false, sourceId, reportTitle: sourceId, reason: width.reason };
  const height = readDimension(value.height, 'height');
  if (!height.ok) return { ok: false, sourceId, reportTitle: sourceId, reason: height.reason };
  if (typeof value.mime !== 'string') return { ok: false, sourceId, reportTitle: sourceId, reason: '缺少 mime' };
  const input: ImportAttachmentInput = {
    sourceId,
    sourceUpdatedAt: times.sourceUpdatedAt,
    raw: value,
    createdAt: times.createdAt,
    updatedAt: times.updatedAt,
    createdBy: actors.createdBy,
    updatedBy: actors.updatedBy,
    mime: value.mime as ImportAttachmentInput['mime'],
    byteSize: value.byteSize,
    width: width.value,
    height: height.value,
    sha256: actual,
  };
  return { ok: true, plan: { sourceId, reportTitle: sourceId, input, sourceFile } };
}

function invalid(sourceId: string, reportTitle: string, reason: string): InvalidRecord {
  return { kind: 'invalid', sourceId, reportTitle, reason };
}

function buildPositioning(value: Record<string, unknown>): string {
  const parts: string[] = [];
  const initial = presentText(value.initial_positioning);
  const current = presentText(value.current_positioning);
  const status = presentText(value.status);
  if (initial) parts.push(`初始定位：${initial}`);
  if (current) parts.push(`当前定位：${current}`);
  if (status) parts.push(`当前说明：${status}`);
  return parts.join('\n\n');
}

function presentText(value: unknown): string {
  if (typeof value !== 'string' || value.trim() === '') return '';
  return value;
}

function resolveArea(
  sourceId: string,
  category: unknown,
  config: ProjectAreaConfig,
  areaIds: ReadonlySet<string>,
): string | { reason: string } {
  const mapped = config.projectArea[sourceId];
  const area = mapped ?? (category === 'learning' ? 'growth' : category === 'project' ? 'product' : undefined);
  if (!area) return { reason: '无法确定领域' };
  if (!areaIds.has(area)) return { reason: `未知领域 id：${area}` };
  return area;
}

function readSnakeTimes(value: Record<string, unknown>): { ok: true; createdAt: string; updatedAt: string } | { ok: false; reason: string } {
  const createdAt = readIsoField(value.created_at, 'created_at');
  if (!createdAt.ok) return createdAt;
  const updatedRaw = value.updated_at === undefined ? value.created_at : value.updated_at;
  const updatedAt = readIsoField(updatedRaw, 'updated_at');
  if (!updatedAt.ok) return updatedAt;
  return { ok: true, createdAt: createdAt.value, updatedAt: updatedAt.value };
}

function readIsoField(value: unknown, field: string): { ok: true; value: string } | { ok: false; reason: string } {
  if (typeof value !== 'string' || value.length === 0) return { ok: false, reason: `${field} 缺失` };
  return { ok: true, value };
}

function readActor(value: unknown, missing: Source): { ok: true; source: Source } | { ok: false; reason: string } {
  if (value === undefined || value === null) return { ok: true, source: missing };
  if (!isRecord(value) || (value.kind !== 'human' && value.kind !== 'agent') || typeof value.name !== 'string' || value.name.length === 0) {
    return { ok: false, reason: '来源格式不正确' };
  }
  return { ok: true, source: { kind: value.kind, name: value.name } };
}

function readTitleOrigin(
  value: unknown,
  title: string,
): { ok: true; value: 'user' | 'fallback' } | { ok: false; reason: string } {
  if (value === undefined) return { ok: true, value: title === '' ? 'fallback' : 'user' };
  if (value === 'user' || value === 'fallback') return { ok: true, value };
  return { ok: false, reason: 'titleOrigin 不正确' };
}

function mapRawInput(value: unknown): { ok: true; value: ImportIdeaInput['rawInput'] } | { ok: false; reason: string } {
  if (!isRecord(value)) return { ok: false, reason: 'rawInput 无法映射' };
  if (value.status === 'legacy') return { ok: true, value: { status: 'legacy' } };
  if (value.status === 'present' && (value.kind === 'web' || value.kind === 'bot') && typeof value.text === 'string') {
    return { ok: true, value: { status: 'present', channel: value.kind, text: value.text } };
  }
  return { ok: false, reason: 'rawInput 无法映射' };
}

function readEnum<T extends string>(
  value: unknown,
  allowed: readonly T[],
  label: string,
): { ok: true; value: T } | { ok: false; reason: string } {
  if (typeof value === 'string' && (allowed as readonly string[]).includes(value)) {
    return { ok: true, value: value as T };
  }
  return { ok: false, reason: `${label}不正确` };
}

function readCaptureGroup(value: unknown): { ok: true; value: string | null } | { ok: false; reason: string } {
  if (value === undefined || value === null) return { ok: true, value: null };
  if (typeof value === 'string' && value.length > 0) return { ok: true, value };
  return { ok: false, reason: 'captureGroupId 不正确' };
}

function readDeletedAt(value: unknown): { ok: true; value: string | null } | { ok: false; reason: string } {
  if (value === undefined || value === null) return { ok: true, value: null };
  if (typeof value === 'string' && value.length > 0) return { ok: true, value };
  return { ok: false, reason: 'deletedAt 不正确' };
}

function readExtensions(
  value: unknown,
): { ok: true; value: ImportIdeaInput['extensions'] } | { ok: false; reason: string } {
  if (value === undefined) return { ok: true, value: [] };
  if (!Array.isArray(value)) return { ok: false, reason: '追记格式不正确' };
  const extensions: ImportIdeaInput['extensions'] = [];
  for (const item of value) {
    if (!isRecord(item) || typeof item.body !== 'string' || typeof item.createdAt !== 'string') {
      return { ok: false, reason: '追记格式不正确' };
    }
    extensions.push({ body: item.body, createdAt: item.createdAt });
  }
  return { ok: true, value: extensions };
}

function readDimension(value: unknown, field: string): { ok: true; value: number | null } | { ok: false; reason: string } {
  if (value === undefined || value === null) return { ok: true, value: null };
  if (typeof value === 'number' && Number.isInteger(value)) return { ok: true, value };
  return { ok: false, reason: `${field} 不正确` };
}

function readSidecarSha256(storeDir: string, sourceId: string): string | null {
  const sidecar = join(storeDir, ...MEDIA_PARTS, `${sourceId}.json`);
  let text: string;
  try {
    text = readFileSync(sidecar, 'utf8');
  } catch {
    return null;
  }
  try {
    const parsed = JSON.parse(text) as unknown;
    if (!isRecord(parsed) || typeof parsed.sha256 !== 'string' || parsed.sha256.length === 0) return null;
    return parsed.sha256;
  } catch {
    return null;
  }
}

function resolveInside(root: string, rawPath: string): string | null {
  const absolute = isAbsolute(rawPath) ? rawPath : resolve(root, rawPath);
  const normalizedRoot = resolve(root);
  const normalized = resolve(absolute);
  if (normalized === normalizedRoot) return null;
  const prefix = normalizedRoot.endsWith(sep) ? normalizedRoot : normalizedRoot + sep;
  if (!normalized.startsWith(prefix)) return null;
  return normalized;
}

function readId(value: Record<string, unknown>): string | null {
  return typeof value.id === 'string' && value.id.length > 0 ? value.id : null;
}

function expectRecords(value: unknown, label: string): Record<string, unknown>[] {
  if (!Array.isArray(value)) throw new Error(`${label} 必须是数组`);
  return value.map((item, index) => {
    if (!isRecord(item)) throw new Error(`${label}[${index}] 必须是对象`);
    return item;
  });
}

function readPath(root: Record<string, unknown>, path: readonly string[]): unknown {
  let current: unknown = root;
  for (const key of path) {
    if (!isRecord(current)) return undefined;
    current = current[key];
  }
  return current;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
